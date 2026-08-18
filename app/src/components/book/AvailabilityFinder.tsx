import { useMemo, useState } from 'react'
import {
  AlertTriangle, Calendar, CalendarSearch, Check, ChevronLeft, ChevronRight, Clock, Plus, Search, UserPlus, X,
} from 'lucide-react'
import type { Appointment, ClientRecord, TimeBlock } from '@/lib/booking-types'
import { fmtTime } from '@/lib/booking-types'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { activeServices, svcById, useServicesStore } from '@/lib/services-store'
import { DatePickerPopover } from './LegendPopover'
import { Sel, layoutItems, allSlotsFor, type BookedService, type SlotGroup } from './BookingPanel'

/** small local date helpers, duplicated from AppointmentBook/BookingPanel to avoid a circular import */
function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabelOf(key: string) {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}
let uid = 0
function newId(prefix: string) {
  uid += 1
  return `${prefix}${Date.now()}-${uid}`
}

interface FinderService {
  serviceId: string
  /** '' = any qualified tech, 'pref-female'/'pref-male' = soft gender preference, or a specific techId */
  techChoice: string
}

interface FinderGuest {
  id: string
  clientId: string | null
  name: string
  phone?: string
  services: FinderService[]
  /** run this guest's services at the same time (different techs) instead of back-to-back */
  parallel: boolean
}

interface Props {
  appts: Appointment[]
  blocks: TimeBlock[]
  clients: ClientRecord[]
  onAddClient: (c: ClientRecord) => void
  dateKey: string
  onPreviewDay: (key: string) => void
  findMakeRoomPlan: (groups: SlotGroup[], startMin: number) => Appointment[] | null
  onRequestMakeRoom: (moves: Appointment[], startMin: number, thenSelect: () => void) => void
  onBook: (services: BookedService[], linkGroup: boolean) => void
  onViewProfile: (clientName: string) => void
  onClose: () => void
}

/** compact client search + quick-create, used per guest slot — every guest here
 *  must resolve to a real client record (no name-only guests, unlike the booking panel) */
function ClientPicker({ clients, exclude, onPick, onCreate }: {
  clients: ClientRecord[]
  exclude: Set<string>
  onPick: (c: ClientRecord) => void
  onCreate: (name: string, phone: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const text = q.toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clients
      .filter((c) => !exclude.has(c.id))
      .filter((c) => c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 6)
  }, [q, clients, exclude])

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}>
      <Search className="pointer-events-none absolute left-2.5 top-[9px] h-3.5 w-3.5 text-ink-faint" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search a client by name or phone"
        className="w-full rounded-[8px] border border-input bg-background py-2 pl-8 pr-3 text-[13px] outline-none focus:ring-1 focus:ring-ring"
      />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-popover shadow-xl">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={() => { onPick(c); setQ('') }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cream"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[9px] font-bold text-clay">
                {initials(c.name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
              <span className="text-[10px] text-ink-faint">{c.phone}</span>
            </button>
          ))}
          {matches.length === 0 && <div className="px-2.5 py-2 text-[11px] text-ink-faint">No matching clients</div>}
          <div className="border-t border-line p-1.5">
            <div className="flex items-center gap-1">
              <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={`New client "${q}", phone`}
                className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
              />
              <button
                type="button"
                disabled={!q.trim() || !phone.trim()}
                onMouseDown={() => { if (q.trim() && phone.trim()) { onCreate(q.trim(), phone.trim()); setQ(''); setPhone('') } }}
                className="rounded-[8px] bg-clay px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="mt-1 pl-5 text-[10px] text-ink-faint">phone required to create a client record</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** a standalone planning tool: enter several guests, each with their own services and
 *  specific-or-any tech requests, and find the first shared opening across everyone —
 *  then hand off straight into booking it, no re-entering anything */
