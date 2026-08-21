import { useMemo, useState } from 'react'
import {
  ArrowRightLeft, Banknote, Bell, CalendarDays, CalendarPlus, CalendarX, Check, CheckCircle2, ClipboardList, Clock, Globe, ListPlus,
  LogOut, PhoneOff, Receipt, Search, Settings, UserX, XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ClientRecord } from '@/lib/booking-types'
import { SALON_NAME, setSessionUser, useSessionUserId } from '@/lib/session'
import { useSessionUser } from '@/lib/current-user'
import { staffSignOut } from '@/lib/auth'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { useSettingsStore } from '@/lib/settings-store'
import {
  clearNotifications, markAllNotificationsRead, markNotificationRead, useNotifications,
  type NotificationKind,
} from '@/lib/notifications-store'
import { KeyRound } from 'lucide-react'

/* ═══ App shell, ported from the k3 web SalonShell ═══
   Left nav rail (76px, expands to 224px on hover) + 64px top context bar. */

interface RailProps {
  active: 'calendar' | 'techschedule' | 'jobcard' | 'search' | 'register'
  onNavigate: (page: RailProps['active'] | 'settings') => void
}

/** `short` overrides the collapsed-rail micro label when the first 5 characters read badly */
const NAV_ITEMS: readonly { id: RailProps['active']; label: string; icon: LucideIcon; short?: string }[] = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'techschedule', label: 'Schedule', icon: Clock },
  { id: 'jobcard', label: 'Job Card', icon: ClipboardList, short: 'Cards' },
  { id: 'search', label: 'Find a Transaction', icon: Search, short: 'Find' },
  { id: 'register', label: 'Manage Register', icon: Banknote, short: 'Reg' },
]

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
        {NAV_ITEMS.map(({ id, label, icon: Icon, short }) => (
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
              {short ?? label.slice(0, 5)}
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
              <div className="flex w-full items-center gap-2.5 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-olive-tint text-[10px] font-extrabold text-olive">
                  {user.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{user.name}</span>
                  <span className="block text-[11px] text-ink-faint">{user.title}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => { staffSignOut(); setUserMenu(false) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-rust transition-colors hover:bg-cream"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className="text-[13px] font-semibold">Sign out</span>
              </button>
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

/* ── Notifications, a running feed of things the salon should know ── */
const KIND_META: Record<NotificationKind, { icon: LucideIcon; color: string }> = {
  booked: { icon: CalendarPlus, color: '#2FA883' },
  moved: { icon: ArrowRightLeft, color: '#6B4FC4' },
  checked_out: { icon: Receipt, color: '#5B54D6' },
  cancelled: { icon: CalendarX, color: '#B3402F' },
  no_show: { icon: UserX, color: '#B3402F' },
  waitlist_joined: { icon: ListPlus, color: '#D99B26' },
  online_request: { icon: Globe, color: '#5E83CE' },
  online_approved: { icon: CheckCircle2, color: '#2FA883' },
  online_declined: { icon: XCircle, color: '#B3402F' },
  turnaway: { icon: PhoneOff, color: '#D99B26' },
}

function relTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function NotificationBell({ onJumpToDate }: { onJumpToDate?: (dateKey: string) => void }) {
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="relative">
      <button
        type="button"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors ${
          open ? 'bg-cream text-ink' : 'text-ink-soft hover:bg-cream hover:text-ink'
        }`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="tnum absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-extrabold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-[95] w-96 overflow-hidden rounded-[14px] border border-line bg-popover shadow-sh-2">
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <span className="text-[13px] font-bold text-ink">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAllNotificationsRead()}
                  className="text-[11.5px] font-semibold text-clay hover:text-clay-deep"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[12.5px] text-ink-faint">
                  Nothing yet, activity on the book will show up here.
                </p>
              ) : (
                notifications.map((n) => {
                  const meta = KIND_META[n.kind]
                  const Icon = meta.icon
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        markNotificationRead(n.id)
                        onJumpToDate?.(n.dateKey)
                        setOpen(false)
                      }}
                      className={`flex w-full items-start gap-2.5 border-b border-line px-3.5 py-2.5 text-left transition-colors last:border-0 hover:bg-cream ${
                        n.read ? '' : 'bg-clay-tint/30'
                      }`}
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        style={{ background: `${meta.color}22`, color: meta.color }}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={`truncate text-[12.5px] ${n.read ? 'font-medium text-ink-soft' : 'font-bold text-ink'}`}>
                            {n.text}
                          </span>
                          {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />}
                        </span>
                        {n.detail && <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">{n.detail}</span>}
                        <span className="mt-0.5 block text-[10.5px] text-ink-faint">{relTime(n.at)}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            {notifications.length > 0 && (
              <div className="border-t border-line px-3.5 py-2">
                <button
                  type="button"
                  onClick={() => clearNotifications()}
                  className="text-[11px] font-semibold text-ink-faint transition-colors hover:text-[#B3402F]"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Top context bar ── */
interface BarProps {
  title: string
  subtitle: string
  clients: ClientRecord[]
  onPickGuest: (c: ClientRecord) => void
  onJumpToDate?: (dateKey: string) => void
  onTurnaway: () => void
  /** today's turnaway tally, resets on its own the next day */
  turnawayCount: number
  turnawayTitle: string
  /** you can't turn away someone in the past or the future, only on today's board */
  turnawayDisabled: boolean
}

function TurnawayButton({ onTurnaway, turnawayCount, turnawayTitle, turnawayDisabled }: {
  onTurnaway: () => void
  turnawayCount: number
  turnawayTitle: string
  turnawayDisabled: boolean
}) {
  return (
    <button
      type="button"
      title={turnawayTitle}
      onClick={onTurnaway}
      disabled={turnawayDisabled}
      className={`relative flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors ${
        turnawayDisabled ? 'cursor-not-allowed text-ink-faint/50' : 'text-ink-soft hover:bg-cream hover:text-ink'
      }`}
    >
      <PhoneOff className="h-[18px] w-[18px]" />
      {turnawayCount > 0 && (
        <span className={`tnum absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white ${turnawayDisabled ? 'bg-ink-faint' : 'bg-clay'}`}>
          {turnawayCount > 99 ? '99+' : turnawayCount}
        </span>
      )}
    </button>
  )
}

export function ContextBar({
  title, subtitle, clients, onPickGuest, onJumpToDate, onTurnaway, turnawayCount, turnawayTitle, turnawayDisabled,
}: BarProps) {
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
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface pl-6 pr-4">
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

        {/* turnaway */}
        <TurnawayButton
          onTurnaway={onTurnaway}
          turnawayCount={turnawayCount}
          turnawayTitle={turnawayTitle}
          turnawayDisabled={turnawayDisabled}
        />

        {/* notifications */}
        <NotificationBell onJumpToDate={onJumpToDate} />
      </div>
    </header>
  )
}
