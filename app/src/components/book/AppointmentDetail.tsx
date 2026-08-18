import { useMemo, useState } from 'react'
import {
  AlertTriangle, Calendar, CalendarX, Check, ChevronLeft, ChevronRight, ClipboardCopy, Clock, CreditCard, Heart, History, Link2, Mail, MessageSquare, Phone, Printer, Receipt, RefreshCw, ScrollText, Undo2, X,
} from 'lucide-react'
import type { Appointment, ClientRecord, TimeBlock } from '@/lib/booking-types'
import { CLOSE_MIN, OPEN_MIN, fmtTime } from '@/lib/booking-types'
import { useSettingsStore } from '@/lib/settings-store'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { activeServices as activeCatalog, svcById, useServicesStore } from '@/lib/services-store'
import { allSlotsFor, layoutItems, spanOf, type SlotGroup } from './BookingPanel'
import { DatePickerPopover } from './LegendPopover'

const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

/** shared style for the Actions/Payment grid buttons, so every tile in
 *  those sections reads as one consistent family regardless of label length */
const actionBtn =
  'flex items-center justify-center gap-1.5 rounded-[8px] border border-line py-2 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink'

export type DetailAction = 'cancel' | 'copy' | 'sendtext' | 'checkout' | 'log' | 'jobcard' | 'invoice' | 'reopen'

interface Props {
  appt: Appointment
  group: Appointment[]
  /** how many distinct clients share this booking's time slot (a real party
   *  checking out together) — NOT how many services `group` has, which is
   *  just this one client's own linked services (e.g. gel mani + gel pedi) */
  partySize: number
  clients: ClientRecord[]
  error: string | null
  /** the day this appointment actually lives on, fixed for the life of this panel even
   *  while the calendar behind it is browsed to preview other days */
  originDateKey: string
  /** the day currently shown on the calendar behind this panel — changes as the day
   *  rail below is used, via onPreviewDay, to actually navigate the background board */
  dateKey: string
  /** switch which day the calendar behind this panel is showing */
  onPreviewDay: (key: string) => void
  /** appointments for any day (today or otherwise), used to preview openings before jumping there */
  dayAppts: (key: string) => Appointment[]
  dayBlocks: (key: string) => TimeBlock[]
  /** a slot that doesn't currently fit — search whether relocating some other
   *  (non-requested) booking would open it up; null when there's no way */
  findMakeRoomPlan: (groups: SlotGroup[], startMin: number, ignoreIds?: Set<string>) => Appointment[] | null
  /** confirm and apply a make-room plan found above, then run `thenSelect` */
  onRequestMakeRoom: (moves: Appointment[], startMin: number, thenSelect: () => void) => void
  onSave: (updated: Appointment[], removedIds: string[], moveToDayKey?: string) => void
  onAction: (a: DetailAction) => void
  /** book a fresh copy of this client's own services (same services, same
   *  techs) on the day/time picked in the rail below — a real rebook, not an
   *  automatic "same time next week" */
  onRebook: (targetDateKey: string, startMin: number) => void
  onViewProfile: () => void
  /** pop up this client's last 5 visits (services, tech, price, category colors) */
  onShowVisits: () => void
  onClose: () => void
  /** true when this client still has something unpaid — "completed" alone doesn't
   *  mean paid, so this stays true past completion until checkout actually runs */
  canCheckout: boolean
  /** true once a payment already covers this booking, so the receipt can be
   *  pulled back up (view/print) without hunting for the right-click menu */
  hasInvoice: boolean
  /** what's still owed on the invoice covering this booking, if any -- while
   *  this is positive the ticket isn't really "done" yet, so the reopen
   *  action reads as finishing checkout rather than reopening a closed one */
  invoiceBalanceDue: number
  /** what's actually still collected on the invoice, net of refunds -- a
   *  payment record existing (hasInvoice) isn't the same as money still
   *  being held: once a ticket's been refunded back to zero, nothing's
   *  actually paid for anymore */
  invoiceNetCollected: number
}

