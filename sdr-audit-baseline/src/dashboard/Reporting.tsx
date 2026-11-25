import { useState } from 'react'
import { formatDate, formatDuration, formatOutcome, formatTime, percent, sentimentFor, sentiments, statusFor } from './model'
import type { CallRecord, Lead, Preferences } from './model'
import { Avatar, Badge, CardHeader, Empty, Icon, Overlay } from './ui'
import type { IconName } from './ui'

type ReportingProps = { leads: Lead[]; calls: CallRecord[]; preferences: Preferences }

const sentimentTones = { Positive: 'green', Neutral: 'indigo', Negative: 'rose', Unrated: 'muted' }
const sentimentColors = { Positive: '#3ccca8', Neutral: '#8187fb', Negative: '#f4849b', Unrated: '#55627b' }

function metricData(leads: Lead[], calls: CallRecord[], preferences: Preferences) {
  const leadIds = new Set(leads.map((lead) => lead.id))
  const booked = new Set(calls.filter((call) => call.summary.meetingStatus === 'booked').map((call) => call.summary.bookedSlotId ?? call.callId)).size
  const crmCalls = calls.filter((call) => leadIds.has(call.lead.id))
  const contacted = new Set(crmCalls.map((call) => call.lead.id)).size
  const qualified = new Set(crmCalls.filter((call) => ['Qualified', 'Booked'].includes(statusFor(call, preferences))).map((call) => call.lead.id)).size
  const bookedLeads = new Set(crmCalls.filter((call) => call.summary.meetingStatus === 'booked').map((call) => call.lead.id)).size
  return { qualified, booked, bookedLeads, contacted }
}

function Metric({ icon, label, value, note, color }: {
  icon: IconName; label: string; value: string | number; note: string; color: string
}) {
  return <article className="panel metric">
    <span className={`metric-icon metric-${color}`}><Icon name={icon} /></span>
    <h2>{label}</h2><strong>{value}</strong><p>{note}</p>
  </article>
}

function ConversionChart({ leads, calls, preferences }: ReportingProps) {
  const { qualified, bookedLeads, contacted } = metricData(leads, calls, preferences)
  const stages = [['Total leads', leads.length], ['Contacted', contacted], ['Qualified', qualified], ['Booked', bookedLeads]] as const
  const max = Math.max(4, Math.ceil(Math.max(...stages.map(([, value]) => value)) / 4) * 4)
  return <section className="panel chart-card">
    <CardHeader title="Lead conversion" detail="Unique leads across the sales funnel" />
    <div className="conversion-plot" role="img" aria-label={stages.map(([label, value]) => `${label} ${value}`).join(', ')}>
      <div className="chart-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map((step) => <span key={step}>{step * max / 4}</span>)}</div>
      <div className="plot-grid" aria-hidden="true">
        {stages.map(([label, value], index) => <div className="plot-column" key={label}>
          <div className={`plot-bar bar-${index}`} style={{ height: `max(3px, ${value / max * 100}%)` }}><b>{value}</b></div>
          <span>{label}</span>
        </div>)}
      </div>
    </div>
  </section>
}

function SentimentChart({ calls }: { calls: CallRecord[] }) {
  const counts = sentiments.map((label) => ({ label, count: calls.filter((call) => sentimentFor(call) === label).length }))
  let cursor = 0
  const segments = counts.filter(({ count }) => count > 0).map(({ label, count }) => {
    const start = cursor
    cursor += 100 * count / calls.length
    return `${sentimentColors[label]} ${start}% ${cursor}%`
  })
  return <section className="panel chart-card sentiment-card">
    <CardHeader title="Sentiment distribution" detail="Estimated from lead replies" />
    <div className="donut" style={segments.length ? { background: `conic-gradient(${segments.join(',')})` } : undefined}>
      <div><strong>{calls.length}</strong><span>{calls.length === 1 ? 'Call' : 'Calls'}</span></div>
    </div>
    <ul className="chart-legend">{counts.map(({ label, count }) => <li key={label}>
      <span className="legend-dot" style={{ background: sentimentColors[label] }} /><span>{label}</span>
      <b>{count}</b><small>{percent(count, calls.length)}%</small>
    </li>)}</ul>
  </section>
}

