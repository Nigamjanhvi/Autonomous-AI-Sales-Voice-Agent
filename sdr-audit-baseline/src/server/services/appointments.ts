import type { ClientSession } from "mongoose";
import { AppointmentModel } from "../db/models.js";
import { ApiError } from "../http/errors.js";
import type { CalendarSlot, Meeting } from "../types.js";
import { pageInfo, getLead } from "./leads.js";
import type { PageInput } from "./leads.js";

type AppointmentSlot = { slotId: string; start: Date; end: Date; salesRep: string };
type AppointmentFilters = PageInput & { leadId?: string; status?: "available" | "held" | "booked"; from?: string; to?: string };

const asMeeting = (slot: AppointmentSlot, leadId: string, notes: string): Meeting => ({
  slotId: slot.slotId, leadId, startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(), salesRep: slot.salesRep, notes,
});

export async function listAvailability(preferredDate?: string): Promise<CalendarSlot[]> {
  const slots = await AppointmentModel.find({ status: "available", start: { $gt: new Date() },
    ...(preferredDate ? { dateKey: preferredDate } : {}) }).sort({ start: 1, slotId: 1 }).limit(3).lean();
  return slots.map(({ slotId, start, end, salesRep }) => ({
    id: slotId, startsAt: start.toISOString(), endsAt: end.toISOString(), salesRep, available: true,
  }));
}

export async function getBookableMeeting(leadId: string, slotId: string, notes = "") {
  const slot = await AppointmentModel.findOne({ slotId }).lean();
  if (!slot) throw new ApiError(404, "SLOT_NOT_FOUND", "Calendar slot not found.");
  if (slot.status !== "available" || slot.start <= new Date()) {
    throw new ApiError(409, "SLOT_UNAVAILABLE", "That slot is no longer available. Check availability for another time.");
  }
  return asMeeting(slot, leadId, notes);
}

export async function reserveAppointment(leadId: string, slotId: string, notes = "", session?: ClientSession, callId?: string) {
  const slot = await AppointmentModel.findOneAndUpdate(
    { slotId, status: "available", start: { $gt: new Date() } },
    { $set: { status: "booked", leadId, notes, bookedAt: new Date(), ...(callId ? { callId } : {}) } },
    { new: true, session },
  ).lean();
  if (!slot) {
    const exists = await AppointmentModel.exists({ slotId }).session(session ?? null);
    if (!exists) throw new ApiError(404, "SLOT_NOT_FOUND", "Calendar slot not found.");
    throw new ApiError(409, "SLOT_UNAVAILABLE", "That slot is no longer available. Check availability for another time.");
  }
  return asMeeting(slot, leadId, notes);
}

export async function bookAppointment(leadId: string, slotId: string, notes?: string) {
  await getLead(leadId);
  return reserveAppointment(leadId, slotId, notes);
}

export async function listAppointments({ leadId, status, from, to, page, limit }: AppointmentFilters) {
  const filter: Record<string, unknown> = { status: status ?? "booked" };
  if (leadId) filter.leadId = leadId;
  if (from || to) filter.start = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
  const pagination = pageInfo({ page, limit }, await AppointmentModel.countDocuments(filter));
  const slots = await AppointmentModel.find(filter).sort({ start: 1, slotId: 1 })
    .skip((pagination.page - 1) * pagination.limit).limit(pagination.limit).lean();
  return {
    appointments: slots.map((slot) => ({
      slotId: slot.slotId, startsAt: slot.start.toISOString(), endsAt: slot.end.toISOString(),
      salesRep: slot.salesRep, status: slot.status, leadId: slot.leadId, callId: slot.callId, notes: slot.notes, bookedAt: slot.bookedAt,
    })),
    pagination,
  };
}
