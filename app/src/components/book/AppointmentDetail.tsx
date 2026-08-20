import { useMemo, useState } from 'react'
import {
  AlertTriangle, Calendar, CalendarX, Check, ChevronLeft, ChevronRight, ClipboardCopy, Clock, CreditCard, Heart, History, Link2, Mail, MessageSquare, Phone, Plus, Printer, Receipt, RefreshCw, ScrollText, Undo2, UserPlus, Users, X,
} from 'lucide-react'
import type { Appointment, ClientRecord, TimeBlock } from '@/lib/booking-types'
import { CLOSE_MIN, OPEN_MIN, fmtTime } from '@/lib/booking-types'
import { useSettingsStore } from '@/lib/settings-store'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { activeServices as activeCatalog, orderedServices, serviceGroupLabel, svcById, useServicesStore } from '@/lib/services-store'
import { useCategoriesStore } from '@/lib/categories-store'
import { allSlotsFor, layoutItems, spanOf, type SlotGroup } from './BookingPanel'
import { DatePickerPopover } from './LegendPopover'
import { SearchSelect } from './SearchSelect'

const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

/** shared style for the Actions/Payment grid buttons, so every tile in
 *  those sections reads as one consistent family regardless of label length */
const actionBtn =
  'flex items-center justify-center gap-1.5 rounded-[8px] border border-line py-2 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink'

export type DetailAction = 'cancel' | 'copy' | 'sendtext' | 'checkout' | 'log' | 'jobcard' | 'invoice' | 'reopen'

