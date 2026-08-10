import { Link, NavLink, Outlet } from 'react-router-dom'
import { CalendarPlus, CalendarClock, User, Phone, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * ClientShell — design.md §7.1
 * Mobile-first 480px centered column ("phone on a desk"): cream gutters with a
 * faint arch pattern at ≥768px, surface column with line side borders.
 * Content slot is <Outlet/> (nested routes only — never children).
 * Bottom tab bar on mobile (safe-area padded), top tabs at ≥768px.
 */

const TABS = [
  { to: '/book', label: 'Book', icon: CalendarPlus, end: true },
  { to: '/book/appointments', label: 'Appointments', icon: CalendarClock, end: false },
  { to: '/book/account', label: 'Account', icon: User, end: false },
] as const

function TabItems({ compact }: { compact: boolean }) {
  return (
    <>
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors duration-150',
              compact ? 'h-full py-1.5' : 'h-12',
              isActive ? 'text-clay' : 'text-ink-faint hover:text-ink-soft',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{label}</span>
              {isActive && (
                <motion.span
                  layoutId={compact ? 'client-tab-dot-mobile' : 'client-tab-dot-desktop'}
                  className="absolute bottom-1 h-1 w-1 rounded-r-pill bg-clay"
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </>
  )
}

export default function ClientShell() {
  return (
    <div className="min-h-[100dvh] bg-cream md:arch-pattern">
      {/* Centered app column */}
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-surface md:border-x md:border-line md:shadow-sh-1">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <Link to="/" className="flex items-center gap-2.5" title="Lumina — home">
            <img src="/logo.svg" alt="Lumina" className="h-6 w-auto" />
          </Link>
          <div className="flex items-center gap-3">
            <p className="hidden items-center gap-1 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint min-[400px]:flex">
              Lumina Salon · 4.9
              <Star className="h-3 w-3 fill-amber text-amber" />· Downtown
            </p>
            <a
              href="tel:+15550142"
              title="Call salon"
              className="flex h-11 w-11 items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-cream hover:text-clay"
            >
              <Phone className="h-5 w-5" />
            </a>
          </div>
        </header>

        {/* Top tabs (≥768px) */}
        <nav
          aria-label="Client sections"
          className="hidden shrink-0 border-b border-line bg-surface px-2 md:flex"
        >
          <TabItems compact={false} />
        </nav>

        {/* Content slot */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Bottom tab bar (mobile) */}
        <nav
          aria-label="Client sections"
          className="sticky bottom-0 flex h-16 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <TabItems compact />
        </nav>
      </div>
    </div>
  )
}
