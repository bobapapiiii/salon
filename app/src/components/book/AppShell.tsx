import { useMemo, useState } from 'react'
import { Bell, CalendarDays, Check, Clock, Search, Settings, Sparkles, Users } from 'lucide-react'
import type { ClientRecord } from '@/lib/booking-types'
import { DEMO_USERS, SALON_NAME, setSessionUser, useSessionUser, useSessionUserId } from '@/lib/session'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { useSettingsStore } from '@/lib/settings-store'
import { KeyRound } from 'lucide-react'

/* ═══ App shell, ported from the k3 web SalonShell ═══
   Left nav rail (76px, expands to 224px on hover) + 64px top context bar. */

interface RailProps {
  active: 'calendar' | 'techschedule' | 'services' | 'clients'
  onNavigate: (page: RailProps['active'] | 'settings') => void
}

const NAV_ITEMS = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'techschedule', label: 'Schedule', icon: Clock },
  { id: 'services', label: 'Services', icon: Sparkles },
  { id: 'clients', label: 'Clients', icon: Users },
] as const

export function NavRail({ active, onNavigate }: RailProps) {
  const user = useSessionUser()
  const userId = useSessionUserId()
  const { techs, roles } = useStaffStore()
  const techUser = techs.find((t) => t.id === userId)
  const display = techUser
    ? { name: techUser.name, initials: techUser.initials, title: roles.find((r) => r.id === techUser.teamId)?.name ?? 'Technician' }
    : { name: user.name, initials: user.initials, title: user.title }
  const loginTechs = boardTechs(techs).filter((t) => t.loginEnabled)
  const salonName = useSettingsStore().general.name || SALON_NAME
  const [userMenu, setUserMenu] = useState(false)
  return (
    <nav
      aria-label="Salon navigation"
      className="group/rail relative z-40 flex w-[76px] shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-[220ms] ease-out-expo hover:w-56"
    >
      {/* mark */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-[18px]" title="Lumina">
        <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
          <g fill="none" stroke="#2B2724" strokeWidth="2.4" strokeLinecap="round">
            <path d="M7 34 L7 21 A13 13 0 0 1 33 21 L33 34" />
            <path d="M4 34 L36 34" />
          </g>
          <circle cx="20" cy="25" r="6.2" fill="#B07D74" />
        </svg>
        <span className="whitespace-nowrap font-display text-lg font-semibold opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
          Lumina
        </span>
      </div>

      {/* primary nav */}
      <div className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`relative flex h-11 items-center gap-3.5 whitespace-nowrap rounded-[10px] px-[13px] text-left text-[13px] font-semibold transition-colors duration-150 ${
              active === id ? 'bg-clay-tint text-clay' : 'text-ink-soft hover:bg-cream hover:text-ink'
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
            <span className="opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
              {label}
            </span>
            <span className="pointer-events-none absolute inset-x-0 top-[30px] text-center text-micro font-bold uppercase text-ink-faint transition-opacity duration-150 group-hover/rail:opacity-0">
              {label.slice(0, 5)}
            </span>
          </button>
        ))}
      </div>

      {/* bottom: settings + staff avatar */}
      <div className="border-t border-line px-3 py-3">
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          title="Settings, job roles & team"
          className="flex h-11 w-full items-center gap-3.5 whitespace-nowrap rounded-[10px] px-[13px] text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
        >
          <Settings className="h-5 w-5 shrink-0" strokeWidth={2} />
          <span className="opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">Settings</span>
        </button>
        {/* signed-in user, click to switch login (demo accounts) */}
        <button
          type="button"
          onClick={() => setUserMenu((o) => !o)}
          title={`${user.name}, switch user`}
          className="mt-1 flex h-12 w-full items-center gap-3 rounded-[10px] px-[13px] text-left transition-colors hover:bg-cream"
        >
          <span className="relative -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-olive-tint text-[11px] font-extrabold text-olive">
            {display.initials}
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-olive ring-2 ring-surface" />
          </span>
          <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
            <span className="block text-[13px] font-bold leading-4">{display.name}</span>
            <span className="block text-[11px] font-medium leading-4 text-ink-faint">{display.title} · {salonName}</span>
          </span>
        </button>
        {userMenu && (
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setUserMenu(false)} />
            <div className="fixed bottom-3 left-[84px] z-[90] w-64 overflow-hidden rounded-[14px] border border-line bg-popover shadow-sh-2">
              <p className="px-3 pb-1 pt-2.5 text-micro font-bold uppercase tracking-wide text-ink-faint">
                Signed in at {salonName}
              </p>
              {DEMO_USERS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { setSessionUser(u.id); setUserMenu(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-cream"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-olive-tint text-[10px] font-extrabold text-olive">
                    {u.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{u.name}</span>
                    <span className="block text-[11px] text-ink-faint">{u.title}</span>
                  </span>
                  {u.id === user.id && <Check className="h-4 w-4 shrink-0 text-clay" />}
                </button>
              ))}
              {loginTechs.length > 0 && (
                <>
                  <p className="flex items-center gap-1 border-t border-line px-3 pb-1 pt-2 text-micro font-bold uppercase tracking-wide text-ink-faint">
                    <KeyRound className="h-3 w-3" /> Team logins
                  </p>
                  {loginTechs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setSessionUser(t.id); setUserMenu(false) }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-cream"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[10px] font-extrabold text-clay">
                        {t.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{t.name}</span>
                        <span className="block text-[11px] text-ink-faint">Tech portal · PIN {t.pin}</span>
                      </span>
                      {t.id === userId && <Check className="h-4 w-4 shrink-0 text-clay" />}
                    </button>
                  ))}
                </>
              )}
              <p className="border-t border-line px-3 py-2 text-[10.5px] leading-4 text-ink-faint">
                Each login keeps its own layout, zoom &amp; filters. The book, clients &amp; team are shared across the salon.
              </p>
            </div>
          </>
        )}
      </div>
    </nav>
  )
}

/* ── Top context bar ── */
interface BarProps {
  title: string
  subtitle: string
  todayLabel: string
  clients: ClientRecord[]
  onPickGuest: (c: ClientRecord) => void
}

export function ContextBar({ title, subtitle, todayLabel, clients, onPickGuest }: BarProps) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const text = q.toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clients
      .filter((c) => c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 7)
  }, [q, clients])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
      <div className="min-w-0">
        <h1 className="truncate font-display text-[22px] font-semibold leading-7 tracking-[-0.01em]">{title}</h1>
        <p className="-mt-0.5 truncate text-small font-medium text-ink-faint">{subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* ⌘K guest search */}
        <div className="relative hidden lg:block">
          <div className="flex h-10 w-[280px] items-center gap-2.5 rounded-[6px] border border-line bg-surface px-3 text-[13px] text-ink-faint transition-colors focus-within:border-clay">
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('')
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); e.currentTarget.blur() }
              }}
              placeholder="Search clients, services"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
            />
            <kbd className="flex shrink-0 items-center gap-0.5 rounded-[6px] border border-line bg-cream px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">⌘K</kbd>
          </div>
          {open && q.trim() && (
            <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-[14px] border border-line bg-popover shadow-sh-2">
              {matches.length === 0 && <div className="px-3 py-3 text-[12px] text-ink-faint">No guests match "{q}"</div>}
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={() => { onPickGuest(c); setQ(''); setOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-cream"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[10px] font-extrabold text-clay">
                    {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{c.name}</span>
                    <span className="block text-[11px] text-ink-faint">{c.phone} · {c.visits} visits</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* notifications */}
        <button
          type="button"
          title="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-cream hover:text-ink"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-clay" />
        </button>

        {/* today chip */}
        <span className="tnum hidden h-9 items-center rounded-full border border-line bg-cream px-3.5 text-small font-bold text-ink-soft md:flex">
          {todayLabel}
        </span>
      </div>
    </header>
  )
}
