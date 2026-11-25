import { model, Schema } from "mongoose";
import type { AgentAnalysis, CallResult, CallSummary, CallTranscriptEntry, Lead, LeadOutcomeClassification, SalesFact } from "../types.js";

const documentOptions = { timestamps: true, versionKey: false, minimize: false } as const;
const nestedOptions = { _id: false, minimize: false };
const requiredString = { type: String, required: true };

export const leadScenarios = ["interested", "busy", "not_interested", "budget_objection", "send_email", "existing_crm", "authority_objection", "security_concern"] as const;
export const outcomes = ["meeting_booked", "send_email", "call_back_later", "not_interested", "disqualified", "needs_human_follow_up"] as const;
export const meetingStatuses = ["booked", "not_booked", "follow_up_needed"] as const;
export const interestLevels = ["high", "medium", "low", "none"] as const;

const salesFactSchema = new Schema<SalesFact>({ kind: requiredString, evidence: requiredString }, nestedOptions);
const leadFields = {
  id: requiredString,
  scenario: { ...requiredString, enum: leadScenarios },
  name: requiredString,
  title: requiredString,
  company: requiredString,
  industry: requiredString,
  companySize: requiredString,
  currentTools: { type: [String], default: [] },
  painHint: { type: String, default: "" },
  discussionTopic: requiredString,
  previousInteraction: { type: String, default: "" },
  workEmail: requiredString,
  phoneNumber: String,
  salesDiscovery: { type: [salesFactSchema], default: undefined },
  doNotContact: Boolean,
};
type LeadDocument = Lead & { deletedAt: Date | null; createdAt: Date };
const leadSchema = new Schema<LeadDocument>({ ...leadFields, deletedAt: { type: Date, default: null } }, documentOptions);
leadSchema.index({ id: 1 }, { unique: true });
leadSchema.index({ deletedAt: 1, createdAt: 1, _id: 1 });
leadSchema.index({ deletedAt: 1, scenario: 1, industry: 1 });
export const LeadModel = model("Lead", leadSchema);

const userSchema = new Schema({
  email: { ...requiredString, trim: true, lowercase: true },
  name: requiredString,
  role: { ...requiredString, enum: ["admin", "operator"], default: "operator" },
  passwordHash: { type: String, select: false },
}, documentOptions);
userSchema.index({ email: 1 }, { unique: true });
export const UserModel = model("User", userSchema);

export type CallKind = "demo" | "interactive" | "vapi";
export type CallState = "active" | "completed";
export type CallDocument = Pick<CallResult, "callId" | "mode" | "agent" | "statusEvents" | "toolCalls" | "intentDetections"> & {
  leadId: string;
  lead: Lead;
  kind: CallKind;
  status: CallState;
  outcome: LeadOutcomeClassification["outcome"];
  startedAt: Date;
  endedAt?: Date;
  offeredSlotIds: string[];
  turnToken?: string;
  turnExpiresAt?: Date;
  analysis?: AgentAnalysis;
};
const statusEventSchema = new Schema<CallResult["statusEvents"][number]>({
  status: { ...requiredString, enum: ["idle", "thinking", "agent_speaking", "lead_speaking"] }, label: requiredString,
}, nestedOptions);
const toolCallSchema = new Schema<CallResult["toolCalls"][number]>({
  name: requiredString, input: { type: Schema.Types.Mixed, default: {} }, output: Schema.Types.Mixed,
}, nestedOptions);
const intentDetectionSchema = new Schema<NonNullable<CallResult["intentDetections"]>[number]>({
  leadMessage: requiredString,
  intent: requiredString,
  objectionType: requiredString,
  nextAgentMove: requiredString,
  shouldCheckCalendar: Boolean,
  shouldBookMeeting: Boolean,
  reasoning: String,
}, nestedOptions);
const callSchema = new Schema<CallDocument>({
  callId: requiredString,
  leadId: requiredString,
  lead: { type: new Schema<Lead>(leadFields, nestedOptions), required: true },
  agent: {
    type: new Schema<CallResult["agent"]>({ name: requiredString, role: requiredString, company: { type: String, default: "" } }, nestedOptions),
    required: true,
  },
  mode: { ...requiredString, enum: ["deterministic", "llm"] },
  kind: { ...requiredString, enum: ["demo", "interactive", "vapi"] },
  status: { ...requiredString, enum: ["active", "completed"] },
  outcome: { ...requiredString, enum: outcomes },
  startedAt: { type: Date, required: true },
  endedAt: Date,
  statusEvents: { type: [statusEventSchema], default: [] },
  toolCalls: { type: [toolCallSchema], default: [] },
  intentDetections: { type: [intentDetectionSchema], default: undefined },
  offeredSlotIds: { type: [String], default: [] },
  turnToken: String,
  turnExpiresAt: Date,
  analysis: Schema.Types.Mixed,
}, documentOptions);
callSchema.index({ callId: 1 }, { unique: true });
callSchema.index({ startedAt: -1, callId: 1 });
callSchema.index({ leadId: 1, startedAt: -1 });
callSchema.index({ outcome: 1, startedAt: -1 });
callSchema.index({ status: 1, startedAt: -1 });
export const CallModel = model("Call", callSchema);

