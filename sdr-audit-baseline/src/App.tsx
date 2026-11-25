import { lazy, Suspense, useEffect, useState } from 'react'
import { Leads } from './dashboard/Leads'
import { Analytics, History, Overview } from './dashboard/Reporting'
import { Appointments, KnowledgeBase, Settings } from './dashboard/WorkspaceViews'
import { defaults, getApi, readStorage } from './dashboard/model'
import type { AgentProfile, CallRecord, Lead, Preferences } from './dashboard/model'
import { Avatar, Badge, Icon } from './dashboard/ui'
import type { IconName } from './dashboard/ui'
import './App.css'

const pages = {
  overview: { title: 'Overview', icon: 'overview', detail: 'Monitor your sales pipeline and AI call activity.' },
  live: { title: 'Live Calls', icon: 'phone', detail: 'Run a call with Carla and follow the conversation in real time.' },
  leads: { title: 'Leads', icon: 'people', detail: 'Explore CRM contacts, qualification scores, and next steps.' },
  history: { title: 'Call History', icon: 'history', detail: 'Review transcripts, outcomes, and follow-up recommendations.' },
  knowledge: { title: 'Knowledge Base', icon: 'book', detail: 'Organize the documents used by your sales team.' },
  appointments: { title: 'Appointments', icon: 'calendar', detail: 'Review meetings booked through the call workspace.' },
  analytics: { title: 'Analytics', icon: 'analytics', detail: 'Understand call performance, sentiment, and conversion.' },
  settings: { title: 'Agent Settings', icon: 'settings', detail: 'Configure this workspace’s agent profile, audio, and lead scoring.' },
} satisfies Record<string, { title: string; icon: IconName; detail: string }>

type Page = keyof typeof pages
const operationPages: Page[] = ['overview', 'live', 'leads', 'history', 'appointments', 'analytics']
const configurationPages: Page[] = ['knowledge', 'settings']
const callStorage = 'carla-dashboard-calls-v1'
const settingsStorage = 'carla-dashboard-preferences-v1'
const LiveCalls = lazy(() => import('./dashboard/LiveCalls').then(({ LiveCalls }) => ({ default: LiveCalls })))

function pageFromLocation(): Page {
  const value = window.location.hash.slice(1)
  return Object.hasOwn(pages, value) ? value as Page : 'overview'
}

