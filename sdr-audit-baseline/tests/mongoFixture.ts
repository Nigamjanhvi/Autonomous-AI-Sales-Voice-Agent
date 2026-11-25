import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";

export async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

async function openPort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

export async function startTestMongo() {
  if (process.env.MONGODB_TEST_URI) return { uri: process.env.MONGODB_TEST_URI, close: async () => {} };

  const port = await openPort();
  const directory = await mkdtemp(join(tmpdir(), "sdr-mongo-test-"));
  const address = "127.0.0.1:" + port;
  const replSet = "sdr-integration";
  const mongod = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--replSet", replSet, "--quiet",
  ], { stdio: "ignore", windowsHide: true });
  let spawnFailed = false;
  mongod.on("error", () => { spawnFailed = true; });
  const close = async () => {
    await stopProcess(mongod);
    if (dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith("sdr-mongo-test-")) {
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  };
  const initial = new mongoose.mongo.MongoClient(`mongodb://${address}/admin?directConnection=true`, { serverSelectionTimeoutMS: 500 });
  try {
    let connected = false;
    for (let index = 0; index < 30 && !spawnFailed && mongod.exitCode === null; index += 1) {
      try { await initial.connect(); connected = true; break; }
      catch { await delay(200); }
    }
    if (!connected) throw new Error("Could not start mongod. Install MongoDB or set MONGODB_TEST_URI to a test replica set.");
    await initial.db("admin").command({ replSetInitiate: { _id: replSet, members: [{ _id: 0, host: address }] } });
    const uri = `mongodb://${address}/?replicaSet=${replSet}`;
    const replica = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
    try { await replica.connect(); await replica.db("admin").command({ ping: 1 }); }
    finally { await replica.close(); }
    return { uri, close };
  } catch (error) {
    await initial.close();
    await close();
    throw error;
  } finally {
    await initial.close();
  }
}
