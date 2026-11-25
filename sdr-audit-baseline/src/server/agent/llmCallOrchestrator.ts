import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { carlaSystemPrompt } from "./carlaSystemPrompt.js";
import { agentConfig } from "../config/agent.config.js";
import { ApiError, isDuplicate } from "../http/errors.js";
import { callIsComplete, getCall, persistCall, withCallTurn } from "../services/calls.js";
import { prepareMeeting } from "../tools/bookMeeting.js";
import { checkCalendarAvailability } from "../tools/checkCalendarAvailability.js";
import { classifyLeadOutcome } from "../tools/classifyLeadOutcome.js";
import { getLeadContext } from "../tools/getLeadContext.js";
import type {
  CalendarSlot,
  CallResult,
  CallStatus,
  CallTranscriptEntry,
  CallSummary,
  CallToolCall,
  Lead,
  LeadIntentDetection,
} from "../types.js";

type CarlaTurn = {
  reply: string;
  detectedPainPoints: string[];
  detectedObjections: string[];
  interestLevel: "high" | "medium" | "low" | "none";
  recommendedToolCall: {
    name:
      | "getLeadContext"
      | "checkCalendarAvailability"
      | "bookMeeting"
      | "saveCallSummary"
      | "classifyLeadOutcome"
      | "none";
    reason: string;
  };
  outcome:
    | "meeting_booked"
    | "interested"
    | "send_follow_up"
    | "call_back_later"
    | "not_interested"
    | "unqualified";
  nextBestAction: string;
};

type LeadScriptTurn = {
  lead: string;
};

type LeadContextForLlm = Omit<Lead, "scenario" | "phoneNumber">;

const leadIntentValues = [
  "interested",
  "objection",
  "send_follow_up",
  "call_back_later",
  "not_interested",
  "unqualified",
] as const;

const objectionTypeValues = [
  "budget",
  "timing",
  "existing_tools",
  "authority",
  "fit",
  "none",
] as const;

const nextAgentMoveValues = [
  "ask_discovery",
  "handle_objection",
  "offer_meeting",
  "offer_email",
  "close",
] as const;

const carlaTurnSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  detectedPainPoints: z.array(z.string().max(500)).max(30).default([]),
  detectedObjections: z.array(z.string().max(500)).max(30).default([]),
  interestLevel: z.enum(["high", "medium", "low", "none"]),
  recommendedToolCall: z.object({
    name: z.enum(["getLeadContext", "checkCalendarAvailability", "bookMeeting", "saveCallSummary", "classifyLeadOutcome", "none"]),
    reason: z.string().max(1000),
  }),
  outcome: z.enum(["meeting_booked", "interested", "send_follow_up", "call_back_later", "not_interested", "unqualified"]),
  nextBestAction: z.string().trim().min(1).max(1000),
});
const intentSchema = z.object({
  intent: z.enum(leadIntentValues),
  objectionType: z.enum(objectionTypeValues),
  shouldCheckCalendar: z.boolean(),
  shouldBookMeeting: z.boolean(),
  nextAgentMove: z.enum(nextAgentMoveValues),
  reasoning: z.string().max(1000),
});

function parseModelOutput<T>(schema: z.ZodType<T>, content: string | null | undefined): T {
  try { return schema.parse(JSON.parse(content ?? "")); }
  catch { throw new ApiError(502, "INVALID_MODEL_RESPONSE", "The AI provider returned an invalid response. Try again."); }
}

const model = () => process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

const maxOutputTokens = () => {
  const parsed = Number(process.env.MAX_OUTPUT_TOKENS ?? 220);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 220;
};

const maxTurns = () => {
  const parsed = Number(process.env.MAX_CALL_TURNS ?? 8);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10) : 8;
};

const maxInteractiveLeadTurns = () => {
  const parsed = Number(process.env.MAX_INTERACTIVE_LEAD_TURNS ?? 6);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 8) : 6;
};

const requireApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || apiKey === "replace_me") {
    throw new ApiError(503, "OPENAI_NOT_CONFIGURED",
      "AGENT_MODE=llm requires OPENAI_API_KEY in .env. Keep AGENT_MODE=deterministic to run without LLM cost.",
    );
  }

  return apiKey;
};
const modelClient = () => new OpenAI({ apiKey: requireApiKey(), timeout: 25_000, maxRetries: 1 });

export const runLlmCall = async (leadId: string): Promise<CallResult> => {
  const startedAt = new Date();
  const lead = await getLeadContext(leadId);
  const client = modelClient();
  const id = `call_${randomUUID()}`;
  const transcript: CallResult["transcript"] = [];
  const statusEvents: CallResult["statusEvents"] = [];
  const toolCalls: CallToolCall[] = [
    {
      name: "getLeadContext",
      input: { leadId },
      output: lead,
    },
  ];
  const painPoints = new Set<string>();
  const objections = new Set<string>();
  const intentDetections: LeadIntentDetection[] = [];
  let interestLevel: CallSummary["interestLevel"] = "low";
  let meetingStatus: CallSummary["meetingStatus"] = "not_booked";
  let bookedSlotId: string | undefined;
  let nextBestAction = "Review the LLM call transcript and choose the next step.";

  const setStatus = (status: CallStatus, label: string) => {
    statusEvents.push({ status, label });
  };

  const agentSays = (message: string) => {
    setStatus("agent_speaking", `${agentConfig.name} speaking`);
    transcript.push({ speaker: "agent", name: agentConfig.name, message });
  };

  const leadSays = (message: string) => {
    setStatus("lead_speaking", `${lead.name} speaking`);
    transcript.push({ speaker: "lead", name: lead.name, message });
  };

  setStatus("thinking", "Loading lead context");
  const leadTurns = leadScriptFor(lead).slice(0, maxTurns());

  setStatus("thinking", "Carla is preparing the opening");
  const openingTurn = await generateCarlaTurn(client, lead, transcript);
  collectSignals(openingTurn, painPoints, objections);
  interestLevel = openingTurn.interestLevel;
  nextBestAction = openingTurn.nextBestAction;
  agentSays(openingTurn.reply);

  for (const leadTurn of leadTurns) {
    leadSays(leadTurn.lead);
    setStatus("thinking", "Reading lead intent");
    const leadIntent = await detectLeadIntent(client, lead, transcript, leadTurn.lead);
    intentDetections.push(leadIntent);

    if (shouldForceScriptedBooking(lead, leadTurn.lead)) {
      setStatus("thinking", "Checking calendar availability");
      const slots = await checkCalendarAvailability();
      toolCalls.push({
        name: "checkCalendarAvailability",
        input: {},
        output: slots,
      });

      const slot = slots[0];
      if (slot) {
        agentSays(`I checked the calendar and have ${formatSlot(slot)} with ${slot.salesRep}. Does that work?`);
        leadSays("Yes, that works. Please send the invite.");
        setStatus("thinking", "Booking meeting");
        const meeting = await prepareMeeting(
          lead.id,
          slot.id,
          "Qualified AI scripted call: lead asked to book a workflow-focused demo.",
        );
        toolCalls.push({
          name: "bookMeeting",
          input: { leadId: lead.id, slotId: slot.id },
          output: meeting,
        });
        bookedSlotId = meeting.slotId;
        meetingStatus = "booked";
        interestLevel = "high";
        nextBestAction = "Send calendar invite and prepare a workflow-focused demo.";
        agentSays(
          `Perfect, I booked the demo with ${meeting.salesRep}. We will send the invite to ${lead.workEmail}. Thanks ${lead.name}.`,
        );
      } else {
        meetingStatus = "follow_up_needed";
        nextBestAction = `Email available demo times to ${lead.workEmail}.`;
        agentSays(
          `I do not see an open slot in the calendar right now, so I will have the team send available demo times to ${lead.workEmail}.`,
        );
      }
      break;
    }

    setStatus("thinking", "Carla is reasoning from lead response");
    const carlaTurn = await generateCarlaTurn(client, lead, transcript);
    collectSignals(carlaTurn, painPoints, objections);
    interestLevel = carlaTurn.interestLevel;
    nextBestAction = carlaTurn.nextBestAction;
    agentSays(carlaTurn.reply);

    if (leadIntent.shouldCheckCalendar && leadIntent.nextAgentMove === "offer_meeting") {
      setStatus("thinking", "Checking calendar availability");
      const slots = await checkCalendarAvailability();
      toolCalls.push({
        name: "checkCalendarAvailability",
        input: {},
        output: slots,
      });

      const slot = slots[0];
      if (slot) {
        agentSays(`I have ${slot.startsAt} with ${slot.salesRep}. Would that work?`);
        leadSays("Yes, that works.");
        setStatus("thinking", "Booking meeting");
        const meeting = await prepareMeeting(
          lead.id,
          slot.id,
          "Qualified LLM call: lead agreed to a meeting.",
        );
        toolCalls.push({
          name: "bookMeeting",
          input: { leadId: lead.id, slotId: slot.id },
          output: meeting,
        });
        bookedSlotId = meeting.slotId;
        meetingStatus = "booked";
        interestLevel = "high";
        nextBestAction = "Send calendar invite and prepare sales rep with call context.";
        agentSays(`Great, I booked it with ${meeting.salesRep}. Thanks ${lead.name}.`);
      } else {
        meetingStatus = "follow_up_needed";
        nextBestAction = "Have sales follow up with available meeting times.";
      }
      break;
    }

    if (leadIntent.intent !== "interested" && leadIntent.nextAgentMove !== "ask_discovery") {
      meetingStatus =
        leadIntent.intent === "not_interested" || leadIntent.intent === "unqualified"
          ? "not_booked"
          : "follow_up_needed";
      nextBestAction = nextBestActionFor(leadIntent);
    }
  }

  const summary: CallSummary = {
    leadId: lead.id,
    leadName: lead.name,
    company: lead.company,
    painPoints: [...painPoints],
    objections: [...objections],
    interestLevel,
    meetingStatus,
    bookedSlotId,
    recommendedNextAction: nextBestAction,
    shortSummaryForSales: shortSummaryFor(lead, interestLevel, meetingStatus, nextBestAction),
  };
  const transcriptText = transcript.map((entry) => entry.message).join("\n");
  const classification = classifyLeadOutcome(transcriptText, summary);

  setStatus("thinking", "Saving call summary");

  const result: CallResult = {
    callId: id,
    mode: "llm",
    agent: {
      name: agentConfig.name,
      role: agentConfig.role,
      company: agentConfig.company,
    },
    lead,
    statusEvents: [...statusEvents, { status: "idle", label: "Call ended" }],
    transcript,
    toolCalls,
    intentDetections,
    summary,
    classification,
  };

  return persistCall(result, { kind: "demo", startedAt, createOnly: true });
};