/** small local date helpers, duplicated from AppointmentBook to avoid a circular import */
function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabelOf(key: string) {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const STATUS_LABELS: Record<Appointment['status'], string> = {
  booked: 'Booked',
  requested: 'New (requested)',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_service: 'In service',
  completed: 'Completed',
  checked_out: 'Checked out',
  no_show: 'No-show',
}

/** small subset of AppointmentBook's STATUS_STYLE, duplicated locally to avoid a circular import */
const STATUS_DOT: Record<Appointment['status'], string> = {
  booked: '#D97706',
  requested: '#D97706',
  confirmed: '#3E9B4F',
  checked_in: '#D9A50B',
  in_service: '#D9A50B',
  // done, not yet paid -- same "still needs action" yellow as checked-in/in-service
  completed: '#D9A50B',
  // done AND paid -- the calendar's own "checked out" red (see AppointmentBook's STATUS_STYLE)
  checked_out: '#DC4444',
  no_show: '#B3402F',
}

/** matches the heart colors used on the calendar card, so the edit panel reads the same way */
const REQUEST_HEART_COLOR: Record<string, string | undefined> = {
  requested: '#16A34A',
  'pref-female': '#EC4899',
  'pref-male': '#2563EB',
  issue: '#F59E0B',
  any: undefined,
}

export function AppointmentDetail({
  appt, group, partySize, clients, error, originDateKey, dateKey, onPreviewDay, dayAppts, dayBlocks,
  findMakeRoomPlan, onRequestMakeRoom, onSave, onAction, onRebook, onViewProfile, onShowVisits, onClose,
  canCheckout, hasInvoice, invoiceBalanceDue, invoiceNetCollected,
}: Props) {
  const increment = useSettingsStore().booking.increment
  const TIME_OPTIONS = Array.from({ length: (CLOSE_MIN - OPEN_MIN) / increment }, (_, i) => i * increment)
  // live catalog -- so a service just added or removed in Settings shows
  // up here immediately instead of the stale baseline list
  const services = activeCatalog(useServicesStore())
  const { roles, techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  const [draft, setDraft] = useState<Appointment[]>(group.map((g) => ({ ...g })))
  const [removed, setRemoved] = useState<string[]>([])
  const [status, setStatus] = useState(appt.status)
  const [notes, setNotes] = useState(appt.notes ?? '')
  const [dayPickerAnchor, setDayPickerAnchor] = useState<DOMRect | null>(null)
  // rebooking: picking a day/time for a fresh copy of these same services and
  // techs, using the exact same day rail below (browse days, see openings) —
  // distinct from the rail's normal job of moving *this* appointment
  const [rebooking, setRebooking] = useState(false)
  const [rebookSlot, setRebookSlot] = useState<{ dateKey: string; startMin: number } | null>(null)

  // checkout runs against today or any past day -- the service already
  // happened, it just hasn't been rung up yet. Only a future day is blocked,
  // since that appointment hasn't happened at all. Reopening a ticket has no
  // such restriction either way: it doesn't redo checkout, it just opens the
  // still-recorded payment for correction or refund
  const canCheckoutDay = originDateKey <= dayKeyOf(new Date())
  const client = clients.find((c) => c.name === appt.clientName)
  const setSvc = (id: string, patch: Partial<Appointment>) =>
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  // changing the Status dropdown applies to every one of this client's own
  // linked services (mirrors the right-click Confirm/Check in/etc. actions,
  // which move a whole booking as one unit) and saves immediately — no
  // separate "Save changes" click needed for a plain status change. onSave
  // (saveDetail in AppointmentBook) closes the panel itself once the save
  // actually goes through, so a pending double-book/gender-mismatch
  // confirmation still keeps the panel's error state visible instead of
  // being masked by an unconditional close here
  const applyStatus = (v: Appointment['status']) => {
    setStatus(v)
    onSave(
      draft.map((d) => ({ ...d, status: v, notes: d.id === appt.id ? notes || undefined : d.notes })),
      removed,
      dateKey !== originDateKey ? dateKey : undefined,
    )
  }

  const total = draft.filter((d) => !removed.includes(d.id)).reduce((s, d) => s + svcById[d.serviceId].price, 0)

  // ── day & time rail, same slot-finding mechanism as booking a new appointment.
  // `dateKey` is the day the calendar behind this panel is showing right now —
  // browsing it via the rail below actually navigates that calendar (onPreviewDay)
  // so the salon can see the board, while `originDateKey` stays fixed at the
  // appointment's real day so Save knows whether this is actually a move ──
  const activeServices = draft.filter((d) => !removed.includes(d.id))
  const svcIds = activeServices.map((d) => d.serviceId)
  const isParallelGroup = activeServices.length > 1 && activeServices.every((d) => d.startMin === activeServices[0].startMin)
  const groupStart = activeServices[0]?.startMin
  const selfIds = new Set(group.map((g) => g.id))
  // each slot is 'open' (fits as-is), 'movable' (fits if a non-requested
  // booking blocking it gets relocated), or 'blocked' — findMakeRoomPlan
  // only runs for slots that don't already fit, and ignores this
  // appointment's own services so it's never proposed as its own fix
  const slotPlans = useMemo(() => {
    if (svcIds.length === 0) return []
    const others = dayAppts(dateKey).filter((a) => !selfIds.has(a.id))
    return allSlotsFor(others, [{ svcIds, parallel: isParallelGroup }], dayBlocks(dateKey)).map(({ start, available }) => {
      if (available) return { start, status: 'open' as const, moves: undefined as Appointment[] | undefined }
      const moves = findMakeRoomPlan([{ svcIds, parallel: isParallelGroup }], start, selfIds)
      return { start, status: moves ? ('movable' as const) : ('blocked' as const), moves: moves ?? undefined }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, JSON.stringify(svcIds), isParallelGroup])

  const applySlot = (s: number) => {
    const items = layoutItems(svcIds, isParallelGroup)
    activeServices.forEach((d, i) => setSvc(d.id, { startMin: s + (items[i]?.offset ?? 0) }))
  }

  const shiftDay = (delta: number) => {
    const d = new Date(dateKey + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    onPreviewDay(dayKeyOf(d))
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[85] flex w-[634px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* guest header */}
      <div className="border-b border-line bg-cream px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay-tint text-sm font-bold text-clay">
            {appt.clientName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button onClick={onViewProfile} className="truncate text-[14px] font-bold text-ink hover:text-clay" title="Open guest profile">
                {appt.clientName}
              </button>
              <span
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                style={{ background: `${STATUS_DOT[status]}1a`, color: STATUS_DOT[status] }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT[status] }} />
                {STATUS_LABELS[status]}
              </span>
            </div>
            <div className="mt-1 space-y-0.5 text-[11px] text-ink-faint">
              <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {client?.phone ?? '(555) 842-1177'}</div>
              <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {appt.clientName.split(' ')[0].toLowerCase()}@email.com</div>
              <div className="flex items-center gap-1.5">Host: Front desk{partySize > 1 && (
                <span className="flex items-center gap-0.5 text-clay"><Link2 className="h-3 w-3" /> group of {partySize}</span>
              )}</div>
              <div className="flex items-center gap-3">
                <button onClick={onViewProfile} className="font-semibold text-clay hover:underline">View full profile →</button>
                <button onClick={onShowVisits} className="flex items-center gap-1 font-semibold text-clay hover:underline">
                  <History className="h-3 w-3" /> Last 5 visits
                </button>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 w-[440px] flex-1 space-y-4 overflow-y-auto p-4">
        {/* status */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Status</label>
          <select
            value={status}
            onChange={(e) => applyStatus(e.target.value as Appointment['status'])}
            className="w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* services */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Service details{group.length > 1 ? ` (${draft.length - removed.length})` : ''}
          </label>
          <div className="space-y-2">
            {draft.filter((d) => !removed.includes(d.id)).map((d) => {
              const isRequested = !!d.techRequested
              const requestKind =
                d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue' ? d.techId
                : d.techRequested ? 'requested'
                : d.requestedTechChoice === 'pref-female' || d.requestedTechChoice === 'pref-male' ? d.requestedTechChoice
                : 'any'
              const heartColor = REQUEST_HEART_COLOR[requestKind]
              return (
                <div key={d.id} className={`rounded-xl border p-2.5 ${isRequested ? 'border-clay/30 bg-clay-tint/30' : 'border-line'}`}>
                  <div className="flex items-center gap-2">
                    <select
                      value={d.serviceId}
                      onChange={(e) => {
                        const svc = svcById[e.target.value]
                        setSvc(d.id, { serviceId: svc.id, durationMin: svc.durationMin })
                      }}
                      className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2 py-1 text-sm outline-none"
                    >
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <span className="tnum shrink-0 text-sm font-bold text-ink">${svcById[d.serviceId].price}</span>
                    {draft.length - removed.length > 1 && (
                      <button onClick={() => setRemoved((r) => [...r, d.id])} className="shrink-0 text-ink-faint hover:text-rust">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <select value={d.startMin} onChange={(e) => setSvc(d.id, { startMin: Number(e.target.value) })}
                      className="rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none">
                      {TIME_OPTIONS.map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                    </select>
                    <select value={d.durationMin} onChange={(e) => setSvc(d.id, { durationMin: Number(e.target.value) })}
                      className="rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none">
                      {DURATIONS.map((x) => <option key={x} value={x}>{x}m</option>)}
                    </select>
                    <select value={d.techId} onChange={(e) => setSvc(d.id, { techId: e.target.value })}
                      className="rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none">
                      <option value="first">First available</option>
                      {roles.map((role) => (
                        <optgroup key={role.id} label={role.name}>
                          {techs.filter((t) => t.teamId === role.id).sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
                      {heartColor && <Heart className="h-3 w-3 shrink-0" style={{ color: heartColor, fill: heartColor }} />}
                      Request
                    </span>
                    <select
                      value={requestKind}
                      onChange={(e) => {
                        const v = e.target.value
                        // a fresh request decision re-arms the gender-mismatch confirmation
                        if (v === 'pref-female' || v === 'pref-male' || v === 'issue') {
                          setSvc(d.id, { techId: v, techRequested: undefined, requestedTechChoice: undefined, genderMismatchOk: undefined })
                        } else if (v === 'requested') {
                          const concrete = d.techId === 'first' || d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue'
                            ? techs.find((t) => t.skills.includes(d.serviceId))?.id ?? 'first'
                            : d.techId
                          setSvc(d.id, { techId: concrete, techRequested: true, requestedTechChoice: undefined, genderMismatchOk: undefined })
                        } else {
                          setSvc(d.id, { techRequested: undefined, requestedTechChoice: undefined, genderMismatchOk: undefined })
                        }
                      }}
                      className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none"
                    >
                      <option value="any">Any tech</option>
                      <option value="requested">Requested</option>
                      <option value="pref-female">Female preferred</option>
                      <option value="pref-male">Male preferred</option>
                      <option value="issue">Issue</option>
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-1 text-right text-[11px] font-semibold text-ink-faint">Total <span className="tnum text-ink">${total.toFixed(2)}</span></div>
        </div>

        {/* notes */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Allergies, design references, preferences"
            className="w-full rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* actions — everything that isn't Save or Check out lives here, out of the
            footer's way, as a plain labeled grid like every other section above it */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Actions</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                setRebooking(true)
                setRebookSlot(null)
                // start the rail back on the appointment's own day (in case it
                // had been browsed elsewhere) — freely changeable below via
                // the arrows, the date picker, or picking a different day
                onPreviewDay(originDateKey)
              }}
              title="Book the same services and techs on a day/time you pick"
              className={actionBtn}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Rebook
            </button>
            <button onClick={() => onAction('copy')} title="Copy each service to the clipboard as its own entry" className={actionBtn}>
              <ClipboardCopy className="h-3.5 w-3.5" /> Copy to clipboard
            </button>
            <button onClick={() => onAction('sendtext')} title="Text the client" className={actionBtn}>
              <MessageSquare className="h-3.5 w-3.5" /> Text client
            </button>
            <button onClick={() => onAction('jobcard')} title="Print job card" className={actionBtn}>
              <Printer className="h-3.5 w-3.5" /> Print job card
            </button>
            <button onClick={() => onAction('log')} title="Show appointment log" className={actionBtn}>
              <ScrollText className="h-3.5 w-3.5" /> View log
            </button>
            {/* once money is actually being held on this booking there's
                nothing left to cancel -- keyed off what's currently
                collected (net of refunds), not just whether a payment
                record exists, so a fully-refunded ticket brings cancel
                back even though hasInvoice (used below for reopen/view
                invoice) stays true */}
            {!(hasInvoice && invoiceNetCollected > 0.004) && (
              <button
                onClick={() => onAction('cancel')}
                title="Cancel this appointment"
                className="flex items-center justify-center gap-1.5 rounded-[8px] border border-rust/40 py-2 text-[12px] font-semibold text-rust transition-colors hover:bg-rust-tint"
              >
                <CalendarX className="h-3.5 w-3.5" /> Cancel appointment
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-[12px] font-medium text-rust">{error}</p>}
      </div>

      {/* day & time rail, same slot-finding mechanism as booking a new appointment.
          picking a day here navigates the calendar behind this panel so it's visible */}
      <div className="w-[194px] shrink-0 overflow-y-auto border-l border-line p-3">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Day</label>
        <div className="mb-3 flex items-center gap-1">
          <button
            onClick={() => shiftDay(-1)}
            title="Previous day"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line text-ink-faint hover:bg-cream hover:text-ink"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => setDayPickerAnchor(e.currentTarget.getBoundingClientRect())}
            title="Choose a date"
            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-[8px] border border-line px-1.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-cream"
          >
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="truncate">{dayLabelOf(dateKey)}</span>
          </button>
          <button
            onClick={() => shiftDay(1)}
            title="Next day"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line text-ink-faint hover:bg-cream hover:text-ink"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {rebooking ? (
          <div className="mb-3 rounded-[8px] border border-clay/30 bg-clay-tint/30 px-2 py-1.5 text-[10.5px] font-semibold text-clay">
            Rebooking — pick a day and time for a new copy, same services and techs
          </div>
        ) : dateKey !== originDateKey && (
          <div className="mb-3 rounded-[8px] border border-clay/30 bg-clay-tint/30 px-2 py-1.5 text-[10.5px] font-semibold text-clay">
            Save changes to move this appointment to {dayLabelOf(dateKey)}
          </div>
        )}
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Available times{spanOf(svcIds, isParallelGroup) > 0 && ` (${spanOf(svcIds, isParallelGroup)}m)`}
        </label>
        {slotPlans.length === 0 && (
          <div className="text-[11px] text-ink-faint">No slots this day</div>
        )}
        <div className="space-y-1">
          {slotPlans.map(({ start: s, status, moves }) => {
            const selected = rebooking
              ? rebookSlot?.dateKey === dateKey && rebookSlot?.startMin === s
              : dateKey === originDateKey && s === groupStart
            const pick = () => (rebooking ? setRebookSlot({ dateKey, startMin: s }) : applySlot(s))
            return (
              <button
                key={s}
                onClick={() => {
                  if (selected) return
                  if (status === 'open') pick()
                  else if (status === 'movable' && moves) onRequestMakeRoom(moves, s, pick)
                  else pick()
                }}
                title={
                  status === 'blocked' ? 'No qualified tech free — saving this will double-book a tech'
                  : status === 'movable' ? `Selecting this moves ${moves!.length} other booking${moves!.length > 1 ? 's' : ''} to make room`
                  : undefined
                }
                className={`flex w-full items-center gap-1.5 rounded-[8px] border px-2 py-1.5 text-[12px] ${
                  selected
                    ? 'border-clay bg-clay-tint font-bold text-clay'
                    : status === 'blocked'
                      ? 'border-amber-400/60 bg-amber-400/10 font-bold text-amber-700 hover:bg-amber-400/20'
                      : 'border-line font-bold text-ink hover:bg-cream'
                }`}
              >
                {status === 'blocked' ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
                {fmtTime(s)}
              </button>
            )
          })}
        </div>
      </div>
      </div>

      {dayPickerAnchor && (
        <DatePickerPopover
          anchor={dayPickerAnchor}
          selected={dateKey}
          today={dayKeyOf(new Date())}
          appointmentDates={new Set()}
          onSelect={(ds) => { setDayPickerAnchor(null); onPreviewDay(ds) }}
          onClose={() => setDayPickerAnchor(null)}
        />
      )}

      {/* footer — pinned outside the scrolling panel above so Check out / View
          receipt / Reopen checkout and Save are always in view, never pushed
          off by notes or a long service list. Check out, View/print receipt,
          and Reopen checkout are the working payment actions today (the old
          Send payment link / Take payment placeholders were disabled stubs
          for a feature that was never built). Reopen checkout reads as
          "Check out {name}" instead while a balance is still owed, since the
          ticket isn't really done yet. While rebooking, this swaps to a
          dedicated Cancel / Confirm pair so it's never confused with Save
          (which edits *this* booking, not the new copy) */}
      <div className="space-y-1.5 border-t border-line p-3">
        {rebooking ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => { setRebooking(false); setRebookSlot(null) }}
              className={`flex-1 ${actionBtn}`}
            >
              Cancel rebook
            </button>
            <button
              onClick={() => rebookSlot && onRebook(rebookSlot.dateKey, rebookSlot.startMin)}
              disabled={!rebookSlot}
              className="flex flex-[2] items-center justify-center gap-2 rounded-[10px] bg-clay py-2.5 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep disabled:opacity-40"
            >
              <RefreshCw className="h-4 w-4" />
              {rebookSlot ? `Rebook to ${dayLabelOf(rebookSlot.dateKey)}, ${fmtTime(rebookSlot.startMin)}` : 'Pick a day and time'}
            </button>
          </div>
        ) : (
          <>
            {appt.status === 'requested' && (
              <button
                onClick={() => applyStatus('booked')}
                title="Confirm this request and put it on the book as a real booking"
                className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-clay py-2.5 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep"
              >
                <Check className="h-4 w-4" /> Confirm booking
              </button>
            )}
            {(canCheckout || hasInvoice) && (
              <div className="grid grid-cols-2 gap-1.5">
                {canCheckout && (
                  <button
                    onClick={() => canCheckoutDay && onAction('checkout')}
                    disabled={!canCheckoutDay}
                    title={canCheckoutDay ? undefined : 'Checkout isn\'t available until this appointment\'s day arrives'}
                    className={`${actionBtn} ${!hasInvoice ? 'col-span-2' : ''} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <CreditCard className="h-3.5 w-3.5" /> Check out {appt.clientName.split(' ')[0]}
                  </button>
                )}
                {hasInvoice && (
                  <button onClick={() => onAction('invoice')} className={actionBtn}>
                    <Receipt className="h-3.5 w-3.5" /> View / print receipt
                  </button>
                )}
                {hasInvoice && (
                  <button
                    onClick={() => onAction('reopen')}
                    className={actionBtn}
                    title={
                      invoiceBalanceDue > 0.004
                        ? 'Finish checking out — a balance is still owed on this ticket'
                        : 'Correct the service total or tip, or refund this ticket, in full or partial'
                    }
                  >
                    {invoiceBalanceDue > 0.004
                      ? <><CreditCard className="h-3.5 w-3.5" /> Check out {appt.clientName.split(' ')[0]}</>
                      : <><Undo2 className="h-3.5 w-3.5" /> Reopen Checkout</>}
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => onSave(
                draft.map((d) => ({ ...d, status: d.id === appt.id ? status : d.status, notes: d.id === appt.id ? notes || undefined : d.notes })),
                removed,
                dateKey !== originDateKey ? dateKey : undefined,
              )}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-clay py-2.5 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep"
            >
              <Clock className="h-4 w-4" /> {dateKey !== originDateKey ? `Save & move to ${dayLabelOf(dateKey)}` : 'Save changes'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
