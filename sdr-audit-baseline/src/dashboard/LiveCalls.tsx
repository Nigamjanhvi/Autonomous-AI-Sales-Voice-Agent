import Vapi from '@vapi-ai/web'
import { type FormEvent, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { apiBase, formatDuration, formatOutcome, recordCall } from './model'
import type { AgentProfile, CallRecord, CallResult, Lead, Preferences } from './model'
import { Avatar, Badge, CardHeader, Empty, Icon, Overlay } from './ui'

const VapiClient = (Vapi as unknown as { default?: typeof Vapi }).default ?? Vapi

type CallStatus = 'agent_speaking' | 'lead_speaking' | 'thinking' | 'idle'
type AgentMode = 'deterministic' | 'llm'
type CallMode = 'demo' | 'interactive'
type StartMode = 'predefined' | 'ai_scripted' | 'ai_interactive'
type VapiVoiceStatus = 'idle' | 'connecting' | 'connected' | 'speaking'

type SpeechRecognitionAlternativeLike = {
  transcript: string
}

type SpeechRecognitionResultLike = {
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike
}

type SpeechRecognitionResultListLike = {
  length: number
  [index: number]: SpeechRecognitionResultLike
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

type SpeechRecognitionErrorEventLike = {
  error: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onstart: (() => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const carlaImageSrc = '/Gemini_Generated_Image_l56rq4l56rq4l56r.png'
const voiceSubmitDelayMs = 4000

const toolLabels: Record<string, string> = {
  getLeadContext: 'CRM loaded',
  checkCalendarAvailability: 'Calendar checked',
  bookMeeting: 'Meeting booked',
  saveCallSummary: 'Summary saved',
}

const startModeConfig: Record<StartMode, { title: string; description: string; agentMode: AgentMode; callMode: CallMode }> = {
  predefined: {
    title: 'Predefined',
    description: 'Fixed lead responses (no AI)',
    agentMode: 'deterministic',
    callMode: 'demo',
  },
  ai_scripted: {
    title: 'AI (Scripted)',
    description: 'AI agent + scripted lead',
    agentMode: 'llm',
    callMode: 'demo',
  },
  ai_interactive: {
    title: 'AI (Interactive)',
    description: 'AI agent + live conversation',
    agentMode: 'llm',
    callMode: 'interactive',
  },
}

const friendlyError = (message: string) => {
  if (message.includes('OPENAI_API_KEY')) {
    return 'LLM and Interactive Mode need a real OPENAI_API_KEY in .env. Use deterministic Scripted Mode for no-cost testing.'
  }

  return message
}

export function LiveCalls({ leads, agentProfile, preferences, requestedLead, onRecorded }: {
  leads: Lead[]
  agentProfile: AgentProfile | null
  preferences: Preferences
  requestedLead: { id: string } | null
  onRecorded: (record: CallRecord) => void
}) {
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [call, setCall] = useState<CallResult | null>(null)
  const [recentTools, setRecentTools] = useState<string[]>([])
  const [visibleCount, setVisibleCount] = useState(0)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isStartModalOpen, setIsStartModalOpen] = useState(false)
  const [selectedStartMode, setSelectedStartMode] = useState<StartMode>('predefined')
  const [activeStartMode, setActiveStartMode] = useState<StartMode | null>(null)
  const [activeCallMode, setActiveCallMode] = useState<CallMode | null>(null)
  const [leadReply, setLeadReply] = useState('')
  const [isVoiceListening, setIsVoiceListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [vapiVoiceStatus, setVapiVoiceStatus] = useState<VapiVoiceStatus>('idle')
  const [vapiVoiceError, setVapiVoiceError] = useState<string | null>(null)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [handledRequest, setHandledRequest] = useState<typeof requestedLead>(null)
  const recordedId = useRef<string | null>(null)
  const transcriptList = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const vapiRef = useRef<Vapi | null>(null)
  const pendingVoiceReplyRef = useRef('')
  const voiceSubmitTimerRef = useRef<number | null>(null)
  const vapiSpokenAgentTurnRef = useRef(-1)
  const vapiCallStartedRef = useRef(false)
  const vapiAttempted = useRef(false)
  const pendingVapiAgentTurnRef = useRef<{
    endCallAfterSpoken: boolean
    index: number
    message: string
  } | null>(null)
  const scriptedLeadRevealTimerRef = useRef<number | null>(null)
  const vapiPublicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined
  const vapiAssistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined
  const vapiVoiceConfigured = Boolean(
    vapiPublicKey &&
      vapiPublicKey !== 'replace_me' &&
      vapiAssistantId &&
      vapiAssistantId !== 'replace_me',
  )
  const vapiVoiceActive = vapiVoiceStatus === 'connected' || vapiVoiceStatus === 'speaking'
  const activeModeUsesVapiVoice =
    voiceEnabled && vapiVoiceConfigured && !vapiVoiceError &&
      (activeStartMode === 'ai_scripted' || activeStartMode === 'ai_interactive')

  const visibleTranscript = useMemo(() => {
    if (!call) {
      return []
    }

    return activeCallMode === 'interactive'
      ? call.transcript
      : call.transcript.slice(0, visibleCount)
  }, [activeCallMode, call, visibleCount])

  const currentAgent = call?.agent ?? agentProfile
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? call?.lead ?? null
  const agentName = preferences.name || currentAgent?.name || 'Carla'
  const agentRole = currentAgent?.role ?? 'AI SDR agent'
  const latestIntent = call?.intentDetections?.[call.intentDetections.length - 1]
  const serverSignals = useMemo(() => {
    const signals = recentTools.map((tool) => toolLabels[tool] ?? tool)
    const checkedCalendar = call?.toolCalls.some((toolCall) => toolCall.name === 'checkCalendarAvailability')

    if (latestIntent) {
      signals.push(`Intent: ${formatOutcome(latestIntent.intent)}`)
      if (latestIntent.objectionType && latestIntent.objectionType !== 'none') {
        signals.push(`Objection: ${formatOutcome(latestIntent.objectionType)}`)
      }
      signals.push(
        latestIntent.nextAgentMove === 'offer_meeting' && !checkedCalendar
          ? 'Next: Continue discovery'
          : `Next: ${formatOutcome(latestIntent.nextAgentMove)}`,
      )
    }

    return signals.slice(-6)
  }, [call?.toolCalls, latestIntent, recentTools])

  const statusText: Record<CallStatus, string> = {
    agent_speaking: `${agentName} speaking${vapiVoiceActive ? ' via Vapi' : ''}`,
    lead_speaking: 'Listening',
    thinking: 'Thinking',
    idle: 'Ready',
  }

  const callIsComplete = Boolean(
    call &&
      (call.summary.meetingStatus === 'booked' ||
        call.statusEvents.at(-1)?.label === 'Call ended'),
  )
  const callInProgress =
    activeCallMode === 'interactive'
      ? Boolean(call) && !callIsComplete
      : call
        ? visibleCount < call.transcript.length
        : false
  const speechRecognitionSupported =
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    if (!callInProgress && !isLoading && requestedLead && requestedLead !== handledRequest) {
      setSelectedLeadId(requestedLead.id)
      setHandledRequest(requestedLead)
    } else if (!selectedLeadId && leads.length) {
      setSelectedLeadId(leads[0].id)
    }
  }, [callInProgress, handledRequest, isLoading, leads, requestedLead, selectedLeadId])

  const captureCall = (result: CallResult, start: number, manual: boolean) => {
    if (recordedId.current === result.callId) return
    recordedId.current = result.callId
    const modeLabel = activeStartMode ? startModeConfig[activeStartMode].title : formatOutcome(result.mode)
    const record = recordCall(result, start, modeLabel, manual)
    setElapsed(record.endedAt - start)
    onRecorded(record)
  }
  const captureCompleted = useEffectEvent((result: CallResult, start: number) => captureCall(result, start, false))

  useEffect(() => {
    if (startedAt === null) return
    if (call && !callInProgress && !isLoading) {
      captureCompleted(call, startedAt)
      return
    }
    if (!isLoading && !callInProgress) return
    const ticker = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => window.clearInterval(ticker)
  }, [call, callInProgress, isLoading, startedAt])

  useEffect(() => {
    if (transcriptList.current) transcriptList.current.scrollTop = transcriptList.current.scrollHeight
  }, [visibleTranscript.length])

  const speakFromEffect = useEffectEvent(() => speakLatestAgentTurnWithVapi())
  const queueFromEffect = useEffectEvent((turn: { endCallAfterSpoken: boolean; index: number; message: string }) => queueVapiAgentTurn(turn))
  const connectFromEffect = useEffectEvent(() => { void startVapiVoice() })

  useEffect(() => {
    if (activeCallMode === 'interactive') return
    if (!call || visibleCount >= call.transcript.length) {
      if (call && visibleCount === call.transcript.length) {
        setStatus('idle')
      }
      return
    }

    if (activeStartMode === 'ai_scripted' && activeModeUsesVapiVoice) {
      return
    }

    const nextEntry = call.transcript[visibleCount]
    setStatus(nextEntry.speaker === 'agent' ? 'agent_speaking' : 'lead_speaking')

    const timer = window.setTimeout(() => {
      setVisibleCount((current) => current + 1)
      setStatus('thinking')
    }, 750)

    return () => window.clearTimeout(timer)
  }, [activeCallMode, activeModeUsesVapiVoice, activeStartMode, call, visibleCount])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      vapiRef.current?.removeAllListeners()
      void vapiRef.current?.stop()
      if (voiceSubmitTimerRef.current) {
        window.clearTimeout(voiceSubmitTimerRef.current)
      }
      if (scriptedLeadRevealTimerRef.current) {
        window.clearTimeout(scriptedLeadRevealTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (
      activeStartMode === 'ai_scripted' ||
      activeCallMode !== 'interactive' ||
      !call ||
      !vapiRef.current ||
      !vapiVoiceActive
    ) {
      return
    }

    const latestAgentTurn = [...call.transcript]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(({ entry }) => entry.speaker === 'agent')

    if (!latestAgentTurn || latestAgentTurn.index <= vapiSpokenAgentTurnRef.current) {
      return
    }

    speakFromEffect()
  }, [activeCallMode, activeStartMode, call, callIsComplete, vapiVoiceActive])

  useEffect(() => {
    if (
      activeStartMode !== 'ai_scripted' ||
      !call ||
      !vapiRef.current ||
      !vapiVoiceActive ||
      visibleCount >= call.transcript.length
    ) {
      return
    }

    const nextEntry = call.transcript[visibleCount]

    if (nextEntry.speaker !== 'agent' || visibleCount <= vapiSpokenAgentTurnRef.current) {
      return
    }

    queueFromEffect({
      endCallAfterSpoken: visibleCount === call.transcript.length - 1,
      index: visibleCount,
      message: nextEntry.message,
    })
  }, [activeStartMode, call, vapiVoiceActive, visibleCount])

  useEffect(() => {
    if (
      !(activeStartMode === 'ai_scripted' || activeCallMode === 'interactive') ||
      !call ||
      (activeCallMode === 'interactive' && callIsComplete) ||
      !activeModeUsesVapiVoice ||
      vapiVoiceStatus !== 'idle' ||
      vapiAttempted.current
    ) {
      return
    }

    vapiAttempted.current = true
    connectFromEffect()
  }, [activeCallMode, activeModeUsesVapiVoice, activeStartMode, call, callIsComplete, vapiVoiceStatus])

  const beginCall = async () => {
    if (!selectedLeadId) {
      setError('Choose who Carla is calling before starting.')
      return
    }

    const startMode = startModeConfig[selectedStartMode]
    const callMode = startMode.callMode
    const startModeKey = selectedStartMode
    setIsLoading(true)
    setElapsed(0)
    setStartedAt(Date.now())
    setVoiceEnabled(preferences.voice === 'vapi')
    vapiAttempted.current = false
    setError(null)
    setCall(null)
    setRecentTools([])
    setVisibleCount(0)
    setStatus('thinking')
    setActiveStartMode(startModeKey)
    setActiveCallMode(callMode)
    setIsStartModalOpen(false)
    setLeadReply('')
    setVoiceError(null)
    setVapiVoiceError(null)
    setIsVoiceListening(false)
    pendingVoiceReplyRef.current = ''
    if (voiceSubmitTimerRef.current) {
      window.clearTimeout(voiceSubmitTimerRef.current)
      voiceSubmitTimerRef.current = null
    }
    if (scriptedLeadRevealTimerRef.current) {
      window.clearTimeout(scriptedLeadRevealTimerRef.current)
      scriptedLeadRevealTimerRef.current = null
    }
    vapiSpokenAgentTurnRef.current = -1
    vapiCallStartedRef.current = false
    pendingVapiAgentTurnRef.current = null
    recognitionRef.current?.abort()
    try {
      await stopVapiVoice()
      const endpoint =
        callMode === 'interactive'
          ? '/api/calls/interactive/start'
          : '/api/calls'
      const response = await fetch(apiBase + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLeadId, mode: startMode.agentMode }),
      })

      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        throw new Error(body.error ?? 'Call request failed')
      }

      const body = (await response.json()) as { call: CallResult }
      setCall(body.call)
      setRecentTools(body.call.toolCalls.map(({ name }) => name))
      setVisibleCount(callMode === 'interactive' ? body.call.transcript.length : 0)
      setStatus(callMode === 'interactive' ? 'idle' : 'thinking')
    } catch (caughtError) {
      setStartedAt(null)
      setStatus('idle')
      setActiveStartMode(null)
      setActiveCallMode(null)
      setError(
        caughtError instanceof Error
          ? `Could not start the call. ${friendlyError(caughtError.message)}`
          : 'Could not start the call. Please make sure the backend is running.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  const endCall = async () => {
    let endedCall = call
    if (call && activeCallMode === 'interactive') {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(apiBase + '/api/calls/' + encodeURIComponent(call.callId) + '/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: call.lead.id }),
        })
        const body = (await response.json()) as { call?: CallResult; error?: string }
        if (!response.ok || !body.call) throw new Error(body.error || 'The backend could not finalize this call.')
        endedCall = body.call
        setCall(endedCall)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'The backend could not finalize this call.')
        return
      } finally {
        setIsLoading(false)
      }
    }
    if (endedCall && startedAt !== null) captureCall(endedCall, startedAt, true)
    recognitionRef.current?.abort()
    void stopVapiVoice().catch(() => setVapiVoiceError('Could not close Vapi audio.'))
    setStatus('idle')
    setVisibleCount(call?.transcript.length ?? 0)
    setActiveStartMode(null)
    setActiveCallMode(null)
    setLeadReply('')
    setIsVoiceListening(false)
    setVoiceError(null)
    setVapiVoiceError(null)
    pendingVoiceReplyRef.current = ''
    vapiCallStartedRef.current = false
    pendingVapiAgentTurnRef.current = null
    if (voiceSubmitTimerRef.current) {
      window.clearTimeout(voiceSubmitTimerRef.current)
      voiceSubmitTimerRef.current = null
    }
    if (scriptedLeadRevealTimerRef.current) {
      window.clearTimeout(scriptedLeadRevealTimerRef.current)
      scriptedLeadRevealTimerRef.current = null
    }
  }

  const sendLeadReply = async (reply: string) => {
    const cleanedReply = reply.trim()

    if (!call || !cleanedReply) {
      return
    }

    setIsLoading(true)
    setError(null)
    setVoiceError(null)
    setStatus('thinking')

    try {
      const response = await fetch(apiBase + '/api/calls/interactive/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: call.callId,
          leadId: selectedLeadId,
          transcript: call.transcript,
          leadReply: cleanedReply,
        }),
      })

      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        throw new Error(body.error ?? 'Lead reply failed')
      }

      const body = (await response.json()) as { call: CallResult }
      setCall(body.call)
      setRecentTools((previous) => [...previous, ...body.call.toolCalls.map(({ name }) => name)].slice(-6))
      setVisibleCount(body.call.transcript.length)
      setLeadReply('')
      setStatus('idle')
    } catch (caughtError) {
      setStatus('idle')
      setError(
        caughtError instanceof Error
          ? `Could not send the lead reply. ${friendlyError(caughtError.message)}`
          : 'Could not send the lead reply. Please make sure the backend is running.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  const submitLeadReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await sendLeadReply(leadReply)
  }

  const sendPendingVoiceReply = () => {
    const reply = pendingVoiceReplyRef.current.trim()

    if (!reply) {
      return
    }

    if (voiceSubmitTimerRef.current) {
      window.clearTimeout(voiceSubmitTimerRef.current)
      voiceSubmitTimerRef.current = null
    }

    recognitionRef.current?.stop()
    recognitionRef.current = null
    pendingVoiceReplyRef.current = ''
    setIsVoiceListening(false)
    void sendLeadReply(reply)
  }

  const scheduleVoiceReplySubmit = (delay = voiceSubmitDelayMs) => {
    if (voiceSubmitTimerRef.current) {
      window.clearTimeout(voiceSubmitTimerRef.current)
    }

    voiceSubmitTimerRef.current = window.setTimeout(() => {
      sendPendingVoiceReply()
    }, delay)
  }

  const toggleVoiceCapture = () => {
    if (isVoiceListening) {
      sendPendingVoiceReply()
      recognitionRef.current?.stop()
      return
    }

    if (!call || isLoading || callIsComplete) {
      return
    }

    const SpeechRecognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setVoiceError('Speech recognition is not available in this browser. Use Chrome or Edge, or type the reply.')
      return
    }

    const recognition = new SpeechRecognition()
    pendingVoiceReplyRef.current = ''
    recognitionRef.current = recognition
    recognition.lang = preferences.language
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onstart = () => {
      setLeadReply('')
      setVoiceError(null)
      setIsVoiceListening(true)
      setStatus('lead_speaking')
    }
    recognition.onerror = (event) => {
      setVoiceError(
        event.error === 'not-allowed'
          ? 'Microphone permission was blocked for this page.'
          : `Could not capture the lead voice: ${event.error}.`,
      )
    }
    recognition.onresult = (event) => {
      const existingFinalText = pendingVoiceReplyRef.current
      let finalText = ''
      let interimText = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript ?? ''

        if (result.isFinal) {
          finalText += transcript
        } else {
          interimText += transcript
        }
      }

      const combinedFinalText = `${existingFinalText} ${finalText}`.trim()
      const nextReply = `${combinedFinalText} ${interimText}`.trim()
      setLeadReply(nextReply)

      if (finalText.trim()) {
        pendingVoiceReplyRef.current = combinedFinalText
        scheduleVoiceReplySubmit()
      }
    }
    recognition.onend = () => {
      setIsVoiceListening(false)
      recognitionRef.current = null

      if (pendingVoiceReplyRef.current) {
        scheduleVoiceReplySubmit()
      }

      if (!pendingVoiceReplyRef.current && !isLoading && activeCallMode === 'interactive') {
        setStatus('idle')
      }
    }

    try {
      recognition.start()
    } catch (caughtError) {
      recognitionRef.current = null
      setIsVoiceListening(false)
      setVoiceError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not start microphone capture.',
      )
    }
  }

  const latestAgentTurn = () =>
    call?.transcript
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(({ entry }) => entry.speaker === 'agent')

  const dispatchQueuedVapiAgentTurn = (vapi: Vapi) => {
    const pendingTurn = pendingVapiAgentTurnRef.current

    if (!pendingTurn || !vapiCallStartedRef.current) {
      return
    }

    pendingVapiAgentTurnRef.current = null
    vapi.say(pendingTurn.message, pendingTurn.endCallAfterSpoken, false, true)
    vapiSpokenAgentTurnRef.current = pendingTurn.index
  }

  const queueVapiAgentTurn = (turn: { endCallAfterSpoken: boolean; index: number; message: string }) => {
    if (turn.index <= vapiSpokenAgentTurnRef.current) {
      return
    }

    pendingVapiAgentTurnRef.current = turn

    if (vapiRef.current) {
      dispatchQueuedVapiAgentTurn(vapiRef.current)
    }
  }

  const speakLatestAgentTurnWithVapi = () => {
    const currentAgentTurn = latestAgentTurn()

    if (!currentAgentTurn || currentAgentTurn.index <= vapiSpokenAgentTurnRef.current) {
      return
    }

    queueVapiAgentTurn({
      endCallAfterSpoken: callIsComplete,
      index: currentAgentTurn.index,
      message: currentAgentTurn.entry.message,
    })
  }

  const revealScriptedLeadAfterAgent = (agentIndex: number) => {
    if (!call || activeStartMode !== 'ai_scripted') {
      return
    }

    const leadIndex = agentIndex + 1

    if (call.transcript[leadIndex]?.speaker !== 'lead') {
      setVisibleCount(Math.max(agentIndex + 1, visibleCount))
      setStatus('idle')
      return
    }

    if (scriptedLeadRevealTimerRef.current) {
      window.clearTimeout(scriptedLeadRevealTimerRef.current)
    }

    scriptedLeadRevealTimerRef.current = window.setTimeout(() => {
      setStatus('lead_speaking')
      setVisibleCount((current) => Math.max(current, leadIndex + 1))

      scriptedLeadRevealTimerRef.current = window.setTimeout(() => {
        setStatus('thinking')
      }, 700)
    }, 450)
  }

  const stopVapiVoice = async () => {
    const vapi = vapiRef.current

    if (!vapi) {
      vapiCallStartedRef.current = false
      pendingVapiAgentTurnRef.current = null
      setVapiVoiceStatus('idle')
      return
    }

    vapiRef.current = null
    vapiCallStartedRef.current = false
    pendingVapiAgentTurnRef.current = null
    vapi.removeAllListeners()

    try {
      await vapi.stop()
    } finally {
      setVapiVoiceStatus('idle')
    }
  }

  const startVapiVoice = async () => {
    if (!selectedLead) {
      setVapiVoiceError('Choose a lead before starting Vapi voice.')
      return
    }

    if (!vapiVoiceConfigured || !vapiPublicKey || !vapiAssistantId) {
      setVapiVoiceError('Add VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID to .env to use Vapi voice.')
      return
    }

    if (vapiRef.current || vapiVoiceStatus === 'connecting') {
      return
    }

    setVapiVoiceStatus('connecting')
    setVapiVoiceError(null)

    const vapi = new VapiClient(vapiPublicKey, undefined, undefined, { startAudioOff: true })
    vapiRef.current = vapi
    vapi.on('call-start', () => {
      vapiCallStartedRef.current = true
      setVapiVoiceStatus('connected')
      setStatus('idle')
      vapi.setMuted(true)
      if (activeStartMode !== 'ai_scripted') {
        speakLatestAgentTurnWithVapi()
        window.setTimeout(() => dispatchQueuedVapiAgentTurn(vapi), 250)
      }
    })
    vapi.on('call-end', () => {
      vapiRef.current = null
      vapiCallStartedRef.current = false
      pendingVapiAgentTurnRef.current = null
      setVapiVoiceStatus('idle')
      setVoiceEnabled(false)
    })
    vapi.on('speech-start', () => {
      setVapiVoiceStatus('speaking')
      setStatus('agent_speaking')
      if (activeStartMode === 'ai_scripted') {
        setVisibleCount((current) => Math.max(current, vapiSpokenAgentTurnRef.current + 1))
      }
    })
    vapi.on('speech-end', () => {
      setVapiVoiceStatus('connected')
      if (activeStartMode === 'ai_scripted') {
        revealScriptedLeadAfterAgent(vapiSpokenAgentTurnRef.current)
        return
      }

      if (!isVoiceListening && activeCallMode === 'interactive') {
        setStatus('idle')
      }
    })
    vapi.on('error', (caughtError) => {
      setVapiVoiceError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Vapi voice failed. Check the public key, assistant id, and dashboard endpoint.',
      )
      setVapiVoiceStatus('idle')
      setVisibleCount(call?.transcript.length ?? 0)
    })

    try {
      await Promise.race([
        vapi.start(vapiAssistantId, {
          firstMessageMode: 'assistant-waits-for-user',
          variableValues: {
            leadId: selectedLead.id,
            leadName: selectedLead.name,
            company: selectedLead.company,
          },
          metadata: {
            leadId: selectedLead.id,
            source: 'ai-sdr',
            backendBrain: true,
            voiceLayerOnly: true,
          },
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error('Vapi voice connection timed out. Check the assistant id, public key, and Custom LLM URL.')),
            15000,
          )
        }),
      ])

      if (vapiCallStartedRef.current && activeStartMode !== 'ai_scripted') {
        speakLatestAgentTurnWithVapi()
      }
    } catch (caughtError) {
      vapiRef.current = null
      vapiCallStartedRef.current = false
      pendingVapiAgentTurnRef.current = null
      vapi.removeAllListeners()
      void vapi.stop()
      setVapiVoiceStatus('idle')
      setVisibleCount(call?.transcript.length ?? 0)
      setVapiVoiceError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not start the Vapi web call.',
      )
    }
  }

  const interactive = activeCallMode === 'interactive' && call && !callIsComplete
  const phase = vapiVoiceStatus === 'connecting' ? 'Connecting audio' :
    isLoading ? (call ? 'Thinking' : 'Preparing call') :
    call && !callInProgress ? 'Call complete' : interactive && status === 'idle' ? 'Waiting for lead' : statusText[status]
  const active = callInProgress || isLoading
  const micAvailable = Boolean(interactive && speechRecognitionSupported && !isLoading)

  return <div className="live-layout">
    <section className="panel agent-card">
      <CardHeader title="Agent console" detail={agentRole}
        action={<Badge tone={active ? 'green' : 'muted'}>{active ? 'Call active' : 'Standby'}</Badge>} />
      <div className="agent-stage" aria-label="Call controls">
        <div className={`agent-presence status-${status}`}>
          <div className="pulse-ring" aria-hidden="true"><span /><span /><span /></div>
          <div className="agent-portrait"><img src={carlaImageSrc} alt="" /></div>
        </div>
        <h2>{agentName}</h2>
        <p className="agent-note">{preferences.personality || agentProfile?.shortProfile || 'AI sales development representative'}</p>
        <div className="call-timer"><Icon name="clock" size={16} /> <span aria-label="Call duration">{formatDuration(elapsed)}</span></div>
        <p className="live-state" role="status">{phase}</p>
        <div className="agent-actions">
          <button type="button" className={`button button-secondary ${isVoiceListening ? 'mic-active' : ''}`}
            onClick={toggleVoiceCapture} disabled={!micAvailable}
            aria-label={isVoiceListening ? 'Stop microphone' : 'Microphone'}
            title={micAvailable ? 'Capture a lead reply' : 'Microphone is available during interactive calls in supported browsers'}>
            <Icon name="mic" />{isVoiceListening ? 'Stop mic' : 'Mic'}
          </button>
          <button className={`button ${callInProgress ? 'button-danger' : 'button-primary'}`} type="button"
            onClick={callInProgress ? endCall : () => setIsStartModalOpen(true)}
            disabled={isLoading || (!callInProgress && !selectedLeadId)}>
            <Icon name={callInProgress ? 'end' : 'phone'} />{isLoading ? 'Working…' : callInProgress ? 'End call' : 'Start call'}
          </button>
        </div>
      </div>
      <div className="lead-context">
        <label className="form-field" htmlFor="lead">Lead<select id="lead" value={selectedLeadId}
          onChange={(event) => setSelectedLeadId(event.target.value)} disabled={active || leads.length === 0}>
          {!leads.length && <option value="">No leads available</option>}
          {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.company}</option>)}
        </select></label>
        {selectedLead && <div className="live-customer">
          <div className="contact-cell"><Avatar name={selectedLead.name} /><div><b>{selectedLead.name}</b><span>{selectedLead.title}</span></div></div>
          <p>{selectedLead.company} · {selectedLead.industry} · {selectedLead.companySize} employees</p>
          <p>{selectedLead.discussionTopic}</p>
          <div className="badge-row">{selectedLead.currentTools.map((tool) => <Badge key={tool}>{tool}</Badge>)}</div>
        </div>}
      </div>
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {voiceError && <p className="feedback feedback-error" role="alert">{voiceError}</p>}
      {vapiVoiceError && <p className="feedback feedback-error" role="alert">{vapiVoiceError} The transcript remains available.</p>}
    </section>

    <section className="panel live-transcript" aria-label="Call transcript">
      <CardHeader title="Live transcript" detail="Conversation between the agent and lead"
        action={<Badge>{visibleTranscript.length} {visibleTranscript.length === 1 ? 'message' : 'messages'}</Badge>} />
      <div ref={transcriptList} className="transcript-scroll">
        {visibleTranscript.length ? <div className="messages" role="log" aria-label="Transcript messages">
          {visibleTranscript.map((entry, index) => {
            const name = entry.speaker === 'agent' ? agentName : entry.name
            return <article className={`message message-${entry.speaker}`} key={index}>
              <Avatar name={name} /><div><b>{name}</b><p>{entry.message}</p></div>
            </article>
          })}
        </div> : <Empty icon="chat" title={active ? 'Preparing transcript' : 'No active conversation'}
          detail={active ? 'Messages appear as soon as they are ready.' : 'Start a call to see the conversation here.'} />}
      </div>
      {interactive && <form className="lead-reply-form" onSubmit={submitLeadReply}>
        <label className="form-field" htmlFor="leadReply">Lead reply<textarea id="leadReply" value={leadReply} rows={2}
          onChange={(event) => setLeadReply(event.target.value)} placeholder={isVoiceListening ? 'Listening…' : 'Type the lead’s reply'}
          disabled={isLoading || isVoiceListening} /></label>
        <div className="dialog-actions"><button type="submit" className="button button-primary" disabled={isLoading || isVoiceListening || !leadReply.trim()}>Send reply</button></div>
      </form>}
      {call && !callInProgress && !isLoading && <div className="live-outcome">
        <div><h3>Call outcome</h3><Badge tone={call.summary.meetingStatus === 'booked' ? 'green' : 'indigo'}>{formatOutcome(call.classification.outcome)}</Badge></div>
        <p>{call.summary.shortSummaryForSales}</p><p><strong>Next action</strong> · {call.summary.recommendedNextAction}</p>
      </div>}
    </section>

    <section className="panel chart-card live-tools">
      <CardHeader title="Recent agent actions" detail="Backend tools and conversation signals" />
      {serverSignals.length ? <ul className="tool-activity">{serverSignals.map((signal, index) => <li key={`${signal}-${index}`}>
        <span className="tool-mark"><Icon name={signal.startsWith('Intent') || signal.startsWith('Next') || signal.startsWith('Objection') ? 'wave' : 'check'} size={15} /></span>{signal}
      </li>)}</ul> : <Empty icon="wave" title="No activity yet" detail="Tool actions will appear as the call progresses." />}
    </section>

    {isStartModalOpen && <Overlay title="Start call" variant="modal" onClose={() => setIsStartModalOpen(false)}>
      <p className="muted">Choose how to call {selectedLead?.name || 'this lead'}.</p>
      <fieldset className="mode-options"><legend className="sr-only">Call mode</legend>
        {(Object.entries(startModeConfig) as Array<[StartMode, (typeof startModeConfig)[StartMode]]>).map(([mode, config]) =>
          <label className="mode-option" key={mode}><input type="radio" name="startMode" value={mode}
            checked={selectedStartMode === mode} onChange={() => setSelectedStartMode(mode)} />
            <span><strong>{config.title}</strong><small>{config.description}</small></span>
          </label>)}
      </fieldset>
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setIsStartModalOpen(false)}>Cancel</button>
        <button type="button" className="button button-primary" onClick={() => void beginCall()} disabled={isLoading}><Icon name="phone" /> Start</button>
      </div>
    </Overlay>}
  </div>
}