export const startInteractiveLlmCall = async (
  leadId: string,
  voice?: { providerCallId?: string },
): Promise<CallResult> => {
  const startedAt = new Date();
  const stableId = voice?.providerCallId ? voiceCallId(voice.providerCallId) : undefined;
  if (stableId) {
    try {
      const existing = await existingVoiceCall(stableId, leadId);
      if (existing.transcript.length || callIsComplete(existing)) return existing;
      return await withCallTurn(stableId, leadId, async (turnToken) => {
        const current = await existingVoiceCall(stableId, leadId);
        if (current.transcript.length) return current;
        const result = await generateOpening(stableId, current.lead);
        return persistCall(result, { kind: "vapi", turnToken });
      });
    }
    catch (error) {
      if (!(error instanceof ApiError && error.code === "CALL_NOT_FOUND")) throw error;
    }
  }

  const lead = await getLeadContext(leadId);
  const result = await generateOpening(stableId ?? "call_" + randomUUID(), lead);
  try {
    return await persistCall(result, { kind: voice ? "vapi" : "interactive", startedAt, createOnly: true });
  } catch (error) {
    if (stableId && isDuplicate(error)) return existingVoiceCall(stableId, leadId);
    throw error;
  }
};

async function generateOpening(callId: string, lead: Lead) {
  const opening = await generateCarlaTurn(modelClient(), lead, []);
  return interactiveCallResult({
    callId,
    lead,
    transcript: [{ speaker: "agent", name: agentConfig.name, message: opening.reply }],
    toolCalls: [{ name: "getLeadContext", input: { leadId: lead.id }, output: lead }],
    statusEvents: [
      { status: "thinking", label: "Loading lead context" },
      { status: "thinking", label: "Carla is preparing the opening" },
      { status: "agent_speaking", label: agentConfig.name + " speaking" },
    ],
    intentDetections: [],
    latestTurn: opening,
  });
}