function CallTable({ calls, onOpen }: { calls: CallRecord[]; onOpen: (call: CallRecord) => void }) {
  return <div className="table-scroll"><table>
    <thead><tr><th>Lead</th><th>Outcome</th><th>Sentiment</th><th>When</th><th><span className="sr-only">Details</span></th></tr></thead>
    <tbody>{calls.map((call) => {
      const sentiment = sentimentFor(call)
      return <tr key={call.callId}>
        <td><div className="contact-cell"><Avatar name={call.lead.name} /><div><b>{call.lead.name}</b><span>{call.lead.company}</span></div></div></td>
        <td><Badge tone={call.summary.meetingStatus === 'booked' ? 'green' : 'muted'}>{formatOutcome(call.classification.outcome)}</Badge></td>
        <td><Badge tone={sentimentTones[sentiment]}>{sentiment}</Badge></td>
        <td>{formatDate(call.endedAt)}<small className="table-subline">{formatTime(call.endedAt)}</small></td>
        <td><button type="button" className="button icon-button table-action" onClick={() => onOpen(call)} aria-label={`View call with ${call.lead.name}`}><Icon name="right" size={17} /></button></td>
      </tr>
    })}</tbody>
  </table></div>
}

function CallDetail({ call, close }: { call: CallRecord; close: () => void }) {
  const sentiment = sentimentFor(call)
  return <Overlay title={`Call with ${call.lead.name}`} onClose={close}>
    <p className="muted">{call.lead.company} · {formatDate(call.endedAt)} · {call.modeLabel} · {formatDuration(call.endedAt - call.startedAt)}</p>
    <div className="badge-row"><Badge tone={sentimentTones[sentiment]}>{sentiment} sentiment</Badge>
      <Badge tone={call.summary.meetingStatus === 'booked' ? 'green' : 'indigo'}>{formatOutcome(call.classification.outcome)}</Badge>
      {call.endedManually && <Badge>Ended manually</Badge>}
    </div>
    <section className="detail-section"><h3>Call summary</h3><p>{call.summary.shortSummaryForSales}</p>
      <dl className="detail-list">
        <div><dt>Interest</dt><dd>{formatOutcome(call.summary.interestLevel)}</dd></div>
        <div><dt>Meeting</dt><dd>{formatOutcome(call.summary.meetingStatus)}</dd></div>
        <div><dt>Next action</dt><dd>{call.summary.recommendedNextAction}</dd></div>
        <div><dt>Outcome reason</dt><dd>{call.classification.reason}</dd></div>
      </dl>
      {call.summary.painPoints.length > 0 && <p><strong>Pain points</strong> · {call.summary.painPoints.join(', ')}</p>}
      {call.summary.objections.length > 0 && <p><strong>Objections</strong> · {call.summary.objections.join(', ')}</p>}
    </section>
    <section className="detail-section"><h3>Transcript</h3>
      <div className="messages">{call.transcript.map((entry, index) => <article className={`message message-${entry.speaker}`} key={index}>
        <Avatar name={entry.name} /><div><b>{entry.name}</b><p>{entry.message}</p></div>
      </article>)}</div>
    </section>
  </Overlay>
}

export function Overview(props: ReportingProps & { loading: boolean; leadError: boolean; openHistory: () => void; openLive: () => void }) {
  const { leads, calls, preferences, loading, leadError, openHistory, openLive } = props
  const metrics = metricData(leads, calls, preferences)
  const [selected, setSelected] = useState<CallRecord | null>(null)
  const leadValue = loading || leadError ? '—' : leads.length
  return <>
    <div className="metric-grid">
      <Metric icon="people" color="indigo" label="Total leads" value={leadValue} note="CRM contacts" />
      <Metric icon="phone" color="blue" label="Total calls" value={calls.length} note="Recorded in this browser" />
      <Metric icon="target" color="green" label="Qualified leads" value={loading || leadError ? '—' : metrics.qualified} note="Based on call results" />
      <Metric icon="calendar" color="purple" label="Appointments booked" value={metrics.booked} note="Confirmed by backend" />
      <Metric icon="analytics" color="amber" label="Conversion rate" value={loading || leadError ? '—' : `${percent(metrics.bookedLeads, leads.length)}%`} note="Booked leads / total leads" />
    </div>
    <div className="report-grid">
      {loading || leadError ? <section className="panel chart-card"><CardHeader title="Lead conversion" detail="Unique leads across the sales funnel" />
        <Empty icon="analytics" title={loading ? 'Loading lead data' : 'Lead data unavailable'} detail={loading ? 'Fetching contacts from the CRM.' : 'The funnel requires a connection to the CRM.'} />
      </section> : <ConversionChart {...props} />}
      <SentimentChart calls={calls} />
    </div>
    <section className="panel table-panel"><CardHeader title="Recent call activity" detail="Latest completed calls from this workspace"
      action={<button type="button" className="button button-secondary" onClick={openHistory}>View history</button>} />
      {calls.length ? <CallTable calls={calls.slice(0, 5)} onOpen={setSelected} /> : <Empty icon="phone" title="No calls recorded yet"
        detail="Completed calls will appear here with their outcome and sentiment."
        action={<button type="button" className="button button-secondary" onClick={openLive}>Open live calls</button>} />}
    </section>
    {selected && <CallDetail call={selected} close={() => setSelected(null)} />}
  </>
}

