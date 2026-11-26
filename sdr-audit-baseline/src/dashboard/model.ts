import type { CallResult, Meeting } from '../server/types'

export type { CallResult, Lead } from '../server/types'

export type AgentProfile = {
  name: string
  role: string
  company: string
  shortProfile: string
}

export type Preferences = {
  name: string
  personality: string
  language: string
  voice: 'vapi' | 'silent'
  qualificationThreshold: number
  requirePainPoint: boolean
}

export const defaults: Preferences = {
  name: '',
  personality: '',
  language: 'en-US',
  voice: 'vapi',
  qualificationThreshold: 60,
  requirePainPoint: false,
}

export type CallRecord = Pick<CallResult, 'callId' | 'lead' | 'transcript' | 'summary' | 'classification' | 'analysis'> & {
  startedAt: number
  endedAt: number
  modeLabel: string
  endedManually: boolean
  meeting?: Meeting
}

export type Sentiment = 'Positive' | 'Neutral' | 'Negative' | 'Unrated'
export const sentiments: Sentiment[] = ['Positive', 'Neutral', 'Negative', 'Unrated']

export const formatOutcome = (value?: string) =>
  value?.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Unknown'

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase()

export const formatDate = (date: number | string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))

export const formatTime = (date: number | string) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date))

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return [Math.floor(seconds / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
}

export function recordCall(call: CallResult, startedAt: number, modeLabel: string, endedManually: boolean): CallRecord {
  const { callId, lead, transcript, summary, classification, analysis } = call
  const output = call.toolCalls.findLast((tool) => ['bookMeeting', 'bookAppointment'].includes(tool.name)
    && (tool.output as Meeting | undefined)?.slotId === summary.bookedSlotId)?.output as Meeting | undefined
  return {
    callId, lead, transcript, summary, classification, analysis, startedAt, modeLabel, endedManually,
    endedAt: Date.now(),
    meeting: output?.startsAt && output.slotId === summary.bookedSlotId ? output : undefined,
  }
}

export function sentimentFor(call: CallRecord): Sentiment {
  const replies = call.transcript.filter(({ speaker }) => speaker === 'lead').map(({ message }) => message)
  if (replies.length === 0) return 'Unrated'
  if (call.analysis) return formatOutcome(call.analysis.sentiment) as Sentiment
  const lastReply = replies.at(-1) ?? ''
  if (/\b(not interested|not this quarter|not relevant|no thanks|remove me|stop calling)\b/i.test(lastReply)) return 'Negative'
  if (/\b(works|please send the invite|let.s book|sounds (good|relevant|interesting)|would be useful)\b/i.test(replies.join(' '))) return 'Positive'
  return 'Neutral'
}

export function scoreFor(call?: CallRecord) {
  if (!call || !call.transcript.some(({ speaker }) => speaker === 'lead')) return undefined
  if (call.analysis) return call.analysis.qualification.score
  if (call.summary.meetingStatus === 'booked') return 100
  if (['not_interested', 'disqualified'].includes(call.classification.outcome)) return 0
  const interest = { high: 80, medium: 50, low: 25, none: 0 }[call.summary.interestLevel] ?? 0
  return Math.min(95, interest + Math.min(15, call.summary.painPoints.length * 5))
}

export function statusFor(call: CallRecord | undefined, preferences: Preferences) {
  if (!call) return 'New'
  if (call.summary.meetingStatus === 'booked') return 'Booked'
  if (call.classification.outcome === 'not_interested') return 'Declined'
  if (call.classification.outcome === 'disqualified') return 'Disqualified'
  const score = scoreFor(call)
  if (score !== undefined && score >= preferences.qualificationThreshold &&
    (!preferences.requirePainPoint || call.summary.painPoints.length > 0)) return 'Qualified'
  return 'Follow-up'
}

export function latestCalls(calls: CallRecord[]) {
  const byLead = new Map<string, CallRecord>()
  for (const call of calls) {
    if (!byLead.has(call.lead.id)) byLead.set(call.lead.id, call)
  }
  return byLead
}

export const percent = (numerator: number, denominator: number) =>
  denominator ? Math.round(100 * numerator / denominator) : 0

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// Use Vite's same-origin proxy in development. This keeps the API working when
// Vite selects a fallback port (for example, 5174) and avoids browser CORS issues.
export const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export async function getApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiBase + path, { signal })
  if (!response.ok) throw new Error(`Backend request failed (HTTP ${response.status}).`)
  return response.json() as Promise<T>
}