export function voiceCallId(providerId: string) {
  return providerId.startsWith("vapi_") || providerId.startsWith("call_") ? providerId : "vapi_" + providerId;
}

async function existingVoiceCall(callId: string, leadId: string) {
  const { call, metadata } = await getCall(callId);
  if (metadata.kind !== "vapi" || metadata.leadId !== leadId) {
    throw new ApiError(409, "CALL_MISMATCH", "The provider call does not match this lead.");
  }
  return call;
}

export const runInteractiveLlmTurn = async ({
  callId, leadId, leadReply, expectedMessageCount, kind = "interactive",
}: {
  callId?: string;
  leadId: string;
  leadReply: string;
  expectedMessageCount?: number;
  kind?: "interactive" | "vapi";
}): Promise<CallResult> => {
  const id = callId ?? (await startInteractiveLlmCall(leadId)).callId;
  await getLeadContext(leadId);
  return withCallTurn(id, leadId, async (turnToken) => {
    const { call: prior, metadata, offeredSlotIds: previousOptions } = await getCall(id);
    if (metadata.kind !== kind) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found for this transport.");
    if (callId && expectedMessageCount !== undefined && prior.transcript.length !== expectedMessageCount) {
      throw new ApiError(409, "STALE_TRANSCRIPT", "This call has advanced. Reload the call before submitting another reply.");
    }
    const { lead, transcript } = prior;
    const entries: CallTranscriptEntry[] = [...transcript, { speaker: "lead", name: lead.name, message: leadReply }];
    const statusEvents: CallResult["statusEvents"] = [
      { status: "lead_speaking", label: lead.name + " speaking" },
      { status: "thinking", label: "Reading lead intent" },
    ];
    const client = modelClient();
    const intent = await detectLeadIntent(client, lead, entries, leadReply);
    const tools: CallToolCall[] = [];
    let offeredSlotIds = previousOptions;
    let summary: CallSummary | undefined;
    let terminal = false;
    let turn: CarlaTurn;
    const acceptedSlotId = selectOfferedSlot(previousOptions, leadReply);

    if (shouldSendTimeSlotsByEmail(leadReply, transcript)) {
      const nextAction = "Email available meeting time slots to " + lead.workEmail + ".";
      turn = scriptedTurn("Absolutely. I will have the team send available meeting times. Thanks for your time.",
        "high", nextAction, "send_follow_up");
      summary = { ...prior.summary, interestLevel: "high", meetingStatus: "follow_up_needed",
        recommendedNextAction: nextAction, shortSummaryForSales: lead.name + " asked for available meeting times by email." };
      terminal = true;
    } else if (/\b(remove me|stop (calling|contacting me)|opt me out|do not (call|contact) me)\b/i.test(leadReply)) {
      turn = scriptedTurn("Understood. I’ll end the call and note your request. Thank you.", "none",
        "Stop active outreach and record the opt-out request.", "not_interested");
      terminal = true;
    } else if (acceptedSlotId) {
      statusEvents.push({ status: "thinking", label: "Booking meeting" });
      const meeting = await prepareMeeting(lead.id, acceptedSlotId, "Qualified interactive call: lead accepted an offered slot.");
      tools.push({ name: "bookMeeting", input: { leadId: lead.id, slotId: acceptedSlotId }, output: meeting });
      const formattedTime = formatSlot(meeting);
      const nextAction = "Send calendar invite and prepare sales rep with call context.";
      turn = scriptedTurn("Perfect, I booked " + formattedTime + " with " + meeting.salesRep + ". Thanks for your time.",
        "high", nextAction, "meeting_booked");
      summary = { ...prior.summary, interestLevel: "high", meetingStatus: "booked", bookedSlotId: meeting.slotId,
        recommendedNextAction: nextAction, shortSummaryForSales: lead.name + " booked a meeting with " + meeting.salesRep + " for " + formattedTime + "." };
      terminal = true;
    } else if (previousOptions.length > 0 && (intent.shouldBookMeeting || /^\s*(?:yes|sure|okay|ok)[.!\s]*$/i.test(leadReply))) {
      turn = scriptedTurn("Which of the offered options works best for you?", "high", "Wait for an explicit slot selection.", "interested");
    } else if (shouldOfferCalendarOptions(intent, leadReply, transcript)) {
      const slots = await availabilityForTurn(statusEvents, tools);
      offeredSlotIds = slots.slice(0, 2).map((slot) => slot.id);
      turn = scriptedTurn(calendarOptionsMessage(slots, lead), "high", calendarNextAction(slots), "interested");
    } else {
      statusEvents.push({ status: "thinking", label: "Carla is reasoning from lead response" });
      turn = await generateCarlaTurn(client, lead, entries);
      if (carlaPromisedCalendarCheck(turn) && intent.shouldCheckCalendar) {
        const slots = await availabilityForTurn(statusEvents, tools);
        offeredSlotIds = slots.slice(0, 2).map((slot) => slot.id);
        turn.reply = turn.reply + " " + calendarOptionsMessage(slots, lead);
        turn.nextBestAction = calendarNextAction(slots);
      }
    }

    statusEvents.push({ status: "agent_speaking", label: agentConfig.name + " speaking" });
    entries.push({ speaker: "agent", name: agentConfig.name, message: turn.reply });
    const result = interactiveCallResult({
      callId: id, lead, transcript: entries, toolCalls: tools, statusEvents,
      intentDetections: [...(prior.intentDetections ?? []), intent], latestTurn: turn,
      summaryOverride: summary, forceFinal: terminal,
    });
    if (!summary) {
      result.summary.painPoints = [...new Set([...prior.summary.painPoints, ...result.summary.painPoints])];
      result.summary.objections = [...new Set([...prior.summary.objections, ...result.summary.objections])];
    }
    return persistCall(result, { kind: metadata.kind, offeredSlotIds, turnToken });
  });
};

