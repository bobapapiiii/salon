import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Clock, GripVertical, Heart, Link2, Moon, MoreHorizontal, Play, Redo2, StickyNote, Sun, Undo2, X } from 'lucide-react'
import type { Appointment, ClientRecord, Scale, Tech, TimeBlock } from '@/lib/booking-types'
import { logEntry } from '@/lib/booking-types'
import {
  CLOSE_MIN, DAY_SLOTS, MIN_PPM, MAX_PPM, MIN_COL_W, MAX_COL_W,
  OPEN_MIN, OVERVIEW_COL_W, SLOT_MIN, TEXT_COL_W, fmtTime, overlaps,
} from '@/lib/booking-types'
import { CLIENTS, SERVICES, generateDay } from '@/lib/mock-data'
import { boardTechs, getStaff, isArchived, moveRole, roleColor, useStaffStore } from '@/lib/staff-store'
import { sdata, setCodec, upref, usePersistentState } from '@/lib/persist'
import { svcById } from '@/lib/services-store'
import { Toolbar } from './Toolbar'
import { ApptContextMenu, ConfirmCancelDialog, type MenuAction } from './ApptMenus'
import { ConfirmDialog } from './ConfirmDialog'
import { BookingPanel, type BookedService } from './BookingPanel'
import { AppointmentDetail, type DetailAction } from './AppointmentDetail'
import { ClientProfile, type ClientNote } from './ClientProfile'
import { RequestsRail } from './RequestsRail'
import { DatePickerPopover, LegendPopover } from './LegendPopover'
import { ContextBar, NavRail } from './AppShell'
import { SettingsPage, type SectionId } from './SettingsPage'
import { useLocation, useNavigate } from 'react-router'
import { useSettingsStore } from '@/lib/settings-store'
import { catById } from '@/lib/categories-store'
import { CheckoutDialog, type PaymentResult } from './CheckoutDialog'
import { InvoiceDialog } from './InvoiceDialog'
import { PosPanel } from './PosPanel'
import { STATUS_META, TechSchedulePanel, type DaySchedule } from './TechSchedulePanel'
import { BlockEditor, type BlockDraft } from './BlockEditor'
import { TurnawayDialog, type TurnawayDraft } from './TurnawayDialog'
import { TechCalendarView } from './TechCalendarView'
import { addNotification } from '@/lib/notifications-store'

const GUTTER_W = 64
const GROUP_H = 40
const TECH_H = 64
const DAY_MIN = CLOSE_MIN - OPEN_MIN
const DEMO_NOW_MIN = 5 * 60 + 30 // demo "now" at 1:30 PM

// shared between setStatus() and saveDetail() so a status change logs the
// same way whether it came from the right-click menu or the edit panel
const STATUS_LOG: Record<string, string> = {
  booked: 'Set back to booked',
  confirmed: 'Confirmed',
  checked_in: `Checked in at ${fmtTime(DEMO_NOW_MIN)}`,
  in_service: `Service started at ${fmtTime(DEMO_NOW_MIN)}`,
  completed: `Service completed at ${fmtTime(DEMO_NOW_MIN)}`,
}

type Column = { kind: 'tech'; tech: Tech } | { kind: 'collapsed'; teamId: string }

interface ClipService {
  serviceId: string
  durationMin: number
  techId: string // tech it was copied from
  notes?: string
  clientName?: string // per-service guest (walk-in parties)
  /** the appointment was made with a preference, honor it when placing */
  requestedTechChoice?: 'first' | 'pref-female' | 'pref-male'
  /** the client asked for a specific tech */
  techRequested?: boolean
  /** carried over from the appointment this was copied from (plain clipboard copy only) */
  bookingSource?: 'front_desk' | 'walk_in' | 'online'
}
interface ClipItem {
  id: string
  clientName: string
  services: ClipService[]
  isPair: boolean
  /** the appointment this was copied from, one clipboard entry per service */
  sourceApptId?: string
  /** set when dragged from a queue tab instead of the clipboard */
  source?: { kind: 'waitlist' | 'walkin' | 'approved'; id: string; guestName?: string; serviceId?: string }
}

/** an approved booking request, waiting to be dragged onto the book */
export interface ApprovedItem {
  id: string
  clientName: string
  services: { serviceId: string; durationMin: number; notes?: string }[]
  isPair: boolean
  notes?: string
  /** what the client asked for, so the salon books it the same way */
  requestedStartMin?: number
  requestedTechId?: string
}

/** a snapshot kept when an appointment is cancelled, since the appointment
 *  itself is removed from the day's board (Reports reads this for cancellation
 *  rate, the booking funnel, and average notice given) */
export interface CancellationRecord {
  id: string
  apptId: string
  dateKey: string
  clientName: string
  serviceId: string
  techId: string
  startMin: number
  durationMin: number
  /** when the appointment was originally booked, from its first log entry */
  bookedAt?: number
  cancelledAt: number
  /** services cancelled together in one same-time group */
  groupSize: number
}

/** logged when a client wanted an appointment and the salon had no room for
 *  them, so demand that never made it onto the book is still visible in
 *  Reports (Zenoti's "Turnaways" report has no equivalent data source here
 *  otherwise, since a slot that was never offered leaves no other trace) */
export interface TurnawayRecord {
  id: string
  dateKey: string
  /** one entry per person; length is the party size. Each person can want a
   *  different general category (e.g. mani for one, mani + pedi for
   *  another) — the exact service isn't tracked, since staff usually don't
   *  know exactly what a turned-away walk-in would have picked */
  guests: { name?: string; categoryIds?: string[] }[]
  phone?: string
  requestedTechId?: string
  reason: 'no_availability' | 'price' | 'didnt_like_options' | 'other'
  notes?: string
  loggedAt: number
}

/** any exact service id → its category id, deduped; drops ids that don't
 *  resolve to a real service (e.g. one that's since been deleted) */
function toCategoryIds(serviceIds?: string[]): string[] | undefined {
  if (!serviceIds || serviceIds.length === 0) return undefined
  const cats = [...new Set(serviceIds.map((id) => svcById[id]?.categoryId).filter((c): c is string => !!c))]
  return cats.length > 0 ? cats : undefined
}

// `guests` (with categoryIds) replaced older shapes as this feature was built
// out: first a single clientName+serviceId, then a shared partySize+
// serviceIds, then a guests array but keyed by exact serviceIds instead of
// categoryIds. Records already saved to a browser's localStorage under any
// of those won't match what the current code expects, so normalize on read
// instead of crashing (e.g. on `for (const g of t.guests)`).
type LegacyGuest = { name?: string; categoryIds?: string[]; serviceIds?: string[] }
type LegacyTurnawayRecord = Omit<TurnawayRecord, 'guests'> & {
  guests?: LegacyGuest[]
  clientName?: string
  partySize?: number
  serviceIds?: string[]
  serviceId?: string
}
function normalizeTurnaway(raw: LegacyTurnawayRecord): TurnawayRecord {
  if (Array.isArray(raw.guests)) {
    return {
      ...raw,
      guests: raw.guests.map((g) => ({ name: g.name, categoryIds: g.categoryIds ?? toCategoryIds(g.serviceIds) })),
    } as TurnawayRecord
  }
  const categoryIds = toCategoryIds(raw.serviceIds ?? (raw.serviceId ? [raw.serviceId] : undefined))
  const partySize = Math.max(1, raw.partySize ?? 1)
  const guests = [{ name: raw.clientName, categoryIds }, ...Array.from({ length: partySize - 1 }, () => ({}))]
  return { ...raw, guests }
}
const turnawaysCodec = {
  deserialize: (raw: unknown): TurnawayRecord[] =>
    Array.isArray(raw) ? raw.filter((r): r is LegacyTurnawayRecord => r != null && typeof r === 'object').map(normalizeTurnaway) : [],
}

export interface QueueEntry {
  id: string
  clientId?: string
  name: string
  serviceId: string
  phone?: string
  preferredTechId?: string
  /** days of week the guest is available (0=Sun to 6=Sat); empty/undefined = any day */
  days?: number[]
  /** available window in minutes from OPEN_MIN; undefined pair = any time */
  fromMin?: number
  toMin?: number
  notes?: string
  createdMin: number
}

export interface WalkInGuest {
  clientId?: string
  name: string
  serviceIds: string[]
}
export interface WalkInGroup {
  id: string
  guests: WalkInGuest[]
  createdMin: number
}

interface DragState {
  kind: 'appt' | 'clip'
  primaryId: string // '' for clip drags
  moveIds: string[]
  clip?: ClipItem
  grabOffsetMin: number
  mode: 'move' | 'resize'
  moved: boolean
  targetTechId: string
  deltaMin: number
  clipStartMin: number
  startClientX: number
  startClientY: number
}

