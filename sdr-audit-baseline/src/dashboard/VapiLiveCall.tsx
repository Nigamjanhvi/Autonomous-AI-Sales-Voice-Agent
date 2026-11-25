import Vapi from '@vapi-ai/web'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { apiBase, formatDuration, recordCall } from './model'
import type { CallRecord, CallResult, Lead } from './model'

const WebVapi = (Vapi as unknown as { default?: typeof Vapi }).default ?? Vapi
type Phase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended'
type Message = { role: 'assistant' | 'user'; transcript: string }

export function VapiLiveCall({ lead, onClose, onRecorded }: {
  lead: Lead
  onClose: () => void
  onRecorded: (record: CallRecord) => void
}) {
  const [phase, setPhase] = useState<Phase>('ended')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
  const [providerId, setProviderId] = useState('')
  const providerIdRef = useRef('')
  const [connected, setConnected] = useState(false)
  const sdk = useRef<Vapi | null>(null)
  const startedAt = useRef(0)
  const recorded = useRef(false)
  const starting = useRef(false)
  const ended = useRef(false)
  const publicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined
  const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined
  const configuredDuration = Number(import.meta.env.VITE_VAPI_MAX_CALL_DURATION_SECONDS ?? 300)
  const maxDurationSeconds = Number.isFinite(configuredDuration) ? Math.min(Math.max(configuredDuration, 30), 900) : 300
  const stopAtLimit = useEffectEvent(() => stop())

  useEffect(() => {
    if (!connected || phase === 'ended') return
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(elapsed)
      if (elapsed >= maxDurationSeconds) stopAtLimit()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [connected, phase, maxDurationSeconds])

  async function syncRecord(id: string) {
    if (recorded.current) return
    const callId = id.startsWith('vapi_') || id.startsWith('call_') ? id : `vapi_${id}`
    for (let attempt = 0; attempt < 5 && !recorded.current; attempt += 1) {
      try {
        const response = await fetch(`${apiBase}/api/calls/${encodeURIComponent(callId)}`)
        if (response.ok) {
          const body = await response.json() as { call: CallResult; metadata: { status: string } }
          if (body.metadata.status === 'completed') {
            recorded.current = true
            onRecorded(recordCall(body.call, startedAt.current || Date.now(), 'Vapi Live', false))
            return
          }
        }
      } catch { /* A later attempt can recover a transient network error. */ }
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
    }
  }

  async function start() {
    if (starting.current || sdk.current) return
    starting.current = true
    ended.current = false
    setError('')
    setPhase('connecting')
    if (!publicKey || publicKey === 'replace_me' || !assistantId || assistantId === 'replace_me') {
      setError('Configure VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID in the local .env file.')
      setPhase('ended')
      starting.current = false
      return
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access a microphone.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      if (ended.current) return
      const vapi = new WebVapi(publicKey)
      sdk.current = vapi
      vapi.on('call-start', () => {
        startedAt.current = Date.now()
        setConnected(true)
        setPhase('listening')
      })
      vapi.on('speech-start', () => setPhase('speaking'))
      vapi.on('speech-end', () => setPhase('listening'))
      vapi.on('message', (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return
        const event = raw as { type?: string; role?: string; transcript?: string; transcriptType?: string }
        if (event.type === 'speech-update' && event.role === 'user') setPhase('listening')
        if (event.type === 'conversation-update') setPhase('thinking')
        if (event.type === 'transcript' && event.transcriptType === 'final' &&
          (event.role === 'assistant' || event.role === 'user') && event.transcript?.trim()) {
          setMessages((previous) => [...previous, { role: event.role as Message['role'], transcript: event.transcript!.trim() }])
          if (event.role === 'user') setPhase('thinking')
        }
      })
      vapi.on('call-end', () => {
        ended.current = true
        sdk.current = null
        setPhase('ended')
        setConnected(false)
        if (providerIdRef.current) window.setTimeout(() => void syncRecord(providerIdRef.current), 1200)
      })
      vapi.on('error', () => {
        setError('Vapi reported a connection or audio error. Check the assistant configuration and network.')
      })
      const call = await Promise.race([vapi.start(assistantId, {
        firstMessageMode: 'assistant-waits-for-user',
        maxDurationSeconds,
        metadata: { leadId: lead.id, source: 'ai-sdr', backendBrain: true },
        variableValues: { leadId: lead.id },
      }), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Vapi connection timed out.')), 20000))])
      if (call?.id) { providerIdRef.current = call.id; setProviderId(call.id) }
      if (!call?.id) throw new Error('Vapi did not confirm a provider call ID.')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not start voice call.'
      setError(message.includes('Permission') || message.includes('NotAllowed')
        ? 'Microphone permission was denied. Allow microphone access in the browser and try again.' : message)
      sdk.current?.removeAllListeners()
      void sdk.current?.stop()
      sdk.current = null
      setPhase('ended')
    } finally { starting.current = false }
  }

  function stop() {
    ended.current = true
    sdk.current?.stop()
    sdk.current?.removeAllListeners()
    sdk.current = null
    setPhase('ended')
    setConnected(false)
    if (providerId) window.setTimeout(() => void syncRecord(providerId), 1200)
  }

  useEffect(() => () => { ended.current = true; sdk.current?.stop(); sdk.current?.removeAllListeners() }, [])

  return <section className="panel" aria-label="Vapi live voice call">
    <h2>Live voice with Carla</h2>
    <p>{lead.name} · {lead.company}</p>
    <p role="status">{connected ? `Provider connected · ${phase}` : phase === 'connecting' ? 'Connecting to Vapi' : 'Disconnected'}</p>
    <p aria-label="Call duration">{formatDuration(seconds * 1000)}</p>
    <div className="agent-actions">
      {phase === 'ended' ? <button className="button button-primary" onClick={() => void start()}>Start browser call</button> :
        <button className="button button-danger" onClick={stop}>End call</button>}
      <button className="button button-secondary" disabled={!connected} onClick={() => {
        sdk.current?.setMuted(!muted); setMuted(!muted)
      }}>{muted ? 'Unmute microphone' : 'Mute microphone'}</button>
      <button className="button button-secondary" disabled={!connected || phase !== 'speaking'} onClick={() => {
        sdk.current?.say('', false, true, true)
        setPhase('listening')
      }}>Interrupt speech</button>
      <button className="button button-secondary" onClick={() => { stop(); onClose() }}>Back to call modes</button>
    </div>
    {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    <div className="transcript-scroll" role="log" aria-label="Live transcript">
      {messages.length ? messages.map((entry, index) => <p key={index}><strong>{entry.role === 'assistant' ? 'Carla' : lead.name}</strong> {entry.transcript}</p>) :
        <p>Final transcript entries appear here when Vapi confirms them.</p>}
    </div>
  </section>
}
