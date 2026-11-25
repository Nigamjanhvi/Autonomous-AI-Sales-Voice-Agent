import dotenv from "dotenv";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./db/connection.js";

dotenv.config({ quiet: true });

try {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT.");
  await connectDatabase();
  const app = createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(port, process.env.HOST || "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  console.log("AI SDR API listening on port " + (typeof address === "object" ? address?.port : port));
  const shutdown = () => server.close(() => { void disconnectDatabase().catch(() => { process.exitCode = 1; }); });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  console.error("API startup failed. Verify HOST, PORT, MONGODB_URI, replica-set connectivity, and database permissions.");
  await disconnectDatabase().catch(() => {});
  process.exitCode = 1;
}
