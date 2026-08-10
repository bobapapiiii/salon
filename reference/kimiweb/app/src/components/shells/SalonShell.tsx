import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  Inbox,
  Sparkles,
  Users,
  Settings,
  Search,
  Bell,
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

/**
 * SalonShell — design.md §7.1
 * Left nav rail (76px, expands to 224px on hover) + 64px top context bar.
 * Content slot is <Outlet/> (nested routes only — never children).
 *
 * Pages own their inner layout: the schedule page should render a full-height
 * calendar that manages its own scroll (add `schedule-scroll` to its scrollers);
 * other pages should wrap content in `p-8 max-w-[1240px]`.
 */

interface SalonShellProps {
  /** Override page title (derived from route by default) */
  title?: string
  /** Override page subtitle */
  subtitle?: string
  /** Pending booking-request count shown on the Requests nav item */
  requestCount?: number
  /** Page-specific actions rendered left of the ⌘K search */
  actions?: ReactNode
}

const NAV_ITEMS = [
  { to: '/salon/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/salon/requests', label: 'Requests', icon: Inbox },
  { to: '/salon/services', label: 'Services', icon: Sparkles },
  { to: '/salon/clients', label: 'Clients', icon: Users },
] as const

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/salon/schedule': { title: 'Schedule', subtitle: 'Day view · whole team' },
  '/salon/requests': { title: 'Requests', subtitle: 'Online booking queue' },
  '/salon/services': { title: 'Services', subtitle: 'Catalog & pricing' },
  '/salon/clients': { title: 'Clients', subtitle: 'Notes, history & flags' },
}

export default function SalonShell({
  title,
  subtitle,
  requestCount = 4,
  actions,
}: SalonShellProps) {
  const { pathname } = useLocation()
  const meta = PAGE_META[pathname] ?? { title: 'Lumina', subtitle: '' }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-paper text-ink">
      {/* ── Left nav rail ─────────────────────────────────────────── */}
      <nav
        aria-label="Salon navigation"
        className="group/rail relative z-40 flex w-[76px] shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-[220ms] ease-out-expo hover:w-56"
      >
        {/* Lumina mark */}
        <Link
          to="/"
          className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-[18px]"
          title="Lumina — home"
        >
          <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
            <g fill="none" stroke="#2A211A" strokeWidth="2.4" strokeLinecap="round">
              <path d="M7 34 L7 21 A13 13 0 0 1 33 21 L33 34" />
              <path d="M4 34 L36 34" />
            </g>
            <circle cx="20" cy="25" r="6.2" fill="#B4552B" />
          </svg>
          <span className="whitespace-nowrap font-display text-lg font-semibold opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
            Lumina
          </span>
        </Link>

        {/* Primary nav items */}
        <div className="flex flex-1 flex-col gap-1 px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'relative flex h-11 items-center gap-3.5 whitespace-nowrap rounded-r-md px-[13px] text-[13px] font-semibold transition-colors duration-150',
                  isActive
                    ? 'bg-clay-tint text-clay'
                    : 'text-ink-soft hover:bg-cream hover:text-ink',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
              <span className="opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
                {label}
              </span>
              {/* Micro label under icon when collapsed */}
              <span className="pointer-events-none absolute inset-x-0 top-[30px] text-center text-micro font-bold uppercase text-ink-faint transition-opacity duration-150 group-hover/rail:opacity-0">
                {label.slice(0, 5)}
              </span>
              {label === 'Requests' && requestCount > 0 && (
                <span className="absolute left-[27px] top-1 flex h-4 min-w-4 items-center justify-center rounded-r-pill bg-clay px-1 text-[10px] font-extrabold text-white tnum group-hover/rail:static group-hover/rail:ml-auto">
                  {requestCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        {/* Bottom: settings stub + staff avatar */}
        <div className="border-t border-line px-3 py-3">
          <button
            type="button"
            disabled
            title="Settings — Phase 2"
            className="flex h-11 w-full cursor-not-allowed items-center gap-3.5 whitespace-nowrap rounded-r-md px-[13px] text-[13px] font-semibold text-ink-faint/60"
          >
            <Settings className="h-5 w-5 shrink-0" strokeWidth={2} />
            <span className="opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
              Settings
            </span>
          </button>
          <div className="mt-1 flex h-12 items-center gap-3 rounded-r-md px-[13px]">
            <span className="relative -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-r-pill bg-olive-tint text-[11px] font-extrabold text-olive">
              DA
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-r-pill bg-olive ring-2 ring-surface" />
            </span>
            <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
              <span className="block text-[13px] font-bold leading-4">Dana</span>
              <span className="block text-[11px] font-medium leading-4 text-ink-faint">
                Front Desk
              </span>
            </span>
          </div>
        </div>
      </nav>

      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top context bar */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
          <div className="min-w-0">
            <h1 className="truncate font-display text-[22px] font-semibold leading-7 tracking-[-0.01em]">
              {title ?? meta.title}
            </h1>
            {(subtitle ?? meta.subtitle) && (
              <p className="-mt-0.5 truncate text-small font-medium text-ink-faint">
                {subtitle ?? meta.subtitle}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {actions}
            {/* ⌘K search */}
            <button
              type="button"
              className="hidden h-10 w-[280px] items-center gap-2.5 rounded-r-sm border border-line bg-surface px-3 text-[13px] text-ink-faint transition-colors hover:border-line-strong focus-visible:border-clay lg:flex"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">Search clients, services…</span>
              <kbd className="flex items-center gap-0.5 rounded-r-sm border border-line bg-cream px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                ⌘K
              </kbd>
            </button>
            {/* Notifications */}
            <button
              type="button"
              title="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-cream hover:text-ink"
            >
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-r-pill bg-clay" />
            </button>
            {/* Today chip */}
            <span className="hidden h-9 items-center rounded-r-pill border border-line bg-cream px-3.5 text-small font-bold text-ink-soft tnum md:flex">
              {format(new Date(), 'EEE, MMM d')}
            </span>
          </div>
        </header>

        {/* Content slot */}
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