function scriptedTurn(reply: string, interestLevel: CarlaTurn["interestLevel"], nextBestAction: string, outcome: CarlaTurn["outcome"]): CarlaTurn {
  return { reply, detectedPainPoints: [], detectedObjections: [], interestLevel,
    recommendedToolCall: { name: "none", reason: "Handled by the call workflow." }, outcome, nextBestAction };
}

async function availabilityForTurn(statusEvents: CallResult["statusEvents"], toolCalls: CallToolCall[]) {
  statusEvents.push({ status: "thinking", label: "Checking calendar availability" });
  const slots = await checkCalendarAvailability();
  toolCalls.push({ name: "checkCalendarAvailability", input: {}, output: slots });
  return slots;
}

function calendarNextAction(slots: CalendarSlot[]) {
  return slots.length ? "Wait for the lead to confirm an offered slot." : "Have sales follow up with available meeting times.";
}

function selectOfferedSlot(options: string[], reply: string) {
  if (!options.length || /\b(no|not|nothing|neither|can't|won't|don't|cannot|maybe|if|unless|instead)\b/i.test(reply)) return undefined;
  const match = reply.trim().match(/^(?:yes[, ]+)?(?:the )?(?:(?:option\s*(1|2|one|two))|(?:(first|second)(?:\s+(?:one|option|slot))?))(?:\s+(?:works(?: for me)?|is fine|please))?[.!]*$/i);
  if (match) {
    const selected = (match[1] ?? match[2]).toLowerCase();
    return options[["1", "one", "first"].includes(selected) ? 0 : 1];
  }
  if (options.length === 1 && /^(yes|okay|ok|sure|that works|book it)(?:[, ]+please)?[.!]*$/i.test(reply.trim())) return options[0];
  return undefined;
}


const generateCarlaTurn = async (
  client: OpenAI,
  lead: Lead,
  transcript: CallResult["transcript"],
): Promise<CarlaTurn> => {
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.3,
    max_tokens: maxOutputTokens(),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: carlaSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Generate Carla's next call turn as JSON. Follow the structured output shape from the system prompt.",
          lead: leadContextForLlm(lead),
          transcript,
        }),
      },
    ],
  });
  return parseModelOutput(carlaTurnSchema, response.choices[0]?.message.content);
};

