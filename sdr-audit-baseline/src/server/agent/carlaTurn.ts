import type OpenAI from "openai";
import type { CallResult, Lead, LeadIntentDetection } from "../types.js";
import { agentConfig } from "../config/agent.config.js";
import { acceptedOption, asksForProductFacts, disposition, groundedReply, mergeFacts, outcomeFor, qualify, wantsScheduling } from "./carlaPolicy.js";
import { createModelClient, emptyUsage, generateModelTurn } from "./carlaModel.js";
import type { ModelTurn } from "./carlaModel.js";
import { executeCarlaTool } from "./carlaTools.js";
import type { ToolContext } from "./carlaTools.js";

const formatTime = (iso: string) => new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem",
}).format(new Date(iso)) + " Israel time";

function plainTurn(reply: string, intent: ModelTurn["intent"] = "interested", sentiment: ModelTurn["sentiment"] = "neutral"): ModelTurn {
  return { reply, intent, sentiment, objectionType: "none", nextAgentMove: "ask_discovery",
    reason: "Based on the current conversation state.", facts: [], sourceId: null, sourceQuote: null };
}

const closingTurns = {
  opt_out: () => plainTurn("Understood. I’ll stop outreach. Thank you for your time.", "not_interested", "negative"),
  declined: () => plainTurn("Of course. Thanks for your time, and have a good day.", "not_interested", "negative"),
  callback: () => plainTurn("Of course. I’ll note that this is a better conversation for another time. Thanks.", "call_back_later"),
  email: () => plainTurn("I’ll note what you requested so the sales team can follow up by email. Thanks for your time.", "send_follow_up"),
};

function conciseReply(reply: string) {
  const speech = reply.trim().replace(/\s+/g, " ");
  const question = speech.indexOf("?");
  const bounded = question >= 0 && speech.indexOf("?", question + 1) >= 0 ? speech.slice(0, question + 1) : speech;
  return bounded.length > 440 ? bounded.slice(0, 435).replace(/\s+\S*$/, "") + "…" : bounded;
}