export function AvailabilityFinder({
  appts, blocks, clients, onAddClient, dateKey, onPreviewDay, findMakeRoomPlan, onRequestMakeRoom, onBook, onViewProfile, onClose,
}: Props) {
  // live catalog -- so a service just added or removed in Settings shows
  // up here immediately instead of the stale baseline list
  const services = activeServices(useServicesStore())
  const { techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  const [guests, setGuests] = useState<FinderGuest[]>([{ id: newId('fg'), clientId: null, name: '', services: [], parallel: false }])
  const [time, setTime] = useState<number | null>(null)
  const [dayPickerAnchor, setDayPickerAnchor] = useState<DOMRect | null>(null)

  const pickedClientIds = useMemo(() => new Set(guests.map((g) => g.clientId).filter((x): x is string => !!x)), [guests])

  const addGuest = () => setGuests((g) => [...g, { id: newId('fg'), clientId: null, name: '', services: [], parallel: false }])
  const removeGuest = (id: string) => setGuests((g) => (g.length > 1 ? g.filter((x) => x.id !== id) : g))
  const pickClient = (id: string, c: ClientRecord) =>
    setGuests((g) => g.map((x) => (x.id === id ? { ...x, clientId: c.id, name: c.name, phone: c.phone } : x)))
  const createAndPick = (id: string, name: string, phone: string) => {
    const c: ClientRecord = { id: newId('c'), name, phone, visits: 0 }
    onAddClient(c)
    pickClient(id, c)
  }
  const clearClient = (id: string) => setGuests((g) => g.map((x) => (x.id === id ? { ...x, clientId: null, name: '', phone: undefined } : x)))
  const addService = (id: string, svcId: string) =>
    setGuests((g) => g.map((x) => (x.id === id && !x.services.some((s) => s.serviceId === svcId)
      ? { ...x, services: [...x.services, { serviceId: svcId, techChoice: '' }] } : x)))
  const removeService = (id: string, svcId: string) =>
    setGuests((g) => g.map((x) => (x.id === id ? { ...x, services: x.services.filter((s) => s.serviceId !== svcId) } : x)))
  const setTechChoice = (id: string, svcId: string, choice: string) =>
    setGuests((g) => g.map((x) => (x.id === id
      ? { ...x, services: x.services.map((s) => (s.serviceId === svcId ? { ...s, techChoice: choice } : s)) } : x)))
  const setParallel = (id: string, p: boolean) => setGuests((g) => g.map((x) => (x.id === id ? { ...x, parallel: p } : x)))

  // only guests with a real client picked and at least one service count toward the search
  const groups = useMemo<SlotGroup[]>(
    () => guests.filter((g) => g.clientId && g.services.length > 0).map((g) => {
      const techChoices: Record<string, string> = {}
      for (const s of g.services) if (s.techChoice) techChoices[s.serviceId] = s.techChoice
      return { svcIds: g.services.map((s) => s.serviceId), parallel: g.parallel, techChoices }
    }),
    [guests],
  )
  const readyGuestCount = groups.length
  const totalServiceCount = groups.reduce((n, g) => n + g.svcIds.length, 0)

  // each slot is 'open' (fits as-is), 'movable' (fits if a non-requested booking
  // gets relocated), or 'blocked' (would double-book) — same three states the
  // new-appointment panel uses, so the color language stays consistent
  const slotPlans = useMemo(() => {
    if (groups.length === 0) return []
    return allSlotsFor(appts, groups, blocks).map(({ start, available }) => {
      if (available) return { start, status: 'open' as const, moves: undefined as Appointment[] | undefined }
      const moves = findMakeRoomPlan(groups, start)
      return { start, status: moves ? ('movable' as const) : ('blocked' as const), moves: moves ?? undefined }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appts, blocks, groups])

  const selectTime = (s: number) => setTime(s)

  const shiftDay = (delta: number) => {
    const d = new Date(dateKey + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    onPreviewDay(dayKeyOf(d))
  }

  const bookNow = () => {
    if (time == null || groups.length === 0) return
    const out: BookedService[] = []
    guests.forEach((g) => {
      if (!g.clientId || g.services.length === 0) return
      const items = layoutItems(g.services.map((s) => s.serviceId), g.parallel)
      items.forEach((item) => {
        const svcInfo = g.services.find((s) => s.serviceId === item.serviceId)!
        const choice = svcInfo.techChoice
        const techVal = choice === 'pref-female' || choice === 'pref-male' ? choice : (choice || 'first')
        out.push({
          clientName: g.name,
          serviceId: item.serviceId,
          techId: techVal,
          startMin: time + item.offset,
          durationMin: item.durationMin,
          addons: [],
          techRequested: choice && choice !== 'pref-female' && choice !== 'pref-male' ? true : undefined,
        })
      })
    })
    if (out.length === 0) return
    onBook(out, guests.filter((g) => g.clientId).length > 1 || out.length > 1)
  }

  const renderGuest = (g: FinderGuest, gi: number) => (
    <div key={g.id} className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Guest {gi + 1}</span>
        {guests.length > 1 && (
          <button
            onClick={() => removeGuest(g.id)}
            title="Remove guest"
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-cream hover:text-rust"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {g.clientId ? (
        <div className="mb-3 flex items-center gap-2 rounded-[8px] bg-cream px-2.5 py-1.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[10px] font-bold text-clay">
            {initials(g.name)}
          </span>
          <div className="min-w-0 flex-1">
            <button onClick={() => onViewProfile(g.name)} className="block truncate text-[13px] font-bold text-ink hover:text-clay" title="Open guest profile">
              {g.name}
            </button>
            {g.phone && <span className="block text-[10.5px] text-ink-faint">{g.phone}</span>}
          </div>
          <button onClick={() => clearClient(g.id)} className="shrink-0 text-[10.5px] font-semibold text-clay hover:underline">Change</button>
        </div>
      ) : (
        <div className="mb-3">
          <ClientPicker
            clients={clients}
            exclude={pickedClientIds}
            onPick={(c) => pickClient(g.id, c)}
            onCreate={(name, phone) => createAndPick(g.id, name, phone)}
          />
        </div>
      )}

      {g.services.length > 0 && (
        <div className="space-y-1.5">
          {g.services.map((s) => {
            const svc = svcById[s.serviceId]
            const qualified = techs.filter((t) => t.skills.includes(s.serviceId))
            return (
              <div key={s.serviceId} className="flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">
                  {svc?.name ?? s.serviceId}
                  <span className="ml-1 font-normal text-ink-faint">${svc?.price} · {svc?.durationMin}m</span>
                </span>
                <Sel value={s.techChoice} onChange={(v) => setTechChoice(g.id, s.serviceId, v)} title="Technician" className="w-[136px] shrink-0">
                  <option value="">Any tech</option>
                  <option value="pref-female">Female preferred</option>
                  <option value="pref-male">Male preferred</option>
                  {qualified.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Sel>
                <button
                  onClick={() => removeService(g.id, s.serviceId)}
                  title="Remove service"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-cream hover:text-rust"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className={g.services.length > 0 ? 'mt-2' : ''}>
        <Sel value="" onChange={(v) => v && addService(g.id, v)} title="Add a service" className="w-full">
          <option value="">+ Add a service…</option>
          {services.filter((sv) => !g.services.some((s) => s.serviceId === sv.id)).map((sv) => (
            <option key={sv.id} value={sv.id}>{sv.name} · {sv.durationMin}m</option>
          ))}
        </Sel>
      </div>

      {g.services.length >= 2 && (
        <div className="mt-2 flex items-center gap-1 rounded-[8px] bg-cream p-1 text-[11px] font-semibold">
          <button
            onClick={() => setParallel(g.id, false)}
            className={`flex-1 rounded-[6px] py-1 transition-colors ${!g.parallel ? 'bg-white text-ink shadow-sm' : 'text-ink-faint'}`}
          >
            One after another
          </button>
          <button
            onClick={() => setParallel(g.id, true)}
            className={`flex-1 rounded-[6px] py-1 transition-colors ${g.parallel ? 'bg-white text-ink shadow-sm' : 'text-ink-faint'}`}
          >
            Same time
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-y-0 right-0 z-[85] flex w-[634px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* header */}
      <div className="border-b border-line bg-cream px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay-tint text-clay">
            <CalendarSearch className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-ink">Find a Time</div>
            <div className="mt-0.5 text-[11px] text-ink-faint">Match every guest&rsquo;s tech requests to one shared opening</div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* guests + services */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {guests.map((g, gi) => renderGuest(g, gi))}
          <button
            onClick={addGuest}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2 text-[12px] font-semibold text-ink-faint transition-colors hover:border-clay/40 hover:text-clay"
          >
            <Plus className="h-3.5 w-3.5" /> Add another guest
          </button>
        </div>

        {/* day + matching-times panel */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-line p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Day</div>
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
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Matching times</div>
          {groups.length === 0 && (
            <div className="text-[11px] text-ink-faint">Add a guest with at least one service to search.</div>
          )}
          {groups.length > 0 && slotPlans.length === 0 && (
            <div className="text-[11px] text-ink-faint">No openings this day.</div>
          )}
          <div className="space-y-1">
            {slotPlans.map(({ start: s, status, moves }) => (
              <button
                key={s}
                onClick={() => {
                  if (status === 'movable' && moves) onRequestMakeRoom(moves, s, () => selectTime(s))
                  else selectTime(s)
                }}
                title={
                  status === 'blocked' ? 'No qualified tech free for everyone — booking this will double-book a tech'
                    : status === 'movable' ? `Selecting this moves ${moves!.length} other booking${moves!.length > 1 ? 's' : ''} to make room`
                      : undefined
                }
                className={`flex w-full items-center gap-1.5 rounded-[8px] border px-2 py-1.5 text-[12px] ${
                  time === s
                    ? 'border-clay bg-clay-tint font-bold text-clay'
                    : status === 'blocked'
                      ? 'border-amber-400/60 bg-amber-400/10 font-bold text-amber-700 hover:bg-amber-400/20'
                      : 'border-line font-bold text-ink hover:bg-cream'
                }`}
              >
                {status === 'blocked' ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
                {fmtTime(s)}
              </button>
            ))}
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

      {/* footer */}
      <div className="flex items-center gap-3 border-t border-line p-3">
        <div className="text-sm">
          <span className="font-bold text-ink">
            {readyGuestCount > 0 ? `${readyGuestCount} guest${readyGuestCount > 1 ? 's' : ''} · ${totalServiceCount} service${totalServiceCount > 1 ? 's' : ''}` : 'No guests yet'}
          </span>
          {time != null && <span className="ml-2 text-ink-faint">at {fmtTime(time)}</span>}
        </div>
        <div className="flex-1" />
        <button
          onClick={bookNow}
          disabled={time == null || groups.length === 0}
          className="flex h-10 items-center gap-1.5 rounded-[10px] bg-clay px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
        >
          <Check className="h-4 w-4" />
          {time != null ? `Book at ${fmtTime(time)}` : 'Book this'}
        </button>
      </div>
    </div>
  )
}
