import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../api/router'

/* ── tRPC output types ─────────────────────────────────────────────── */
type RouterOutputs = inferRouterOutputs<AppRouter>
export type SalonData = RouterOutputs['salon']['get']
export type StaffMember = RouterOutputs['staff']['list'][number]
export type CategoryList = RouterOutputs['services']['list']
export type ServiceCategory = CategoryList[number]
export type ServiceItem = ServiceCategory['services'][number]
export type Appointment = RouterOutputs['appointments']['byDate'][number]
export type ApptItem = Appointment['items'][number]
export type BookingRequest = RouterOutputs['requests']['list'][number]
export type ClientRow = RouterOutputs['clients']['list'][number]
export type ClientNoteRow = ClientRow['notes'][number]

export type ApptStatus = Appointment['status']
export type Density = 15 | 30 | 60
export type ColorMode = 'category' | 'status'
export type CatKey = 'nails' | 'hair' | 'lashes' | 'spa'

/* ── Layout constants (salon-schedule.md §4.1) ─────────────────────── */
export const GUTTER_W = 64
export const UNASSIGNED_W = 120
export const COL_MIN_W = 112
export const PX_PER_HOUR: Record<Density, number> = { 15: 48, 30: 64, 60: 88 }
export const pxPerMin = (d: Density) => PX_PER_HOUR[d] / 60

/* ── Category colors (design.md §3.2) ──────────────────────────────── */
export const CATEGORY_COLORS: Record<CatKey, { fill: string; line: string; text: string }> = {
  nails: { fill: '#F3DFDA', line: '#C97F72', text: '#7C3F35' },
  hair: { fill: '#F1E5C9', line: '#BE9334', text: '#6F5313' },
  lashes: { fill: '#E5E9D8', line: '#87936B', text: '#4B552F' },
  spa: { fill: '#E9E2D6', line: '#9C8E78', text: '#5C5140' },
}

export function categoryKeyFromName(name: string | null | undefined): CatKey {
  const n = (name ?? '').toLowerCase()
  if (n.startsWith('nail')) return 'nails'
  if (n.startsWith('hair')) return 'hair'
  if (n.startsWith('lash')) return 'lashes'
  return 'spa'
}

export const GROUP_LABEL: Record<string, string> = {
  nails: 'Nails',
  hair: 'Hair',
  lashes: 'Lashes',
  spa: 'Spa',
}

/* ── Status (design.md §3.3) ───────────────────────────────────────── */
export const STATUS_LABEL: Record<ApptStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  'checked-in': 'Checked in',
  'in-progress': 'In progress',
  completed: 'Completed',
  'no-show': 'No-show',
  cancelled: 'Cancelled',
}

/** Status ramp fills used in "Color by Status" mode (design.md §3.3). */
export const STATUS_FILL: Record<ApptStatus, string> = {
  requested: '#F6EAD2', // amber-tint
  confirmed: '#E8EBDA', // olive-tint
  'checked-in': '#F6E3D6', // clay-tint
  'in-progress': '#F6E3D6',
  completed: '#F2EBE0', // cream
  'no-show': '#F5DFDB', // rust-tint
  cancelled: '#F2EBE0',
}

/** Status chip tint/text pairs for popovers & badges. */
export const STATUS_CHIP: Record<ApptStatus, { bg: string; fg: string }> = {
  requested: { bg: '#F6EAD2', fg: '#8A5E15' },
  confirmed: { bg: '#E8EBDA', fg: '#5A6038' },
  'checked-in': { bg: '#F6E3D6', fg: '#9A4523' },
  'in-progress': { bg: '#F6E3D6', fg: '#9A4523' },
  completed: { bg: '#F2EBE0', fg: '#6E5F50' },
  'no-show': { bg: '#F5DFDB', fg: '#B3402F' },
  cancelled: { bg: '#F2EBE0', fg: '#A3937F' },
}

/* ── Avatar tints (design.md §7.2) ─────────────────────────────────── */
export const AVATAR_TINTS: Record<string, { bg: string; fg: string }> = {
  clay: { bg: '#F6E3D6', fg: '#9A4523' },
  honey: { bg: '#F1E5C9', fg: '#6F5313' },
  olive: { bg: '#E8EBDA', fg: '#4B552F' },
  rose: { bg: '#F3DFDA', fg: '#7C3F35' },
}
export const avatarTint = (t: string | null | undefined) =>
  AVATAR_TINTS[t ?? ''] ?? AVATAR_TINTS['clay']!

/* ── Time helpers ──────────────────────────────────────────────────── */
export const minToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export const fmtRange = (s: number, e: number) => `${minToTime(s)}–${minToTime(e)}`

export const fmtDur = (mins: number) =>
  mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`

export const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

export const nowMinutes = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

export const addDaysStr = (dateStr: string, n: number) => {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const prettyDate = (dateStr: string) =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

export const snap = (min: number, step: number) => Math.round(min / step) * step

export const initialsOf = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()

export const timeAgo = (iso: string | Date) => {
  const then = typeof iso === 'string' ? new Date(iso) : iso
  const mins = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ── Working-hours helpers ─────────────────────────────────────────── */
export const dayOfWeekOf = (dateStr: string) => new Date(dateStr + 'T12:00:00').getDay()

export function workWindow(
  s: StaffMember,
  dateStr: string,
): { start: number; end: number } | null {
  const dow = dayOfWeekOf(dateStr)
  const sched = s.schedules.find((x) => x.dayOfWeek === dow)
  return sched ? { start: sched.startMin, end: sched.endMin } : null
}

/** Next working day label for off-duty popover ("Wed, May 14" etc.). */
export function nextWorkingLabel(s: StaffMember, fromDate: string): string | null {
  const base = dayOfWeekOf(fromDate)
  for (let i = 1; i <= 7; i++) {
    const dow = (base + i) % 7
    if (s.schedules.some((x) => x.dayOfWeek === dow)) {
      const d = new Date(fromDate + 'T12:00:00')
      d.setDate(d.getDate() + i)
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }
  }
  return null
}

/* ── Conflict helpers (client-side mirror of api/queries/salon.ts) ─── */
export function techBusyIntervals(items: ApptItem[]): [number, number][] {
  const busy: [number, number][] = []
  for (const it of items) {
    busy.push([it.startMin, it.endMin - it.processingMin])
    if (it.bufferMin > 0) busy.push([it.endMin, it.endMin + it.bufferMin])
  }
  return busy
}

export function overlaps(aS: number, aE: number, bS: number, bE: number) {
  return aS < bE && aE > bS
}

/**
 * Check whether placing a segment on tech `staffId` conflicts with existing
 * appointments for that tech (processing gaps free the tech, buffers block).
 */
export function techConflict(
  appointments: Appointment[],
  staffId: number,
  seg: { startMin: number; endMin: number; processingMin: number; bufferMin: number },
  ignoreAppointmentId?: number,
): boolean {
  const existing: ApptItem[] = []
  for (const a of appointments) {
    if (a.id === ignoreAppointmentId) continue
    if (a.status === 'cancelled' || a.status === 'no-show') continue
    for (const it of a.items) if (it.staffId === staffId) existing.push(it)
  }
  const busy = techBusyIntervals(existing)
  const intervals: [number, number][] = [[seg.startMin, seg.endMin - seg.processingMin]]
  if (seg.bufferMin > 0) intervals.push([seg.endMin, seg.endMin + seg.bufferMin])
  return intervals.some(([s, e]) => busy.some(([bs, be]) => overlaps(s, e, bs, be)))
}
