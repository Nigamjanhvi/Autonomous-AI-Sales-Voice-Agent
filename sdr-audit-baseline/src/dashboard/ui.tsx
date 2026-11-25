import { useEffect, useRef, type ReactNode } from 'react'
import { initials } from './model'

const icons = {
  overview: 'M3 3h7v7H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 14h7v7H3z',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3 19.3 19.3 0 0 1-6-6 19.7 19.7 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.6 3a2 2 0 0 1-.5 2.1L7.9 10a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5l3 .6a2 2 0 0 1 1.8 2z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  history: 'M3 12a9 9 0 1 0 2.6-6.4L3 8 M3 3v5h5 M12 7v5l3 2',
  book: 'M4 19V5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1 0-4h14 M8 7h8 M8 11h5',
  calendar: 'M3 6h18v15H3z M3 10h18 M8 3v5 M16 3v5 M8 14h2 M14 14h2 M8 17h2',
  analytics: 'M3 3v18h18 M7 16l4-5 4 2 5-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1h-2.6v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.5-1h-.1v-2.6h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.1H15v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1V14h-.1a1.7 1.7 0 0 0-1.5 1z',
  check: 'm5 12 4 4L19 6',
  target: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  wave: 'M3 12h3l2-6 4 12 4-12 2 6h3',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z m-2 5 5 5',
  close: 'm6 6 12 12 M18 6 6 18',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 10v1a7 7 0 0 0 14 0v-1 M12 18v4 M9 22h6',
  end: 'M3 15c-2-2 1-6 4-7a17 17 0 0 1 10 0c3 1 6 5 4 7l-3 1-2-4H8l-2 4z',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6',
  download: 'M12 3v13 m-5-5 5 5 5-5 M4 16v5h16v-5',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 6v6l4 2',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 11v5 M12 7v.1',
  chat: 'M4 4h16v12H9l-5 4z M8 9h8 M8 12h5',
  grid: 'M3 3h18v18H3z M3 8h18 M8 8v13',
} satisfies Record<string, string>

export type IconName = keyof typeof icons

export function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge tone-${tone}`}>{children}</span>
}

export function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="contact-avatar">{initials(name)}</span>
}

export function Empty({ icon, title, detail, action }: { icon: IconName; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22} /></span>
    <strong>{title}</strong><p>{detail}</p>{action}
  </div>
}

export function CardHeader({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <header className="card-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>
}

export function Overlay({ title, variant = 'drawer', onClose, children }: {
  title: string
  variant?: 'drawer' | 'modal'
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} className={`overlay overlay-${variant}`} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="overlay-inner">
      <header className="overlay-heading"><h2>{title}</h2>
        <button type="button" className="button icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="overlay-body">{children}</div>
    </div>
  </dialog>
}
