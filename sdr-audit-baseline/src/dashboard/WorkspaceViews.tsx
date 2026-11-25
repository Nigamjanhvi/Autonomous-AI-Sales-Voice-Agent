import { useEffect, useRef, useState } from 'react'
import { defaults, formatDate, formatTime } from './model'
import type { AgentProfile, CallRecord, Preferences } from './model'
import { Badge, CardHeader, Empty, Icon, Overlay } from './ui'

type DocumentRecord = { id: string; file: File; uploadedAt: number }

async function documentStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('carla-knowledge-base', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('documents', { keyPath: 'id' })
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('Close other workspace tabs and retry.'))
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('documents', mode)
      const request = action(transaction.objectStore('documents'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export function KnowledgeBase() {
  const [docs, setDocs] = useState<DocumentRecord[]>([])
  const [busy, setBusy] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<DocumentRecord | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    documentStore<DocumentRecord[]>('readonly', (store) => store.getAll())
      .then((records) => { if (active) setDocs(records.sort((a, b) => b.uploadedAt - a.uploadedAt)) })
      .catch(() => { if (active) setError('Could not load browser documents. Check this browser’s storage permissions.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])

  async function addFiles(files: File[]) {
    if (!files.length || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    let added = 0
    const failed: string[] = []
    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024 || !/\.(pdf|docx|txt|md|csv)$/i.test(file.name)) {
          failed.push(file.name)
          continue
        }
        try {
          const doc = { id: crypto.randomUUID(), file, uploadedAt: Date.now() }
          await documentStore('readwrite', (store) => store.add(doc))
          setDocs((previous) => [doc, ...previous])
          added += 1
        } catch {
          failed.push(file.name)
        }
      }
      if (added) setNotice(`${added} ${added === 1 ? 'document saved' : 'documents saved'} to this browser.`)
      if (failed.length) setError(`Could not save ${failed.join(', ')}. Check the file type, 10 MB limit, and browser storage.`)
    } finally {
      setBusy(false)
    }
  }

  function download(doc: DocumentRecord) {
    const url = URL.createObjectURL(doc.file)
    const link = document.createElement('a')
    link.href = url
    link.download = doc.file.name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function remove(doc: DocumentRecord) {
    setPendingDelete(null)
    setBusy(true)
    setNotice('')
    setError('')
    try {
      await documentStore('readwrite', (store) => store.delete(doc.id))
      setDocs((previous) => previous.filter(({ id }) => id !== doc.id))
      setNotice(`Removed ${doc.file.name}.`)
    } catch {
      setError(`Could not remove ${doc.file.name}.`)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="panel chart-card">
      <CardHeader title="Add documents" detail="Files are stored in this browser. Carla’s backend does not index them." />
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true) }}
        onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles([...event.dataTransfer.files]) }}>
        <span className="empty-icon"><Icon name="upload" size={24} /></span><strong>Drop documents here</strong>
        <p>PDF, DOCX, TXT, Markdown or CSV · Up to 10 MB per file</p>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" /> {busy ? 'Working…' : 'Choose files'}
        </button>
        <input ref={input} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" hidden onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }} />
      </div>
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
    </section>
    <section className="panel table-panel"><CardHeader title="Documents" detail={`${docs.length} stored locally`} />
      {docs.length ? <div className="table-scroll"><table><thead><tr><th>Document</th><th>Status</th><th>Added</th><th>Actions</th></tr></thead>
        <tbody>{docs.map((doc) => <tr key={doc.id}>
          <td><div className="file-cell"><Icon name="file" /><div><b>{doc.file.name}</b><small className="table-subline">{Math.max(1, Math.ceil(doc.file.size / 1024))} KB</small></div></div></td>
          <td><Badge tone="green">Stored locally</Badge></td><td>{formatDate(doc.uploadedAt)}</td>
          <td><div className="row-actions">
            <button type="button" className="button icon-button" aria-label={`Download ${doc.file.name}`} onClick={() => download(doc)}><Icon name="download" /></button>
            <button type="button" disabled={busy} className="button icon-button" aria-label={`Remove ${doc.file.name}`} onClick={() => setPendingDelete(doc)}><Icon name="trash" /></button>
          </div></td>
        </tr>)}</tbody></table></div> : <Empty icon="book" title={busy ? 'Loading documents' : 'No documents yet'} detail="Add a product brief, sales playbook, or FAQ to organize your reference material." />}
    </section>
    {pendingDelete && <Overlay title="Remove document?" variant="modal" onClose={() => setPendingDelete(null)}>
      <p className="muted">{pendingDelete.file.name} will be removed from this browser.</p>
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
        <button type="button" className="button button-danger" onClick={() => void remove(pendingDelete)}>Remove document</button></div>
    </Overlay>}
  </>
}

const dateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Appointments({ calls, openLive }: { calls: CallRecord[]; openLive: () => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selected, setSelected] = useState<Date | null>(null)
  const now = new Date()
  const first = new Date(month.getFullYear(), month.getMonth(), 1 - ((month.getDay() + 6) % 7))
  const bookings = [...new Map(calls.filter((call) => call.meeting).reverse().map((call) => [call.meeting!.slotId, call])).values()]
    .sort((a, b) => Date.parse(a.meeting!.startsAt) - Date.parse(b.meeting!.startsAt))
  const upcoming = bookings.filter((call) => new Date(call.meeting!.startsAt) >= now)
  const shown = selected ? bookings.filter((call) => dateKey(new Date(call.meeting!.startsAt)) === dateKey(selected)) : upcoming
  const past = bookings.filter((call) => new Date(call.meeting!.startsAt) < now).reverse()
  const shiftMonth = (step: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + step, 1)); setSelected(null) }

  return <>
    <div className="appointments-grid">
      <section className="panel chart-card">
        <CardHeader title={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          detail="Booked meetings · Local time"
          action={<div className="row-actions">
            <button type="button" className="button icon-button" aria-label="Previous month" onClick={() => shiftMonth(-1)}><Icon name="left" /></button>
            <button type="button" className="button icon-button" aria-label="Next month" onClick={() => shiftMonth(1)}><Icon name="right" /></button>
          </div>} />
        <div className="calendar-grid">
          {weekdays.map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
          {Array.from({ length: 42 }, (_, index) => {
            const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)
            const key = dateKey(day)
            const count = bookings.filter((call) => dateKey(new Date(call.meeting!.startsAt)) === key).length
            const active = selected && dateKey(selected) === key
            return <button type="button" className={`calendar-day${day.getMonth() !== month.getMonth() ? ' other-month' : ''}${key === dateKey(now) ? ' today' : ''}`}
              aria-label={`${formatDate(day.getTime())}, ${count} bookings`} aria-pressed={Boolean(active)} key={key} onClick={() => {
                setSelected(active ? null : day)
                if (day.getMonth() !== month.getMonth()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1))
              }}>
              <span>{day.getDate()}</span>{count > 0 && <small>{count}<span className="calendar-book-label"> booked</span></small>}
            </button>
          })}
        </div>
      </section>
      <section className="panel chart-card">
        <CardHeader title={selected ? formatDate(selected.getTime()) : 'Upcoming meetings'}
          detail={selected ? 'Bookings on selected date' : 'Bookings from completed calls'}
          action={selected && <button type="button" className="button button-secondary" onClick={() => setSelected(null)}>Upcoming</button>} />
        {shown.length ? <MeetingList calls={shown} /> : <Empty icon="calendar" title={selected ? 'No meetings on this date' : 'No upcoming meetings'}
          detail={selected ? 'Choose another date to see its bookings.' : 'New bookings from completed calls will appear here.'}
          action={selected || past.length ? undefined : <button type="button" className="button button-secondary" onClick={openLive}>Open live calls</button>} />}
      </section>
    </div>
    {past.length > 0 && <section className="panel chart-card"><CardHeader title="Past bookings" detail="Confirmed bookings with a start time in the past" /><MeetingList calls={past} /></section>}
  </>
}