export async function advanceCarla(input: {
  client?: OpenAI; callId: string; lead: Lead; prior?: CallResult; previousOptions?: string[]; latestReply?: string; atLimit?: boolean;
}) {
  const { client, callId, lead, prior, previousOptions = [], latestReply = "", atLimit = false } = input;
  const transcript = [...(prior?.transcript ?? [])];
  const previousAgentReply = transcript.findLast(({ speaker }) => speaker === "agent")?.message;
  if (latestReply) transcript.push({ speaker: "lead", name: lead.name, message: latestReply });
  const ctx: ToolContext = {
    callId, lead, latestReply, previousOptions, atLimit,
    knownFacts: mergeFacts(lead.salesDiscovery ?? [], prior?.analysis?.facts ?? []),
    newFacts: [], sources: [], events: [],
  };
  const runTool = (name: string, args: object = {}) => executeCarlaTool(name, JSON.stringify(args), ctx);
  const action = disposition(latestReply);
  const optOut = action === "opt_out";
  const explicitSelection = acceptedOption(latestReply, previousOptions);
  let usage = prior?.analysis?.modelUsage ?? emptyUsage();
  let turn: ModelTurn;
  let budgetReached = false;
  if (action) {
    turn = closingTurns[action]();
    await runTool("endCall", { reason: optOut ? "declined" : action });
  } else {
    if (asksForProductFacts(latestReply)) await runTool("searchKnowledgeBase", { query: latestReply.slice(0, 350) });
    const model = await generateModelTurn(client ?? createModelClient(), ctx, transcript, usage);
    usage = model.usage;
    budgetReached = !model.turn;
    turn = model.turn ?? plainTurn("I’ll leave it here for now. The sales team can pick up where we left off.");
    if (turn.facts.length) await runTool("updateLead", { facts: turn.facts });
    if (explicitSelection && !ctx.booking) await runTool("bookAppointment", { option: explicitSelection });
    if (ctx.bookingError) throw ctx.bookingError;
    if (!budgetReached && !atLimit && !ctx.booking && !ctx.slots && wantsScheduling(latestReply)) {
      await runTool("getAvailableSlots", { preferredDate: null });
    }
  }

  let spoken = turn.reply;
  if (!latestReply && !budgetReached) {
    // Start every sales call with an explicit introduction and a single permission question.
    if (!/\b(?:i['’]m|i am|this is) Carla\b.{0,90}\bAI\b.*\?/i.test(spoken)) {
      spoken = `Hi ${lead.name}, I’m Carla, an AI sales representative. Is now a good time to talk about ${lead.discussionTopic.slice(0, 90).replace(/[?!]+/g, "")}?`;
    }
    turn = plainTurn(spoken);
  } else if (ctx.booking) {
    spoken = `I’ve booked ${formatTime(ctx.booking.startsAt)} with ${ctx.booking.salesRep}. Our team can follow up with the invite. Thanks for your time.`;
  } else if (ctx.slots) {
    const options = ctx.slots.map(({ startsAt }, index) => `Option ${index + 1} is ${formatTime(startsAt)}.`).join(" ");
    spoken = options ? options + " Which option works for you?" : "I don’t see an open slot. The sales team can follow up with availability.";
  } else if (!action && !budgetReached && (asksForProductFacts(latestReply) || turn.intent === "product_question")) {
    if (!ctx.events.some(({ name }) => name === "searchKnowledgeBase")) {
      await runTool("searchKnowledgeBase", { query: latestReply.slice(0, 350) });
    }
    spoken = groundedReply(latestReply, ctx.sources, turn.sourceId, turn.sourceQuote);
  } else if (!action && !budgetReached && /\b(?:booked|reserved|confirmed (?:your |the )?(?:meeting|appointment)|invite (?:is |has been |was )?sent|option [12]|\d{1,2}:\d\d|pricing (?:is|starts at)|we (?:guarantee|are certified|integrate with))\b|[$€£]\s*\d/i.test(spoken)) {
    spoken = "I can discuss the next step with you. What would be most useful?";
  }
  if (!ctx.booking && turn.intent === "not_interested" && !action) spoken = closingTurns.declined().reply;
  if (!action && !ctx.booking && !ctx.slots && spoken === previousAgentReply) {
    spoken = turn.intent === "confused" ? "Which part would be useful to clarify?" : "What would be most useful to cover next?";
  }
  const complete = Boolean(ctx.close || ctx.booking || turn.intent === "not_interested" || budgetReached || atLimit);
  if (atLimit && !action && !ctx.booking && !budgetReached && spoken.includes("?")) {
    spoken = "Thanks, that gives me useful context. The sales team can follow up from here.";
  }
  transcript.push({ speaker: "agent", name: agentConfig.name, message: conciseReply(spoken) || "Thanks for your time." });

  if (complete) {
    ctx.finishing = true;
    await runTool("saveCallSummary");
  }
  const facts = mergeFacts(ctx.knownFacts, ctx.newFacts);
  const classification = outcomeFor(turn.intent, ctx.booking, optOut);
  const rejected = turn.intent === "not_interested";
  const painPoints = facts.filter(({ kind }) => kind === "need").map(({ evidence }) => evidence);
  const objection = turn.objectionType === "none" ? undefined : turn.objectionType.replaceAll("_", " ") + ": " + latestReply.slice(0, 170);
  const objections = [...new Set([...(prior?.summary.objections ?? []), ...(objection ? [objection] : [])])].slice(-15);
  const statusEvents: CallResult["statusEvents"] = [
    ...(latestReply ? [{ status: "lead_speaking" as const, label: lead.name + " speaking" }] : []),
    { status: "thinking", label: "Evaluating conversation and tool results" },
    { status: "agent_speaking", label: agentConfig.name + " speaking" },
    { status: "idle", label: complete ? "Call ended" : "Waiting for lead reply" },
  ];
  const intent: LeadIntentDetection = {
    leadMessage: latestReply, intent: turn.intent, objectionType: turn.objectionType,
    shouldCheckCalendar: Boolean(ctx.slots), shouldBookMeeting: Boolean(ctx.booking),
    nextAgentMove: complete ? "close" : ctx.slots ? "offer_meeting" : turn.nextAgentMove,
    reasoning: turn.reason,
  };
  const result: CallResult = {
    callId, lead: { ...lead, ...(facts.length ? { salesDiscovery: facts } : {}), ...(optOut ? { doNotContact: true } : {}) },
    mode: "llm", agent: { name: agentConfig.name, role: agentConfig.role, company: agentConfig.company },
    transcript, statusEvents, toolCalls: ctx.events, classification,
    intentDetections: [...(prior?.intentDetections ?? []), ...(latestReply ? [intent] : [])],
    summary: {
      leadId: lead.id, leadName: lead.name, company: lead.company, painPoints, objections,
      interestLevel: ctx.booking || turn.intent === "scheduling" || wantsScheduling(latestReply) ? "high" : rejected ? "none" :
        turn.sentiment === "positive" ? "medium" : "low",
      meetingStatus: ctx.booking ? "booked" : ["send_email", "call_back_later"].includes(classification.outcome) ? "follow_up_needed" : "not_booked",
      bookedSlotId: ctx.booking?.slotId,
      recommendedNextAction: classification.recommendedNextAction,
      shortSummaryForSales: lead.name + " at " + lead.company + ". " + classification.reason +
        (painPoints.length ? " Latest confirmed need: " + painPoints.at(-1) : ""),
    },
    analysis: { sentiment: rejected ? "negative" : ctx.booking ? "positive" : turn.sentiment, qualification: qualify(facts, Boolean(ctx.booking), rejected),
      facts, modelUsage: usage },
  };
  const offeredSlotIds = complete ? [] : ctx.slots ? ctx.slots.map(({ id }) => id) : previousOptions;
  return { result, offeredSlotIds, meeting: ctx.booking, newFacts: ctx.newFacts, optedOut: optOut };
}