function App() {
  const [page, setPage] = useState(pageFromLocation)
  const [liveLoaded, setLiveLoaded] = useState(() => pageFromLocation() === 'live')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [agent, setAgent] = useState<AgentProfile | null>(null)
  const [connection, setConnection] = useState<'loading' | 'connected' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [profileUnavailable, setProfileUnavailable] = useState(false)
  const [requestedLead, setRequestedLead] = useState<{ id: string } | null>(null)
  const [calls, setCalls] = useState(() => readStorage<CallRecord[]>(callStorage, []))
  const [preferences, setPreferences] = useState(() => ({ ...defaults, ...readStorage(settingsStorage, defaults) }))
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    const sync = () => {
      const next = pageFromLocation()
      if (next === 'live') setLiveLoaded(true)
      setPage(next)
      setSidebarOpen(false)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false)
        document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    async function loadLeads(retries = 3) {
      try {
        const { leads } = await getApi<{ leads: Lead[] }>('/api/leads', controller.signal)
        setLeads(leads)
        setConnection('connected')
      } catch {
        if (controller.signal.aborted) return
        if (retries > 0) {
          timer = window.setTimeout(() => void loadLeads(retries - 1), 450)
        } else {
          setConnection('error')
        }
      }
    }
    void loadLeads()
    void getApi<{ agent: AgentProfile }>('/api/agent', controller.signal)
      .then(({ agent }) => { setAgent(agent); setProfileUnavailable(false) })
      .catch(() => { if (!controller.signal.aborted) setProfileUnavailable(true) })
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [attempt])

  useEffect(() => {
    try {
      localStorage.setItem(callStorage, JSON.stringify(calls))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [calls])

  function navigate(next: Page) {
    if (next === 'live') setLiveLoaded(true)
    if (page !== next) {
      setPage(next)
      window.location.hash = next
      window.scrollTo({ top: 0 })
    }
    setSidebarOpen(false)
  }

  function record(call: CallRecord) {
    setCalls((current) => [call, ...current.filter(({ callId }) => call.callId !== callId)])
  }

  function savePreferences(values: Preferences) {
    localStorage.setItem(settingsStorage, JSON.stringify(values))
    setPreferences(values)
  }

  function retry() {
    setConnection('loading')
    setProfileUnavailable(false)
    setAttempt((value) => value + 1)
  }

  function navLinks(items: Page[]) {
    return items.map((item) => <a className="navigation-link" href={`#${item}`} key={item}
      aria-current={page === item ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(item) }}>
      <Icon name={pages[item].icon} />{pages[item].title}</a>)
  }

  const openLive = () => navigate('live')
  const busy = connection === 'loading'
  const failed = connection === 'error'
  const agentName = preferences.name || agent?.name || 'Carla'

  return <div className="workspace">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <aside id="workspace-sidebar" className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview') }}>
        <span className="brand-mark"><Icon name="wave" size={22} /></span>
        <span><strong>Carla<span>.</span></strong><small>Sales Operations</small></span>
      </a>
      <nav aria-label="Workspace navigation">
        <div className="nav-section"><p>Workspace</p>{navLinks(operationPages)}</div>
        <div className="nav-section"><p>Configuration</p>{navLinks(configurationPages)}</div>
      </nav>
      <div className="sidebar-footer">
        <span className="workspace-mark"><Icon name="grid" size={19} /></span>
        <div><strong>Fortivex AI</strong><small>Evaluation workspace</small></div>
      </div>
    </aside>

    <div className="workspace-main">
      <header className="topbar">
        <div className="top-left">
          <button type="button" className="button icon-button mobile-menu" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={sidebarOpen} aria-controls="workspace-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Icon name={sidebarOpen ? 'close' : 'menu'} />
          </button>
          <span className="breadcrumb"><span>Sales workspace</span><Icon name="right" size={14} /><strong>{pages[page].title}</strong></span>
        </div>
        <div className="top-right">
          <Badge tone={failed ? 'rose' : busy ? 'muted' : 'green'}><span className="status-dot" />
            {failed ? 'API offline' : busy ? 'Connecting' : 'API connected'}</Badge>
          <span className="top-avatar" title={agentName}><Avatar name={agentName} /></span>
        </div>
      </header>
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <main id="main-content" className="workspace-content" tabIndex={-1}>
        <header className="page-heading">
          <div><h1>{page === 'overview' ? 'Sales Overview' : pages[page].title}</h1><p>{pages[page].detail}</p></div>
          {page === 'overview' && <button type="button" className="button button-primary" onClick={openLive}><Icon name="phone" /> Open live calls</button>}
        </header>

        {failed && <div className="feedback feedback-error retry-banner" role="alert"><span><Icon name="info" /> Could not load CRM leads. Check that the Express server is running.</span>
          <button type="button" className="button button-secondary" onClick={retry}>Retry connection</button></div>}
        {profileUnavailable && !failed && ['live', 'settings'].includes(page) && <div className="feedback feedback-error retry-banner" role="alert">
          <span><Icon name="info" /> Could not load the agent profile. The workspace is using its default profile.</span>
          <button type="button" className="button button-secondary" onClick={retry}>Retry connection</button></div>}
        {storageError && <p className="feedback feedback-error" role="alert">Browser storage is unavailable. New call records will be lost when this tab closes.</p>}

        {liveLoaded && <div className="screen" hidden={page !== 'live'}>
          <Suspense fallback={<p className="muted" role="status">Loading the call console…</p>}>
            <LiveCalls leads={leads} agentProfile={agent} preferences={preferences} requestedLead={requestedLead} onRecorded={record} />
          </Suspense>
        </div>}
        {page === 'overview' && <div className="screen"><Overview leads={leads} calls={calls} preferences={preferences}
          loading={busy} leadError={failed} openLive={openLive} openHistory={() => navigate('history')} /></div>}
        {page === 'leads' && <div className="screen"><Leads leads={leads} calls={calls} preferences={preferences} loading={busy} failed={failed}
          onCall={(lead) => { setRequestedLead({ id: lead.id }); openLive() }} /></div>}
        {page === 'history' && <div className="screen"><History calls={calls} openLive={openLive} /></div>}
        {page === 'knowledge' && <div className="screen"><KnowledgeBase /></div>}
        {page === 'appointments' && <div className="screen"><Appointments calls={calls} openLive={openLive} /></div>}
        {page === 'analytics' && <div className="screen"><Analytics leads={leads} calls={calls} preferences={preferences} leadDataAvailable={!busy && !failed} /></div>}
        {page === 'settings' && <div className="screen"><Settings preferences={preferences} agent={agent} save={savePreferences} /></div>}
      </main>
    </div>
  </div>
}

export default App
