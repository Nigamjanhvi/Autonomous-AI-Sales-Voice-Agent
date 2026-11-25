import type { LeadIntentDetection, LeadOutcomeClassification, Meeting, Qualification, SalesFact, SalesFactKind } from "../types.js";
import type { KnowledgeSource } from "../services/knowledge.js";

export const factKinds = ["need", "authority", "timing", "budget", "workflow"] as const;
export const intents = ["interested", "objection", "send_follow_up", "call_back_later", "not_interested", "unqualified", "confused", "product_question", "scheduling"] as const;
export const objections = ["budget", "timing", "existing_tools", "authority", "fit", "security", "none"] as const;
export const nextMoves = ["ask_discovery", "handle_objection", "offer_meeting", "offer_email", "close"] as const;

export function disposition(reply: string) {
  if (/\b(?:remove me|unsubscribe|opt me out|stop (?:calling|contacting)(?: me)?|(?:do not|don't) (?:call|contact) me)\b/i.test(reply)) return "opt_out";
  if (/\b(?:not interested|no thanks|no thank you|not for us|we(?:'re| are) not looking for (?:this|anything)|no interest)\b/i.test(reply)) return "declined";
  if (/\b(?:call (?:me|us) (?:back|later|tomorrow)|(?:i'm|i am) (?:busy|about to join)|not a good time)\b/i.test(reply)) return "callback";
  if (/\b(?:send (?:me|us) (?:an? )?(?:e-?mail|info(?:rmation)?|details)|e-?mail (?:me|us))\b/i.test(reply)) return "email";
  return undefined;
}

export function wantsScheduling(reply: string) {
  if (disposition(reply) || /\b(?:not|don't|cannot|can't|won't|maybe)\b/i.test(reply)) return false;
  return /\b(?:book|schedule|arrange|set up)\b.{0,35}\b(?:meeting|demo|call|slot|time)\b|\b(?:calendar availability|available (?:times|slots)|what times|when are you available)\b/i.test(reply);
}

export function acceptedOption(reply: string, previousOptions: string[]) {
  if (!previousOptions.length || disposition(reply) ||
      /\b(?:no|not|neither|can't|won't|don't|cannot|maybe|if|unless|instead|or)\b/i.test(reply)) return undefined;
  const match = reply.trim().match(/^(?:yes[, ]+)?(?:(?:please )?book |i(?:'ll| will) take |i (?:choose|accept) )?(?:the )?(?:(?:option\s*(1|2|one|two))|(?:(first|second)(?:\s+(?:one|option|slot))?))(?:\s+(?:works(?: for me)?|is fine|please))?[.!?]*$/i);
  if (match) {
    const option = ["1", "one", "first"].includes((match[1] ?? match[2]).toLowerCase()) ? 1 : 2;
    if (previousOptions[option - 1]) return option;
  }
  if (previousOptions.length === 1 && /^(?:yes|ok(?:ay)?|sure|that works|book it)(?:[, ]+please)?[.!]*$/i.test(reply.trim())) return 1;
  return undefined;
}

export function asksForProductFacts(reply: string) {
  return /\b(?:price|pricing|cost|how much|integration|integrate|features?|capabilit(?:y|ies)|security|compliance|implementation|how (?:does|do) (?:it|you)|what (?:does|do) (?:it|you)|what is (?:it|carla))\b|(?:कीमत|मूल्य|लागत|कितना|सुविधा|फीचर|एकीकरण|सुरक्षा|कैसे काम)/i.test(reply);
}

export function groundedReply(reply: string, sources: KnowledgeSource[], citedId: string | null, quote: string | null) {
  const excerpt = quote?.trim();
  const source = sources.find(({ sourceId }) => sourceId === citedId);
  const pricing = /\b(?:price|pricing|cost|how much)\b/i.test(reply);
  if (source && excerpt && excerpt.length <= 280 && source.content.includes(excerpt) &&
      (!pricing || /\b(?:price|pricing|cost)\b|[$€£]/i.test(excerpt))) return excerpt;
  return "I don’t have a verified answer for that. A sales teammate can follow up with the details.";
}

const compact = (value: string) => value.trim().replace(/\s+/g, " ");
export function verifiedFact(fact: SalesFact, leadReply: string): SalesFact | undefined {
  const evidence = compact(fact.evidence);
  const source = compact(leadReply);
  const offset = source.toLowerCase().indexOf(evidence.toLowerCase());
  if (offset < 0 || evidence.split(/\s+/).length < 3 ||
      /\b(?:api key|password|secret token|credit card)\b/i.test(evidence)) return undefined;
  const start = Math.max(source.lastIndexOf(".", offset), source.lastIndexOf(";", offset)) + 1;
  const end = source.slice(offset + evidence.length).search(/[.;?!]/);
  const statement = source.slice(start, end < 0 ? undefined : offset + evidence.length + end);
  if (["budget", "authority", "timing"].includes(fact.kind) &&
      /\b(?:no|not|don't|can't|unknown|maybe|blocked|tight|unclear|haven't|won't|need approval)\b/i.test(statement)) return undefined;
  const confirmation: Partial<Record<SalesFactKind, RegExp>> = {
    budget: /\b(?:approved|allocated|budgeted|(?:have|set aside|earmarked) (?:a |the )?budget)\b/i,
    authority: /\b(?:i (?:approve|sign off|am the decision maker|make the (?:final )?decision)|i'm the decision maker|i own the decision|i can approve|i am the buyer)\b/i,
    timing: /\b(?:this|next|within|in|by|before)\s+(?:(?:the |a )?\d+ (?:days?|weeks?|months?)|week|month|quarter|year|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    need: /\b(?:need|problem|challenges?|struggle|takes? too long|take too much time|spend|spending|duplicate|manual|difficult|hard to|losing|waste|miss)\b/i,
  };
  const pattern = confirmation[fact.kind];
  if (pattern && !pattern.test(evidence)) return undefined;
  return { kind: fact.kind, evidence: source.slice(offset, offset + evidence.length) };
}

export function mergeFacts(before: SalesFact[], after: SalesFact[]) {
  return [...new Map([...before, ...after].map((fact) => [fact.kind + ":" + fact.evidence.toLowerCase(), fact])).values()].slice(-30);
}

export function qualify(facts: SalesFact[], scheduled: boolean, declined: boolean): Qualification {
  const rubric = [
    { kind: "need", label: "Business need", points: 30 },
    { kind: "authority", label: "Decision authority", points: 20 },
    { kind: "timing", label: "Timeline", points: 20 },
    { kind: "budget", label: "Confirmed budget", points: 15 },
  ] as const;
  const factors: Qualification["factors"] = rubric.map(({ kind, label, points }) => {
    const evidence = facts.findLast((fact) => fact.kind === kind)?.evidence;
    return { label, points: evidence && !declined ? points : 0, possible: points, ...(evidence ? { evidence } : {}) };
  });
  factors.push({ label: "Confirmed appointment", points: scheduled && !declined ? 15 : 0, possible: 15 });
  const score = factors.reduce((value, factor) => value + factor.points, 0);
  return { score, factors, status: declined ? "unqualified" : score >= 60 ? "qualified" : "developing",
    reason: declined ? "The lead declined outreach." : score >= 60 ? "Confirmed evidence meets the 60-point qualification threshold." :
      "Continue discovery to confirm the missing qualification factors." };
}

export function outcomeFor(intent: LeadIntentDetection["intent"], meeting?: Meeting, optedOut = false): LeadOutcomeClassification {
  if (meeting) return { outcome: "meeting_booked", recommendedNextAction: "Send the calendar invite and share discovery notes with sales.", reason: "The lead explicitly accepted the reserved slot." };
  if (intent === "not_interested") return { outcome: "not_interested", recommendedNextAction: optedOut ? "Honor the opt-out and stop outreach." : "Close the outreach and respect the decline.", reason: optedOut ? "The lead opted out of outreach." : "The lead declined." };
  if (intent === "send_follow_up") return { outcome: "send_email", recommendedNextAction: "Have sales email the requested information.", reason: "The lead requested information by email." };
  if (intent === "call_back_later") return { outcome: "call_back_later", recommendedNextAction: "Have sales follow up at the lead’s preferred time.", reason: "The lead asked to revisit the conversation." };
  if (intent === "unqualified") return { outcome: "disqualified", recommendedNextAction: "Record the fit gap and close this outreach.", reason: "Discovery identified a fit gap." };
  return { outcome: "needs_human_follow_up", recommendedNextAction: "Review discovery notes and agree on the next sales action.", reason: "Discovery ended without a confirmed appointment or follow-up request." };
}
