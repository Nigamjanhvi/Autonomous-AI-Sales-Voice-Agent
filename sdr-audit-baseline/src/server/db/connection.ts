import mongoose from "mongoose";
import { agentConfig } from "../config/agent.config.js";
import { AgentConfigurationModel, AppointmentModel, LeadModel, databaseModels } from "./models.js";
import calendar from "../data/calendar.mock.json" with { type: "json" };
import leads from "../data/crm.mock.json" with { type: "json" };
import type { Lead } from "../types.js";
import { seedDemoKnowledge } from "../services/knowledge.js";

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error("MONGODB_URI must be configured.");
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB?.trim() || undefined,
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
    autoIndex: false,
  });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("MongoDB must use a replica set or sharded cluster.");
  // Build declared indexes without dropping indexes managed outside the application.
  await Promise.all(databaseModels.map(async (Model) => { await Model.createIndexes(); }));
  await AgentConfigurationModel.updateOne({ key: "default" }, { $setOnInsert: { key: "default", ...agentConfig } }, { upsert: true });
  if (process.env.SEED_DEMO_DATA === "true") {
    await seedDemoData();
    await seedDemoKnowledge();
  }
}

async function seedDemoData() {
  const createdAt = new Date();
  await LeadModel.bulkWrite((leads as Lead[]).map((lead) => ({
    updateOne: { filter: { id: lead.id }, update: { $setOnInsert: { ...lead, createdAt, updatedAt: createdAt } }, upsert: true, timestamps: false },
  })));
  const tomorrow = new Date();
  tomorrow.setUTCHours(0, 0, 0, 0);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const fixtureDay = Date.parse(`${calendar[0].startsAt.slice(0, 10)}T00:00:00.000Z`);
  await AppointmentModel.bulkWrite(calendar.map((slot) => {
    const start = new Date(tomorrow.getTime() + Date.parse(slot.startsAt) - fixtureDay);
    const end = new Date(start.getTime() + Date.parse(slot.endsAt) - Date.parse(slot.startsAt));
    return {
      updateOne: {
        filter: { slotId: slot.id },
        update: { $setOnInsert: { slotId: slot.id, start, end, dateKey: start.toISOString().slice(0, 10),
          salesRep: slot.salesRep, status: slot.available ? "available" : "held", notes: slot.notes, createdAt, updatedAt: createdAt } },
        upsert: true, timestamps: false,
      },
    };
  }));
}

export async function databaseHealthy() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  try {
    await mongoose.connection.db.command({ ping: 1 }, { timeoutMS: 1500 });
    return true;
  } catch {
    return false;
  }
}

export const disconnectDatabase = () => mongoose.disconnect();