interface MovingItem {
  id: string
  techId: string
  startMin: number
  durationMin: number
  serviceId: string
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* safe tech lookup, live read from the staff store (roles are configurable) */
const UNASSIGNED_TECH: Tech = { id: 'unassigned', name: 'Unassigned', initials: '??', teamId: '', skills: SERVICES.map((s) => s.id) }
const techOf = (id: string): Tech => getStaff().techs.find((t) => t.id === id) ?? UNASSIGNED_TECH

/* status palette for "Color by Status" mode — Zenoti-style
   orange booked · green confirmed · yellow checked in · red checked out · purple time elapsed */
const STATUS_STYLE: Record<string, { fill: string; line: string; text: string }> = {
  booked: { fill: '#FDE8C8', line: '#D97706', text: '#7C4A03' },
  requested: { fill: '#FDE8C8', line: '#D97706', text: '#7C4A03' },
  confirmed: { fill: '#D5F0DA', line: '#3E9B4F', text: '#1E5B29' },
  checked_in: { fill: '#FCF3C5', line: '#D9A50B', text: '#6B5204' },
  in_service: { fill: '#FCF3C5', line: '#D9A50B', text: '#6B5204' },
  completed: { fill: '#FBD5D5', line: '#DC4444', text: '#7A1F1F' },
  no_show: { fill: '#F5DFDB', line: '#B3402F', text: '#7A2418' },
  late: { fill: '#E6DEFB', line: '#8B5CF6', text: '#4C2D95' },
}

// one-time migration for days generated/edited before check-in/start/complete
// timestamps existed: a status of checked_in/in_service/completed implies the
// client already passed through the earlier stages too, so back-fill
// plausible timestamps instead of leaving the hover card blank for them
function backfillStageTimestamps(list: Appointment[]): Appointment[] {
  let changed = false
  const next = list.map((a) => {
    const patch: Partial<Appointment> = {}
    if ((a.status === 'checked_in' || a.status === 'in_service' || a.status === 'completed') && a.checkedInMin == null) {
      patch.checkedInMin = Math.max(0, a.startMin - 5)
    }
    if ((a.status === 'in_service' || a.status === 'completed') && a.startedMin == null) {
      patch.startedMin = a.startMin
    }
    if (a.status === 'completed' && a.completedMin == null) {
      patch.completedMin = a.startMin + Math.max(5, a.durationMin - 3)
    }
    if (Object.keys(patch).length === 0) return a
    changed = true
    return { ...a, ...patch }
  })
  return changed ? next : list
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabel(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
  const isToday = (d: Date) => dayKey(d) === dayKey(new Date())

export function AppointmentBook() {
  const { roles, techs } = useStaffStore()
  const navigate = useNavigate()
  const location = useLocation()
  // settings is a real route, /settings/<section> is linkable and bookmarkable
  const settingsMatch = location.pathname.match(/^\/settings(?:\/([a-z]+))?/)
  const settingsOpen = settingsMatch != null
  const settingsSection = (settingsMatch?.[1] ?? 'general') as SectionId
  // everything the user changes persists across refreshes (localStorage)
  const [dateKey, setDateKey] = usePersistentState<string>(upref('ui-date'), () => dayKey(new Date()))
  const date = useMemo(() => new Date(dateKey + 'T12:00:00'), [dateKey])
  const [apptDays, setApptDays] = usePersistentState<Record<string, Appointment[]>>(sdata('appts-v1'), {})
  const [appts, setAppts] = useState<Appointment[]>(() => backfillStageTimestamps(apptDays[dateKey] ?? generateDay(dateKey)))
  const [scale, setScaleRaw] = usePersistentState<Scale>(upref('ui-scale'), { colW: 112, ppm: 1.15 })
  const [density, setDensity] = usePersistentState<15 | 30 | 60 | null>(upref('ui-density'), null)
  const [colorMode, setColorMode] = usePersistentState<'category' | 'status'>(upref('ui-colormode'), 'status')
  const [collapsed, setCollapsed] = usePersistentState<Set<string>>(upref('ui-collapsed'), new Set<string>(), setCodec<string>())
  const [hiddenTeams, setHiddenTeams] = usePersistentState<Set<string>>(upref('ui-hidden'), new Set<string>(), setCodec<string>())
  const [techQuery, setTechQuery] = usePersistentState(upref('ui-techquery'), '')
  const [catFilter, setCatFilter] = usePersistentState(upref('ui-catfilter'), 'all')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [float, setFloat] = useState<{ x: number; y: number } | null>(null)
  const [railOpen, setRailOpen] = usePersistentState(upref('ui-railopen'), false)
  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null)
  const [legendAnchor, setLegendAnchor] = useState<DOMRect | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; apptId: string } | null>(null)
  const [cancelPromptId, setCancelPromptId] = useState<string | null>(null)
  const [clipboard, setClipboard] = usePersistentState<ClipItem[]>(upref('clipboard-v1'), [])
  const [approved, setApproved] = usePersistentState<ApprovedItem[]>(sdata('approved-v1'), [])
  const [checkoutName, setCheckoutName] = useState<string | null>(null)
  const [invoicePayment, setInvoicePayment] = useState<{ payment: (typeof payments)[number]; items: Appointment[] } | null>(null)
  const [checkoutGroup, setCheckoutGroup] = useState<string | null>(null) // parallelGroup of the source appt
  const [checkoutSelected, setCheckoutSelected] = useState<Set<string>>(new Set()) // people on this ticket
  const [checkoutGuestOf, setCheckoutGuestOf] = useState<string | null>(null) // set when the person is a name-only guest
  // the checkout draft persists: close the panel, come back to the same edits
  interface CheckoutDraft {
    name: string
    groupId: string | null
    selected: string[]
    removedIds: string[]
    addedIds: string[]
    tipPct: number | null
    tipCustom: string
    method: string
    note: string
    redeemId: string | null
    tipByTech?: Record<string, string>
  }
  const [checkoutDraft, setCheckoutDraft] = usePersistentState<CheckoutDraft | null>(sdata('checkout-draft-v1'), null)
  const [posOpen, setPosOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [schedules, setSchedules] = usePersistentState<Record<string, DaySchedule>>(sdata('schedule-v1'), {})
  const [blocksByDay, setBlocksByDay] = usePersistentState<Record<string, TimeBlock[]>>(sdata('blocks-v1'), {})
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number; techId: string; startMin: number } | null>(null)
  const [techMenu, setTechMenu] = useState<{ x: number; y: number; techId: string } | null>(null)
  const [techSchedView, setTechSchedView] = useState<{ techId: string; mode: 'week' | 'month' } | null>(null)
  const [moveApptsTechId, setMoveApptsTechId] = useState<string | null>(null)
  const [logApptId, setLogApptId] = useState<string | null>(null)
  // the day the appointment in the edit panel actually lives on, fixed while
  // that panel's day rail browses the calendar elsewhere (see openDetail)
  const [detailOriginDay, setDetailOriginDay] = useState<string | null>(null)
  // stable per-day previews for the availability modal (unvisited days generate once)
  const dayPreviewCache = useRef(new Map<string, Appointment[]>())
  const [blockEdit, setBlockEdit] = useState<{ id: string | null; techId: string; draft: BlockDraft } | null>(null)
  const [blockDeleteId, setBlockDeleteId] = useState<string | null>(null)
  const [clipboardClearConfirm, setClipboardClearConfirm] = useState(false)
  const [pendingBlockDrop, setPendingBlockDrop] = useState<{ d: DragState; moving: MovingItem[] } | null>(null)
  const [pendingOverlap, setPendingOverlap] = useState<{ techId: string; timeLabel: string; apply: () => void } | null>(null)
  const [pendingTechRequest, setPendingTechRequest] = useState<{ fromName: string; toName: string; clientName: string; apply: () => void } | null>(null)
  const [pendingGenderMismatch, setPendingGenderMismatch] = useState<{ pref: 'female' | 'male'; toName: string; clientName: string; apply: () => void } | null>(null)
  const blocksRef = useRef<TimeBlock[]>([])
  blocksRef.current = blocksByDay[dateKey] ?? []
  // blocks drag like appointments, but self-contained (no conflict rules)
  const [blockDrag, setBlockDrag] = useState<{ id: string; mode: 'move' | 'resize'; techId: string; startMin: number; durationMin: number; moved: boolean } | null>(null)
  const daySchedule = useMemo(() => {
    const explicit = schedules[dateKey] ?? {}
    const wd = new Date(dateKey + 'T12:00:00').getDay()
    const out: DaySchedule = {}
    for (const t of techs) {
      if (isArchived(t)) continue
      if (explicit[t.id]) { out[t.id] = explicit[t.id]; continue }
      // temporary time off (exact dates) beats the weekly template
      const off = (t.timeOff ?? []).find((x) => x.from <= dateKey && dateKey <= x.to)
      if (off) {
        out[t.id] = {
          status: off.status,
          notes: off.notes,
          ...(off.status === 'late' ? { startMin: off.timeMin } : off.status === 'early' ? { endMin: off.timeMin } : {}),
        }
        continue
      }
      const w = t.weeklySchedule?.[wd]
      if (w?.off) out[t.id] = { status: 'off' }
      else if (w && (w.startMin != null || w.endMin != null)) out[t.id] = { status: 'working', startMin: w.startMin, endMin: w.endMin }
    }
    return out
  }, [schedules, dateKey, techs])
  const schedRef = useRef(daySchedule)
  schedRef.current = daySchedule
  const dayBlocks = blocksByDay[dateKey] ?? []
  const setDayBlocks = (next: TimeBlock[] | ((b: TimeBlock[]) => TimeBlock[])) =>
    setBlocksByDay((m) => ({ ...m, [dateKey]: typeof next === 'function' ? next(m[dateKey] ?? []) : next }))
  const [pointsByClient, setPointsByClient] = usePersistentState<Record<string, number>>(sdata('loyalty-v1'), {})
  // cancellation history, kept separately since a cancelled appointment is removed
  // from the day's board entirely (nothing else needs it, but Reports does)
  const [, setCancellations] = usePersistentState<CancellationRecord[]>(sdata('cancellations-v1'), [])
  const [turnaways, setTurnaways] = usePersistentState<TurnawayRecord[]>(sdata('turnaways-v1'), [], turnawaysCodec)
  const [turnawayOpen, setTurnawayOpen] = useState(false)
  // you can't turn away someone in the past or the future, only right now, so
  // logging only makes sense while looking at today's board
  const canLogTurnaway = isToday(date)
  // daily turnaway tally for the toolbar badge, scoped to whichever day is on
  // screen (same as every other day-scoped thing here, appts/blocks/etc) so it
  // always matches what you're looking at, and naturally resets when the date
  // changes rather than needing a separate stored counter to reset
  const turnawaysToday = useMemo(() => turnaways.filter((t) => t.dateKey === dateKey), [turnaways, dateKey])
  const turnawaysTodayCategories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of turnawaysToday) {
      for (const g of t.guests) {
        for (const id of g.categoryIds ?? []) {
          const name = catById[id]?.name ?? 'Service'
          counts.set(name, (counts.get(name) ?? 0) + 1)
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [turnawaysToday])
  const turnawayDayLabel = canLogTurnaway ? 'today' : `on ${dayLabel(date)}`
  const turnawaySummary = turnawaysToday.length === 0
    ? null
    : `${turnawaysToday.length} turnaway${turnawaysToday.length === 1 ? '' : 's'} ${turnawayDayLabel}${
        turnawaysTodayCategories.length > 0
          ? ` — ${turnawaysTodayCategories.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')}`
          : ''
      }`
  const turnawayTitle = canLogTurnaway
    ? turnawaySummary ?? "Log a turnaway, a client we couldn't fit in"
    : `Turnaways can only be logged for today${turnawaySummary ? ` · ${turnawaySummary}` : ''}`
  const [payments, setPayments] = usePersistentState<{ id: string; dateKey: string; clientName: string; itemCount: number; subtotal: number; tip: number; total: number; method: string; points: number; notes?: string; pos?: boolean; party?: number; discount?: number; redeemed?: { name: string; points: number; value: number }; lines?: { techId: string; price: number }[]; apptIds?: string[]; tipByTech?: { techId: string; amount: number }[] }[]>(sdata('payments-v1'), [])
  // online waitlist (self-serve) + walk-in queue (front desk)
  const [waitlist, setWaitlist] = usePersistentState<QueueEntry[]>(sdata('waitlist-v1'), () => [
    { id: 'w1', name: 'Ava R.', serviceId: 'p-gel', phone: '(555) 220-1188', preferredTechId: getStaff().techs.find((t) => t.teamId === 'pedi')?.id, days: [1, 3, 5], fromMin: 360, toMin: 600, notes: 'Prefers after 2 PM', createdMin: DEMO_NOW_MIN - 25 },
    { id: 'w2', name: 'Noah K.', serviceId: 'm-gel', days: [6], fromMin: 0, toMin: 240, createdMin: DEMO_NOW_MIN - 8 },
  ])
  const [walkins, setWalkins] = usePersistentState<WalkInGroup[]>(sdata('walkins-v1'), () => [
    { id: 'k1', guests: [{ name: 'Lily', serviceIds: ['p-classic'] }], createdMin: DEMO_NOW_MIN - 12 },
    { id: 'k2', guests: [{ name: 'Zoe M.', serviceIds: ['m-classic'] }], createdMin: DEMO_NOW_MIN - 4 },
  ])
  const allowOverlap = useSettingsStore().booking.allowOverlap // Settings → Online booking
  const warnOnDoubleBook = useSettingsStore().booking.warnOnDoubleBook
  // auto-move a non-requested squatter to make room for a specific-tech
  // booking/edit/drag, instead of prompting to double-book — Settings → Online booking
  const autoRelocateNonRequested = useSettingsStore().booking.autoRelocateNonRequested
  const salonGeneral = useSettingsStore().general
  // salon operating window for the viewed day (minutes from OPEN_MIN) + closures
  const salonDow = new Date(dateKey + 'T12:00:00').getDay()
  const salonDayHours = salonGeneral.weekHours?.[salonDow]
  const salonHoliday = (salonGeneral.holidays ?? []).find((h) => h.date === dateKey)
  const salonOpenOff = Math.max(0, Math.min(DAY_MIN, (salonDayHours?.open ?? OPEN_MIN) - OPEN_MIN))
  const salonCloseOff = Math.max(salonOpenOff, Math.min(DAY_MIN, (salonDayHours?.close ?? CLOSE_MIN) - OPEN_MIN))
  const salonClosed = Boolean(salonHoliday) || Boolean(salonDayHours?.off)
  const [clients, setClients] = usePersistentState<ClientRecord[]>(sdata('clients-v1'), CLIENTS)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingPrefill, setBookingPrefill] = useState<{ techId: string; startMin: number } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [darkMode, setDarkMode] = usePersistentState(upref('ui-dark'), false)
  const [hoverTip, setHoverTip] = useState<{ apptId: string; x: number; y: number } | null>(null)
  // measured after render — the card's row count varies (notes, tech-choice
  // line, and the checked-in/started/completed rows are all conditional), so
  // a fixed height guess isn't enough to keep it from running off the bottom
  const hoverTipRef = useRef<HTMLDivElement>(null)
  const [hoverTipPos, setHoverTipPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!hoverTip) { setHoverTipPos(null); return }
    const el = hoverTipRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setHoverTipPos({
      left: Math.max(8, Math.min(hoverTip.x + 14, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(hoverTip.y + 14, window.innerHeight - height - 8)),
    })
  }, [hoverTip])
  const [profileName, setProfileName] = useState<string | null>(null)
  const [notesByClient, setNotesByClient] = usePersistentState<Record<string, ClientNote[]>>(sdata('notes-v1'), {})
  const [fitOpen, setFitOpen] = useState(false)

  const historyRef = useRef<{ appts: Appointment[]; waitlist: QueueEntry[]; walkins: WalkInGroup[]; approved: ApprovedItem[]; blocks: TimeBlock[]; clipboard: ClipItem[] }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const hoverTimer = useRef<number | undefined>(undefined)
  const tipTimer = useRef<number | undefined>(undefined)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewW, setViewW] = useState(1400)

  const colW = scale.colW
  const pxPerMin = scale.ppm
  // greyed padding: one hour before open and one after close
  const VIEW_PAD = 60
  const yAt = (m: number) => (m + VIEW_PAD) * pxPerMin

  const setScale = useCallback((s: Scale) => {
    // zoom stays independent of the density lines, adjusting scale keeps them
    setScaleRaw({
      colW: clamp(Math.round(s.colW), MIN_COL_W, MAX_COL_W),
      ppm: clamp(s.ppm, MIN_PPM, MAX_PPM),
    })
  }, [])

  // density presets from the reference build (time-height zoom)
  const onDensity = useCallback((d: 15 | 30 | 60) => {
    setDensity(d)
    setScaleRaw((s) => ({ ...s, ppm: { 15: 0.8, 30: 64 / 60, 60: 88 / 60 }[d] }))
  }, [])

  // fit the whole book into the viewport, Zenoti-style
  const fitWidth = useCallback(() => {
    const cols = Math.max(1, columnsRef.current.length)
    setScaleRaw((s) => ({
      ...s,
      colW: clamp(Math.floor((viewW - GUTTER_W) / cols), MIN_COL_W, MAX_COL_W),
    }))
  }, [viewW])
  const fitHeight = useCallback(() => {
    const vh = scrollRef.current?.clientHeight ?? 700
    setScaleRaw((s) => ({
      ...s,
      ppm: clamp((vh - GROUP_H - TECH_H) / (DAY_MIN + 120), MIN_PPM, MAX_PPM),
    }))
  }, [])
  const columnsRef = useRef<Column[]>([])

  // ctrl / ⌘ + scroll → width zoom · +shift → height zoom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const d = -e.deltaY
      setScaleRaw((s) =>
        e.shiftKey
          ? { ...s, ppm: clamp(s.ppm + d * 0.004, MIN_PPM, MAX_PPM) }
          : { ...s, colW: clamp(s.colW + d * 0.6, MIN_COL_W, MAX_COL_W) },
      )
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  // ── day navigation (persisted per-day books keep edits while you browse) ──
  const goDay = (d: Date) => {
    const key = dayKey(d)
    setAppts(backfillStageTimestamps(apptDays[key] ?? generateDay(key)))
    setDateKey(key)
    historyRef.current = []
    redoRef.current = []
    setSelectedGroup(null)
    setMenu(null)
  }

  // mirror the visible day's appointments into the persisted map
  useEffect(() => {
    setApptDays((m) => (m[dateKey] === appts ? m : { ...m, [dateKey]: appts }))
  }, [appts, dateKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // appts/blocks for an arbitrary day, not just the one on screen — lets the
  // edit panel's "available times" rail preview other days without visiting
  // them (same stable-preview-cache pattern as the tech week/month takeover)
  const dayApptsFor = (k: string): Appointment[] => {
    if (k === dateKey) return appts
    if (apptDays[k]) return apptDays[k]
    let v = dayPreviewCache.current.get(k)
    if (!v) { v = generateDay(k); dayPreviewCache.current.set(k, v) }
    return v
  }
  const dayBlocksFor = (k: string): TimeBlock[] => blocksByDay[k] ?? []

  // ── columns model (role groups from the staff store; techs A to Z within a role) ──
  const columns = useMemo<Column[]>(() => {
    const cols: Column[] = []
    const q = techQuery.trim().toLowerCase()
    for (const role of roles) {
      if (hiddenTeams.has(role.id)) continue
      if (collapsed.has(role.id)) { cols.push({ kind: 'collapsed', teamId: role.id }); continue }
      const inRole = boardTechs(techs.filter((x) => x.teamId === role.id)).sort((a, b) => a.name.localeCompare(b.name))
      for (const t of inRole) {
        if (q && !t.name.toLowerCase().includes(q)) continue
        // off-duty with an empty book, no column needed today
        const sd = daySchedule[t.id]
        const offDuty = sd && (sd.status === 'off' || sd.status === 'vacation' || sd.status === 'emergency')
        if (offDuty && !appts.some((a) => a.techId === t.id)) continue
        cols.push({ kind: 'tech', tech: t })
      }
    }
    return cols
  }, [roles, techs, collapsed, hiddenTeams, techQuery, daySchedule, appts])
  columnsRef.current = columns

  /* team chips (visibility pills in the filter bar), derived from job roles */
  const teamChips = useMemo(
    () => roles.map((r) => {
      const line = roleColor(roles, r.id)
      return { id: r.id, name: r.name, fill: `${line}1F`, text: line }
    }),
    [roles],
  )

  // clear the hover tooltip when changing days — the detail panel is left
  // alone: its own day rail intentionally navigates this same `date` to
  // preview other days while staying open (detailOriginDay keeps track of
  // which day the appointment being edited actually lives on)
  useEffect(() => { setHoverTip(null) }, [date])

  const colIndex = useMemo(() => {
    const m = new Map<string, number>()
    columns.forEach((c, i) => { if (c.kind === 'tech') m.set(c.tech.id, i) })
    return m
  }, [columns])

  // columns stretch to fill the viewport — but never squeeze below readable
  // text width just because a side rail/panel (or a narrower window, e.g.
  // devtools docked open) stole space (scroll instead). Only exception: the
  // user deliberately zoomed out to block/overview mode (colW below the
  // overview threshold) — that stays a plain colored block at any width.
  const cw = useMemo(() => {
    if (colW < OVERVIEW_COL_W) return colW
    const n = Math.max(1, columns.length)
    const fill = Math.floor((viewW - GUTTER_W) / n)
    return Math.max(colW, fill, TEXT_COL_W)
  }, [columns.length, viewW, colW])
  const colXAt = useCallback((i: number) => i * cw, [cw])
  const colWAt = useCallback((_i: number) => cw, [cw])

  // right-side panels (booking 580px, checkout/POS 460px, appointment detail
  // 440px) overlay the scroller — pad the content so the last columns can
  // scroll out from under them
  const panelPad = bookingOpen ? 580 : checkoutName || posOpen ? 460 : detailId ? 440 : 0
  const totalW = GUTTER_W + columns.length * cw + panelPad

  const showText = cw >= TEXT_COL_W
  const isOverview = cw < OVERVIEW_COL_W
  const dayH = (DAY_MIN + VIEW_PAD * 2) * pxPerMin

  // ── horizontal virtualization ─────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const firstCol = Math.max(0, Math.floor(scrollLeft / cw) - 2)
  const lastCol = Math.min(columns.length - 1, Math.ceil((scrollLeft + viewW) / cw) + 2)

  const visibleTechIds = useMemo(() => {
    const s = new Set<string>()
    for (let i = firstCol; i <= lastCol; i++) {
      const c = columns[i]
      if (c?.kind === 'tech') s.add(c.tech.id)
    }
    return s
  }, [columns, firstCol, lastCol])

  // ── derived appointment views ─────────────────────────────────────────────
  const filtered = useMemo(
    () => (catFilter === 'all' ? appts : appts.filter((a) => catById[svcById[a.serviceId].categoryId].id === catFilter)),
    [appts, catFilter],
  )
  const requested = useMemo(() => appts.filter((a) => a.status === 'requested'), [appts])

  const teamStats = useMemo(() => {
    const m = new Map<string, { booked: number; total: number; appts: number }>()
    for (const role of roles) {
      const inRole = techs.filter((t) => t.teamId === role.id)
      const booked = inRole.filter((t) => appts.some((a) => a.techId === t.id)).length
      const count = appts.filter((a) => inRole.some((t) => t.id === a.techId)).length
      m.set(role.id, { booked, total: inRole.length, appts: count })
    }
    return m
  }, [appts, roles, techs])

  const apptCountByTech = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of appts) m.set(a.techId, (m.get(a.techId) ?? 0) + 1)
    return m
  }, [appts])

  // ── mutations (with undo/redo history, snapshots include the queues) ──────
  type Snapshot = { appts: Appointment[]; waitlist: QueueEntry[]; walkins: WalkInGroup[]; approved: ApprovedItem[]; blocks: TimeBlock[]; clipboard: ClipItem[] }
  const redoRef = useRef<Snapshot[]>([])

  const commit = useCallback((next: Appointment[]) => {
    historyRef.current.push({ appts, waitlist, walkins, approved, blocks: dayBlocks, clipboard })
    if (historyRef.current.length > 30) historyRef.current.shift()
    redoRef.current = [] // a new action clears the redo stack
    setAppts(next)
  }, [appts, waitlist, walkins, approved, dayBlocks])

  // block mutations snapshot too, so undo covers them
  const commitBlocks = (next: TimeBlock[]) => {
    historyRef.current.push({ appts, waitlist, walkins, approved, blocks: dayBlocks, clipboard })
    if (historyRef.current.length > 30) historyRef.current.shift()
    redoRef.current = []
    setDayBlocks(next)
  }

  const undo = useCallback(() => {
    const prev = historyRef.current.pop()
    if (prev) {
      redoRef.current.push({ appts, waitlist, walkins, approved, blocks: dayBlocks, clipboard })
      setAppts(prev.appts)
      setWaitlist(prev.waitlist)
      setWalkins(prev.walkins)
      setApproved(prev.approved)
      setDayBlocks(prev.blocks)
      setClipboard(prev.clipboard)
    }
  }, [appts, waitlist, walkins, approved, dayBlocks, clipboard])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (next) {
      historyRef.current.push({ appts, waitlist, walkins, approved, blocks: dayBlocks, clipboard })
      setAppts(next.appts)
      setWaitlist(next.waitlist)
      setWalkins(next.walkins)
      setApproved(next.approved)
      setDayBlocks(next.blocks)
      setClipboard(next.clipboard)
    }
  }, [appts, waitlist, walkins, approved, dayBlocks, clipboard])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
      if (e.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo])

  const showFlash = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), 2600)
  }

  // ── conflict checking ─────────────────────────────────────────────────────
  const checkMove = useCallback(
    (moving: MovingItem[], extraIgnoreIds?: Set<string>) => {
      const ids = new Set(moving.map((m) => m.id))
      const errors = new Map<string, string | null>()
      for (const m of moving) {
        let err: string | null = null
        if (m.startMin < salonOpenOff || m.startMin + m.durationMin > salonCloseOff) err = salonClosed ? 'Salon closed' : 'Outside hours'
        if (!err && !allowOverlap) {
          const hit = appts.find(
            (a) => !ids.has(a.id) && !extraIgnoreIds?.has(a.id) && a.techId === m.techId &&
              overlaps(m.startMin, m.startMin + m.durationMin, a.startMin, a.startMin + a.durationMin),
          )
          if (hit) err = `Overlaps ${hit.clientName}`
        }
        if (!err && !techOf(m.techId).skills.includes(m.serviceId)) {
          err = `${techOf(m.techId).name} not qualified`
        }
        errors.set(m.id, err)
      }
      return errors
    },
    [appts, allowOverlap, salonOpenOff, salonCloseOff, salonClosed],
  )

  // ── side-by-side lanes for overlapping appointments on the same tech ─────
  const laneInfo = useMemo(() => {
    const map = new Map<string, { lane: number; lanes: number }>()
    if (!allowOverlap) return map
    const byTech = new Map<string, Appointment[]>()
    for (const a of appts) {
      const l = byTech.get(a.techId) ?? []
      l.push(a)
      byTech.set(a.techId, l)
    }
    for (const list of byTech.values()) {
      list.sort((x, y) => x.startMin - y.startMin || y.durationMin - x.durationMin)
      let cluster: Appointment[] = []
      let clusterEnd = -1
      const flush = () => {
        if (cluster.length === 0) return
        const laneEnds: number[] = []
        const laneOf = new Map<string, number>()
        for (const a of cluster) {
          let lane = laneEnds.findIndex((end) => end <= a.startMin)
          if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
          laneEnds[lane] = a.startMin + a.durationMin
          laneOf.set(a.id, lane)
        }
        for (const a of cluster) map.set(a.id, { lane: laneOf.get(a.id)!, lanes: laneEnds.length })
        cluster = []
        clusterEnd = -1
      }
      for (const a of list) {
        if (cluster.length > 0 && a.startMin >= clusterEnd) flush()
        cluster.push(a)
        clusterEnd = Math.max(clusterEnd, a.startMin + a.durationMin)
      }
      flush()
    }
    return map
  }, [appts, allowOverlap])

  const computeMoving = useCallback((d: DragState, apptList: Appointment[]): MovingItem[] => {
    if (d.kind === 'clip' && d.clip) {
      // dynamically assign every service a free, least-booked tech at the current target time
      const counts = new Map<string, number>()
      for (const a of apptList) counts.set(a.techId, (counts.get(a.techId) ?? 0) + 1)
      const used: { techId: string; from: number; to: number }[] = []
      return d.clip.services.map((s, i) => {
        const from = d.clipStartMin
        const to = from + s.durationMin
        let techId: string
        if (i === 0) {
          // a copied preference (first available / gender) wins over the drop column
          techId = s.requestedTechChoice
            ? (resolveChoice(s.requestedTechChoice, s.serviceId, from, to)?.id ?? d.targetTechId)
            : d.targetTechId
        } else {
          const free = boardTechs(getStaff().techs).filter(
            (t) => t.skills.includes(s.serviceId) &&
              withinShift(t.id, from, to) &&
              !used.some((u) => u.techId === t.id && overlaps(from, to, u.from, u.to)) &&
              !apptList.some((a) => a.techId === t.id && overlaps(from, to, a.startMin, a.startMin + a.durationMin)) &&
              !blocksRef.current.some((b) => b.techId === t.id && overlaps(from, to, b.startMin, b.startMin + b.durationMin)),
          ).sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0]
          techId = free?.id ?? s.techId
        }
        used.push({ techId, from, to })
        return { id: `clip-${i}`, techId, startMin: from, durationMin: s.durationMin, serviceId: s.serviceId }
      })
    }
    return d.moveIds.map((id) => {
      const a = apptList.find((x) => x.id === id)!
      if (d.mode === 'resize') {
        return { id, techId: a.techId, startMin: a.startMin, durationMin: Math.max(SLOT_MIN, a.durationMin + d.deltaMin), serviceId: a.serviceId }
      }
      return {
        id,
        techId: id === d.primaryId ? d.targetTechId : a.techId,
        startMin: a.startMin + d.deltaMin,
        durationMin: a.durationMin,
        serviceId: a.serviceId,
      }
    })
  }, [])

  // ── drag & drop ───────────────────────────────────────────────────────────
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const startDrag = (e: React.PointerEvent, appt: Appointment, mode: 'move' | 'resize') => {
    if (isOverview) return
    e.stopPropagation()
    e.preventDefault()
    setFocusKey(null)
    setHoverTip(null)
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(tipTimer.current)
    const rect = contentRef.current!.getBoundingClientRect()
    const pointerMin = (e.clientY - rect.top - GROUP_H - TECH_H) / pxPerMin - VIEW_PAD
    // only the card you grabbed moves, linked services stay put (they just light up on hover)
    setFloat({ x: 0, y: 0 })
    setDrag({
      kind: 'appt', primaryId: appt.id, moveIds: [appt.id],
      grabOffsetMin: pointerMin - appt.startMin, mode, moved: false,
      targetTechId: appt.techId, deltaMin: 0, clipStartMin: 0,
      startClientX: e.clientX, startClientY: e.clientY,
    })
  }

  const startClipDrag = (e: React.PointerEvent, clip: ClipItem) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = contentRef.current!.getBoundingClientRect()
    const yMin = (e.clientY - rect.top - GROUP_H - TECH_H) / pxPerMin - VIEW_PAD
    const half = clip.services[0].durationMin / 2
    setDrag({
      kind: 'clip', primaryId: '', moveIds: [], clip,
      grabOffsetMin: half, mode: 'move', moved: false,
      targetTechId: clip.services[0].techId, deltaMin: 0,
      clipStartMin: clamp(Math.round((yMin - half) / SLOT_MIN) * SLOT_MIN, 0, DAY_MIN - clip.services[0].durationMin),
      startClientX: e.clientX, startClientY: e.clientY,
    })
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      const content = contentRef.current
      const scroller = scrollRef.current
      if (!d || !content || !scroller) return
      // edge auto-scroll
      const sRect = scroller.getBoundingClientRect()
      if (e.clientX > sRect.right - 60) scroller.scrollLeft += 22
      else if (e.clientX < sRect.left + GUTTER_W + 40) scroller.scrollLeft -= 22

      const rect = content.getBoundingClientRect()
      const x = e.clientX - rect.left - GUTTER_W
      const yMin = (e.clientY - rect.top - GROUP_H - TECH_H) / pxPerMin - VIEW_PAD
      const colIdx = clamp(Math.floor(x / cw), 0, columns.length - 1)
      const col = columns[colIdx]

      if (d.kind === 'clip') {
        const targetTechId = col?.kind === 'tech' ? col.tech.id : d.targetTechId
        const start = clamp(
          Math.round((yMin - d.grabOffsetMin) / SLOT_MIN) * SLOT_MIN,
          0, DAY_MIN - d.clip!.services[0].durationMin,
        )
        setDrag({ ...d, moved: true, targetTechId, clipStartMin: start })
        return
      }

      const primary = appts.find((a) => a.id === d.primaryId)!
      const targetTechId = d.mode === 'move' && col?.kind === 'tech' ? col.tech.id : primary.techId
      let deltaMin: number
      if (d.mode === 'move') {
        deltaMin = Math.round((yMin - d.grabOffsetMin - primary.startMin) / SLOT_MIN) * SLOT_MIN
      } else {
        deltaMin = Math.round((yMin - primary.startMin - primary.durationMin) / SLOT_MIN) * SLOT_MIN
      }
      // smooth float follows the pointer continuously
      setFloat({ x: e.clientX - d.startClientX, y: e.clientY - d.startClientY })
      // while drag state only updates when the snap target actually changes
      const moved = d.moved || Math.abs(e.clientX - d.startClientX) > 4 || Math.abs(e.clientY - d.startClientY) > 4
      if (moved !== d.moved || deltaMin !== d.deltaMin || targetTechId !== d.targetTechId) {
        setDrag({ ...d, moved, targetTechId, deltaMin })
      }
    }

    const onUp = () => {
      const d = dragRef.current
      setFloat(null)
      if (!d) return
      if (!d.moved) {
        setDrag(null)
        if (d.kind === 'appt') {
          const primary = appts.find((a) => a.id === d.primaryId)!
          if (isOverview) {
            setScale({ colW: 104, ppm: pxPerMin })
            scrollToTech(primary.techId)
          } else {
            setSelectedGroup((g) => (g === (primary.parallelGroup ?? primary.id) ? null : primary.parallelGroup ?? primary.id))
          }
        }
        return
      }
      suppressClick.current = true // don't let the drop become a quick-book click

      // dropped back where it started, snap back quietly, no commit
      if (d.kind === 'appt' && d.deltaMin === 0 && appts.find((a) => a.id === d.primaryId)!.techId === d.targetTechId) {
        setDrag(null)
        return
      }

      const moving = computeMoving(d, appts)
      const relocated = relocateSquatters(moving)
      const errors = checkMove(moving, new Set(relocated.keys()))
      const firstErr = [...errors.values()].find((e) => e) ?? null

      // dropping into a time block is allowed for staff, but confirm first
      const hitBlock = !firstErr && moving.some((m) =>
        blocksRef.current.some((b) => b.techId === m.techId && overlaps(m.startMin, m.startMin + m.durationMin, b.startMin, b.startMin + b.durationMin)),
      )
      if (hitBlock) {
        setPendingBlockDrop({ d, moving })
        setDrag(null)
        return
      }

      continueAfterPrompts(d, moving, firstErr, relocated)
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, appts, columns, cw, pxPerMin, isOverview])

  // live drag validity
  const dragMoving = useMemo(() => (drag && drag.moved ? computeMoving(drag, appts) : []), [drag, appts, computeMoving])
  const dragErrors = useMemo(() => checkMove(dragMoving), [dragMoving, checkMove])
  const dragInvalid = [...dragErrors.values()].some(Boolean)
  // group key of the card being dragged, its linked partners glow during the drag
  const dragGroupKey = drag?.kind === 'appt' && drag.moved
    ? (appts.find((x) => x.id === drag.primaryId)?.parallelGroup ?? drag.primaryId)
    : null
  // techs holding spotlighted appointments, their header boxes light up too
  const focusTechIds = useMemo(() => (focusKey == null ? null : new Set(
    appts.filter((a) => (a.parallelGroup ?? a.id) === focusKey).map((a) => a.techId))), [focusKey, appts])
  // techs targeted by the current drag, header boxes light up with the column wash
  const dragTargetTechIds = useMemo(() => new Set(dragMoving.map((m) => m.techId)), [dragMoving])

  // ── hover: quick info tooltip + sticky link-focus ─────────────────────────
  // Tooltip appears fast (350ms); focus-dim mode kicks in at 2s and is
  // sticky, survives the cursor leaving so you can scroll to find linked
  // appointments. Click anywhere to exit focus mode.
  const onCardEnter = (e: React.PointerEvent, a: Appointment) => {
    if (drag) return
    const { clientX, clientY } = e
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(tipTimer.current)
    tipTimer.current = window.setTimeout(() => setHoverTip({ apptId: a.id, x: clientX, y: clientY }), 350)
    // focus-dim engages at 2s but the info tooltip stays while hovering
    hoverTimer.current = window.setTimeout(() => setFocusKey(a.parallelGroup ?? a.id), 2000)
  }
  const onCardLeave = () => {
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(tipTimer.current)
    setHoverTip(null)
  }
  useEffect(() => {
    if (focusKey == null) return
    // pointerdown, not click: drag starts call preventDefault on pointerdown,
    // which suppresses click — the rail could never exit spotlight mode
    const exit = () => setFocusKey(null)
    window.addEventListener('pointerdown', exit)
    return () => window.removeEventListener('pointerdown', exit)
  }, [focusKey != null]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── booking flow (Zenoti-style right panel) ──────────────────────────────
  const onGridClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (isOverview) return
    if (salonClosed) { showFlash(`⚠ Salon is closed on this day${salonHoliday?.label ? ` (${salonHoliday.label})` : ''}`); return }
    const rect = contentRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - GUTTER_W
    const yMin = (e.clientY - rect.top - GROUP_H - TECH_H) / pxPerMin - VIEW_PAD
    if (x < 0 || yMin < salonOpenOff || yMin > salonCloseOff) return
    const col = columns[Math.floor(x / cw)]
    if (col?.kind !== 'tech') return
    setBookingPrefill({ techId: col.tech.id, startMin: Math.round(yMin / SLOT_MIN) * SLOT_MIN })
    closeCheckout()
    setPosOpen(false)
    setBookingOpen(true)
  }

  // resolve a special tech choice ('first', 'pref-female', 'pref-male', 'issue')
  // into a concrete tech: least-booked qualified tech free at that time
  const resolveChoice = (choice: string, serviceId: string, from: number, to: number, ignore?: string | Set<string>, excludeTechIds?: Set<string>): Tech | null => {
    const ignoreIds = typeof ignore === 'string' ? new Set([ignore]) : ignore
    let pool = boardTechs(getStaff().techs).filter((t) =>
      t.skills.includes(serviceId) &&
      withinShift(t.id, from, to) &&
      !excludeTechIds?.has(t.id) &&
      !appts.some((a) => !ignoreIds?.has(a.id) && a.techId === t.id && overlaps(from, to, a.startMin, a.startMin + a.durationMin)) &&
      !blocksRef.current.some((b) => b.techId === t.id && overlaps(from, to, b.startMin, b.startMin + b.durationMin)),
    )
    if (choice === 'pref-female' || choice === 'pref-male') {
      const g = choice === 'pref-female' ? 'female' : 'male'
      const gp = pool.filter((t) => t.gender === g)
      if (gp.length > 0) pool = gp // preference, not a hard filter
    }
    return pool.sort((a, b) => (apptCountByTech.get(a.id) ?? 0) - (apptCountByTech.get(b.id) ?? 0))[0] ?? null
  }

  // free a tech's [from,to) for a tech-requested booking: move any NON-requested
  // appointment sitting there to a qualified tech who's actually free — and if
  // the best candidate is busy too, chase that squatter off of THEM as well,
  // hopping through as many techs as it takes. Cycle-guarded (never revisits a
  // tech already mid-chain) so it always terminates; null when the chain hits
  // a requested appointment it can't bump, or runs out of qualified techs
  const makeRoom = (techId: string, from: number, to: number, ignoreIds?: Set<string>): Appointment[] | null => {
    const ignore = ignoreIds ?? new Set<string>()

    // free tid's [f,t) window, recursively bumping whoever's chained in the
    // way. `moved` is the relocation plan built up so far across the whole
    // chain (id → its final appointment); `visited` is the set of techs
    // already being cleared earlier in this same chain, so it can't loop
    // back through one of them. Returns the updated plan on success, or
    // null if this branch of the chain is a dead end.
    const freeSlotFor = (
      tid: string, f: number, t: number, moved: Map<string, Appointment>, visited: Set<string>,
    ): Map<string, Appointment> | null => {
      const effTechOf = (a: Appointment) => moved.get(a.id)?.techId ?? a.techId
      const squatter = appts.find((a) =>
        !ignore.has(a.id) && effTechOf(a) === tid &&
        overlaps(f, t, a.startMin, a.startMin + a.durationMin))
      if (!squatter) return moved // already clear
      if (squatter.techRequested || visited.has(tid)) return null
      const nextVisited = new Set(visited)
      nextVisited.add(tid)
      const sqFrom = squatter.startMin
      const sqTo = sqFrom + squatter.durationMin
      const candidates = boardTechs(getStaff().techs)
        .filter((c) =>
          c.id !== tid && c.skills.includes(squatter.serviceId) && withinShift(c.id, sqFrom, sqTo) &&
          !nextVisited.has(c.id) &&
          !blocksRef.current.some((b) => b.techId === c.id && overlaps(sqFrom, sqTo, b.startMin, b.startMin + b.durationMin)))
        .sort((a, b) => (apptCountByTech.get(a.id) ?? 0) - (apptCountByTech.get(b.id) ?? 0))
      for (const cand of candidates) {
        // clear the candidate first (a no-op if she's already free), then land the squatter there
        const cleared = freeSlotFor(cand.id, sqFrom, sqTo, moved, nextVisited)
        if (!cleared) continue
        const placed = new Map(cleared)
        placed.set(squatter.id, {
          ...squatter, techId: cand.id,
          log: [...(squatter.log ?? []), logEntry(`Auto-moved to ${cand.name} to make room for a requested booking`)],
        })
        // tid might have had more than one overlapping appointment (possible
        // if double-booking was used before), keep clearing it
        const rest = freeSlotFor(tid, f, t, placed, visited)
        if (rest) return rest
      }
      return null
    }

    const result = freeSlotFor(techId, from, to, new Map(), new Set())
    return result ? [...result.values()] : null
  }

  // move every NON-requested appointment off a tech to the least-booked
  // qualified tech at the same time; requested and checked-out ones stay
  const moveTechAppointments = (techId: string) => {
    const movable = appts.filter((a) =>
      a.techId === techId && !a.techRequested && a.status !== 'completed' && a.status !== 'in_service')
    if (movable.length === 0) { showFlash('Nothing to move, only requested or finished bookings'); return }
    const moved = new Map<string, Appointment>()
    let stuck = 0
    for (const a of movable) {
      const busy = new Set<string>([techId])
      for (const m of moved.values()) {
        if (overlaps(a.startMin, a.startMin + a.durationMin, m.startMin, m.startMin + m.durationMin)) busy.add(m.techId)
      }
      const alt = resolveChoice('first', a.serviceId, a.startMin, a.startMin + a.durationMin, a.id, busy)
      if (alt) moved.set(a.id, {
        ...a, techId: alt.id,
        log: [...(a.log ?? []), logEntry(`Moved to ${alt.name} to balance the schedule`)],
      })
      else stuck++
    }
    if (moved.size > 0) commit(appts.map((a) => moved.get(a.id) ?? a))
    showFlash(
      `✓ Moved ${moved.size} of ${techOf(techId).name}'s bookings` +
      (stuck > 0 ? `, ${stuck} had no qualified tech free` : ''))
  }

