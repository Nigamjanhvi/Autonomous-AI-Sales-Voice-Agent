import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { LeadModel } from "../db/models.js";
import { ApiError } from "../http/errors.js";
import type { Lead, SalesFact } from "../types.js";

type LeadInput = Omit<Lead, "id" | "salesDiscovery" | "doNotContact">;
type LeadPatch = Partial<Omit<LeadInput, "phoneNumber">> & { phoneNumber?: string | null };
export type PageInput = { page?: number; limit?: number };
type LeadFilters = PageInput & { search?: string; industry?: string; scenario?: Lead["scenario"] };
const projection = "-_id -createdAt -updatedAt -deletedAt";

export function pageInfo({ page = 1, limit = 25 }: PageInput, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export async function listLeads({ search, scenario, industry, page, limit }: LeadFilters = {}) {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (scenario) filter.scenario = scenario;
  if (industry) filter.industry = industry;
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = ["name", "company", "workEmail"].map((field) => ({ [field]: pattern }));
  }
  const query = LeadModel.find(filter).select(projection).sort({ createdAt: 1, _id: 1 }).lean<Lead[]>();
  // The original unparameterized endpoint supplies the dashboard's full lead list.
  if (!page && !limit && !search && !scenario && !industry) return { leads: await query };
  const pagination = pageInfo({ page, limit }, await LeadModel.countDocuments(filter));
  return { leads: await query.skip((pagination.page - 1) * pagination.limit).limit(pagination.limit), pagination };
}

export async function getLead(leadId: string) {
  const lead = await LeadModel.findOne({ id: leadId, deletedAt: null }).select(projection).lean<Lead>();
  if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found.");
  return lead;
}

export async function createLead(input: LeadInput) {
  const lead = { ...input, id: `lead_${randomUUID()}` };
  await LeadModel.create(lead);
  return lead;
}

export async function updateLead(leadId: string, { phoneNumber, ...fields }: LeadPatch) {
  const update = phoneNumber === null
    ? { $set: fields, $unset: { phoneNumber: 1 } }
    : { $set: phoneNumber === undefined ? fields : { ...fields, phoneNumber } };
  const lead = await LeadModel.findOneAndUpdate({ id: leadId, deletedAt: null }, update, { new: true, runValidators: true })
    .select(projection).lean<Lead>();
  if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found.");
  return lead;
}

export async function deleteLead(leadId: string) {
  const result = await LeadModel.updateOne({ id: leadId, deletedAt: null }, { $set: { deletedAt: new Date() } });
  if (!result.matchedCount) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found.");
}

export function assertContactAllowed(lead: Lead) {
  if (lead.doNotContact) throw new ApiError(409, "CONTACT_OPTED_OUT", "This lead has opted out of outreach.");
}

export async function persistSalesDiscovery(leadId: string, facts: SalesFact[], optedOut: boolean, session: ClientSession) {
  if (!facts.length && !optedOut) return;
  const existing = { $ifNull: ["$salesDiscovery", []] };
  const incoming = { $literal: facts };
  const update = await LeadModel.updateOne({ id: leadId, deletedAt: null }, [
    { $set: {
      ...(facts.length ? { salesDiscovery: { $slice: [{
        $concatArrays: [{ $filter: { input: existing, cond: { $not: [{ $in: ["$$this", incoming] }] } } }, incoming],
      }, -30] } } : {}),
      ...(optedOut ? { doNotContact: true } : {}),
    } },
  ], { session, updatePipeline: true });
  if (!update.matchedCount) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found.");
}