function MeetingList({ calls }: { calls: CallRecord[] }) {
  return <ul className="meeting-list">{calls.map((call) => <li key={call.callId}>
    <span className="empty-icon"><Icon name="calendar" /></span>
    <div><strong>{call.lead.name}</strong><p>{call.lead.company} · {call.meeting?.salesRep}</p>
      <p>{formatDate(call.meeting!.startsAt)} · {formatTime(call.meeting!.startsAt)}–{formatTime(call.meeting!.endsAt)}</p></div>
    <Badge tone="green">Booked</Badge>
  </li>)}</ul>
}

export function Settings({ preferences, agent, save }: {
  preferences: Preferences; agent: AgentProfile | null; save: (values: Preferences) => void
}) {
  const [draft, setDraft] = useState(preferences)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  function update<T extends keyof Preferences>(key: T, value: Preferences[T]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setFeedback(null)
  }
  function submit() {
    const next = { ...draft, name: draft.name.trim(), personality: draft.personality.trim() }
    try {
      save(next)
      setDraft(next)
      setFeedback({ text: 'Preferences saved to this browser.', error: false })
    } catch {
      setFeedback({ text: 'Could not save preferences. Check this browser’s storage permissions.', error: true })
    }
  }
  return <form className="settings-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="settings-grid">
      <section className="panel chart-card"><CardHeader title="Agent profile" detail="Display settings for the live workspace" />
        <label className="form-field">Display name<input value={draft.name} maxLength={40} placeholder={agent?.name || 'Carla'} onChange={(event) => update('name', event.target.value)} /></label>
        <label className="form-field">Personality note<textarea value={draft.personality} maxLength={250} rows={3}
          placeholder={agent?.shortProfile || 'Describe the agent’s style'} onChange={(event) => update('personality', event.target.value)} />
          <small>Shown on the live call profile. Carla’s server prompt is configured on the backend.</small></label>
      </section>
      <section className="panel chart-card"><CardHeader title="Language and voice" detail="Input and playback for new calls" />
        <label className="form-field">Microphone language<select value={draft.language} onChange={(event) => update('language', event.target.value)}>
          <option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option>
          <option value="en-IN">English (India)</option><option value="es-ES">Spanish</option><option value="fr-FR">French</option>
        </select><small>Controls browser speech recognition.</small></label>
        <label className="form-field">Agent playback<select value={draft.voice} onChange={(event) => update('voice', event.target.value as Preferences['voice'])}>
          <option value="vapi">Vapi when configured</option><option value="silent">Text only</option></select>
          <small>The configured Vapi assistant controls the voice.</small></label>
      </section>
      <section className="panel chart-card"><CardHeader title="Qualification criteria" detail="Applies to dashboard lead status and reporting" />
        <label className="form-field">Minimum score <strong>{draft.qualificationThreshold} / 100</strong>
          <input type="range" min={5} max={100} step={5} value={draft.qualificationThreshold} onChange={(event) => update('qualificationThreshold', Number(event.target.value))} />
          <small>Scores use recorded interest and pain points. Bookings score 100 and declines score 0.</small>
        </label>
        <label className="checkbox-field"><input type="checkbox" checked={draft.requirePainPoint}
          onChange={(event) => update('requirePainPoint', event.target.checked)} /> Require a recorded pain point for qualification</label>
      </section>
    </div>
    {feedback && <p className={`feedback ${feedback.error ? 'feedback-error' : 'feedback-success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => { setDraft(defaults); setFeedback(null) }}>Restore defaults</button>
      <button type="submit" className="button button-primary"><Icon name="check" /> Save preferences</button></div>
  </form>
}
