import { useState } from 'react'
import { formatDate, formatOutcome, latestCalls, scoreFor, statusFor } from './model'
import type { CallRecord, Lead, Preferences } from './model'
import { Avatar, Badge, CardHeader, Empty, Icon, Overlay } from './ui'

const tones: Record<string, string> = { Booked: 'green', Qualified: 'indigo', 'Follow-up': 'amber', Declined: 'rose', Disqualified: 'rose' }

export function Leads({ leads, calls, preferences, loading, failed, onCall }: {
  leads: Lead[]; calls: CallRecord[]; preferences: Preferences; loading: boolean; failed: boolean; onCall: (lead: Lead) => void
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [industry, setIndustry] = useState('')
  const [selected, setSelected] = useState<Lead | null>(null)
  const byLead = latestCalls(calls)
  const industries = [...new Set(leads.map((lead) => lead.industry))].sort()
  const matches = leads.filter((lead) => (!status || statusFor(byLead.get(lead.id), preferences) === status) &&
    (!industry || lead.industry === industry) &&
    `${lead.name} ${lead.company} ${lead.title} ${lead.workEmail}`.toLowerCase().includes(query.trim().toLowerCase()))
  const latest = selected ? byLead.get(selected.id) : undefined
  const selectedStatus = statusFor(latest, preferences)
  return <section className="panel table-panel">
    <CardHeader title="Lead directory" detail={`${matches.length} of ${leads.length} contacts`} />
    <div className="table-filters">
      <label className="search-input"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder="Search leads by name or company" aria-label="Search leads" /></label>
      <select aria-label="Filter by lead status" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All statuses</option>{['New', 'Qualified', 'Booked', 'Follow-up', 'Declined', 'Disqualified'].map((item) => <option key={item}>{item}</option>)}
      </select>
      <select aria-label="Filter by industry" value={industry} onChange={(event) => setIndustry(event.target.value)}>
        <option value="">All industries</option>{industries.map((item) => <option key={item}>{item}</option>)}
      </select>
    </div>
    {matches.length ? <div className="table-scroll"><table>
      <thead><tr><th>Lead</th><th>Company</th><th>Status</th><th>Score</th><th><span className="sr-only">Details</span></th></tr></thead>
      <tbody>{matches.map((lead) => {
        const call = byLead.get(lead.id)
        const label = statusFor(call, preferences)
        const score = scoreFor(call)
        return <tr key={lead.id}>
          <td><button type="button" className="contact-cell contact-button" onClick={() => setSelected(lead)}>
            <Avatar name={lead.name} /><span><b>{lead.name}</b><span>{lead.title}</span></span>
          </button></td>
          <td>{lead.company}<small className="table-subline">{lead.industry}</small></td>
          <td><Badge tone={tones[label]}>{label}</Badge></td>
          <td>{score === undefined ? <span className="muted">Unscored</span> : <span className="lead-score"><meter min={0} max={100} value={score}>{score}</meter>{score}</span>}</td>
          <td><button type="button" className="button icon-button table-action" aria-label={`View ${lead.name}`} onClick={() => setSelected(lead)}><Icon name="right" size={17} /></button></td>
        </tr>
      })}</tbody>
    </table></div> : <Empty icon="people" title={loading ? 'Loading leads' : failed ? 'Lead data unavailable' : 'No leads found'}
      detail={loading ? 'Fetching contacts from the CRM.' : failed ? 'Retry the API request to view your leads.' : 'Try a different search or filter.'} />}
    {selected && <Overlay title={selected.name} onClose={() => setSelected(null)}>
      <div className="contact-summary"><Avatar name={selected.name} /><div><strong>{selected.title}</strong><p>{selected.company}</p></div></div>
      <div className="badge-row"><Badge tone={tones[selectedStatus]}>{selectedStatus}</Badge><Badge>Score {scoreFor(latest) ?? 'unscored'}</Badge></div>
      <dl className="detail-list">
        <div><dt>Email</dt><dd><a href={`mailto:${selected.workEmail}`}>{selected.workEmail}</a></dd></div>
        <div><dt>Industry</dt><dd>{selected.industry}</dd></div>
        <div><dt>Company size</dt><dd>{selected.companySize}</dd></div>
        <div><dt>Current tools</dt><dd>{selected.currentTools.join(', ')}</dd></div>
        <div><dt>Discussion topic</dt><dd>{selected.discussionTopic}</dd></div>
        <div><dt>Potential pain point</dt><dd>{selected.painHint}</dd></div>
        <div><dt>Previous interaction</dt><dd>{selected.previousInteraction}</dd></div>
        {latest && <div><dt>Latest call · {formatDate(latest.endedAt)}</dt><dd>{formatOutcome(latest.classification.outcome)}</dd></div>}
      </dl>
      <button type="button" className="button button-primary" onClick={() => { setSelected(null); onCall(selected) }}><Icon name="phone" /> Open live call</button>
    </Overlay>}
  </section>
}