const interactiveCallResult = ({
  callId,
  lead,
  transcript,
  toolCalls,
  statusEvents,
  intentDetections,
  latestTurn,
  summaryOverride,
  forceFinal,
}: {
  callId: string;
  lead: Lead;
  transcript: CallResult["transcript"];
  toolCalls: CallToolCall[];
  statusEvents: CallResult["statusEvents"];
  intentDetections: LeadIntentDetection[];
  latestTurn: CarlaTurn;
  summaryOverride?: CallSummary;
  forceFinal?: boolean;
}): CallResult => {
  const summary: CallSummary = summaryOverride ?? {
    leadId: lead.id,
    leadName: lead.name,
    company: lead.company,
    painPoints: latestTurn.detectedPainPoints ?? [],
    objections: latestTurn.detectedObjections ?? [],
    interestLevel: latestTurn.interestLevel,
    meetingStatus: "not_booked",
    recommendedNextAction: latestTurn.nextBestAction,
    shortSummaryForSales: `Interactive call in progress with ${lead.name} at ${lead.company}.`,
  };
  const classification = classifyLeadOutcome(
    transcript.map((entry) => entry.message).join("\n"),
    summary,
  );
  const leadTurnCount = transcript.filter((entry) => entry.speaker === "lead").length;
  const isFinal =
    forceFinal || summary.meetingStatus === "booked" || leadTurnCount >= maxInteractiveLeadTurns();
  if (isFinal && !summaryOverride) {
    summary.shortSummaryForSales = shortSummaryFor(lead, summary.interestLevel, summary.meetingStatus, summary.recommendedNextAction);
  }

  return {
    callId,
    mode: "llm",
    agent: {
      name: agentConfig.name,
      role: agentConfig.role,
      company: agentConfig.company,
    },
    lead,
    statusEvents: [
      ...statusEvents,
      { status: "idle", label: isFinal ? "Call ended" : "Waiting for lead reply" },
    ],
    transcript,
    toolCalls,
    intentDetections,
    summary,
    classification,
  };
};

const detectLeadIntent = async (
  client: OpenAI,
  lead: Lead,
  transcript: CallResult["transcript"],
  leadMessage: string,
): Promise<LeadIntentDetection> => {
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.1,
    max_tokens: 180,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You classify one lead reply in an outbound sales call. Return only valid JSON. Do not write Carla's reply.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Classify the latest lead message. Use the exact enum values from the response shape. Set shouldCheckCalendar true only when the lead explicitly asks to schedule, book, discuss calendar availability, or choose a meeting time. Mere interest in a demo/product/help is not enough. Set shouldBookMeeting true only if the lead agreed to a specific available slot, otherwise false.",
          responseShape: {
            intent:
              "interested | objection | send_follow_up | call_back_later | not_interested | unqualified",
            objectionType: "budget | timing | existing_tools | authority | fit | none",
            shouldCheckCalendar: "boolean",
            shouldBookMeeting: "boolean",
            nextAgentMove:
              "ask_discovery | handle_objection | offer_meeting | offer_email | close",
            reasoning: "brief reason",
          },
          leadContext: leadContextForLlm(lead),
          transcript,
          latestLeadMessage: leadMessage,
        }),
      },
    ],
  });
  return { leadMessage, ...parseModelOutput(intentSchema, response.choices[0]?.message.content) };
};