interface Props {
  appt: Appointment
  /** how many distinct clients share this booking's time slot (a real party
   *  checking out together) */
  partySize: number
  /** every appointment sharing this booking's parallelGroup, across every
   *  guest — the chips row above the service list picks which guest's own
   *  services are currently shown/editable below, same as the New
   *  Appointment panel's guest chips */
  party: Appointment[]
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
  /** `added` is any brand-new guest(s) or service(s) staged via the party
   *  chips / "Add service" below — real appointment records with fresh ids
   *  that don't exist on the board yet, for the caller to insert alongside
   *  the usual update/remove */
  onSave: (updated: Appointment[], removedIds: string[], moveToDayKey?: string, added?: Appointment[]) => void
  /** register a brand-new client record -- "create a full account" in the
   *  add-guest picker below, same as New Appointment's own guest picker */
  onAddClient: (c: ClientRecord) => void
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
  appt, partySize, party, clients, error, originDateKey, dateKey, onPreviewDay, dayAppts, dayBlocks,
  findMakeRoomPlan, onRequestMakeRoom, onSave, onAddClient, onAction, onRebook, onViewProfile, onShowVisits, onClose,
  canCheckout, hasInvoice, invoiceBalanceDue, invoiceNetCollected,
}: Props) {
  const increment = useSettingsStore().booking.increment
  const TIME_OPTIONS = Array.from({ length: (CLOSE_MIN - OPEN_MIN) / increment }, (_, i) => i * increment)
  // live catalog -- so a service just added or removed in Settings shows
  // up here immediately instead of the stale baseline list
  const services = activeCatalog(useServicesStore())
  const categories = useCategoriesStore()
  // same order + category/subcategory grouping as the Settings service list
  const svcOptions = orderedServices(services, categories).map((s) => ({ value: s.id, label: s.name, group: serviceGroupLabel(s, categories) }))
  const { roles, techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  // every appointment in the party, editable regardless of which guest it
  // belongs to -- the chips row above the service list (like the New
  // Appointment panel's own guest chips) picks which guest's services show
  // in the editable list below. `originalIds` is a frozen snapshot of which
  // of these already existed on the board when the panel opened, so Save
  // can split the working set back into "update" vs. "insert" without
  // re-deriving that on every edit
  const [draft, setDraft] = useState<Appointment[]>(party.map((p) => ({ ...p })))
  const [originalIds] = useState(() => new Set(party.map((p) => p.id)))
  const [removed, setRemoved] = useState<string[]>([])
  const [activeGuest, setActiveGuest] = useState(appt.clientName)
  const [status, setStatus] = useState(appt.status)
  const [notes, setNotes] = useState(appt.notes ?? '')
  const [dayPickerAnchor, setDayPickerAnchor] = useState<DOMRect | null>(null)
  // rebooking: picking a day/time for a fresh copy of these same services and
  // techs, using the exact same day rail below (browse days, see openings) —
  // distinct from the rail's normal job of moving *this* appointment
  const [rebooking, setRebooking] = useState(false)
  const [rebookSlot, setRebookSlot] = useState<{ dateKey: string; startMin: number } | null>(null)
  const [addingGuest, setAddingGuest] = useState(false)
  const [guestQuery, setGuestQuery] = useState('')
  const [newAccountPhone, setNewAccountPhone] = useState('')

  // checkout runs against today or any past day -- the service already
  // happened, it just hasn't been rung up yet. Only a future day is blocked,
  // since that appointment hasn't happened at all. Reopening a ticket has no
  // such restriction either way: it doesn't redo checkout, it just opens the
  // still-recorded payment for correction or refund
  const canCheckoutDay = originDateKey <= dayKeyOf(new Date())
  const client = clients.find((c) => c.name === appt.clientName)
  const liveDraft = draft.filter((d) => !removed.includes(d.id))
  const setSvc = (id: string, patch: Partial<Appointment>) =>
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  // every guest still in the party (this client first, then everyone else in
  // first-seen order) -- the chips row uses this to switch which guest's
  // services show in the editable list below, same as the New Appointment
  // panel's own guest chips
  const guestNames = useMemo(() => {
    const order: string[] = []
    for (const d of liveDraft) if (!order.includes(d.clientName)) order.push(d.clientName)
    return order.sort((a, b) => (a === appt.clientName ? -1 : b === appt.clientName ? 1 : 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, removed, appt.clientName])
  const activeSvcs = liveDraft.filter((d) => d.clientName === activeGuest)
  // clients not already in this party -- the add-guest picker only offers
  // someone genuinely new
  const availableClients = clients.filter((c) => !guestNames.includes(c.name))
  // matches while typing in the add-guest search -- same search shape as
  // BookingPanel's own AddAnotherGuest (name or phone digits)
  const guestMatches = useMemo(() => {
    const q = guestQuery.trim().toLowerCase()
    if (!q) return []
    const digits = guestQuery.replace(/\D/g, '')
    return availableClients
      .filter((c) => c.name.toLowerCase().includes(q) || (digits && c.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestQuery, availableClients])

  // dropping a guest entirely (the chip's X, not a per-service remove): ids
  // that already existed on the board go through the normal `removed` array
  // (Save filters those out generically, across the whole day); ids only
  // staged locally this session -- never actually saved -- can just be
  // dropped outright
  const removeGuest = (name: string) => {
    if (name === appt.clientName) return
    const ids = liveDraft.filter((d) => d.clientName === name).map((d) => d.id)
    setRemoved((r) => [...r, ...ids.filter((id) => originalIds.has(id))])
    setDraft((d) => d.filter((x) => !(x.clientName === name && !originalIds.has(x.id))))
    if (activeGuest === name) setActiveGuest(appt.clientName)
  }

  // adding someone new to the party stages a real draft appointment right in
  // `draft`, with one default service so it's immediately visible and
  // editable below -- same as adding another service to whoever's already
  // active, both stay purely local until Save actually commits them
  const addGuestClient = (c: ClientRecord) => {
    const svc = services[0]
    if (!svc) return
    setDraft((d) => [...d, {
      id: `a${Date.now()}-party${d.length}`,
      techId: 'first',
      clientName: c.name,
      serviceId: svc.id,
      startMin: appt.startMin,
      durationMin: svc.durationMin,
      status: 'booked',
      bookingSource: 'front_desk',
      parallelGroup: appt.parallelGroup,
    }])
    setActiveGuest(c.name)
    setAddingGuest(false)
    setGuestQuery('')
  }

  // a guest with no profile of their own -- name only, linked to this
  // client's profile (same as a name-only guest added from New Appointment,
  // shows up under their Guests tab once Save actually registers it)
  const addGuestNameOnly = (name: string) => {
    const trimmed = name.trim()
    const svc = services[0]
    if (!trimmed || !svc || guestNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return
    setDraft((d) => [...d, {
      id: `a${Date.now()}-party${d.length}`,
      techId: 'first',
      clientName: trimmed,
      serviceId: svc.id,
      startMin: appt.startMin,
      durationMin: svc.durationMin,
      status: 'booked',
      bookingSource: 'front_desk',
      parallelGroup: appt.parallelGroup,
      guestOf: client?.id,
    }])
    setActiveGuest(trimmed)
    setAddingGuest(false)
    setGuestQuery('')
  }

  // or a full account for someone who doesn't have one yet, phone required --
  // same as New Appointment's own "create a full account" option
  const addGuestNewAccount = (name: string, phone: string) => {
    const trimmedName = name.trim()
    const trimmedPhone = phone.trim()
    if (!trimmedName || !trimmedPhone) return
    const c: ClientRecord = { id: `c${Date.now()}`, name: trimmedName, phone: trimmedPhone, visits: 0 }
    onAddClient(c)
    addGuestClient(c)
    setNewAccountPhone('')
  }

  const addService = (clientName: string) => {
    const svc = services[0]
    if (!svc) return
    setDraft((d) => [...d, {
      id: `a${Date.now()}-svc${d.length}`,
      techId: 'first',
      clientName,
      serviceId: svc.id,
      startMin: appt.startMin,
      durationMin: svc.durationMin,
      status: 'booked',
      bookingSource: 'front_desk',
      parallelGroup: appt.parallelGroup,
    }])
  }

  // Save's `updated` must only contain ids that already exist on the board
  // (saveDetail's relocation/gender/banned pipeline compares against the
  // board to tell what's actually changing); anything staged this session --
  // a new guest, or a new service on anyone -- goes through `added` instead,
  // so it's inserted rather than matched against an id that was never there
  const splitForSave = (list: Appointment[]) => ({
    updated: list.filter((d) => originalIds.has(d.id)),
    added: list.filter((d) => !originalIds.has(d.id)),
  })

  // changing the Status dropdown applies to every one of this client's own
  // linked services (mirrors the right-click Confirm/Check in/etc. actions,
  // which move a whole booking as one unit) and saves immediately — no
  // separate "Save changes" click needed for a plain status change. onSave
  // (saveDetail in AppointmentBook) closes the panel itself once the save
  // actually goes through, so a pending double-book/gender-mismatch
  // confirmation still keeps the panel's error state visible instead of
  // being masked by an unconditional close here
  // the Status dropdown always applies to appt.clientName's own services
  // specifically, never the rest of the party -- each guest's status is
  // tracked independently (one checked in, another still just booked)
  const applyStatus = (v: Appointment['status']) => {
    setStatus(v)
    const kept = liveDraft.map((d) => ({
      ...d,
      status: d.clientName === appt.clientName ? v : d.status,
      notes: d.id === appt.id ? notes || undefined : d.notes,
    }))
    const { updated, added } = splitForSave(kept)
    onSave(updated, removed, dateKey !== originDateKey ? dateKey : undefined, added)
  }

  const total = activeSvcs.reduce((s, d) => s + svcById[d.serviceId].price, 0)

  // ── day & time rail, same slot-finding mechanism as booking a new appointment.
  // scoped to whichever guest is active via the chips above, so switching
  // guests re-targets the rail at their own services. `dateKey` is the day
  // the calendar behind this panel is showing right now — browsing it via
  // the rail below actually navigates that calendar (onPreviewDay) so the
  // salon can see the board, while `originDateKey` stays fixed at the
  // appointment's real day so Save knows whether this is actually a move ──
  const svcIds = activeSvcs.map((d) => d.serviceId)
  const isParallelGroup = activeSvcs.length > 1 && activeSvcs.every((d) => d.startMin === activeSvcs[0].startMin)
  const groupStart = activeSvcs[0]?.startMin
  const selfIds = new Set(activeSvcs.map((d) => d.id))
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
    activeSvcs.forEach((d, i) => setSvc(d.id, { startMin: s + (items[i]?.offset ?? 0) }))
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

        {/* party — every guest sharing this booking, as a row of chips, same
            as the New Appointment panel. Click a chip to edit that guest's
            own services below; the X drops them from the party entirely
            (this client's own chip has none — you can't remove yourself).
            Adding someone new stages them here with one default service,
            ready to edit like any other row the moment they're selected */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <Users className="h-3 w-3" /> Party{guestNames.length > 1 ? ` (${guestNames.length})` : ''}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {guestNames.map((name) => (
              <div
                key={name}
                className={`flex items-center gap-1 rounded-[8px] border py-1 pl-2.5 pr-1 text-[12px] font-semibold ${
                  activeGuest === name ? 'border-clay bg-clay-tint text-clay' : 'border-line text-ink hover:bg-cream'
                }`}
              >
                <button type="button" onClick={() => setActiveGuest(name)} className="flex items-center gap-1">
                  {name}
                  <span className={`font-normal ${activeGuest === name ? 'text-clay/70' : 'text-ink-faint'}`}>
                    {liveDraft.filter((d) => d.clientName === name).length} svc
                  </span>
                </button>
                {name !== appt.clientName && (
                  <button
                    type="button"
                    onClick={() => removeGuest(name)}
                    title={`Remove ${name} from this party`}
                    className="rounded-[6px] p-0.5 text-ink-faint hover:text-rust"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            {addingGuest ? (
              <div
                className="relative"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setAddingGuest(false); setGuestQuery('') }
                }}
              >
                <div className="flex items-center gap-1 rounded-[8px] border border-dashed border-clay/40 bg-clay-tint/20 py-0.5 pl-1 pr-1">
                  <input
                    autoFocus
                    value={guestQuery}
                    onChange={(e) => setGuestQuery(e.target.value)}
                    placeholder="Guest name or phone number"
                    className="w-40 bg-transparent px-1.5 py-1 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    onMouseDown={() => { setAddingGuest(false); setGuestQuery('') }}
                    className="shrink-0 text-ink-faint hover:text-rust"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {guestQuery.trim() && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-[8px] border border-line bg-popover shadow-xl">
                    {guestMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => addGuestClient(c)}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cream"
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
                        <span className="shrink-0 text-[10px] text-ink-faint">{c.phone}</span>
                      </button>
                    ))}
                    {/* name-only guest, no profile, linked to appt.clientName */}
                    <button
                      type="button"
                      onMouseDown={() => addGuestNameOnly(guestQuery)}
                      className="flex w-full items-center gap-2 border-t border-line bg-clay-tint/20 px-2.5 py-2 text-left text-[12px] hover:bg-clay-tint/40"
                    >
                      <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-ink">Add &ldquo;{guestQuery.trim()}&rdquo; as guest</span>
                        <span className="block text-[10px] text-ink-faint">name only, no profile, links to {appt.clientName}</span>
                      </span>
                    </button>
                    {/* or create a full account for them, phone required */}
                    <div className="border-t border-line p-1.5">
                      <div className="flex items-center gap-1">
                        <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                        <input
                          value={newAccountPhone}
                          onChange={(e) => setNewAccountPhone(e.target.value)}
                          placeholder={`New account "${guestQuery.trim()}", phone`}
                          className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
                        />
                        <button
                          type="button"
                          disabled={!guestQuery.trim() || !newAccountPhone.trim()}
                          onMouseDown={() => addGuestNewAccount(guestQuery, newAccountPhone)}
                          className="rounded-[8px] bg-clay px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                      <p className="mt-1 pl-5 text-[10px] text-ink-faint">phone required for an account, or use the guest option above</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingGuest(true)}
                className="flex items-center gap-1 rounded-[8px] border border-dashed border-line py-1 pl-2 pr-2.5 text-[12px] font-semibold text-ink-soft hover:bg-cream"
              >
                <UserPlus className="h-3 w-3" /> Add guest
              </button>
            )}
          </div>
        </div>

        {/* services */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Service details{guestNames.length > 1 ? ` — ${activeGuest}` : ''}{activeSvcs.length > 1 ? ` (${activeSvcs.length})` : ''}
          </label>
          <div className="space-y-2">
            {activeSvcs.map((d) => {
              const isRequested = !!d.techRequested
              const requestKind =
                d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue' ? d.techId
                : d.techRequested ? 'requested'
                : d.requestedTechChoice === 'pref-female' || d.requestedTechChoice === 'pref-male' ? d.requestedTechChoice
                : 'any'
              const heartColor = REQUEST_HEART_COLOR[requestKind]
              // the tech's own call, not the client's -- still bookable, just
              // flagged so the front desk sees it before going ahead (see
              // Settings → Techs → Clients not taken). Looked up against
              // THIS row's own guest, not always appt.clientName, since the
              // active guest can be anyone in the party now
              const rowClient = clients.find((c) => c.name === d.clientName)
              const bannedTech = rowClient ? techs.find((t) => t.id === d.techId && (t.bannedClientIds ?? []).includes(rowClient.id)) : undefined
              return (
                <div key={d.id} className={`rounded-xl border p-2.5 ${isRequested ? 'border-clay/30 bg-clay-tint/30' : 'border-line'}`}>
                  <div className="flex items-center gap-2">
                    <SearchSelect
                      options={svcOptions}
                      value={d.serviceId}
                      onChange={(v) => {
                        const svc = svcById[v]
                        setSvc(d.id, { serviceId: svc.id, durationMin: svc.durationMin })
                      }}
                      searchPlaceholder="Search services"
                      className="min-w-0 flex-1"
                    />
                    <span className="tnum shrink-0 text-sm font-bold text-ink">${svcById[d.serviceId].price}</span>
                    {activeSvcs.length > 1 && (
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
                    <SearchSelect
                      options={[
                        { value: 'first', label: 'First available' },
                        ...roles.flatMap((role) => techs.filter((t) => t.teamId === role.id).sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
                          value: t.id, label: t.name, group: role.name,
                        }))),
                      ]}
                      value={d.techId}
                      onChange={(v) => setSvc(d.id, { techId: v })}
                      searchPlaceholder="Search technicians"
                    />
                  </div>
                  {bannedTech && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-rust">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {bannedTech.name} has stopped taking {d.clientName.split(' ')[0]}
                    </p>
                  )}
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
          <button
            type="button"
            onClick={() => addService(activeGuest)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line py-1.5 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            <Plus className="h-3.5 w-3.5" /> Add service
          </button>
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
              onClick={() => {
                const kept = liveDraft.map((d) => ({
                  ...d,
                  status: d.id === appt.id ? status : d.status,
                  notes: d.id === appt.id ? notes || undefined : d.notes,
                }))
                const { updated, added } = splitForSave(kept)
                onSave(updated, removed, dateKey !== originDateKey ? dateKey : undefined, added)
              }}
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
