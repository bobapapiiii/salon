import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import { Inbox, ChevronDown, Copy, Filter, List } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  avatarTint,
  minToTime,
  pxPerMin,
  type Density,
  type StaffMember,
} from './schedule-utils'

/* ── TimeGutter — 64px, sticky left, hour labels + 30-min ticks ────── */
export const TimeGutter = memo(function TimeGutter({
  openMin,
  closeMin,
  density,
}: {
  openMin: number
  closeMin: number
  density: Density
}) {
  const ppm = pxPerMin(density)
  const hours: number[] = []
  for (let h = Math.ceil(openMin / 60) * 60; h <= closeMin; h += 60) hours.push(h)
  return (
    <div className="relative h-full w-16 shrink-0 border-r border-line bg-cream/50">
      {hours.map((h) => (
        <div key={h}>
          <span
            className="absolute right-2 -translate-y-1/2 text-micro font-bold uppercase text-ink-faint tnum"
            style={{ top: (h - openMin) * ppm }}
          >
            {minToTime(h)}
          </span>
          {h + 30 < closeMin && (
            <span
              aria-hidden
              className="absolute right-0 w-2 border-t border-line"
              style={{ top: (h + 30 - openMin) * ppm }}
            />
          )}
        </div>
      ))}
    </div>
  )
})

/* ── TechColumnHeader — avatar, name, role, count, context menu ────── */
export const TechColumnHeader = memo(function TechColumnHeader({
  tech,
  count,
  working,
  width,
  flash,
  onFilterTo,
}: {
  tech: StaffMember
  count: number
  working: boolean
  width: number
  flash: boolean
  onFilterTo: (name: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const tint = avatarTint(tech.avatarTint)
  return (
    <div
      className={cn(
        'relative flex h-16 shrink-0 items-center gap-2 border-r border-line px-2 transition-colors duration-200',
        flash && 'bg-clay-tint',
      )}
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-r-sm text-left"
        title={`${tech.name} — options`}
      >
        <span
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-r-pill text-[11px] font-extrabold"
          style={{ background: tint.bg, color: tint.fg }}
        >
          {tech.initials}
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-[9px] w-[9px] rounded-r-pill ring-2 ring-surface',
              working ? 'bg-olive' : 'bg-line-strong',
            )}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-4">{tech.name}</span>
          <span className="block truncate text-micro font-bold uppercase leading-4 text-ink-faint">
            {tech.title ?? 'Technician'}
          </span>
        </span>
      </button>
      {count > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-r-pill bg-cream px-1.5 text-[11px] font-extrabold text-ink-soft tnum">
          {count}
        </span>
      )}
      {menuOpen && (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute left-1 top-14 z-50 w-48 rounded-r-lg border border-line bg-surface p-1 shadow-sh-2">
            <MenuItem
              icon={<List className="h-3.5 w-3.5" />}
              label="View tech day list"
              onClick={() => {
                setMenuOpen(false)
                onFilterTo(tech.name)
              }}
            />
            <MenuItem
              icon={<Filter className="h-3.5 w-3.5" />}
              label="Filter to this tech"
              onClick={() => {
                setMenuOpen(false)
                onFilterTo(tech.name)
              }}
            />
            <MenuItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Copy schedule"
              onClick={() => {
                setMenuOpen(false)
                toast.success(`${tech.name}'s schedule copied`)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
})

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-r-sm px-2.5 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
    >
      {icon}
      {label}
    </button>
  )
}

/* ── Unassigned header ─────────────────────────────────────────────── */
export function UnassignedHeader({ count, width }: { count: number; width: number }) {
  return (
    <div
      className="flex h-16 shrink-0 items-center gap-2 border-r border-line-strong bg-cream px-3 sched-stripe-bg"
      style={{ width }}
    >
      <Inbox className="h-4 w-4 shrink-0 text-ink-soft" />
      <span className="truncate text-[13px] font-bold text-ink-soft">Unassigned</span>
      {count > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-r-pill bg-clay px-1.5 text-[11px] font-extrabold text-white tnum">
          {count}
        </span>
      )}
    </div>
  )
}

/* ── Group band (sticky header row 1) ──────────────────────────────── */
export function GroupBand({
  label,
  catLine,
  techCount,
  apptCount,
  width,
  collapsed,
  onToggle,
}: {
  label: string
  catLine: string
  techCount: number
  apptCount: number
  width: number
  collapsed: boolean
  onToggle: () => void
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-12 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-line bg-cream/70 transition-colors hover:bg-cream"
        title={`${label} — ${apptCount} appointments. Expand`}
      >
        <ChevronDown className="h-3 w-3 -rotate-90 text-ink-soft" />
        <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-ink-soft tnum">
          {apptCount}
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="relative flex h-10 shrink-0 items-center gap-2 overflow-hidden border-r border-line bg-cream/40 px-3 text-left transition-colors hover:bg-cream"
      style={{ width }}
      title={`Collapse ${label}`}
    >
      <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink">
        {label}
      </span>
      <span className="whitespace-nowrap text-small font-medium text-ink-faint">
        {techCount} tech{techCount === 1 ? '' : 's'} · {apptCount} appt{apptCount === 1 ? '' : 's'} today
      </span>
      <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink-soft" />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: catLine }} />
    </button>
  )
}

/* ── NowLine — 2px clay line + gutter dot + time chip ──────────────── */
export function NowLine({
  nowMin,
  openMin,
  density,
  pulse,
}: {
  nowMin: number
  openMin: number
  density: Density
  pulse: boolean
}) {
  const top = (nowMin - openMin) * pxPerMin(density)
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="relative h-[2px] w-full bg-clay">
        <span
          className={cn(
            'absolute -left-1 -top-[4px] h-2.5 w-2.5 rounded-r-pill bg-clay',
            pulse && 'sched-now-pulse',
          )}
        />
        <span className="absolute left-1.5 -top-[9px] rounded-r-sm bg-clay-tint px-1 py-px text-[10px] font-extrabold text-clay tnum">
          {minToTime(nowMin)}
        </span>
      </div>
    </div>
  )
}

/* ── First-load skeleton (salon-schedule.md §9) ────────────────────── */
export function ScheduleSkeleton() {
  return (
    <div className="flex h-full">
      <div className="w-16 shrink-0 border-r border-line bg-cream/50 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="sched-skeleton mb-6 ml-auto h-2.5 w-9 rounded" />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="min-w-[112px] flex-1 border-r border-line p-2">
          <div className="mb-3 flex items-center gap-2">
            <div className="sched-skeleton h-8 w-8 rounded-r-pill" />
            <div className="sched-skeleton h-3 w-14 rounded" />
          </div>
          {[140, 90, 60].map((h, j) => (
            <div
              key={j}
              className="sched-skeleton mb-3 rounded-r-sm"
              style={{ height: h, opacity: 1 - j * 0.25 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Off-day empty state (salon-schedule.md §9) ────────────────────── */
export function OffDayState({ onJump }: { onJump: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <img src="/empty-calendar.svg" alt="" className="h-[120px] w-[160px] opacity-80" />
      <h3 className="text-[15px] font-bold leading-[22px]">Salon is closed this day</h3>
      <p className="max-w-56 text-small font-medium text-ink-soft">
        No technicians are scheduled. Jump to the next open day to keep planning.
      </p>
      <button
        type="button"
        onClick={onJump}
        className="mt-1 h-10 rounded-r-md bg-clay px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep"
      >
        Jump to next open day
      </button>
    </div>
  )
}