const messageSchema = new Schema<CallTranscriptEntry>({
  speaker: { ...requiredString, enum: ["agent", "lead"] },
  name: requiredString,
  message: requiredString,
}, nestedOptions);
const conversationSchema = new Schema<{ callId: string; leadId: string; messages: CallTranscriptEntry[] }>({
  callId: requiredString,
  leadId: requiredString,
  messages: { type: [messageSchema], default: [] },
}, documentOptions);
conversationSchema.index({ callId: 1 }, { unique: true });
export const ConversationModel = model("Conversation", conversationSchema);

const summaryFields = new Schema<CallSummary>({
  leadId: requiredString,
  leadName: requiredString,
  company: requiredString,
  painPoints: { type: [String], default: [] },
  objections: { type: [String], default: [] },
  interestLevel: { ...requiredString, enum: interestLevels },
  meetingStatus: { ...requiredString, enum: meetingStatuses },
  bookedSlotId: String,
  recommendedNextAction: requiredString,
  shortSummaryForSales: requiredString,
}, nestedOptions);
const classificationFields = new Schema<LeadOutcomeClassification>({
  outcome: { ...requiredString, enum: outcomes },
  recommendedNextAction: requiredString,
  reason: requiredString,
}, nestedOptions);
const summarySchema = new Schema({
  id: requiredString,
  callId: String,
  leadId: requiredString,
  summary: { type: summaryFields, required: true },
  classification: { type: classificationFields, required: true },
}, documentOptions);
summarySchema.index({ id: 1 }, { unique: true });
summarySchema.index({ callId: 1 }, { unique: true, sparse: true });
summarySchema.index({ leadId: 1, createdAt: -1 });
export const SummaryModel = model("Summary", summarySchema);

const appointmentSchema = new Schema({
  slotId: requiredString,
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  dateKey: requiredString,
  salesRep: requiredString,
  status: { ...requiredString, enum: ["available", "held", "booked"] as const },
  leadId: String,
  callId: String,
  notes: String,
  bookedAt: Date,
}, documentOptions);
appointmentSchema.index({ slotId: 1 }, { unique: true });
appointmentSchema.index({ callId: 1 }, { unique: true, sparse: true });
appointmentSchema.index({ status: 1, start: 1, slotId: 1 });
appointmentSchema.index({ status: 1, dateKey: 1, start: 1 });
appointmentSchema.index({ leadId: 1, start: 1 });
export const AppointmentModel = model("Appointment", appointmentSchema);

const knowledgeDocumentSchema = new Schema({
  documentId: requiredString, workspaceId: { ...requiredString, default: "workspace_default" }, title: requiredString, fileName: requiredString,
  contentType: requiredString, size: { type: Number, min: 0, required: true },
  storageKey: String,
  status: { ...requiredString, enum: ["uploaded", "processing", "indexed", "failed", "deleted", "pending", "ready"], default: "uploaded" },
  error: String, checksum: String,
}, documentOptions);
knowledgeDocumentSchema.index({ documentId: 1 }, { unique: true });
knowledgeDocumentSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
export const KnowledgeDocumentModel = model("KnowledgeDocument", knowledgeDocumentSchema);

const knowledgeChunkSchema = new Schema({
  documentId: requiredString, workspaceId: { ...requiredString, default: "workspace_default" }, position: { type: Number, min: 0, required: true }, content: requiredString,
  embedding: { type: [Number], default: undefined }, page: Number, section: String,
}, documentOptions);
knowledgeChunkSchema.index({ documentId: 1, position: 1 }, { unique: true });
knowledgeChunkSchema.index({ workspaceId: 1, content: "text" });
export const KnowledgeChunkModel = model("KnowledgeChunk", knowledgeChunkSchema);

const agentConfigurationSchema = new Schema({
  key: requiredString, name: requiredString, role: requiredString, gender: String, company: String,
  shortProfile: requiredString, language: String, voice: String, qualificationCriteria: [String],
}, documentOptions);
agentConfigurationSchema.index({ key: 1 }, { unique: true });
export const AgentConfigurationModel = model("AgentConfiguration", agentConfigurationSchema);

export const databaseModels = [
  LeadModel, UserModel, CallModel, ConversationModel, SummaryModel, AppointmentModel,
  KnowledgeDocumentModel, KnowledgeChunkModel, AgentConfigurationModel,
];