export function History({ calls, openLive }: { calls: CallRecord[]; openLive: () => void }) {
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState('')
  const [selected, setSelected] = useState<CallRecord | null>(null)
  const outcomes = [...new Set(calls.map((call) => call.classification.outcome))]
  const matches = calls.filter((call) => (!outcome || call.classification.outcome === outcome) &&
    `${call.lead.name} ${call.lead.company}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <section className="panel table-panel">
    <CardHeader title="Call records" detail="Calls completed in this browser" />
    <div className="table-filters">
      <label className="search-input"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by lead or company" aria-label="Search call records" /></label>
      <select aria-label="Filter by outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">All outcomes</option>
        {outcomes.map((item) => <option key={item} value={item}>{formatOutcome(item)}</option>)}</select>
    </div>
    {matches.length ? <CallTable calls={matches} onOpen={setSelected} /> : <Empty icon="history"
      title={calls.length ? 'No matching calls' : 'No calls recorded yet'} detail={calls.length ? 'Try a different search or outcome.' : 'Start a call to populate the history.'}
      action={calls.length ? undefined : <button type="button" className="button button-secondary" onClick={openLive}>Open live calls</button>} />}
    {selected && <CallDetail call={selected} close={() => setSelected(null)} />}
  </section>
}

export function Analytics(props: ReportingProps & { leadDataAvailable: boolean }) {
  const { leads, calls, preferences, leadDataAvailable } = props
  const [period, setPeriod] = useState('all')
  const days = Number(period)
  const periodCalls = period === 'all' ? calls : calls.filter((call) => call.endedAt >= Date.now() - days * 86_400_000)
  const metrics = metricData(leads, periodCalls, preferences)
  const avgDuration = periodCalls.length ? periodCalls.reduce((sum, call) => sum + call.endedAt - call.startedAt, 0) / periodCalls.length : 0
  const bookedCalls = periodCalls.filter((call) => call.summary.meetingStatus === 'booked').length
  const outcomes = [...new Set(periodCalls.map((call) => call.classification.outcome))]
  return <>
    <div className="report-controls"><label>Time range <select value={period} onChange={(event) => setPeriod(event.target.value)}>
      <option value="all">All recorded calls</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option>
    </select></label></div>
    <div className="metric-grid metrics-four">
      <Metric icon="phone" color="indigo" label="Total calls" value={periodCalls.length} note="In selected period" />
      <Metric icon="clock" color="blue" label="Average duration" value={periodCalls.length ? formatDuration(avgDuration) : '—'} note="Includes demo playback" />
      <Metric icon="calendar" color="green" label="Appointments booked" value={metrics.booked} note="Distinct booked slots" />
      <Metric icon="analytics" color="amber" label="Appointment conversion" value={`${percent(bookedCalls, periodCalls.length)}%`} note="Booked calls / total calls" />
    </div>
    <div className="report-grid">{leadDataAvailable ? <ConversionChart {...props} calls={periodCalls} /> :
      <section className="panel chart-card"><CardHeader title="Lead conversion" /><Empty icon="analytics" title="Lead data unavailable" detail="The funnel requires CRM data." /></section>}
      <SentimentChart calls={periodCalls} /></div>
    <section className="panel chart-card"><CardHeader title="Call performance" detail="Distribution by recorded outcome" />
      {outcomes.length ? <ul className="performance-list">{outcomes.map((outcome) => {
        const count = periodCalls.filter((call) => call.classification.outcome === outcome).length
        return <li key={outcome}><span>{formatOutcome(outcome)}</span><meter min={0} max={periodCalls.length} value={count}>{count}</meter><b>{count}</b></li>
      })}</ul> : <Empty icon="analytics" title="No activity in this period" detail="Complete a call or choose a wider time range." />}
    </section>
  </>
}