  // the tech's personal duration/rate for a service (base when no override)
  const svcForTech = (techId: string, serviceId: string) => {
    const svc = svcById[serviceId]
    const ov = techOf(techId).serviceOverrides?.[serviceId]
    return { durationMin: ov?.durationMin ?? svc.durationMin, price: ov?.price ?? svc.price }
  }

  // is the tech working throughout [from, to)? (off-duty and out-of-shift fail)
  const withinShift = (techId: string, from: number, to: number) => {
    const sd = schedRef.current[techId]
    const st = sd?.status ?? 'working'
    if (st === 'off' || st === 'vacation' || st === 'emergency') return false
    return from >= (sd?.startMin ?? 0) && to <= (sd?.endMin ?? DAY_MIN)
  }

  // ── live checkout editing — changes hit the schedule instantly ────────────
  const patchCheckoutAppt = (id: string, patch: Partial<Appointment>) =>
    commit(appts.map((a) => (a.id === id ? { ...a, ...patch } : a)))

  const removeCheckoutLine = (id: string) =>
    setCheckoutDraft((d) => d && { ...d, removedIds: [...new Set([...d.removedIds, id])] })

  const addCheckoutExtra = (x: { serviceId: string; techId: string; person?: string }) => {
    const svc = svcById[x.serviceId]
    const hostClient = clients.find((c) => c.name === checkoutName)
    const person = x.person ?? checkoutName!
    const personIsAccount = clients.some((c) => c.name === person)
    const techId = x.techId || pickLeastBooked(x.serviceId, DEMO_NOW_MIN, svc.durationMin, [])?.id || techs[0]?.id || ''
    const st = svcForTech(techId, x.serviceId)
    const start = Math.min(
      Math.max(0, ...checkoutItems.map((a) => a.startMin + a.durationMin), DEMO_NOW_MIN),
      DAY_MIN - st.durationMin,
    )
    const appt: Appointment = {
      id: `a${Date.now()}-x`, techId, clientName: person, serviceId: x.serviceId,
      startMin: start, durationMin: st.durationMin, status: 'confirmed' as const,
      guestOf: personIsAccount ? undefined : checkoutGuestOf ?? hostClient?.id,
      priceOverride: st.price !== svc.price ? st.price : undefined,
      bookingSource: 'front_desk',
    }
    commit([...appts, appt])
    setCheckoutDraft((d) => d && { ...d, addedIds: [...d.addedIds, appt.id] })
    // name-only guests register under the host's profile
    if (!personIsAccount && hostClient && person !== checkoutName) {
      setClients((cs) => cs.map((c) => {
        if (c.id !== hostClient.id) return c
        const have = new Set((c.guests ?? []).map((g) => g.name.toLowerCase()))
        if (have.has(person.toLowerCase())) return c
        return { ...c, guests: [...(c.guests ?? []), { id: `g${Date.now()}-${(c.guests ?? []).length}`, name: person }] }
      }))
    }
    showFlash(`✓ ${svc.name} added to ${person}'s ticket`)
  }

  const removeCheckoutExtra = (id: string) => {
    commit(appts.filter((a) => a.id !== id))
    setCheckoutDraft((d) => d && {
      ...d,
      addedIds: d.addedIds.filter((x) => x !== id),
      removedIds: d.removedIds.filter((x) => x !== id),
    })
  }

  // does this move double-book a tech? (only reachable when overlap is enabled)
  const overlapHitFor = (moving: MovingItem[], extraIgnoreIds?: Set<string>) => {
    const ids = new Set(moving.map((m) => m.id))
    return moving.find((m) =>
      appts.some((a) => !ids.has(a.id) && !extraIgnoreIds?.has(a.id) && a.techId === m.techId &&
        overlaps(m.startMin, m.startMin + m.durationMin, a.startMin, a.startMin + a.durationMin)) ||
      moving.some((x) => x.id !== m.id && x.techId === m.techId &&
        overlaps(m.startMin, m.startMin + m.durationMin, x.startMin, x.startMin + x.durationMin)),
    ) ?? null
  }

  // dropping onto a tech's column pins the service to her by definition —
  // move any non-requested appointment out of the way, same as booking or
  // editing to a specific tech already does
  const relocateSquatters = (moving: MovingItem[]): Map<string, Appointment> => {
    const movingIds = new Set(moving.map((m) => m.id))
    const relocated = new Map<string, Appointment>()
    for (const m of moving) {
      const clash = appts.some((a) =>
        !movingIds.has(a.id) && !relocated.has(a.id) && a.techId === m.techId &&
        overlaps(m.startMin, m.startMin + m.durationMin, a.startMin, a.startMin + a.durationMin))
      if (!clash) continue
      const moved = autoRelocateNonRequested ? makeRoom(m.techId, m.startMin, m.startMin + m.durationMin, movingIds) : null
      // null means the feature is off, the squatter is itself requested, or
      // nobody qualified is free — fall through to the usual double-book
      // prompt / overlap error
      if (moved) for (const x of moved) relocated.set(x.id, x)
    }
    return relocated
  }

  const continueAfterPrompts = (
    d: DragState, moving: MovingItem[], firstErr: string | null, relocated: Map<string, Appointment> = new Map(),
    confirmed: { techRequest?: boolean; genderMismatch?: boolean } = {},
  ) => {
    // moving a requested-tech service onto a DIFFERENT tech always confirms first
    if (!firstErr && !confirmed.techRequest && d.kind === 'appt' && d.mode === 'move') {
      const primary = appts.find((a) => a.id === d.primaryId)
      if (primary?.techRequested && d.targetTechId !== primary.techId) {
        setPendingTechRequest({
          fromName: techOf(primary.techId).name,
          toName: techOf(d.targetTechId).name,
          clientName: primary.clientName,
          apply: () => continueAfterPrompts(d, moving, null, relocated, { ...confirmed, techRequest: true }),
        })
        return
      }
    }
    // moving a gender-preferred service onto a tech of the OTHER gender always confirms first —
    // unless the salon already okayed a gender mismatch for this exact appointment before
    if (!firstErr && !confirmed.genderMismatch && d.kind === 'appt' && d.mode === 'move') {
      const primary = appts.find((a) => a.id === d.primaryId)
      const pref = primary?.requestedTechChoice
      if (primary && !primary.genderMismatchOk && (pref === 'pref-female' || pref === 'pref-male') && d.targetTechId !== primary.techId) {
        const wantGender = pref === 'pref-female' ? 'female' : 'male'
        const target = techOf(d.targetTechId)
        if (target.gender !== wantGender) {
          setPendingGenderMismatch({
            pref: wantGender,
            toName: target.name,
            clientName: primary.clientName,
            apply: () => continueAfterPrompts(d, moving, null, relocated, { ...confirmed, genderMismatch: true }),
          })
          return
        }
      }
    }
    if (firstErr || !allowOverlap || !warnOnDoubleBook) {
      applyDropRef.current(d, moving, firstErr, relocated, confirmed.genderMismatch)
      return
    }
    const hit = overlapHitFor(moving, new Set(relocated.keys()))
    if (hit) {
      setPendingOverlap({
        techId: hit.techId,
        timeLabel: fmtTime(hit.startMin),
        apply: () => applyDropRef.current(d, moving, null, relocated, confirmed.genderMismatch),
      })
      return
    }
    applyDropRef.current(d, moving, null, relocated, confirmed.genderMismatch)
  }

  // applies a validated drop (appointment move or queue/clipboard placement)
  const applyDrop = (
    d: DragState, moving: MovingItem[], firstErr: string | null, relocated: Map<string, Appointment> = new Map(),
    ackGenderMismatch?: boolean,
  ) => {
    if (salonClosed) { showFlash(`⚠ Salon is closed on this day${salonHoliday?.label ? ` (${salonHoliday.label})` : ''}`); return }
    const movedNote = relocated.size > 0 ? `, moved ${relocated.size} booking${relocated.size > 1 ? 's' : ''} to make room` : ''
    if (d.kind === 'clip') {
      if (firstErr) {
        showFlash(`⚠ Can't drop here, ${firstErr}`)
      } else {
        const group = d.clip!.isPair ? `pg${Date.now()}` : undefined
        const newAppts: Appointment[] = moving.map((m, i) => {
          const st = svcForTech(m.techId, m.serviceId)
          const base = svcById[m.serviceId]
          return {
            id: `a${Date.now()}-${i}`,
            techId: m.techId,
            clientName: d.clip!.services[i].clientName ?? d.clip!.clientName,
            serviceId: m.serviceId,
            startMin: m.startMin,
            durationMin: m.durationMin === base.durationMin ? st.durationMin : m.durationMin,
            priceOverride: st.price !== base.price ? st.price : undefined,
            status: d.clip!.source?.kind === 'approved' ? 'confirmed' as const : 'booked' as const,
            notes: d.clip!.services[i].notes,
            parallelGroup: group,
            requestedTechChoice: d.clip!.services[i].requestedTechChoice,
            techRequested: d.clip!.services[i].techRequested,
            bookingSource: d.clip!.source?.kind === 'walkin' ? 'walk_in' as const
              : d.clip!.source?.kind === 'waitlist' || d.clip!.source?.kind === 'approved' ? 'online' as const
              : d.clip!.services[i].bookingSource ?? 'front_desk' as const,
            log: [logEntry(`Placed at ${fmtTime(m.startMin)} with ${techOf(m.techId).name}`)],
          }
        })
        commit([...appts.map((a) => relocated.get(a.id) ?? a), ...newAppts])
        if (d.clip!.source) {
          const src = d.clip!.source
          if (src.kind === 'walkin' && src.guestName && src.serviceId) {
            removeWalkinService(src.id, src.guestName, src.serviceId)
          } else if (src.kind === 'approved') {
            setApproved((x) => x.filter((i) => i.id !== src.id))
          } else {
            removeQueue(src.kind, src.id)
          }
          showFlash(`✓ ${d.clip!.clientName} booked from ${src.kind === 'waitlist' ? 'waitlist' : src.kind === 'approved' ? 'approved requests' : 'walk-ins'} at ${fmtTime(moving[0].startMin)}${movedNote}`)
          addNotification({
            kind: 'booked',
            text: 'New appointment booked',
            detail: `${d.clip!.clientName} · from ${src.kind === 'waitlist' ? 'waitlist' : src.kind === 'approved' ? 'approved request' : 'walk-in'} · ${fmtTime(moving[0].startMin)}${movedNote}`,
            dateKey,
          })
        } else {
          setClipboard((c) => c.filter((x) => x.id !== d.clip!.id))
          showFlash(`✓ ${d.clip!.clientName} placed at ${fmtTime(moving[0].startMin)} on ${dayLabel(date)}${movedNote}`)
          addNotification({
            kind: 'booked',
            text: 'New appointment booked',
            detail: `${d.clip!.clientName} · ${fmtTime(moving[0].startMin)}${movedNote}`,
            dateKey,
          })
        }
      }
      return
    }

    if (firstErr) {
      showFlash(`⚠ Can't move, ${firstErr}`)
    } else {
      const byId = new Map(moving.map((m) => [m.id, m]))
      commit(appts.map((a) => {
        const m = byId.get(a.id)
        return m
          ? {
              ...a, techId: m.techId, startMin: m.startMin, durationMin: m.durationMin,
              genderMismatchOk: ackGenderMismatch && a.id === d.primaryId ? true : a.genderMismatchOk,
              log: [...(a.log ?? []), logEntry(`Moved to ${techOf(m.techId).name} at ${fmtTime(m.startMin)}`)],
            }
          : relocated.get(a.id) ?? a
      }))
      const primary = appts.find((a) => a.id === d.primaryId)!
      const t = techOf(byId.get(d.primaryId)!.techId)
      showFlash(`✓ ${primary.clientName} → ${t.name} at ${fmtTime(byId.get(d.primaryId)!.startMin)}${movedNote}`)
      addNotification({
        kind: 'moved',
        text: 'Appointment moved',
        detail: `${primary.clientName} → ${t.name} at ${fmtTime(byId.get(d.primaryId)!.startMin)}${movedNote}`,
        dateKey,
        apptId: primary.id,
      })
    }
  }
  const applyDropRef = useRef(applyDrop)
  applyDropRef.current = applyDrop