const leadContextForLlm = (lead: Lead): LeadContextForLlm => {
  const { scenario: _scenario, phoneNumber: _phoneNumber, ...context } = lead;

  return context;
};

const shouldForceScriptedBooking = (lead: Lead, leadReply: string) =>
  lead.id === "lead_interested" &&
  /\b(book|schedule|set up|set-up)\b.{0,32}\b(demo|meeting|call)\b/.test(
    leadReply.toLowerCase(),
  );

const shouldOfferCalendarOptions = (
  intent: LeadIntentDetection,
  leadReply: string,
  transcript: CallTranscriptEntry[],
) => {
  const normalized = leadReply.toLowerCase();
  const previousAgentMessage =
    [...transcript].reverse().find((entry) => entry.speaker === "agent")?.message.toLowerCase() ?? "";
  const carlaAlreadySaidSheWillCheck =
    /\b(check|checking|look|looking)\b.{0,40}\b(calendar|availability|available times|time slots|slots)\b/.test(
      previousAgentMessage,
    );
  const leadAsksForCheckResult =
    /\b(did you check|have you checked|any update|what did you find|do you have times|what times|which slots|what slots)\b/.test(
      normalized,
    );
  const explicitlyAskedToSchedule =
    /\b(book|schedule|set up|set-up|arrange)\b.{0,32}\b(meeting|demo|call|time|slot)\b/.test(
      normalized,
    ) ||
    /\b(meeting|demo|call|time slot|time slots|availability|calendar)\b.{0,32}\b(book|schedule|available|work|works)\b/.test(
      normalized,
    ) ||
    /\b(when are you available|what times|which time|send.*time slot|send.*available time)\b/.test(
      normalized,
    );
  const shouldContinuePromisedCalendarCheck =
    carlaAlreadySaidSheWillCheck && leadAsksForCheckResult;

  return (
    shouldContinuePromisedCalendarCheck ||
    (explicitlyAskedToSchedule &&
      (intent.shouldCheckCalendar ||
        intent.nextAgentMove === "offer_meeting" ||
        /\b(book|meeting|demo|call|calendar|schedule|available|availability|time slot|time slots)\b/.test(
          normalized,
        )))
  );
};

const carlaPromisedCalendarCheck = (turn: CarlaTurn) => {
  const reply = turn.reply.toLowerCase();

  return (
    turn.recommendedToolCall.name === "checkCalendarAvailability" ||
    /\b(i'?ll|i will|let me|i can|going to)\b.{0,48}\b(check|look|find)\b.{0,48}\b(calendar|availability|available times|time slots|slots|openings)\b/.test(
      reply,
    ) ||
    /\b(check|look|find)\b.{0,48}\b(calendar|availability|available times|time slots|slots|openings)\b/.test(
      reply,
    )
  );
};

const shouldSendTimeSlotsByEmail = (
  leadReply: string,
  transcript: CallTranscriptEntry[],
) => {
  const normalized = leadReply.toLowerCase();
  const previousAgentMessage =
    [...transcript].reverse().find((entry) => entry.speaker === "agent")?.message.toLowerCase() ?? "";
  const asksForSlots = /\b(time slot|time slots|slot|slots|available time|available times|availability)\b/.test(
    normalized,
  );
  const mentionsEmail = /\b(email|send|mail)\b/.test(normalized);
  const followsNoSlotMessage =
    previousAgentMessage.includes("do not see an open slot") ||
    previousAgentMessage.includes("available times");

  return asksForSlots && (mentionsEmail || followsNoSlotMessage);
};

const calendarOptionsMessage = (slots: CalendarSlot[], lead: Lead) => {
  const availableSlots = slots.slice(0, 2);

  if (availableSlots.length === 0) {
    return "I do not see an open slot in the mock calendar right now, so I will have the sales team follow up with available times.";
  }

  const options = availableSlots
    .map((slot, index) => `Option ${index + 1}: ${formatSlot(slot)} with ${slot.salesRep}`)
    .join("; ");

  return `Absolutely. Since you are evaluating whether AI agents can help with ${lead.discussionTopic.toLowerCase()}, a short meeting is the right place to map that to your current workflow. I checked the calendar and can offer ${options}. Which one works best for you?`;
};

const formatSlot = (slot: Pick<CalendarSlot, "startsAt">) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(slot.startsAt));

const collectSignals = (
  turn: CarlaTurn,
  painPoints: Set<string>,
  objections: Set<string>,
) => {
  for (const painPoint of turn.detectedPainPoints ?? []) {
    painPoints.add(painPoint);
  }

  for (const objection of turn.detectedObjections ?? []) {
    objections.add(objection);
  }
};

const leadScriptFor = (lead: Lead): LeadScriptTurn[] => {
  const first = "Yes, sure.";

  switch (lead.scenario) {
    case "interested":
      return [
        {
          lead: "Yes, I have a few minutes. We downloaded your guide because outbound follow-up is getting hard to keep consistent.",
        },
        {
          lead: "We use HubSpot and Outreach, but reps still duplicate follow-up work and sometimes high-intent leads wait too long.",
        },
        {
          lead: "That sounds relevant, but I would want to see how this fits our current workflow before considering anything.",
        },
        { lead: "Yes, let's book a short demo." },
      ];
    case "budget_objection":
      return [
        { lead: first },
        {
          lead: "Budget is tight, but we do spend too much time on repetitive follow-up.",
        },
      ];
    case "busy":
      return [{ lead: "I am about to join a meeting. Can you call me later?" }];
    case "not_interested":
      return [{ lead: "I do not think this is relevant for us right now." }];
    case "send_email":
      return [{ lead: "Can you send me an email instead?" }];
    case "existing_crm":
      return [
        { lead: "We already use Salesforce and Outreach." },
        { lead: "Send me a brief overview first." },
      ];
    case "authority_objection":
      return [
        { lead: "I can answer a few questions, but our CRO would need to approve anything like this." },
        { lead: "Send me something brief that I can forward." },
      ];
    case "security_concern":
      return [
        { lead: "This sounds interesting, but security review is usually the hard part for us." },
        { lead: "Send me details first. I do not want a generic pitch." },
      ];
  }
};

const nextBestActionFor = (intent: LeadIntentDetection) => {
  switch (intent.intent) {
    case "send_follow_up":
      return "Send a concise follow-up email tailored to the lead's question.";
    case "call_back_later":
      return "Schedule or note a better time to call the lead back.";
    case "not_interested":
      return "Respect the decline and avoid further outreach unless the lead re-engages.";
    case "unqualified":
      return "Mark the lead as unqualified and document the reason.";
    case "objection":
      return `Follow up on the ${intent.objectionType} objection without pushing for a meeting.`;
    case "interested":
      return "Continue discovery and offer a meeting only if the lead shows fit.";
  }
};

const shortSummaryFor = (
  lead: Lead,
  interestLevel: CallSummary["interestLevel"],
  meetingStatus: CallSummary["meetingStatus"],
  nextBestAction: string,
) =>
  `${lead.name} at ${lead.company} completed an LLM-assisted call. Interest: ${interestLevel}. Meeting status: ${meetingStatus}. Next action: ${nextBestAction}`;