  const onGridRightClick = (e: React.MouseEvent) => {
    if (isOverview) return
    e.preventDefault()
    if (salonClosed) { showFlash(`⚠ Salon is closed on this day${salonHoliday?.label ? ` (${salonHoliday.label})` : ''}`); return }
    const rect = contentRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - GUTTER_W
    const yMin = (e.clientY - rect.top - GROUP_H - TECH_H) / pxPerMin - VIEW_PAD
    if (x < 0 || yMin < salonOpenOff || yMin > salonCloseOff) return
    const col = columns[Math.floor(x / cw)]
    if (col?.kind !== 'tech') return
    setGridMenu({ x: e.clientX, y: e.clientY, techId: col.tech.id, startMin: Math.round(yMin / SLOT_MIN) * SLOT_MIN })
  }

  const startBlockDrag = (e: React.PointerEvent, b: TimeBlock, mode: 'move' | 'resize') => {
    if (e.button !== 0 || isOverview) return
    e.preventDefault()
    e.stopPropagation()
    const rect = contentRef.current!.getBoundingClientRect()
    const startX = e.clientX, startY = e.clientY
    const orig = { techId: b.techId, startMin: b.startMin, durationMin: b.durationMin }
    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - startY) / pxPerMin
      const dx = ev.clientX - startX
      setBlockDrag((d) => {
        const moved = (d?.moved ?? false) || Math.abs(dy) > 3 || Math.abs(dx) > 6
        if (mode === 'move') {
          const col = columns[Math.floor((ev.clientX - rect.left - GUTTER_W) / cw)]
          const techId = col?.kind === 'tech' ? col.tech.id : d?.techId ?? orig.techId
          const startMin = clamp(Math.round((orig.startMin + dy) / SLOT_MIN) * SLOT_MIN, 0, DAY_MIN - orig.durationMin)
          return { id: b.id, mode, techId, startMin, durationMin: orig.durationMin, moved }
        }
        const durationMin = clamp(Math.round((orig.durationMin + dy) / SLOT_MIN) * SLOT_MIN, SLOT_MIN, DAY_MIN - orig.startMin)
        return { id: b.id, mode, techId: orig.techId, startMin: orig.startMin, durationMin, moved }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setBlockDrag((d) => {
        if (d?.moved) {
          commitBlocks(dayBlocks.map((x) => (x.id === b.id ? { ...x, techId: d.techId, startMin: d.startMin, durationMin: d.durationMin } : x)))
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const saveBlock = (d: BlockDraft) => {
    if (!blockEdit) return
    const isNew = blockEdit.id === null
    if (isNew) {
      commitBlocks([...dayBlocks, { id: `b${Date.now()}`, techId: blockEdit.techId, startMin: d.startMin, durationMin: d.endMin - d.startMin, reason: d.reason }])
    } else {
      commitBlocks(dayBlocks.map((b) => (b.id === blockEdit.id ? { ...b, startMin: d.startMin, durationMin: d.endMin - d.startMin, reason: d.reason } : b)))
    }
    setBlockEdit(null)
    showFlash(isNew ? `✓ ${d.reason} blocked for ${techOf(blockEdit.techId).name}` : '✓ Block updated')
  }

  const openBooking = () => {
    setBookingPrefill(null)
    closeCheckout()
    setPosOpen(false)
    setBookingOpen(true)
  }

  const onBookFromPanel = (services: BookedService[], linkGroup: boolean) => {
    if (salonClosed) { showFlash(`⚠ Salon is closed on this day${salonHoliday?.label ? ` (${salonHoliday.label})` : ''}`); return }
    const group = linkGroup || services.length > 1 ? `pg${Date.now()}` : undefined
    // interval-aware assignment: two services may share a tech when back-to-back,
    // but never when their times overlap (parallel)
    const assigned: { techId: string; from: number; to: number }[] = []
    // "any available" → least-booked qualified tech (keeps the day balanced)
    const bookedCount = new Map<string, number>()
    for (const a of appts) bookedCount.set(a.techId, (bookedCount.get(a.techId) ?? 0) + 1)
    const newAppts: Appointment[] = []
    // non-requested appointments auto-moved to make room for tech-requested ones
    const relocated = new Map<string, Appointment>()
    // requested tech had no room even after relocation, needs the double-book prompt
    let forceDouble = false
    for (const [i, s] of services.entries()) {
      const svc = svcById[s.serviceId]
      const addonMins = (s.addons ?? []).reduce((m, a) => m + a.mins, 0)
      let dur = s.durationMin ?? svc.durationMin
      const from = s.startMin
      let to = from + dur
      if (from < salonOpenOff || to > salonCloseOff) { showFlash(`⚠ ${svc.name} would run outside salon hours`); return }
      let techId = s.techId
      // picked by name (not First available / gender pref / issue) — pinning
      // to a specific tech is what should clear squatters out of the way,
      // independent of whether the separate "Requested" flag was also set
      const pinned = techId !== 'first' && techId !== 'pref-female' && techId !== 'pref-male' && techId !== 'issue'
      if (techId === 'first' || techId === 'pref-female' || techId === 'pref-male' || techId === 'issue') {
        // exclude techs already assigned a same-time service in THIS booking,
        // so parallel services never land on one tech (back-to-back still can)
        const busy = new Set(assigned.filter((x) => overlaps(from, to, x.from, x.to)).map((x) => x.techId))
        const freePool = resolveChoice(techId, s.serviceId, from, to, undefined, busy)
        if (!freePool) { showFlash(`⚠ No tech free for ${svc.name} at ${fmtTime(from)}`); return }
        techId = freePool.id
      }
      const selfClash = assigned.some((x) => x.techId === techId && overlaps(from, to, x.from, x.to))
      if (selfClash) { showFlash(`⚠ ${techOf(techId).name} is busy at ${fmtTime(from)}`); return }
      const clash = appts.some((a) =>
        !relocated.has(a.id) && a.techId === techId && overlaps(from, to, a.startMin, a.startMin + a.durationMin))
      if (clash && (pinned || s.techRequested)) {
        // booked for THIS specific tech: move the non-requested booking out of her way
        const moved = autoRelocateNonRequested ? makeRoom(techId, from, to) : null
        if (moved) for (const m of moved) relocated.set(m.id, m)
        else forceDouble = true // feature off, or nowhere to move it — ask about double booking
      } else if (clash && !allowOverlap) {
        showFlash(`⚠ ${techOf(techId).name} is busy at ${fmtTime(from)}`)
        return
      }
      // her personal timing/rate applies unless the panel hand-set the duration
      const st = svcForTech(techId, s.serviceId)
      if (s.durationMin == null || s.durationMin === svc.durationMin + addonMins) {
        dur = st.durationMin + addonMins
        to = from + dur
      }
      assigned.push({ techId, from, to })
      bookedCount.set(techId, (bookedCount.get(techId) ?? 0) + 1)
      const addonNote = s.addons.length > 0 ? `Add-ons: ${s.addons.map((a) => a.name).join(', ')}` : undefined
      newAppts.push({
        id: `a${Date.now()}-${i}`,
        techId,
        clientName: s.clientName,
        serviceId: s.serviceId,
        startMin: s.startMin,
        durationMin: dur,
        priceOverride: st.price !== svc.price ? st.price : undefined,
        status: 'booked' as const,
        bookingSource: 'front_desk',
        notes: [s.notes, addonNote].filter(Boolean).join(' · ') || undefined,
        parallelGroup: group,
        guestOf: s.guestOf,
        addons: s.addons.length > 0 ? s.addons : undefined,
        issue: s.techId === 'issue' ? true : undefined,
        requestedTechChoice: s.techId === 'first' || s.techId === 'pref-female' || s.techId === 'pref-male' ? s.techId : undefined,
        techRequested: s.techRequested ?? (s.techId !== 'first' && s.techId !== 'pref-female' && s.techId !== 'pref-male' && s.techId !== 'issue' ? true : undefined),
        log: [logEntry(`Booked at ${fmtTime(s.startMin)} with ${techOf(techId).name}`)],
      })
    }
    const doBook = () => {
    commit([...appts.map((a) => relocated.get(a.id) ?? a), ...newAppts])
    // register name-only guests under the booking client's profile (deduped by name)
    const guestNamesByClient = new Map<string, Set<string>>()
    for (const svc of services) {
      if (!svc.guestOf) continue
      const set = guestNamesByClient.get(svc.guestOf) ?? new Set<string>()
      set.add(svc.clientName)
      guestNamesByClient.set(svc.guestOf, set)
    }
    if (guestNamesByClient.size > 0) {
      setClients((cs) => cs.map((c) => {
        const add = guestNamesByClient.get(c.id)
        if (!add) return c
        const have = new Set((c.guests ?? []).map((g) => g.name.toLowerCase()))
        const merged = [...(c.guests ?? [])]
        add.forEach((n) => {
          if (!have.has(n.toLowerCase())) merged.push({ id: `g${Date.now()}-${merged.length}`, name: n })
        })
        return merged.length === (c.guests ?? []).length ? c : { ...c, guests: merged }
      }))
    }
    setBookingOpen(false)
    const names = [...new Set(services.map((s) => s.clientName))].join(' & ')
    const movedNote = relocated.size > 0 ? `, moved ${relocated.size} booking${relocated.size > 1 ? 's' : ''} to make room` : ''
    showFlash(`✓ ${names} booked at ${fmtTime(services[0].startMin)}${movedNote}, confirmation sent`)
    addNotification({
      kind: 'booked',
      text: newAppts.length > 1 ? `${newAppts.length} appointments booked` : 'New appointment booked',
      detail: `${names} · ${fmtTime(services[0].startMin)}${movedNote}`,
      dateKey,
    })
    }
    // requested tech with no room to relocate, always ask before double booking
    if (forceDouble) {
      const hit = newAppts.find((n) =>
        appts.some((a) => !relocated.has(a.id) && a.techId === n.techId &&
          overlaps(n.startMin, n.startMin + n.durationMin, a.startMin, a.startMin + a.durationMin)))
      if (hit) {
        setPendingOverlap({ techId: hit.techId, timeLabel: fmtTime(hit.startMin), apply: doBook })
        return
      }
    }
    // double booking is enabled and this booking overlaps, warn before placing it
    if (allowOverlap && warnOnDoubleBook) {
      const hit = newAppts.find((n) =>
        appts.some((a) => !relocated.has(a.id) && a.techId === n.techId &&
          overlaps(n.startMin, n.startMin + n.durationMin, a.startMin, a.startMin + a.durationMin)) ||
        newAppts.some((m) => m !== n && m.techId === n.techId &&
          overlaps(n.startMin, n.startMin + n.durationMin, m.startMin, m.startMin + m.durationMin)))
      if (hit) {
        setPendingOverlap({ techId: hit.techId, timeLabel: fmtTime(hit.startMin), apply: doBook })
        return
      }
    }
    doBook()
  }

  // ── team schedule (per-day tech status/hours) ─────────────────────────────
  const setTechDay = (techId: string, patch: Partial<DaySchedule[string]>) =>
    setSchedules((m) => ({
      ...m,
      [dateKey]: {
        ...(m[dateKey] ?? {}),
        [techId]: { ...(m[dateKey]?.[techId] ?? { status: 'working' as const }), ...patch },
      },
    }))

  // ── checkout ──────────────────────────────────────────────────────────────
  // one ticket per client visit, or the whole party for linked groups.
  // 'completed' status alone doesn't mean paid — "Mark completed" sets it the
  // moment the service is done, before checkout ever runs, and checkout ALSO
  // sets it once payment goes through. The payments ledger is the only
  // reliable record of what's actually been paid for.
  const payable = (a: Appointment) =>
    a.status !== 'no_show' && a.status !== 'requested' && !payments.some((p) => p.apptIds?.includes(a.id))
  const checkoutItems = useMemo(() => {
    if (!checkoutName) return []
    const notRemoved = (a: Appointment) => !(checkoutDraft?.removedIds ?? []).includes(a.id)
    if (checkoutGroup) {
      // party tickets: whoever is selected, per person, from this group only
      const inGroup = appts.filter((a) => a.parallelGroup === checkoutGroup && payable(a) && notRemoved(a))
      return inGroup.filter((a) => checkoutSelected.has(a.clientName))
    }
    const client = clients.find((c) => c.name === checkoutName)
    return appts.filter((a) =>
      (a.clientName === checkoutName || (client != null && a.guestOf === client.id)) && payable(a) && notRemoved(a),
    )
  }, [checkoutName, checkoutSelected, checkoutGroup, appts, clients])

  // distinct people in the party, host first (drives the person chips)
  const checkoutPeople = useMemo(() => {
    if (!checkoutGroup) return checkoutName ? [checkoutName] : []
    const names = [...new Set(appts.filter((a) => a.parallelGroup === checkoutGroup && payable(a)).map((a) => a.clientName))]
    return names.sort((a, b) => (a === checkoutName ? -1 : b === checkoutName ? 1 : 0))
  }, [checkoutGroup, appts, checkoutName])

  const toggleCheckoutPerson = (name: string) =>
    setCheckoutSelected((s) => {
      // never empty the ticket — one person must stay on it
      if (s.size === 1 && s.has(name)) return s
      const n = new Set(s)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })

  const openCheckout = (a: Appointment, groupOverride?: Appointment[]) => {
    setDetailId(null)
    setBookingOpen(false) // right-side panels are exclusive, never stack
    setPosOpen(false)
    // groupOverride lets a caller pass an already-resolved group (e.g. the
    // edit panel, whose day rail may have navigated the live calendar away
    // from this appointment's own day within this same synchronous call)
    // instead of re-deriving it from `appts`, which might not be it yet
    const source = groupOverride ?? appts
    const people = a.parallelGroup
      ? [...new Set(source.filter((x) => x.parallelGroup === a.parallelGroup && payable(x)).map((x) => x.clientName))]
      : []
    const name = a.parallelGroup
      ? a.clientName
      : a.guestOf
        ? clients.find((c) => c.id === a.guestOf)?.name ?? a.clientName
        : a.clientName
    setCheckoutGroup(a.parallelGroup ?? null)
    setCheckoutGuestOf(a.parallelGroup ? a.guestOf ?? null : null)
    setCheckoutName(name)
    // resume the saved draft for this client, or start a fresh one
    const resume = checkoutDraft && checkoutDraft.name === name && checkoutDraft.groupId === (a.parallelGroup ?? null) ? checkoutDraft : null
    if (resume) {
      setCheckoutSelected(new Set(resume.selected))
    } else {
      setCheckoutSelected(new Set(people.length > 0 ? people : [name]))
      setCheckoutDraft({
        name, groupId: a.parallelGroup ?? null,
        selected: people.length > 0 ? people : [name],
        removedIds: [], addedIds: [],
        tipPct: 18, tipCustom: '', method: 'Cash', note: '', redeemId: null, tipByTech: undefined,
      })
    }
  }

  const closeCheckout = () => {
    setCheckoutName(null)
    setCheckoutGroup(null)
    setCheckoutSelected(new Set())
    setCheckoutGuestOf(null)
  }

  const completeCheckout = (p: PaymentResult) => {
    const ids = new Set(checkoutItems.map((a) => a.id))
    // everything else (service, tech, time, price, adds) is already live on the book
    commit(appts.map((a) => (ids.has(a.id)
      ? {
          ...a, status: 'completed' as const,
          log: [...(a.log ?? []), logEntry(`Checked out, $${p.total.toFixed(2)} (${p.method})`)],
        }
      : a)))
    const party = new Set(checkoutItems.map((a) => a.clientName))
    const payLines = checkoutItems
      .map((a) => ({
        techId: a.techId,
        price: (a.priceOverride ?? svcById[a.serviceId]?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0),
      }))
      .filter((l) => l.techId !== '')
    setPayments((x) => [...x, {
      id: `pay${Date.now()}`, dateKey, clientName: checkoutName!, itemCount: ids.size,
      party: party.size > 1 ? party.size : undefined, lines: payLines, apptIds: [...ids], ...p,
    }])
    // every account holder on the ticket gets a visit
    setClients((cs) => cs.map((c) => (party.has(c.name) ? { ...c, visits: c.visits + 1 } : c)))
    // loyalty: deduct redeemed points, then award what this ticket earned
    const host = clients.find((c) => c.name === checkoutName)
    if (host) {
      setPointsByClient((m) => ({ ...m, [host.id]: Math.max(0, (m[host.id] ?? 0) - (p.redeemed?.points ?? 0) + p.points) }))
    }
    showFlash(party.size > 1
      ? `✓ Party of ${party.size} checked out together, $${p.total.toFixed(2)} (${p.method})`
      : `✓ ${checkoutName} checked out, $${p.total.toFixed(2)} (${p.method})`)
    addNotification({
      kind: 'checked_out',
      text: party.size > 1 ? `Party of ${party.size} checked out` : 'Client checked out',
      detail: `${checkoutName} · $${p.total.toFixed(2)} (${p.method})`,
      dateKey,
    })
    setCheckoutDraft(null) // ticket closed, draft can go
    closeCheckout()
  }

  // POS sale, no appointments touched, just the payment record
  const completePos = (r: { method: string; tip: number; subtotal: number; total: number; points: number; discount?: number; redeemed?: { name: string; points: number; value: number }; clientName: string; itemCount: number; lines?: { techId: string; price: number }[]; tipByTech?: { techId: string; amount: number }[] }) => {
    setPayments((x) => [...x, {
      id: `pay${Date.now()}`, dateKey, clientName: r.clientName, itemCount: r.itemCount,
      subtotal: r.subtotal, tip: r.tip, total: r.total, method: r.method, points: r.points, pos: true,
      lines: r.lines?.filter((l) => l.techId !== ''),
      tipByTech: r.tipByTech,
    }])
    setClients((cs) => cs.map((c) => (c.name === r.clientName ? { ...c, visits: c.visits + 1 } : c)))
    const posClient = clients.find((c) => c.name === r.clientName)
    if (posClient) {
      setPointsByClient((m) => ({ ...m, [posClient.id]: Math.max(0, (m[posClient.id] ?? 0) - (r.redeemed?.points ?? 0) + r.points) }))
    }
    showFlash(`✓ POS sale, $${r.total.toFixed(2)} (${r.method})`)
    setPosOpen(false)
  }

  // opening the editor dismisses booking, POS, and checkout — panels are exclusive
  const openDetail = (id: string) => {
    setDetailError(null)
    setDetailId(id)
    // the day this appointment actually lives on, fixed for the life of the
    // panel even while its day rail browses the calendar to other days
    setDetailOriginDay(dateKey)
    setBookingOpen(false)
    setPosOpen(false)
    closeCheckout()
  }

  // ── context menu actions ──────────────────────────────────────────────────
  const setStatus = (a: Appointment, status: Appointment['status'], msg: string) => {
    // confirm, check-in, start, complete, and undo all apply to every service
    // in THIS booking (a multi-service visit shares a parallelGroup, so e.g.
    // mani+pedi booked together check in as one unit) — but never sweep in a
    // client's OTHER, unrelated appointments elsewhere on the day just
    // because the name matches; party members move individually
    const targets = a.parallelGroup
      ? appts.filter((x) => x.parallelGroup === a.parallelGroup && x.clientName === a.clientName)
      : [a]
    const ids = new Set(targets.map((t) => t.id))
    commit(appts.map((x) => (ids.has(x.id)
      ? {
          ...x,
          status,
          checkedInMin: status === 'checked_in' ? DEMO_NOW_MIN : status === 'confirmed' || status === 'booked' ? undefined : x.checkedInMin,
          startedMin: status === 'in_service' ? DEMO_NOW_MIN : status === 'checked_in' ? undefined : x.startedMin,
          completedMin: status === 'completed' ? DEMO_NOW_MIN : x.completedMin,
          log: [...(x.log ?? []), logEntry(STATUS_LOG[status] ?? `Status set to ${status}`)],
        }
      : x)))
    showFlash(targets.length > 1 ? `${msg} (${targets.length} services)` : msg)
  }

  // one clipboard entry per service, recopying replaces instead of stacking duplicates
  const copyServiceToClipboard = (a: Appointment, quiet = false) => {
    const item: ClipItem = {
      id: `clip-${a.id}`,
      clientName: a.clientName,
      services: [{ serviceId: a.serviceId, durationMin: a.durationMin, techId: a.techId, notes: a.notes, requestedTechChoice: a.requestedTechChoice, techRequested: a.techRequested, bookingSource: a.bookingSource }],
      isPair: false,
      sourceApptId: a.id,
    }
    setClipboard((c) => [...c.filter((x) => x.sourceApptId !== a.id), item])
    if (!quiet) showFlash(`⧉ ${a.clientName}, ${svcById[a.serviceId].short} on the clipboard, drag it onto any day`)
  }

  const copyToClipboard = (a: Appointment) => {
    const group = a.parallelGroup ? appts.filter((x) => x.parallelGroup === a.parallelGroup) : [a]
    group.forEach((g) => copyServiceToClipboard(g, true))
    showFlash(group.length > 1
      ? `⧉ ${group.length} services on the clipboard as separate entries, drag each one in`
      : `⧉ Copied ${a.clientName}, switch days and drag it in`)
  }

  const onMenuAction = (action: MenuAction) => {
    const a = appts.find((x) => x.id === menu!.apptId)
    setMenu(null)
    if (!a) return
    switch (action) {
      case 'edit': openDetail(a.id); break
      case 'log': setLogApptId(a.id); break
      case 'confirm': setStatus(a, 'confirmed', '✓ Confirmed, client notified by SMS'); break
      case 'checkin': setStatus(a, 'checked_in', `✓ ${a.clientName} checked in`); break
      case 'start': setStatus(a, 'in_service', '▶ Service started'); break
      case 'complete': setStatus(a, 'completed', '✓ Completed, ready for checkout'); break
      case 'checkout': {
        const payableNow = appts.some((x) =>
          (x.clientName === a.clientName || (a.guestOf && x.guestOf === a.guestOf) || (a.parallelGroup && x.parallelGroup === a.parallelGroup)) &&
          payable(x))
        if (!payableNow) { showFlash('Already checked out, right-click and choose View invoice / Print'); break }
        openCheckout(a)
        break
      }
      case 'backtocheckin': setStatus(a, 'checked_in', `Back to checked in, ${a.clientName}`); break
      case 'backtoconfirmed': setStatus(a, 'confirmed', `Back to confirmed, ${a.clientName}`); break
      case 'invoice': {
        const host = a.guestOf ? clients.find((c) => c.id === a.guestOf)?.name ?? a.clientName : a.clientName
        const payment = payments.find((p) => p.apptIds?.includes(a.id))
          ?? [...payments].reverse().find((p) => p.clientName === host && p.dateKey === dateKey)
        if (!payment) { showFlash('No payment recorded for this appointment'); break }
        const items = payment.apptIds
          ? appts.filter((x) => payment.apptIds!.includes(x.id))
          : [a]
        setMenu(null)
        setInvoicePayment({ payment, items: items.length > 0 ? items : [a] })
        break
      }
      case 'noshow':
        setStatus(a, 'no_show', `Marked no-show, ${a.clientName}`)
        addNotification({ kind: 'no_show', text: 'Client no-showed', detail: `${a.clientName} · ${fmtTime(a.startMin)}`, dateKey, apptId: a.id })
        break
      case 'cancel':
        setCancelPromptId(a.id) // confirmation happens in the dialog
        break
      case 'copy': copyToClipboard(a); break
    }
  }

  // ── appointment detail panel ──────────────────────────────────────────────
  // sourced from the appointment's OWN day (detailOriginDay), not the live
  // `appts`/dateKey — the panel's day rail can navigate the live calendar to
  // preview other days while it's open, and the panel itself must stay put
  const detailBoard = dayApptsFor(detailOriginDay ?? dateKey)
  const detailAppt = detailId ? detailBoard.find((a) => a.id === detailId) : undefined
  const detailGroup = detailAppt
    ? detailAppt.parallelGroup
      ? detailBoard.filter((a) => a.parallelGroup === detailAppt.parallelGroup)
      : [detailAppt]
    : []

  const saveDetail = (updated: Appointment[], removedIds: string[], moveToDayKey?: string) => {
    // the edit panel's day rail actually navigates the live calendar as the
    // salon browses (so they can see the board), so moveToDayKey — when set
    // — always equals the CURRENT live day; that means the whole pinned-tech
    // relocation / gender-mismatch / overlap pipeline below can run exactly
    // as it does for a same-day edit (it already targets `appts`, i.e.
    // "whichever day is live"), and a cross-day move only additionally needs
    // to drop the appointment's old copy from the day it used to live on
    const originDay = detailOriginDay ?? dateKey
    const originBoard = dayApptsFor(originDay)
    const crossDay = !!moveToDayKey && moveToDayKey !== originDay

    // a service is "pinned" when the form has it set to an actual tech by
    // name, as opposed to First available / gender preference / issue — this
    // is what should trigger auto-relocation below, independent of whether
    // the separate "Request: Requested" flag was also flipped, since picking
    // someone by name IS asking for that specific tech
    const pinnedIds = new Set(
      updated
        .filter((u) => !removedIds.includes(u.id) &&
          u.techId !== 'first' && u.techId !== 'pref-female' && u.techId !== 'pref-male' && u.techId !== 'issue')
        .map((u) => u.id),
    )
    const keep = updated.filter((u) => !removedIds.includes(u.id)).map((u) => {
      if (u.techId === 'first' || u.techId === 'pref-female' || u.techId === 'pref-male' || u.techId === 'issue') {
        const resolved = resolveChoice(u.techId, u.serviceId, u.startMin, u.startMin + u.durationMin, u.id)
        return {
          ...u,
          techId: resolved?.id ?? u.techId,
          issue: u.techId === 'issue' ? true : undefined,
          techRequested: undefined, // an auto-assigned choice isn't a by-name request
          requestedTechChoice: u.techId === 'pref-female' || u.techId === 'pref-male' ? (u.techId as 'pref-female' | 'pref-male') : undefined,
          log: [...(u.log ?? []), logEntry(`Edited, auto-assigned to ${techOf(resolved?.id ?? u.techId).name}`)],
        }
      }
      // a specific tech clears the flag
      return { ...u, issue: undefined, log: [...(u.log ?? []), logEntry('Edited appointment details')] }
    }).map((u) => {
      // the Status dropdown can change status right here in the edit panel —
      // stamp the same checked-in/started/completed timestamps setStatus()
      // would, but only on an actual transition, not every unrelated save.
      // Compare against originBoard (the appointment's own day), not `appts`
      // (the live/target day), since those differ for a cross-day move
      const orig = originBoard.find((a) => a.id === u.id)
      if (!orig || orig.status === u.status) return u
      return {
        ...u,
        checkedInMin: u.status === 'checked_in' ? DEMO_NOW_MIN : u.status === 'confirmed' || u.status === 'booked' ? undefined : u.checkedInMin,
        startedMin: u.status === 'in_service' ? DEMO_NOW_MIN : u.status === 'checked_in' ? undefined : u.startedMin,
        completedMin: u.status === 'completed' ? DEMO_NOW_MIN : u.completedMin,
        log: [...(u.log ?? []), logEntry(STATUS_LOG[u.status] ?? `Status set to ${u.status}`)],
      }
    })
    const moving: MovingItem[] = keep.map((u) => ({
      id: u.id, techId: u.techId, startMin: u.startMin, durationMin: u.durationMin, serviceId: u.serviceId,
    }))

    // a service was pinned to a specific tech by name in the edit form: move
    // any non-requested appointment out of her way, same as booking or
    // approving a tech-requested service does
    const keepIds = new Set(keep.map((u) => u.id))
    const ignoreIds = new Set([...keepIds, ...removedIds])
    const relocated = new Map<string, Appointment>()
    for (const u of keep) {
      if (!pinnedIds.has(u.id)) continue
      const clash = appts.some((a) =>
        !ignoreIds.has(a.id) && !relocated.has(a.id) && a.techId === u.techId &&
        overlaps(u.startMin, u.startMin + u.durationMin, a.startMin, a.startMin + a.durationMin))
      if (!clash) continue
      const moved = autoRelocateNonRequested ? makeRoom(u.techId, u.startMin, u.startMin + u.durationMin, ignoreIds) : null
      // null means the feature is off, the squatter is itself requested, or
      // nobody qualified is free — fall through to the usual double-book
      // prompt / overlap error below
      if (moved) for (const m of moved) relocated.set(m.id, m)
    }

    const err = [...checkMove(moving, new Set(relocated.keys())).values()].find(Boolean)
    if (err) { setDetailError(err); return }
    const doSave = (finalKeep: Appointment[] = keep) => {
      const byId = new Map(finalKeep.map((u) => [u.id, u]))
      if (crossDay) {
        // finalKeep's ids live on originDay, not today's board — drop them
        // from there and append them (already resolved above against the
        // live day) onto today, alongside any relocated squatters
        setApptDays((m) => ({
          ...m,
          [originDay]: (m[originDay] ?? originBoard).filter((a) => !byId.has(a.id) && !removedIds.includes(a.id)),
        }))
        commit([
          ...appts.filter((a) => !removedIds.includes(a.id)).map((a) => relocated.get(a.id) ?? a),
          ...finalKeep,
        ])
        setDetailId(null)
        showFlash(
          relocated.size > 0
            ? `✓ Moved to ${dayLabel(date)}, moved ${relocated.size} booking${relocated.size > 1 ? 's' : ''} to make room`
            : `✓ Moved to ${dayLabel(date)}`)
        return
      }
      commit(appts
        .filter((a) => !removedIds.includes(a.id))
        .map((a) => byId.get(a.id) ?? relocated.get(a.id) ?? a))
      setDetailId(null)
      showFlash(
        relocated.size > 0
          ? `✓ Appointment updated, moved ${relocated.size} booking${relocated.size > 1 ? 's' : ''} to make room`
          : finalKeep.some((u) => u.issue) ? '⚠ Marked as issue, assigned to an available tech' : '✓ Appointment updated')
    }
    const afterGenderCheck = (finalKeep: Appointment[] = keep) => {
      // double-booking is enabled, warn before saving one (only for clashes we
      // couldn't clear a path for above)
      if (allowOverlap) {
        const hit = finalKeep.find((u) =>
          appts.some((a) =>
            !keepIds.has(a.id) && !removedIds.includes(a.id) && !relocated.has(a.id) && a.techId === u.techId &&
            overlaps(u.startMin, u.startMin + u.durationMin, a.startMin, a.startMin + a.durationMin)))
        if (hit) {
          setPendingOverlap({ techId: hit.techId, timeLabel: fmtTime(hit.startMin), apply: () => doSave(finalKeep) })
          return
        }
      }
      doSave(finalKeep)
    }
    // reassigning a gender-preferred service to a tech of the other gender always confirms first —
    // unless the salon already okayed a gender mismatch for this exact appointment before
    const genderMismatch = keep.find((u) => {
      const pref = u.requestedTechChoice
      if (pref !== 'pref-female' && pref !== 'pref-male') return false
      if (u.genderMismatchOk) return false
      const orig = originBoard.find((a) => a.id === u.id)
      if (!orig || orig.techId === u.techId) return false
      const wantGender = pref === 'pref-female' ? 'female' : 'male'
      return techOf(u.techId).gender !== wantGender
    })
    if (genderMismatch) {
      setPendingGenderMismatch({
        pref: genderMismatch.requestedTechChoice === 'pref-female' ? 'female' : 'male',
        toName: techOf(genderMismatch.techId).name,
        clientName: genderMismatch.clientName,
        apply: () => afterGenderCheck(keep.map((u) => (u.id === genderMismatch.id ? { ...u, genderMismatchOk: true } : u))),
      })
      return
    }
    afterGenderCheck()
  }

  const onDetailAction = (action: DetailAction) => {
    const a = detailAppt
    if (!a) return
    const originKey = detailOriginDay ?? dateKey
    // the edit panel's day rail may have navigated the live calendar away
    // from this appointment's own day (to preview another day) — snap back
    // before any follow-up flow that reads the live board (cancel confirm,
    // checkout, the log modal all resolve their target by id against `appts`
    // on a later render, so this restores it in time for them)
    if (originKey !== dateKey) goDay(new Date(originKey + 'T12:00:00'))
    switch (action) {
      case 'checkout':
        // pass detailGroup explicitly — it's already resolved against the
        // appointment's own day, whereas `appts` may not have caught up to
        // the goDay() above yet within this same synchronous handler
        openCheckout(a, detailGroup)
        break
      case 'copy':
        detailGroup.forEach((g) => copyServiceToClipboard(g, true))
        showFlash(detailGroup.length > 1
          ? `⧉ ${detailGroup.length} services on the clipboard as separate entries, drag each one in`
          : `⧉ Copied ${a.clientName}, switch days and drag it in`)
        // close the edit panel so the salon can switch days and drop it in
        setDetailId(null)
        break
      case 'sendtext':
        showFlash(`✉ Text sent to ${a.clientName}`)
        break
      case 'log':
        setLogApptId(a.id)
        break
      case 'cancel': {
        setDetailId(null)
        setCancelPromptId(a.id) // confirmation happens in the dialog
        break
      }
      case 'rebook': {
        const originDate = new Date(originKey + 'T12:00:00')
        const target = new Date(originDate.getFullYear(), originDate.getMonth(), originDate.getDate() + 7)
        const key = dayKey(target)
        const newGroup = a.parallelGroup ? `pg${Date.now()}` : undefined
        setApptDays((m) => ({
          ...m,
          [key]: [...(m[key] ?? generateDay(key)), ...detailGroup.map((g, i) => ({
            ...g, id: `a${Date.now()}-${i}`, status: 'confirmed' as const, parallelGroup: newGroup,
          }))],
        }))
        setDetailId(null)
        showFlash(`✓ Rebooked to ${dayLabel(target)}, jump there with ◀ ▶ to see it`)
        break
      }
    }
  }

  // ── cancel confirmation ────────────────────────────────────────────────────
  const cancelAppt = cancelPromptId ? appts.find((a) => a.id === cancelPromptId) : undefined
  const cancelGroup = cancelAppt?.parallelGroup
    ? appts.filter((a) => a.parallelGroup === cancelAppt.parallelGroup)
    : cancelAppt ? [cancelAppt] : []

  const recordCancellations = (group: Appointment[]) => {
    if (group.length === 0) return
    const now = Date.now()
    setCancellations((x) => [...x, ...group.map((g) => ({
      id: `cx${now}-${g.id}`, apptId: g.id, dateKey, clientName: g.clientName,
      serviceId: g.serviceId, techId: g.techId, startMin: g.startMin, durationMin: g.durationMin,
      bookedAt: g.log?.[0]?.at, cancelledAt: now, groupSize: group.length,
    }))])
    const names = [...new Set(group.map((g) => g.clientName))]
    addNotification({
      kind: 'cancelled',
      text: group.length > 1 ? `${group.length} services cancelled` : 'Appointment cancelled',
      detail: `${names.join(' & ')} · ${fmtTime(group[0].startMin)}`,
      dateKey,
      apptId: group[0].id,
    })
  }

  // ── turnaways ──────────────────────────────────────────────────────────────
  const logTurnaway = (d: TurnawayDraft) => {
    // safety net for the dialog being left open across a day rollover — the
    // toolbar button is disabled outside today, but a stale open dialog could
    // still call this, and you can't turn away someone in the past or future
    if (!canLogTurnaway) {
      setTurnawayOpen(false)
      showFlash(`⚠ That was for a different day, turnaways can only be logged for today`)
      return
    }
    setTurnaways((x) => [...x, { id: `tw${Date.now()}`, dateKey, loggedAt: Date.now(), ...d }])
    setTurnawayOpen(false)
    const named = d.guests.map((g) => g.name).filter((n): n is string => !!n)
    const who = named.length > 0 ? named.join(', ') : d.guests.length > 1 ? `a party of ${d.guests.length}` : 'a walk-in'
    // the new record always belongs to turnawaysToday (both scoped to dateKey)
    showFlash(`Logged turnaway for ${who} · ${turnawaysToday.length + 1} ${turnawayDayLabel} at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
    const reasonLabel = d.reason === 'no_availability' ? 'No availability'
      : d.reason === 'price' ? 'Price'
      : d.reason === 'didnt_like_options' ? "Didn't like the options"
      : 'Other'
    addNotification({
      kind: 'turnaway',
      text: 'Turnaway logged',
      detail: `${who} · ${reasonLabel}`,
      dateKey,
    })
  }
  const doCancelOne = () => {
    if (cancelAppt) recordCancellations([cancelAppt])
    commit(appts.filter((x) => x.id !== cancelPromptId))
    setCancelPromptId(null)
    showFlash('Appointment cancelled, client notified by SMS')
  }
  const doCancelGroup = () => {
    const ids = new Set(cancelGroup.map((g) => g.id))
    recordCancellations(cancelGroup)
    commit(appts.filter((x) => !ids.has(x.id)))
    setCancelPromptId(null)
    showFlash(`Group cancelled (${cancelGroup.length} services), client notified by SMS`)
  }

  // ── client profile ────────────────────────────────────────────────────────
  const profileClient = profileName
    ? clients.find((c) => c.name === profileName) ?? { id: 'guest', name: profileName, phone: '(555) 000-0000', visits: 0 }
    : null

  const openProfile = (name: string) => {
    setProfileName(name)
  }

  // every visit by a name-only guest of this client, newest first
  const guestVisits = useMemo(() => {
    if (!profileClient) return []
    const out: { dateKey: string; appt: Appointment }[] = []
    const seen = new Set<string>()
    const push = (dk: string, list: Appointment[]) => {
      for (const a of list) {
        if (a.guestOf === profileClient.id && !seen.has(a.id)) {
          seen.add(a.id)
          out.push({ dateKey: dk, appt: a })
        }
      }
    }
    Object.entries(apptDays).forEach(([dk, list]) => push(dk, list))
    push(dateKey, appts)
    return out.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.appt.startMin - a.appt.startMin)
  }, [profileClient, apptDays, appts, dateKey])

  const addClientNote = (text: string) => {
    if (!profileClient) return
    const note: ClientNote = {
      id: `n${Date.now()}`,
      text,
      when: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      by: 'Front desk',
    }
    setNotesByClient((m) => ({ ...m, [profileClient.name]: [note, ...(m[profileClient.name] ?? [])] }))
  }

  const deleteClientNote = (id: string) => {
    if (!profileClient) return
    setNotesByClient((m) => ({ ...m, [profileClient.name]: (m[profileClient.name] ?? []).filter((n) => n.id !== id) }))
  }

  const saveClientProfile = (patch: Partial<ClientRecord>) => {
    if (!profileClient) return
    setClients((xs) => {
      // rename everywhere if the name changed
      if (patch.name && patch.name !== profileClient.name) {
        setAppts((cur) => cur.map((a) => (a.clientName === profileClient.name ? { ...a, clientName: patch.name! } : a)))
        setProfileName(patch.name)
      }
      const exists = xs.some((c) => c.id === profileClient.id)
      return exists
        ? xs.map((c) => (c.id === profileClient.id ? { ...c, ...patch } : c))
        : [...xs, { ...profileClient, ...patch }]
    })
    showFlash('✓ Guest profile saved')
  }

  // ── requests approval ─────────────────────────────────────────────────────
  // ── requests rail actions ──────────────────────────────────────────────────
  const approveRequest = (id: string) => {
    const req = appts.find((a) => a.id === id)
    if (!req) return
    const linked = req.parallelGroup
      ? appts.filter((a) => a.parallelGroup === req.parallelGroup && a.status === 'requested')
      : [req]
    const ids = new Set(linked.map((a) => a.id))
    // try to place every service at the requested time: the requested tech when
    // one was picked, otherwise the least-booked qualifying tech (any / pref)
    const assigned: { techId: string; from: number; to: number }[] = []
    const placed: Appointment[] = []
    const relocated = new Map<string, Appointment>()
    for (const r of linked) {
      const from = r.startMin
      const to = from + r.durationMin
      const busy = new Set(assigned.filter((x) => overlaps(from, to, x.from, x.to)).map((x) => x.techId))
      const isFree = (tid: string) =>
        withinShift(tid, from, to) &&
        !busy.has(tid) &&
        !appts.some((a) => !ids.has(a.id) && !relocated.has(a.id) && a.techId === tid && overlaps(from, to, a.startMin, a.startMin + a.durationMin)) &&
        !blocksRef.current.some((b) => b.techId === tid && overlaps(from, to, b.startMin, b.startMin + b.durationMin))
      let techId: string | null = null
      if (r.requestedTechChoice) {
        // any technician / female preferred / male preferred
        techId = resolveChoice(r.requestedTechChoice, r.serviceId, from, to, ids, busy)?.id ?? null
      } else if (r.techId) {
        if (isFree(r.techId)) {
          techId = r.techId // specific requested tech is open at the requested time
        } else {
          // requested tech is taken: move the non-requested booking out of her way
          const moved = autoRelocateNonRequested ? makeRoom(r.techId, from, to, ids) : null
          if (moved && !busy.has(r.techId) && withinShift(r.techId, from, to) &&
            !blocksRef.current.some((b) => b.techId === r.techId && overlaps(from, to, b.startMin, b.startMin + b.durationMin))) {
            for (const m of moved) relocated.set(m.id, m)
            techId = r.techId
          }
        }
      }
      if (!techId) break // requested time is not available, send to the drag queue
      assigned.push({ techId, from, to })
      placed.push({
        ...r, techId, status: 'confirmed' as const,
        log: [...(r.log ?? []), logEntry(`Approved and booked at ${fmtTime(from)} with ${techOf(techId).name}`)],
      })
    }
    if (placed.length === linked.length) {
      commit([...appts.filter((a) => !ids.has(a.id)).map((a) => relocated.get(a.id) ?? a), ...placed])
      const movedNote = relocated.size > 0 ? `, moved ${relocated.size} booking${relocated.size > 1 ? 's' : ''} to make room` : ''
      showFlash(`✓ Approved and booked at ${fmtTime(req.startMin)}${movedNote}, client notified`)
      addNotification({
        kind: 'online_approved',
        text: 'Online request approved',
        detail: `${req.clientName} · ${fmtTime(req.startMin)}${movedNote}`,
        dateKey,
        apptId: req.id,
      })
      return
    }
    // requested time unavailable, keep the manual drag-onto-calendar flow
    commit(appts.filter((a) => !ids.has(a.id)))
    setApproved((x) => [...x, {
      id: `ap${Date.now()}`,
      clientName: req.clientName,
      services: linked.map((a) => ({ serviceId: a.serviceId, durationMin: a.durationMin, notes: a.notes })),
      isPair: linked.length > 1,
      notes: req.notes,
      requestedStartMin: req.startMin,
      requestedTechId: req.techId,
    }])
    showFlash(`✓ Approved, ${fmtTime(req.startMin)} is taken, drag ${req.clientName}'s booking onto the calendar`)
    addNotification({
      kind: 'online_approved',
      text: 'Online request approved',
      detail: `${req.clientName} · requested ${fmtTime(req.startMin)}, needs placement`,
      dateKey,
    })
  }
  const declineRequest = (id: string) => {
    const req = appts.find((a) => a.id === id)
    if (!req) return
    const linked = req.parallelGroup
      ? appts.filter((a) => a.parallelGroup === req.parallelGroup && a.status === 'requested')
      : [req]
    const ids = new Set(linked.map((a) => a.id))
    commit(appts.filter((a) => !ids.has(a.id)))
    showFlash('Request declined, client notified')
    addNotification({
      kind: 'online_declined',
      text: 'Online request declined',
      detail: `${req.clientName} · requested ${fmtTime(req.startMin)}`,
      dateKey,
    })
  }
  const proposeRequest = (id: string, startMin: number) => {
    commit(appts.map((a) => (a.id === id ? { ...a, startMin, status: 'confirmed' as const } : a)))
    showFlash(`✓ Proposal sent for ${fmtTime(startMin)}, client confirmed`)
  }

  // ── queue tabs: waitlist (self-serve) + walk-ins ──────────────────────────
  const addWaitlist = (entry: Omit<QueueEntry, 'id' | 'createdMin'>) => {
    setWaitlist((w) => [...w, { ...entry, id: `w${Date.now()}`, createdMin: DEMO_NOW_MIN }])
    showFlash(`✓ ${entry.name} joined the online waitlist`)
    addNotification({ kind: 'waitlist_joined', text: 'Client joined the waitlist', detail: entry.name, dateKey })
  }
  const addWalkinGroup = (guests: WalkInGuest[]) => {
    setWalkins((w) => [...w, { id: `k${Date.now()}`, guests, createdMin: DEMO_NOW_MIN }])
    showFlash(`✓ ${guests.map((g) => g.name).join(' & ')} added to walk-ins`)
  }
  const removeQueue = (kind: 'waitlist' | 'walkin', id: string) => {
    if (kind === 'waitlist') setWaitlist((w) => w.filter((x) => x.id !== id))
    else setWalkins((w) => w.filter((x) => x.id !== id))
  }

  // one service placed from a walk-in group, peel it off; empty guests/groups dissolve
  const removeWalkinService = (groupId: string, guestName: string, serviceId: string) => {
    setWalkins((w) =>
      w
        .map((g) =>
          g.id === groupId
            ? {
                ...g,
                guests: g.guests
                  .map((x) => (x.name === guestName ? { ...x, serviceIds: x.serviceIds.filter((s) => s !== serviceId) } : x))
                  .filter((x) => x.serviceIds.length > 0),
              }
            : g,
        )
        .filter((g) => g.guests.length > 0),
    )
  }

  // least-booked qualified tech free at [startMin, startMin+dur), skipping `used`
  const pickLeastBooked = useCallback((serviceId: string, startMin: number, dur: number, used: { techId: string; from: number; to: number }[], apptList: Appointment[] = appts) =>
    boardTechs(getStaff().techs).filter(
      (t) => t.skills.includes(serviceId) &&
        withinShift(t.id, startMin, startMin + dur) &&
        !used.some((u) => u.techId === t.id && overlaps(startMin, startMin + dur, u.from, u.to)) &&
        !apptList.some((a) => a.techId === t.id && overlaps(startMin, startMin + dur, a.startMin, a.startMin + a.durationMin)) &&
        !blocksRef.current.some((b) => b.techId === t.id && overlaps(startMin, startMin + dur, b.startMin, b.startMin + b.durationMin)),
    ).sort((a, b) => (apptCountByTech.get(a.id) ?? 0) - (apptCountByTech.get(b.id) ?? 0))[0],
  [appts, apptCountByTech])

  const onDragWaitlistEntry = (e: React.PointerEvent, entry: QueueEntry) => {
    const svc = svcById[entry.serviceId]
    const fallback = pickLeastBooked(svc.id, entry.createdMin, svc.durationMin, [])
    const clip: ClipItem = {
      id: `q-waitlist-${entry.id}`,
      clientName: entry.name,
      services: [{ serviceId: svc.id, durationMin: svc.durationMin, techId: entry.preferredTechId ?? fallback?.id ?? techs[0]?.id ?? '', notes: entry.notes, techRequested: entry.preferredTechId != null ? true : undefined }],
      isPair: false,
      source: { kind: 'waitlist', id: entry.id },
    }
    startClipDrag(e, clip)
  }

  const onDragApproved = (e: React.PointerEvent, item: ApprovedItem) => {
    const clip: ClipItem = {
      id: `q-approved-${item.id}`,
      clientName: item.clientName,
      services: item.services.map((s) => {
        const fallback = pickLeastBooked(s.serviceId, DEMO_NOW_MIN, s.durationMin, [])
        return { serviceId: s.serviceId, durationMin: s.durationMin, techId: fallback?.id ?? techs[0]?.id ?? '', notes: s.notes }
      }),
      isPair: item.isPair,
      source: { kind: 'approved', id: item.id },
    }
    startClipDrag(e, clip)
  }

  const onDragWalkinService = (e: React.PointerEvent, group: WalkInGroup, guestName: string, serviceId: string) => {
    const svc = svcById[serviceId]
    const fallback = pickLeastBooked(svc.id, group.createdMin, svc.durationMin, [])
    const clip: ClipItem = {
      id: `q-walkin-${group.id}-${guestName}-${serviceId}`,
      clientName: guestName,
      services: [{ serviceId: svc.id, durationMin: svc.durationMin, techId: fallback?.id ?? techs[0]?.id ?? '', clientName: guestName }],
      isPair: false,
      source: { kind: 'walkin', id: group.id, guestName, serviceId },
    }
    startClipDrag(e, clip)
  }

  // ── jump to tech ──────────────────────────────────────────────────────────
  const scrollToTech = (techId: string) => {
    const tech = techOf(techId)
    const nextCollapsed = new Set(collapsed)
    nextCollapsed.delete(tech.teamId)
    const nextHidden = new Set(hiddenTeams)
    nextHidden.delete(tech.teamId)
    setCollapsed(nextCollapsed)
    setHiddenTeams(nextHidden)
    setTechQuery('') // a filtered-out tech can't be jumped to, clear the filter
    let idx = 0
    outer: for (const role of roles) {
      if (nextHidden.has(role.id)) continue
      if (nextCollapsed.has(role.id)) { idx++; continue }
      for (const t of techs.filter((x) => x.teamId === role.id).sort((a, b) => a.name.localeCompare(b.name))) {
        if (t.id === techId) break outer
        idx++
      }
    }
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        left: Math.max(0, idx * cw - viewW / 2 + cw / 2),
        behavior: 'smooth',
      })
    })
  }

  const toggleTeam = (teamId: string) =>
    setCollapsed((s) => { const n = new Set(s); n.has(teamId) ? n.delete(teamId) : n.add(teamId); return n })

  // ── render helpers ────────────────────────────────────────────────────────
  const renderCard = (a: Appointment) => {
    if (a.startMin < 0 || a.startMin >= DAY_MIN) return null // never render outside salon hours
    const svc = svcById[a.serviceId]
    const cat = catById[svc.categoryId]
    const top = GROUP_H + TECH_H + yAt(a.startMin)
    const h = Math.max(8, a.durationMin * pxPerMin - 2)
    const col = colIndex.get(a.techId)
    if (col == null) return null
    // overlap mode: split the column into side-by-side lanes
    const li = laneInfo.get(a.id)
    const lanes = li?.lanes ?? 1
    const lane = li?.lane ?? 0
    const cardW = (colWAt(col) - 4) / lanes
    const left = GUTTER_W + colXAt(col) + 1 + lane * cardW
    const key = a.parallelGroup ?? a.id
    const isSelected = selectedGroup === key
    const isFocusRelated = focusKey === key
    const isDimmed = focusKey != null && focusKey !== key
    const isMoving = drag?.kind === 'appt' && drag.moveIds.includes(a.id) && drag.moved
    // single floating card during drag, it shows the *target* time, and turns rust on conflict
    const movingItem = isMoving ? dragMoving.find((m) => m.id === a.id) : undefined
    const dragInvalidCard = Boolean(movingItem && dragErrors.get(movingItem.id))
    const dispStart = movingItem?.startMin ?? a.startMin
    const dispDur = movingItem?.durationMin ?? a.durationMin

    // ── Lumina visual language ──────────────────────────────────────────
    const byStatus = colorMode === 'status'
    // booked and not checked in past the start time shows purple (time elapsed)
    const isLate = (a.status === 'confirmed' || a.status === 'booked') && isToday(date) && DEMO_NOW_MIN > a.startMin
    const st = byStatus ? STATUS_STYLE[isLate ? 'late' : a.status] ?? STATUS_STYLE.confirmed : null
    const lineC = darkMode ? `hsl(${cat.hue})` : byStatus ? st!.line : cat.line
    const fillC = darkMode
      ? `hsl(${cat.hue} / 0.24)`
      : byStatus
        ? st!.fill
        : cat.fill
    const textC = darkMode ? '#fff' : byStatus ? st!.text : cat.text
    const isRequested = a.status === 'requested'
    const isNoShow = a.status === 'no_show'
    const isCompleted = a.status === 'completed'
    // completed just means the service is done — it fades out only once the
    // client has actually paid and checked out, not the moment it's marked done
    const isPaid = isCompleted && payments.some((p) => p.apptIds?.includes(a.id))
    const isInService = a.status === 'in_service'
    const elapsed = isInService && isToday(date)
      ? Math.min(1, Math.max(0.05, (DEMO_NOW_MIN - a.startMin) / Math.max(1, a.durationMin)))
      : 0
    const tall = h >= 52 // room for name + service + time
    // linked partners glow while one of them is being dragged
    const isDragLinked = dragGroupKey != null && key === dragGroupKey && !isMoving

    return (
      <div
        key={a.id}
        onPointerDown={(e) => startDrag(e, a, 'move')}
        onPointerEnter={(e) => onCardEnter(e, a)}
        onPointerLeave={onCardLeave}
        onClick={(e) => {
          e.stopPropagation()
          setHoverTip(null)
          if (isOverview) {
            setScale({ colW: 104, ppm: pxPerMin })
            scrollToTech(a.techId)
          } else {
            openDetail(a.id)
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!isOverview) { openDetail(a.id) }
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setHoverTip(null); openDetail(a.id) }}
        className={`group/blk absolute z-10 select-none rounded-[6px] text-left ${
          isMoving ? 'z-40 cursor-grabbing' : 'transition-[box-shadow,transform,opacity] duration-150 ease-out-expo'
        } ${
          isOverview ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        } ${!isMoving && 'hover:-translate-y-px hover:shadow-sh-2'} ${
          isNoShow ? 'saturate-50' : ''
        } ${dragInvalidCard ? 'ring-2 ring-rust' : ''} ${isDragLinked ? 'z-20 ring-2 ring-clay shadow-sh-2' : ''} ${isSelected || isFocusRelated ? 'z-20 ring-2 ring-clay' : ''} ${
          isDimmed ? 'opacity-25' : ''}`}
        style={{
          top, left, height: h, width: cardW - (lanes > 1 ? 2 : 0),
          background: dragInvalidCard ? '#F9DBDF' : fillC,
          border: dragInvalidCard
            ? '1.5px solid #D64550'
            : a.issue
              ? '1.5px dashed #D64550'
              : isNoShow
                ? '1.5px solid #B3402F'
                : isRequested
                  ? `1.5px dashed ${lineC}`
                  : `1px solid ${lineC}66`,
          opacity: isMoving ? 0.95 : isPaid ? 0.55 : isNoShow ? 0.7 : undefined,
          transform: isMoving && float ? `translate(${float.x}px, ${float.y}px)` : undefined,
          boxShadow: isMoving ? '0 12px 28px rgba(38,37,43,.25)' : undefined,
          pointerEvents: isMoving ? 'none' : undefined,
        }}
      >
        {/* 4px category left rail — always the service category, even in status mode */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-[4px] rounded-l-[5px]" style={{ background: darkMode ? `hsl(${cat.hue})` : cat.line }} />
        {/* requested white wash */}
        {isRequested && !darkMode && <span aria-hidden className="absolute inset-0 rounded-[6px] bg-white/45" />}
        {/* in-service elapsed hatch + sheen */}
        {isInService && isToday(date) && (
          <span aria-hidden className="absolute inset-y-0 left-0 overflow-hidden rounded-l-[5px]" style={{ width: `${elapsed * 100}%` }}>
            <span className="sched-hatch absolute inset-0" />
            <span className="sched-sheen absolute inset-y-0 w-1/3" style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,.5), transparent)' }} />
          </span>
        )}

        {showText && (
          <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden pl-[9px] pr-1 pt-[3px]" style={{ fontSize: cw >= 140 ? 12.5 : 10 }}>
            <div className="flex items-start justify-between gap-1">
              <span className="flex min-w-0 items-center gap-1">
                {a.issue ? (
                  <Heart className="h-2.5 w-2.5 shrink-0" style={{ color: '#F59E0B', fill: '#F59E0B' }} />
                ) : a.techRequested ? (
                  <Heart className="h-2.5 w-2.5 shrink-0" style={{ color: '#16A34A', fill: '#16A34A' }} />
                ) : a.requestedTechChoice === 'pref-female' ? (
                  <Heart className="h-2.5 w-2.5 shrink-0" style={{ color: '#EC4899', fill: '#EC4899' }} />
                ) : a.requestedTechChoice === 'pref-male' ? (
                  <Heart className="h-2.5 w-2.5 shrink-0" style={{ color: '#2563EB', fill: '#2563EB' }} />
                ) : null}
                <span className="truncate font-bold leading-4" style={{ color: textC }}>{a.clientName}</span>
              </span>
              {/* status icon channel */}
              {isRequested && <Clock className="h-3 w-3 shrink-0" style={{ color: lineC }} />}
              {a.status === 'checked_in' && (
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white shadow-sh-1">
                  <Check className="h-2.5 w-2.5" style={{ color: lineC }} strokeWidth={3.5} />
                </span>
              )}
              {isInService && <Play className="h-3 w-3 shrink-0" style={{ color: lineC }} fill={lineC} />}
            </div>
            {/* priority: name, then service, time only when there's room for a third line */}
            {(h >= 30 || cw >= 140) && (
              <span className="truncate font-medium leading-[15px]" style={{ color: textC, opacity: 0.85 }}>{svc.short}</span>
            )}
            {(a.parallelGroup || a.notes || tall) && (
              <div className="mt-auto flex items-center gap-1 pb-[3px]">
                {a.parallelGroup && <Link2 className="h-2.5 w-2.5 shrink-0" style={{ color: textC, opacity: 0.75 }} />}
                {a.notes && <StickyNote className="h-3 w-3 shrink-0 text-amber-500/90" />}
                {tall && (
                  <span className="tnum truncate text-micro font-bold uppercase" style={{ color: textC, opacity: 0.75 }}>
                    {h >= 38 ? `${fmtTime(dispStart)} to ${fmtTime(dispStart + dispDur)}` : fmtTime(dispStart)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* no-show tag */}
        {isNoShow && h >= 30 && (
          <span className="absolute bottom-1 right-1 z-10 rounded-[6px] bg-rust px-1 py-px text-[9px] font-extrabold uppercase tracking-[0.06em] text-white">
            No-show
          </span>
        )}
        {/* issue tag — the salon needs to resolve this one */}
        {a.issue && h >= 30 && !isNoShow && (
          <span className="absolute bottom-1 right-1 z-10 rounded-[6px] bg-amber-500 px-1 py-px text-[9px] font-extrabold uppercase tracking-[0.06em] text-white">
            ⚠ Issue
          </span>
        )}
        {!isOverview && (
          <div
            onPointerDown={(e) => startDrag(e, a, 'resize')}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity duration-150 group-hover/blk:opacity-100"
            style={{ background: 'linear-gradient(to top, rgba(42,33,26,.14), transparent)' }}
          />
        )}
      </div>
    )
  }

  const renderGhost = (m: MovingItem) => {
    const col = colIndex.get(m.techId)
    if (col == null) return null
    const svc = svcById[m.serviceId]
    const cat = catById[svc.categoryId]
    const invalid = Boolean(dragErrors.get(m.id))
    const lineC = darkMode ? `hsl(${cat.hue})` : cat.line
    const fillC = darkMode ? `hsl(${cat.hue} / 0.45)` : cat.fill
    return (
      <div
        key={`ghost-${m.id}`}
        className={`pointer-events-none absolute z-30 rounded-[6px] ${invalid ? 'ring-2 ring-rust' : 'ring-1 ring-white/60'}`}
        style={{
          top: GROUP_H + TECH_H + yAt(m.startMin),
          left: GUTTER_W + colXAt(col) + 1,
          height: Math.max(8, m.durationMin * pxPerMin - 2),
          width: colWAt(col) - 4,
          background: invalid ? '#B3402F59' : fillC,
          border: `1.5px dashed ${invalid ? '#B3402F' : lineC}`,
          boxShadow: '0 12px 28px rgba(42,33,26,.22)',
        }}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-[4px]" style={{ background: invalid ? '#B3402F' : lineC }} />
        {showText && (
          <div className="truncate pl-[9px] pr-1 pt-[3px] text-[10px] font-bold" style={{ color: invalid ? '#fff' : darkMode ? '#fff' : cat.text }}>
            {techOf(m.techId).name} · {fmtTime(m.startMin)}
          </div>
        )}
      </div>
    )
  }

  // day totals for the status bar
  const dayGuests = useMemo(() => new Set(appts.map((a) => a.clientName)).size, [appts])
  const dayValue = useMemo(() => appts.reduce((s, a) => s + (a.priceOverride ?? svcById[a.serviceId].price) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0), 0), [appts])
  const dayCollected = useMemo(() => payments.filter((p) => p.dateKey === dateKey).reduce((s, p) => s + p.total, 0), [payments, dateKey])

  const hours = Array.from({ length: DAY_SLOTS / 4 + 3 }, (_, i) => (i - 1) * 60)

  const onNavNavigate = (page: 'calendar' | 'techschedule' | 'services' | 'clients' | 'settings') => {
    if (page === 'techschedule') { setScheduleOpen(true); return }
    if (page === 'settings') { navigate('/settings/general'); return }
    if (page !== 'calendar') showFlash(`${page[0].toUpperCase() + page.slice(1)} page, coming soon`)
  }

  return (
    <div className={`h-full overflow-hidden ${darkMode ? 'dark' : ''} bg-background text-foreground`}>
    <div className="flex h-full">
      <NavRail active="calendar" onNavigate={onNavNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
      <ContextBar
        title="Schedule"
        subtitle="Day view · whole team"
        clients={clients}
        onPickGuest={(c) => openProfile(c.name)}
        onJumpToDate={(k) => goDay(new Date(k + 'T12:00:00'))}
        onTurnaway={() => { if (canLogTurnaway) setTurnawayOpen(true) }}
        turnawayCount={turnawaysToday.length}
        turnawayTitle={turnawayTitle}
        turnawayDisabled={!canLogTurnaway}
      />
      <Toolbar
        subtitle={`${dayLabel(date)} · ${columns.filter((c) => c.kind === 'tech').length} of ${techs.length} techs working · ${appts.length} appointments`}
        dateLabel={dayLabel(date)}
        isToday={isToday(date)}
        onPrevDay={() => goDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1))}
        onNextDay={() => goDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))}
        onToday={() => goDay(new Date())}
        onPickDate={setDateAnchor}
        density={density}
        onDensity={onDensity}
        colorMode={colorMode} onColorMode={setColorMode}
        onPickLegend={setLegendAnchor}
        teamChips={teamChips}
        hiddenTeams={hiddenTeams}
        onToggleTeamChip={(id) => setHiddenTeams((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })}
        onReorderChip={moveRole}
        techQuery={techQuery} onTechQuery={setTechQuery}
        catFilter={catFilter} onCatFilter={setCatFilter}
        onBook={openBooking}
        onPos={() => {
          setBookingOpen(false)
          closeCheckout()
          setPosOpen(true)
        }}
        requestCount={requested.length}
        onToggleRail={() => setRailOpen((o) => !o)}
      />

      {/* legend + date picker popovers */}
      {legendAnchor && (
        <LegendPopover
          anchor={legendAnchor}
          colorMode={colorMode}
          onColorMode={setColorMode}
          onClose={() => setLegendAnchor(null)}
        />
      )}
      {dateAnchor && (
        <DatePickerPopover
          anchor={dateAnchor}
          selected={dayKey(date)}
          today={dayKey(new Date())}
          appointmentDates={new Set([dayKey(new Date())])}
          onSelect={(ds) => { setDateAnchor(null); goDay(new Date(ds + 'T12:00:00')) }}
          onClose={() => setDateAnchor(null)}
        />
      )}

      {/* clipboard tray */}
      {clipboard.length > 0 && (
        <div className="absolute bottom-11 right-3 z-[60] w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] font-semibold">
            <span>Clipboard ({clipboard.length}), drag onto the book, any day</span>
            <button
              onClick={() => setClipboardClearConfirm(true)}
              className="text-[10px] font-bold text-rust transition-opacity hover:opacity-70"
            >
              Clear all
            </button>
          </div>
          <div className="max-h-44 space-y-1 overflow-auto p-1.5">
            {clipboard.map((c) => (
              <div
                key={c.id}
                onPointerDown={(e) => startClipDrag(e, c)}
                className="group flex cursor-grab items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:border-sky-500/60 active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.clientName}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {c.services.map((s) => svcById[s.serviceId].short).join(' + ')}
                    {c.isPair && ' · same time'}
                  </div>
                  {c.services[0] && (() => {
                    const choice = c.services[0].requestedTechChoice
                    const label = choice === 'first' ? 'First available'
                      : choice === 'pref-female' ? 'Female preferred'
                      : choice === 'pref-male' ? 'Male preferred'
                      : techOf(c.services[0].techId).name
                    return label && label !== 'Unassigned' ? (
                      <div className="truncate text-[10px] font-semibold text-sky-600">Requested: {label}</div>
                    ) : null
                  })()}
                </div>
                {c.isPair && <Link2 className="h-3 w-3 shrink-0 text-sky-400" />}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setClipboard((x) => x.filter((y) => y.id !== c.id))}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* flash message */}
      {flash && (
        <div className="absolute bottom-14 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-border bg-popover px-4 py-2 text-sm shadow-2xl">
          {flash}
        </div>
      )}

      {/* grid + right requests rail */}
      <div className="flex min-h-0 flex-1">
      {/* calendar scroller */}
      <div ref={scrollRef} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)} className="relative flex-1 overflow-auto bg-background">
        <div ref={contentRef} className="relative" style={{ width: totalW, height: GROUP_H + TECH_H + dayH }} onDoubleClick={onGridClick} onContextMenu={onGridRightClick}>
          {/* corner */}
          <div className="sticky z-50 border-b border-r border-border bg-card" style={{ position: 'sticky', top: 0, left: 0, width: GUTTER_W, height: GROUP_H + TECH_H, float: 'left' }} />

          {/* role group header row, click to collapse/expand */}
          <div className="sticky z-40 flex border-b border-border bg-cream/70 backdrop-blur" style={{ top: 0, marginLeft: GUTTER_W, height: GROUP_H, width: totalW - GUTTER_W, position: 'sticky' }}>
            {buildSegments(columns).map((seg, i) => {
              const stats = teamStats.get(seg.teamId)!
              const role = roles.find((r) => r.id === seg.teamId)
              return (
                <button
                  key={`${seg.teamId}:${i}`}
                  onClick={(e) => { e.stopPropagation(); toggleTeam(seg.teamId) }}
                  className="relative flex h-full items-center gap-2 overflow-hidden border-r border-border px-3 text-left transition-colors hover:bg-cream"
                  style={{ width: seg.span * cw, minWidth: seg.span * cw }}
                  title={`${role?.name ?? 'Role'}, click to ${seg.collapsed ? 'expand' : 'collapse'}`}
                >
                  {seg.collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-soft" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
                  <span className="truncate text-[12px] font-bold uppercase tracking-[0.08em] text-ink">{role?.name ?? seg.teamId}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] font-medium text-ink-faint">
                    {stats.total} techs · {stats.appts} appts
                  </span>
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: roleColor(roles, seg.teamId) }} />
                </button>
              )
            })}
          </div>

          {/* tech header row */}
          <div className="sticky z-40 flex border-b border-border bg-card/95 backdrop-blur" style={{ top: GROUP_H, marginLeft: GUTTER_W, height: TECH_H, width: totalW - GUTTER_W, position: 'sticky' }}>
            {columns.slice(firstCol, lastCol + 1).map((c, i) => {
              const idx = firstCol + i
              return (
                <div
                  key={idx}
                  onContextMenu={c.kind === 'tech' ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setTechMenu({ x: e.clientX, y: e.clientY, techId: c.kind === 'tech' ? c.tech.id : '' })
                  } : undefined}
                  className={`group flex h-full items-center gap-2 border-r border-border/60 px-1.5 transition-colors duration-150 ${
                    c.kind === 'tech' && dragTargetTechIds.has(c.tech.id)
                      ? dragInvalid ? 'bg-rust-tint' : 'bg-clay-tint ring-2 ring-inset ring-clay'
                      : ''
                  } ${
                    focusTechIds != null
                      ? c.kind === 'tech' && focusTechIds.has(c.tech.id)
                        ? 'bg-clay-tint ring-2 ring-inset ring-clay'
                        : 'opacity-40'
                      : ''
                  }`}
                  style={{ position: 'absolute', left: colXAt(idx), width: colWAt(idx) }}
                >
                  {c.kind === 'tech' && (
                    <button
                      type="button"
                      aria-label={`${c.tech.name} options`}
                      onClick={(e) => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setTechMenu({ x: r.right - 190, y: r.bottom + 4, techId: c.tech.id })
                      }}
                      className="absolute right-0.5 top-0.5 z-10 hidden h-5 w-5 items-center justify-center rounded text-ink-faint hover:bg-cream hover:text-ink group-hover:flex"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {c.kind === 'tech' && (c.tech.gender === 'female' || c.tech.gender === 'male') && (
                    <span
                      aria-hidden
                      title={c.tech.gender === 'female' ? 'Female' : 'Male'}
                      className="absolute inset-x-0 bottom-0 h-[3px]"
                      style={{ background: c.tech.gender === 'female' ? '#EC6BA8' : '#4C8DED' }}
                    />
                  )}
                  {c.kind === 'tech' ? (
                    showText ? (
                      // photo (if enabled) + name + schedule status when it's not a plain full day
                      <span className="flex h-full min-w-0 flex-1 items-start gap-1.5 px-0.5 pt-2">
                        {c.tech.photoUrl && c.tech.showPhotoOnCalendar && (
                          <img src={c.tech.photoUrl} alt="" className="mt-0.5 h-[26px] w-[26px] shrink-0 rounded-full object-cover ring-1 ring-line" />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className="break-words text-[12.5px] font-semibold leading-[1.2]"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {c.tech.nickname || c.tech.name}
                        </span>
                        {(() => {
                          const sd = daySchedule[c.tech.id]
                          // only full-day-off statuses get a label, shifts show as grey blocks instead
                          if (!sd || (sd.status !== 'off' && sd.status !== 'vacation' && sd.status !== 'emergency')) return null
                          const meta = STATUS_META[sd.status]
                          return (
                            <span className="mt-0.5 block truncate text-[8.5px] font-extrabold uppercase leading-3" style={{ color: meta.color }}>
                              {meta.label}
                            </span>
                          )
                        })()}
                        </span>
                      </span>
                    ) : (
                      <span className="flex h-full min-w-0 flex-1 items-center justify-center text-[8px] font-bold text-ink-soft">{c.tech.initials}</span>
                    )
                  ) : (
                    showText && <span className="px-1 text-center text-[10px] text-muted-foreground">tap ▶ to expand</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* time gutter, labels at the selected density, bold like Zenoti */}
          <div className="sticky z-30 border-r border-border bg-cream/85 backdrop-blur-sm" style={{ position: 'sticky', left: 0, top: GROUP_H + TECH_H, width: GUTTER_W, height: dayH, float: 'left' }}>
            {Array.from({ length: (DAY_MIN + 2 * VIEW_PAD) / (density ?? 60) + 1 }, (_, i) => -VIEW_PAD + i * (density ?? 60)).map((m) => {
              const isFirst = m === -VIEW_PAD
              const isLast = m === DAY_MIN + VIEW_PAD
              const offHours = m < 0 || m > DAY_MIN
              const isHour = m % 60 === 0
              return (
                <span key={m}>
                  <span
                    className={`tnum absolute right-1.5 uppercase ${
                      isHour ? 'text-[11px] font-extrabold' : 'text-micro font-bold'
                    } ${offHours ? 'text-ink-faint/50' : isHour ? 'text-ink-soft' : 'text-ink-faint'}`}
                    style={{
                      top: isFirst ? 2 : isLast ? dayH - 14 : yAt(m),
                      transform: isFirst || isLast ? 'none' : 'translateY(-50%)',
                    }}
                  >
                    {fmtTime(m)}
                  </span>
                </span>
              )
            })}
          </div>

          {/* day body: hour lines + column lines + drop-target wash */}
          <div className="absolute" style={{ left: GUTTER_W, top: GROUP_H + TECH_H, width: totalW - GUTTER_W, height: dayH }}>
            {/* closed hours (before open / after close), greyed */}
            <div className="absolute w-full" style={{ top: 0, height: yAt(salonOpenOff), background: 'repeating-linear-gradient(45deg, rgba(100,116,139,0.07) 0 8px, rgba(100,116,139,0.02) 8px 16px)' }} />
            <div className="absolute w-full border-t-2 border-line" style={{ top: yAt(salonOpenOff) }} />
            <div className="absolute w-full" style={{ top: yAt(salonCloseOff), height: dayH - yAt(salonCloseOff), background: 'repeating-linear-gradient(45deg, rgba(100,116,139,0.07) 0 8px, rgba(100,116,139,0.02) 8px 16px)' }} />
            <div className="absolute w-full border-t-2 border-line" style={{ top: yAt(salonCloseOff) }} />
            {salonClosed && (
              <>
                <div className="absolute w-full" style={{ top: yAt(salonOpenOff), height: Math.max(0, yAt(salonCloseOff) - yAt(salonOpenOff)), background: 'repeating-linear-gradient(45deg, rgba(100,116,139,0.10) 0 8px, rgba(100,116,139,0.04) 8px 16px)' }} />
                <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: yAt(salonOpenOff) + Math.max(0, yAt(salonCloseOff) - yAt(salonOpenOff)) / 2 - 16 }}>
                  <span className="rounded-full bg-panel/90 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-ink-soft shadow ring-1 ring-line">
                    {salonHoliday ? salonHoliday.label || 'Closed' : 'Closed'}
                  </span>
                </div>
              </>
            )}
            {hours.map((m) => (
              <div key={m} className="absolute w-full border-t border-line" style={{ top: yAt(m) }} />
            ))}
            {density === 15 && Array.from({ length: DAY_SLOTS - 1 }, (_, i) => (i + 1) * 15).filter((m) => m % 60 !== 0).map((m) => (
              <div key={m} className={`absolute w-full border-t ${m % 30 === 0 ? 'border-line/80' : 'border-line/55'}`} style={{ top: yAt(m) }} />
            ))}
            {density === 30 && Array.from({ length: DAY_SLOTS / 2 }, (_, i) => (i + 1) * 30).filter((m) => m % 60 !== 0).map((m) => (
              <div key={m} className="absolute w-full border-t border-line/70" style={{ top: yAt(m) }} />
            ))}
            {/* off-duty tech columns, greyed out for the day */}
            {columns.slice(firstCol, lastCol + 1).map((c, i) => {
              if (c.kind !== 'tech') return null
              const sd = daySchedule[c.tech.id]
              if (!sd || sd.status === 'working' || sd.status === 'late' || sd.status === 'early') return null
              const idx = firstCol + i
              return (
                <div
                  key={`off${i}`}
                  className="absolute"
                  style={{
                    left: colXAt(idx), top: 0, width: colWAt(idx), height: dayH,
                    background: 'repeating-linear-gradient(45deg, rgba(100,116,139,0.08) 0 8px, rgba(100,116,139,0.03) 8px 16px)',
                  }}
                >
                </div>
              )
            })}
            {/* drop-target wash per column */}
            {drag?.moved && columns.slice(firstCol, lastCol + 1).map((c, i) => {
              const idx = firstCol + i
              if (c.kind !== 'tech') return null
              const isTarget = dragMoving.some((m) => m.techId === c.tech.id)
              if (!isTarget) return null
              return (
                <div
                  key={`w${i}`}
                  className={`absolute transition-colors duration-150 ${dragInvalid ? 'bg-rust-tint/60' : 'bg-clay-tint/60'}`}
                  style={{ left: colXAt(idx), top: 0, width: colWAt(idx), height: dayH }}
                />
              )
            })}
            {columns.slice(firstCol, lastCol + 1).map((_, i) => (
              <div key={i} className="absolute border-l border-border/40" style={{ left: colXAt(firstCol + i), top: 0, height: dayH }} />
            ))}

            {/* time blocks, drag to move, bottom edge to resize, right-click for the reason */}
            {dayBlocks.map((b) => {
              const d = blockDrag?.id === b.id ? blockDrag : null
              const techId = d?.techId ?? b.techId
              const idx = colIndex.get(techId)
              if (idx == null || idx < firstCol || idx > lastCol) return null
              const startMin = d?.startMin ?? b.startMin
              const durationMin = d?.durationMin ?? b.durationMin
              return (
                <div
                  key={b.id}
                  onPointerDown={(e) => startBlockDrag(e, b, 'move')}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setBlockEdit({ id: b.id, techId: b.techId, draft: { startMin: b.startMin, endMin: b.startMin + b.durationMin, reason: b.reason } })
                  }}
                  className={`absolute select-none overflow-hidden rounded-[5px] border border-slate-400/30 ${
                    d ? 'z-40 shadow-sh-2 ring-1 ring-slate-400/60' : 'z-[6]'
                  }`}
                  style={{
                    left: colXAt(idx) + 2, width: colWAt(idx) - 4,
                    top: yAt(startMin), height: Math.max(10, durationMin * pxPerMin - 2),
                    background: 'repeating-linear-gradient(45deg, rgba(100,116,139,0.12) 0 6px, rgba(100,116,139,0.05) 6px 12px)',
                    cursor: 'grab', touchAction: 'none',
                  }}
                  title={`${b.reason} · ${fmtTime(b.startMin)} to ${fmtTime(b.startMin + b.durationMin)}, drag to move · right-click to set reason`}
                >
                  {durationMin * pxPerMin >= 18 && (
                    <span className="block truncate px-1.5 pt-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                      {b.reason}{d ? ` · ${fmtTime(startMin)}` : ''}
                    </span>
                  )}
                  <span
                    onPointerDown={(e) => startBlockDrag(e, b, 'resize')}
                    className="absolute inset-x-0 bottom-0 h-[7px] cursor-ns-resize"
                    title="Drag to resize"
                  />
                </div>
              )
            })}

            {/* out-of-shift ranges, late arrivals, early departures, custom hours */}
            {columns.slice(firstCol, lastCol + 1).map((c, i) => {
              if (c.kind !== 'tech') return null
              const sd = daySchedule[c.tech.id]
              if (!sd) return null
              const ranges: { from: number; to: number }[] = []
              if (sd.status === 'late') ranges.push({ from: 0, to: sd.startMin ?? 0 })
              else if (sd.status === 'early') ranges.push({ from: sd.endMin ?? DAY_MIN, to: DAY_MIN })
              else if (sd.status === 'working' && (sd.startMin != null || sd.endMin != null)) {
                if ((sd.startMin ?? 0) > 0) ranges.push({ from: 0, to: sd.startMin! })
                if ((sd.endMin ?? DAY_MIN) < DAY_MIN) ranges.push({ from: sd.endMin!, to: DAY_MIN })
              } else return null
              const idx = firstCol + i
              return ranges.map((r, j) => (
                <div
                  key={`un${i}-${j}`}
                  className="absolute"
                  style={{
                    left: colXAt(idx), top: yAt(r.from), width: colWAt(idx), height: Math.max(2, (r.to - r.from) * pxPerMin),
                    background: 'repeating-linear-gradient(45deg, rgba(100,116,139,0.08) 0 8px, rgba(100,116,139,0.03) 8px 16px)',
                  }}
                />
              ))
            })}

            {/* collapsed team density strips */}
            {columns.slice(firstCol, lastCol + 1).map((c, i) => {
              if (c.kind !== 'collapsed') return null
              const left = colXAt(firstCol + i)
              return (
                <div key={`d${i}`} className="absolute" style={{ left, top: 0, width: cw, height: dayH }}>
                  {appts.filter((a) => techOf(a.techId).teamId === c.teamId && a.techId !== 'unassigned').map((a) => (
                    <div key={a.id} className="absolute rounded-sm opacity-50" style={{
                      top: yAt(a.startMin), height: Math.max(3, a.durationMin * pxPerMin),
                      left: 2, right: 2,
                      background: darkMode ? `hsl(${catById[svcById[a.serviceId].categoryId].hue} / 0.6)` : catById[svcById[a.serviceId].categoryId].line,
                    }} />
                  ))}
                </div>
              )
            })}

            {/* now line (today only) */}
            {isToday(date) && (
              <div className="pointer-events-none absolute z-20 w-full" style={{ top: yAt(DEMO_NOW_MIN) }}>
                <div className="relative h-[2px] w-full bg-clay">
                  <span className="sched-now-pulse absolute -left-1 -top-[4px] h-2.5 w-2.5 rounded-full bg-clay" />
                  <span className="absolute left-1.5 -top-[9px] rounded-[6px] bg-clay-tint px-1 py-px text-[10px] font-extrabold text-clay tnum">
                    {fmtTime(DEMO_NOW_MIN)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* scroll spacer for open right panels */}
          {panelPad > 0 && <div className="absolute" style={{ left: totalW - panelPad, top: 0, width: panelPad, height: 1 }} />}

          {/* appointment cards (virtualized) */}
          {filtered.filter((a) => visibleTechIds.has(a.techId)).map((a) => renderCard(a))}
          {/* ghost preview, clipboard drags only (appointment drags show the floating card itself) */}
          {drag?.moved && drag.kind === 'clip' && dragMoving.map(renderGhost)}
        </div>

        {/* technician week / month calendar takeover */}
        {techSchedView && (
          <TechCalendarView
            tech={techOf(techSchedView.techId)}
            anchor={date}
            mode={techSchedView.mode}
            pxPerMin={scale.ppm}
            density={density}
            getAppts={(k) => {
              if (k === dateKey) return appts
              if (apptDays[k]) return apptDays[k]
              let v = dayPreviewCache.current.get(k)
              if (!v) { v = generateDay(k); dayPreviewCache.current.set(k, v) }
              return v
            }}
            getBlocks={(k) => blocksByDay[k] ?? []}
            onBook={(d, startMin) => {
              // stay in the tech view, just book into the right day
              const techId = techSchedView.techId
              goDay(d)
              setBookingPrefill({ techId, startMin })
              closeCheckout()
              setPosOpen(false)
              setBookingOpen(true)
            }}
            onApptMenu={(e, apptId) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, apptId }) }}
            onExit={() => setTechSchedView(null)}
          />
        )}
      </div>

      {/* right requests rail */}
      {railOpen && (
        <RequestsRail
          requests={requested}
          appts={appts}
          approved={approved}
          blocks={dayBlocks}
          onApprove={approveRequest}
          onDragApproved={onDragApproved}
          onDecline={declineRequest}
          onPropose={proposeRequest}
          onClose={() => setRailOpen(false)}
          waitlist={waitlist}
          walkins={walkins}
          clients={clients}
          onAddClient={(c) => setClients((x) => [...x, c])}
          onAddWaitlist={addWaitlist}
          onAddWalkinGroup={addWalkinGroup}
          onRemoveQueue={removeQueue}
          onDragWaitlist={onDragWaitlistEntry}
          onDragWalkin={onDragWalkinService}
          onOpenProfile={openProfile}
        />
      )}
      </div>

      {/* status bar */}
      <div className="flex items-center gap-4 border-t border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>Total guests: <b className="font-semibold text-foreground">{dayGuests}</b></span>
        <span>Appointments: <b className="font-semibold text-foreground">{appts.length}</b></span>
        <span>Requests: <b className="font-semibold text-foreground">{requested.length}</b></span>
        <span>Services value: <b className="font-semibold text-foreground">${dayValue.toLocaleString()}</b></span>
        {dayCollected > 0 && (
          <span>Collected: <b className="font-semibold text-olive">${dayCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
        )}
        {drag?.moved && (
          <span className={dragInvalid ? 'font-medium text-rust' : 'font-medium text-olive'}>
            {dragInvalid ? '⛔ Slot unavailable' : '✓ Release to drop'}
          </span>
        )}
        {allowOverlap && <span className="font-medium text-violet-500">double-booking on</span>}
        {focusKey != null && <span className="font-medium text-clay">focus mode, click anywhere to exit</span>}
        <span className="ml-auto" />

        {/* right cluster: undo · theme · Fit · Height % · Width % */}
        <div className="flex items-center gap-2.5 text-[11px]">
          <button
            onClick={undo}
            disabled={historyRef.current.length === 0}
            title="Undo last change (⌘Z)"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line bg-surface text-ink-soft hover:bg-cream disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={redoRef.current.length === 0}
            title="Redo (⌘⇧Z)"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line bg-surface text-ink-soft hover:bg-cream disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line bg-surface text-ink-soft hover:bg-cream"
          >
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <div className="relative">
            <button
              onClick={() => setFitOpen((o) => !o)}
              className="flex h-6 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 font-semibold text-ink-soft hover:bg-cream"
            >
              ⇥ Fit
            </button>
            {fitOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFitOpen(false)} />
                <div className="absolute bottom-8 right-0 z-50 w-44 overflow-hidden rounded-[10px] border border-line bg-popover shadow-sh-2">
                  <button onClick={() => { fitHeight(); setFitOpen(false) }} className="w-full px-3 py-2 text-left text-[12px] font-medium hover:bg-cream">⇥ Fit to height</button>
                  <button onClick={() => { fitWidth(); setFitOpen(false) }} className="w-full px-3 py-2 text-left text-[12px] font-medium hover:bg-cream">⇥ Fit to width</button>
                </div>
              </>
            )}
          </div>
          <span className="flex items-center gap-1">
            Height <b className="tnum font-semibold text-foreground">{Math.round((scale.ppm / 1.15) * 100)}%</b>
            <button onClick={() => setScale({ ...scale, ppm: scale.ppm - 0.08 })} className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-line bg-surface text-ink-soft hover:bg-cream">−</button>
            <button onClick={() => setScale({ ...scale, ppm: scale.ppm + 0.08 })} className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-line bg-surface text-ink-soft hover:bg-cream">+</button>
          </span>
          <span className="flex items-center gap-1">
            Width <b className="tnum font-semibold text-foreground">{Math.round((scale.colW / 112) * 100)}%</b>
            <button onClick={() => setScale({ ...scale, colW: scale.colW - 8 })} className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-line bg-surface text-ink-soft hover:bg-cream">−</button>
            <button onClick={() => setScale({ ...scale, colW: scale.colW + 8 })} className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-line bg-surface text-ink-soft hover:bg-cream">+</button>
          </span>
        </div>
      </div>

      {/* grid spot menu, right-click an empty spot */}
      {gridMenu && (
        <div className="fixed inset-0 z-[90]" onClick={() => setGridMenu(null)} onContextMenu={(e) => { e.preventDefault(); setGridMenu(null) }}>
          <div
            className="absolute w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-2xl"
            style={{ left: Math.min(gridMenu.x, window.innerWidth - 240), top: Math.min(gridMenu.y, window.innerHeight - 180) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              {techOf(gridMenu.techId).name} · {fmtTime(gridMenu.startMin)}
            </div>
            <button
              onClick={() => {
                setBookingPrefill({ techId: gridMenu.techId, startMin: gridMenu.startMin })
                closeCheckout()
                setPosOpen(false)
                setBookingOpen(true)
                setGridMenu(null)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent"
            >
              ＋ New appointment here
            </button>
            <button
              onClick={() => {
                commitBlocks([...dayBlocks, {
                  id: `b${Date.now()}`, techId: gridMenu.techId,
                  startMin: gridMenu.startMin, durationMin: 60, reason: 'Block',
                }])
                showFlash(`✓ 1 hour blocked for ${techOf(gridMenu.techId).name}, right-click it to set a reason`)
                setGridMenu(null)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent"
            >
              ▦ Block 1 hour here
            </button>
          </div>
        </div>
      )}

      {/* turnaway logger */}
      {turnawayOpen && (
        <TurnawayDialog onSave={logTurnaway} onClose={() => setTurnawayOpen(false)} />
      )}

      {/* block editor */}
      {blockEdit && (
        <BlockEditor
          techName={techOf(blockEdit.techId).name}
          isNew={blockEdit.id === null}
          initial={blockEdit.draft}
          onSave={saveBlock}
          onDelete={blockEdit.id ? () => setBlockDeleteId(blockEdit.id) : undefined}
          onClose={() => setBlockEdit(null)}
        />
      )}

      {/* dropping into a time block, staff override needs a confirm */}
      {pendingBlockDrop && (() => {
        const { d, moving } = pendingBlockDrop
        const hit = dayBlocks.find((b) =>
          moving.some((m) => b.techId === m.techId && overlaps(m.startMin, m.startMin + m.durationMin, b.startMin, b.startMin + b.durationMin)),
        )
        const name = d.kind === 'clip' ? d.clip!.clientName : appts.find((a) => a.id === d.primaryId)?.clientName ?? 'Appointment'
        return (
          <ConfirmDialog
            title="Move into blocked time?"
            body={`${name} → ${techOf(moving[0].techId).name} at ${fmtTime(moving[0].startMin)} overlaps a “${hit?.reason ?? 'Block'}” block. Are you sure?`}
            confirmLabel="Move anyway"
            onConfirm={() => continueAfterPrompts(d, moving, null, relocateSquatters(moving))}
            onClose={() => setPendingBlockDrop(null)}
          />
        )
      })()}

      {/* technician header menu, right-click or hover "..." on a tech name */}
      {techMenu && (() => {
        const t = techOf(techMenu.techId)
        const act = (fn: () => void) => () => { setTechMenu(null); fn() }
        const item = (label: string, fn: () => void) => (
          <button
            key={label}
            onClick={act(fn)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent"
          >
            {label}
          </button>
        )
        return (
          <div className="fixed inset-0 z-[90]" onClick={() => setTechMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTechMenu(null) }}>
            <div
              className="absolute w-60 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-2xl"
              style={{ left: Math.min(techMenu.x, window.innerWidth - 250), top: Math.min(techMenu.y, window.innerHeight - 230) }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
                {t.name}
              </div>
              {item('View profile settings', () => navigate('/settings/techs', { state: { techId: t.id } }))}
              {item('View week schedule', () => setTechSchedView({ techId: t.id, mode: 'week' }))}
              {item('View monthly schedule', () => setTechSchedView({ techId: t.id, mode: 'month' }))}
              <div className="my-1 border-t border-border" />
              {item('Move appointments to other techs', () => setMoveApptsTechId(t.id))}
            </div>
          </div>
        )
      })()}

      {/* move a tech's non-requested appointments, confirm first */}
      {moveApptsTechId && (
        <ConfirmDialog
          title={`Move ${techOf(moveApptsTechId).name}'s appointments?`}
          body="All of her non-requested appointments today move to the least-booked qualified techs at the same times. Requested and in-progress appointments stay with her."
          confirmLabel="Move appointments"
          onConfirm={() => { moveTechAppointments(moveApptsTechId); setMoveApptsTechId(null) }}
          onClose={() => setMoveApptsTechId(null)}
        />
      )}

      {/* appointment audit log */}
      {logApptId && (() => {
        const a = appts.find((x) => x.id === logApptId)
        if (!a) return null
        const entries = [...(a.log ?? [])].sort((x, y) => x.at - y.at)
        return (
          <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 p-4" onClick={() => setLogApptId(null)}>
            <div
              className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-bold">Appointment log</h2>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {a.clientName}, {svcById[a.serviceId]?.name ?? ''} at {fmtTime(a.startMin)} with {techOf(a.techId).name}
                  </p>
                </div>
                <button onClick={() => setLogApptId(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                {entries.length === 0 && (
                  <p className="py-6 text-center text-[12px] text-muted-foreground">No changes recorded yet.</p>
                )}
                {entries.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-3 border-b border-border/50 py-2 last:border-0">
                    <span className="tnum w-32 shrink-0 text-[10.5px] font-semibold text-muted-foreground">
                      {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px]">{e.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* clear clipboard confirmation */}
      {clipboardClearConfirm && (
        <ConfirmDialog
          title={`Clear all ${clipboard.length} clipboard ${clipboard.length === 1 ? 'item' : 'items'}?`}
          body="Copied services are removed from the clipboard. The appointments stay on the book."
          confirmLabel="Clear clipboard"
          onConfirm={() => setClipboard([])}
          onClose={() => setClipboardClearConfirm(false)}
        />
      )}

      {/* moving a requested-tech service to another tech always confirms */}
      {pendingTechRequest && (
        <ConfirmDialog
          title={`${pendingTechRequest.clientName} requested ${pendingTechRequest.fromName}`}
          body={`This client specifically asked for ${pendingTechRequest.fromName}. Move the service to ${pendingTechRequest.toName} anyway?`}
          confirmLabel={`Move to ${pendingTechRequest.toName}`}
          onConfirm={pendingTechRequest.apply}
          onClose={() => setPendingTechRequest(null)}
        />
      )}

      {/* moving a gender-preferred service to a tech of the other gender always confirms */}
      {pendingGenderMismatch && (
        <ConfirmDialog
          title={`${pendingGenderMismatch.clientName} requested a ${pendingGenderMismatch.pref} tech`}
          body={`This client asked for a ${pendingGenderMismatch.pref} technician. ${pendingGenderMismatch.toName} doesn't match that preference. Move the service to ${pendingGenderMismatch.toName} anyway?`}
          confirmLabel={`Move to ${pendingGenderMismatch.toName}`}
          onConfirm={pendingGenderMismatch.apply}
          onClose={() => setPendingGenderMismatch(null)}
        />
      )}

      {/* double-book warning, only when overlap is enabled in Settings */}
      {pendingOverlap && (
        <ConfirmDialog
          title={`Double-book ${techOf(pendingOverlap.techId).name}?`}
          body={`The appointment at ${pendingOverlap.timeLabel} overlaps another booking on her column. Double booking is enabled in Settings, continue?`}
          confirmLabel="Double-book anyway"
          onConfirm={pendingOverlap.apply}
          onClose={() => setPendingOverlap(null)}
        />
      )}

      {/* delete-block confirmation */}
      {blockDeleteId && (
        <ConfirmDialog
          title={`Delete "${dayBlocks.find((b) => b.id === blockDeleteId)?.reason ?? 'time'}" block?`}
          body={`${fmtTime(dayBlocks.find((b) => b.id === blockDeleteId)?.startMin ?? 0)}, the time becomes bookable again.`}
          confirmLabel="Delete block"
          onConfirm={() => { commitBlocks(dayBlocks.filter((b) => b.id !== blockDeleteId)); setBlockEdit(null) }}
          onClose={() => setBlockDeleteId(null)}
        />
      )}

      {/* context menu */}
      {menu && (
        <ApptContextMenu
          x={menu.x} y={menu.y}
          appt={appts.find((a) => a.id === menu.apptId)!}
          pairCount={appts.filter((a) => a.parallelGroup && a.parallelGroup === appts.find((x) => x.id === menu.apptId)?.parallelGroup).length}
          hasPayment={payments.some((p) => p.apptIds?.includes(menu.apptId))}
          onAction={onMenuAction}
          onClose={() => setMenu(null)}
        />
      )}

      {/* hover info tooltip */}
      {hoverTip && (() => {
        const a = appts.find((x) => x.id === hoverTip.apptId)
        if (!a) return null
        const client = clients.find((c) => c.name === a.clientName)
        const svc = svcById[a.serviceId]
        const row = (label: string, value: React.ReactNode) => (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-white/50">{label}</span>
            <span className="min-w-0 flex-1 font-medium">{value}</span>
          </div>
        )
        const pos = hoverTipPos ?? {
          left: Math.min(hoverTip.x + 14, window.innerWidth - 300),
          top: Math.min(hoverTip.y + 14, window.innerHeight - 190),
        }
        return (
          <div
            ref={hoverTipRef}
            className="pointer-events-none fixed z-[75] w-72 space-y-1 rounded-lg bg-slate-900/95 p-3 text-[11px] text-white shadow-2xl"
            style={{ left: pos.left, top: pos.top }}
          >
            {row('Start time', fmtTime(a.startMin))}
            {a.checkedInMin != null && row('Checked in', <span className="text-emerald-400">{fmtTime(a.checkedInMin)}</span>)}
            {a.startedMin != null && row('Started', <span className="text-emerald-400">{fmtTime(a.startedMin)}</span>)}
            {a.completedMin != null && row('Completed', <span className="text-emerald-400">{fmtTime(a.completedMin)}</span>)}
            {row('Guest', a.clientName)}
            {row('Phone', client?.phone ?? '(555) 000-0000')}
            {row('Service', svc.name)}
            {row('Technician', a.techId === 'unassigned' ? 'Unassigned' : techOf(a.techId).name)}
            {row('Tech choice', a.issue
              ? <span className="font-semibold" style={{ color: '#FBBF24' }}>⚠ Issue, needs resolving</span>
              : a.techRequested
                ? <span className="font-semibold" style={{ color: '#4ADE80' }}>Requested</span>
                : a.requestedTechChoice === 'pref-female'
                  ? <span className="font-semibold" style={{ color: '#F472B6' }}>Female preferred</span>
                  : a.requestedTechChoice === 'pref-male'
                    ? <span className="font-semibold" style={{ color: '#60A5FA' }}>Male preferred</span>
                    : 'Any available')}
            {row('Source', a.bookingSource === 'walk_in' ? 'Walk-in' : a.bookingSource === 'online' ? 'Web booking' : a.bookingSource === 'front_desk' ? 'Front desk' : a.status === 'requested' ? 'Web booking' : 'Front desk')}
            {row('Status', <span className={a.status === 'requested' ? 'text-amber-400' : 'text-emerald-400'}>{a.status.replace('_', ' ').toUpperCase()}</span>)}
            {a.notes && <div className="border-t border-white/10 pt-1 text-white/60">{a.notes}</div>}
          </div>
        )
      })()}

      {/* booking flow panel */}
      {bookingOpen && (
        <BookingPanel
          appts={appts}
          blocks={dayBlocks}
          clients={clients}
          onAddClient={(c) => setClients((x) => [...x, c])}
          prefillTime={bookingPrefill?.startMin ?? null}
          prefillTechId={bookingPrefill?.techId ?? null}
          dateKey={dateKey}
          onPreviewDay={(k) => goDay(new Date(k + 'T12:00:00'))}
          onBook={onBookFromPanel}
          onClose={() => setBookingOpen(false)}
        />
      )}

      {/* appointment detail panel */}
      {detailAppt && (
        <AppointmentDetail
          appt={detailAppt}
          group={detailGroup}
          clients={clients}
          error={detailError}
          originDateKey={detailOriginDay ?? dateKey}
          dateKey={dateKey}
          onPreviewDay={(k) => goDay(new Date(k + 'T12:00:00'))}
          dayAppts={dayApptsFor}
          dayBlocks={dayBlocksFor}
          onSave={saveDetail}
          onAction={onDetailAction}
          onCopyService={copyServiceToClipboard}
          onViewProfile={() => openProfile(detailAppt.clientName)}
          onClose={() => setDetailId(null)}
        />
      )}

      {/* cancel confirmation */}
      {cancelAppt && (
        <ConfirmCancelDialog
          clientName={cancelAppt.clientName}
          serviceName={svcById[cancelAppt.serviceId].name}
          timeLabel={fmtTime(cancelAppt.startMin)}
          groupCount={cancelGroup.length}
          onCancelOne={doCancelOne}
          onCancelGroup={doCancelGroup}
          onClose={() => setCancelPromptId(null)}
        />
      )}

      {/* client profile */}
      {profileClient && (
        <ClientProfile
          client={profileClient}
          appts={appts}
          guestVisits={guestVisits}
          realVisits={payments
            .filter((p) => p.clientName === profileClient.name)
            .map((p) => {
              const dayAppts = p.dateKey === dateKey ? appts : apptDays[p.dateKey] ?? []
              const items = (p.apptIds ?? []).map((id) => dayAppts.find((a) => a.id === id)).filter((a): a is Appointment => a != null)
              return {
                paymentId: p.id,
                invoice: `INV-${p.id.replace(/\D/g, '').slice(-6)}`,
                date: new Date(p.dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }),
                services: items.length > 0 ? items.map((a) => svcById[a.serviceId]?.name ?? a.serviceId) : ['POS sale'],
                price: p.total,
                techName: items[0] ? techOf(items[0].techId).name : 'Front desk',
              }
            })}
          onViewInvoice={(paymentId) => {
            const p = payments.find((x) => x.id === paymentId)
            if (!p) return
            const dayAppts = p.dateKey === dateKey ? appts : apptDays[p.dateKey] ?? []
            const items = (p.apptIds ?? []).map((id) => dayAppts.find((a) => a.id === id)).filter((a): a is Appointment => a != null)
            setInvoicePayment({ payment: p, items })
          }}
          pointsBalance={profileClient.id === 'guest' ? 0 : pointsByClient[profileClient.id] ?? 0}
          loyaltyHistory={payments.filter((p) => p.clientName === profileClient.name)}
          notes={notesByClient[profileClient.name] ?? []}
          onAddNote={addClientNote}
          onDeleteNote={deleteClientNote}
          onSaveProfile={saveClientProfile}
          onClose={() => setProfileName(null)}
        />
      )}

      {/* settings, full-screen salon configuration, routed at /settings/<section> */}
      <SettingsPage
        open={settingsOpen}
        section={settingsSection}
        onSection={(id) => navigate(`/settings/${id}`)}
        onClose={() => navigate('/')}
        focusTechId={(location.state as { techId?: string } | null)?.techId ?? null}
      />

      {/* team schedule, per-day tech status & hours */}
      {scheduleOpen && (
        <TechSchedulePanel
          dateLabel={dayLabel(date)}
          day={daySchedule}
          onSet={setTechDay}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {/* POS, ring up off-book sales */}
      {posOpen && (
        <PosPanel
          clients={clients}
          pointsByClient={pointsByClient}
          onAddClient={(c) => setClients((x) => [...x, c])}
          onComplete={completePos}
          onClose={() => setPosOpen(false)}
        />
      )}

      {/* invoice / printable receipt */}
      {invoicePayment && (
        <InvoiceDialog
          payment={invoicePayment.payment}
          items={invoicePayment.items}
          onClose={() => setInvoicePayment(null)}
        />
      )}

      {/* checkout, one ticket per client visit */}
      {checkoutName && checkoutItems.length > 0 && (
        <CheckoutDialog
          clientName={checkoutName}
          items={checkoutItems}
          dateLabel={dayLabel(date)}
          onComplete={completeCheckout}
          onClose={closeCheckout}
          people={checkoutPeople}
          selected={checkoutSelected}
          onTogglePerson={toggleCheckoutPerson}
          onSelectAll={() => { const all = new Set(checkoutPeople); setCheckoutSelected(all); setCheckoutDraft((d) => d && { ...d, selected: [...all] }) }}
          loyaltyBalance={(() => { const c = clients.find((x) => x.name === checkoutName); return c ? pointsByClient[c.id] ?? 0 : 0 })()}
          addedIds={checkoutDraft?.addedIds ?? []}
          onPatchLine={patchCheckoutAppt}
          onRemoveLine={removeCheckoutLine}
          onAddExtra={addCheckoutExtra}
          onRemoveExtra={removeCheckoutExtra}
          draft={checkoutDraft ? { tipPct: checkoutDraft.tipPct, tipCustom: checkoutDraft.tipCustom, method: checkoutDraft.method, note: checkoutDraft.note, redeemId: checkoutDraft.redeemId, tipByTech: checkoutDraft.tipByTech } : undefined}
          onDraft={(patch) => setCheckoutDraft((d) => d && { ...d, ...patch })}
        />
      )}
      </div>
    </div>
    </div>
  )
}

function buildSegments(columns: Column[]): { teamId: string; span: number; collapsed: boolean }[] {
  const segs: { teamId: string; span: number; collapsed: boolean }[] = []
  for (const c of columns) {
    const teamId = c.kind === 'tech' ? c.tech.teamId : c.teamId
    const isCollapsed = c.kind === 'collapsed'
    const last = segs[segs.length - 1]
    if (last && last.teamId === teamId && last.collapsed === isCollapsed) last.span++
    else segs.push({ teamId, span: 1, collapsed: isCollapsed })
  }
  return segs
}
