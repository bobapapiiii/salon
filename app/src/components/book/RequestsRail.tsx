import { useMemo, useState } from 'react'
import { Check, Clock, GripVertical, Inbox, Plus, Search, Send, UserPlus, Users, X } from 'lucide-react'
import type { Appointment, ClientRecord, Tech, TimeBlock } from '@/lib/booking-types'
import { DAY_SLOTS, SLOT_MIN, fmtTime, overlaps } from '@/lib/booking-types'
import { boardTechs, getStaff, useStaffStore } from '@/lib/staff-store'
import { activeServices, svcById, useServicesStore } from '@/lib/services-store'
import { catById } from '@/lib/categories-store'
import type { ApprovedItem, QueueEntry, WalkInGroup, WalkInGuest } from './AppointmentBook'
import { ConfirmDialog } from './ConfirmDialog'
import { SearchSelect } from './SearchSelect'

const DAY_MIN = DAY_SLOTS * SLOT_MIN
const techById = () => Object.fromEntries(getStaff().techs.map((t) => [t.id, t]))
const DEMO_NOW_MIN = 5 * 60 + 30

/** up to 3 nearest bookable times for a service */
function nearestSlots(appts: Appointment[], serviceId: string, count = 3, blocks: TimeBlock[] = []): number[] {
  const svc = svcById[serviceId]
  const qualified = boardTechs(getStaff().techs).filter((t) => t.skills.includes(serviceId))
  const free = (t: { id: string }, s: number) =>
    !appts.some((a) => a.techId === t.id && overlaps(s, s + svc.durationMin, a.startMin, a.startMin + a.durationMin)) &&
    !blocks.some((b) => b.techId === t.id && overlaps(s, s + svc.durationMin, b.startMin, b.startMin + b.durationMin))
  const out: number[] = []
  for (let s = 0; s <= DAY_MIN - svc.durationMin && out.length < count; s += SLOT_MIN) {
    if (qualified.some((t) => free(t, s))) out.push(s)
  }
  return out
}

type Tab = 'requests' | 'waitlist' | 'walkins'

interface Props {
  requests: Appointment[]
  appts: Appointment[]
  approved: ApprovedItem[]
  blocks: TimeBlock[]
  onApprove: (id: string) => void
  onDragApproved: (e: React.PointerEvent, item: ApprovedItem) => void
  onDecline: (id: string) => void
  onPropose: (id: string, startMin: number) => void
  onClose: () => void
  waitlist: QueueEntry[]
  walkins: WalkInGroup[]
  clients: ClientRecord[]
  onAddClient: (c: ClientRecord) => void
  onAddWaitlist: (entry: Omit<QueueEntry, 'id' | 'createdMin'>) => void
  onAddWalkinGroup: (guests: WalkInGuest[]) => void
  onRemoveQueue: (kind: 'waitlist' | 'walkin', id: string) => void
  onDragWaitlist: (e: React.PointerEvent, entry: QueueEntry) => void
  onDragWalkin: (e: React.PointerEvent, group: WalkInGroup, guestName: string, serviceId: string) => void
  onOpenProfile: (name: string) => void
}

export function RequestsRail(p: Props) {
  const [tab, setTab] = useState<Tab>('requests')
  // every removal passes through a confirmation prompt first
  const [pendingRemove, setPendingRemove] = useState<{ kind: 'waitlist' | 'walkin'; id: string; label: string } | null>(null)
  const [pendingDecline, setPendingDecline] = useState<Appointment | null>(null)

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'requests', label: 'Requests', count: p.requests.length },
    { id: 'waitlist', label: 'Waitlist', count: p.waitlist.length },
    { id: 'walkins', label: 'Walk-ins', count: p.walkins.length },
  ]

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-line bg-surface" aria-label="Queues">
      {/* tabbed header */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 text-[12px] font-bold transition-colors ${
              tab === t.id ? 'bg-clay-tint text-clay' : 'text-ink-faint hover:bg-cream hover:text-ink-soft'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`tnum flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-extrabold ${
                tab === t.id ? 'bg-clay text-white' : 'bg-line text-ink-soft'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
        <button onClick={p.onClose} className="ml-auto rounded p-1 text-ink-faint hover:bg-cream hover:text-ink" title="Hide panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {tab === 'requests' && (
          <>
            {p.approved.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-0.5 text-[10.5px] font-bold uppercase tracking-wide text-olive">
                  <Check className="h-3 w-3" /> Approved, drag onto the book
                </div>
                {p.approved.map((item) => (
                  <ApprovedCard key={item.id} item={item} onDrag={(ev) => p.onDragApproved(ev, item)} />
                ))}
                <div className="border-b border-line" />
              </>
            )}
            {p.requests.length === 0 && p.approved.length === 0 && <EmptyState title="Queue is clear" body="New online bookings will appear here." />}
            {p.requests.map((r) => (
              <RequestCard key={r.id} req={r} appts={p.appts} blocks={p.blocks} onApprove={p.onApprove} onAskDecline={() => setPendingDecline(r)} onPropose={p.onPropose} />
            ))}
          </>
        )}

        {tab === 'waitlist' && (
          <>
            <WaitlistForm clients={p.clients} onAddClient={p.onAddClient} onAdd={p.onAddWaitlist} />
            {p.waitlist.length === 0 && <EmptyState title="Waitlist is empty" body="Guests who join online will show up here." />}
            {p.waitlist.map((e) => (
              <QueueCard key={e.id} entry={e} onRemove={() => setPendingRemove({ kind: 'waitlist', id: e.id, label: e.name })} onDrag={(ev) => p.onDragWaitlist(ev, e)} onOpenProfile={p.onOpenProfile} />
            ))}
          </>
        )}

        {tab === 'walkins' && (
          <>
            <WalkInBuilder clients={p.clients} onAddClient={p.onAddClient} onAdd={p.onAddWalkinGroup} />
            {p.walkins.length === 0 && <EmptyState title="No walk-ins waiting" body="Add guests who walk in without an appointment." />}
            {p.walkins.map((g) => (
              <WalkInGroupCard key={g.id} group={g} onRemove={() => setPendingRemove({ kind: 'walkin', id: g.id, label: g.guests.map((x) => x.name).join(', ') })} onDrag={(ev, name, sid) => p.onDragWalkin(ev, g, name, sid)} onOpenProfile={p.onOpenProfile} />
            ))}
          </>
        )}
      </div>

      {/* decline-request confirmation */}
      {pendingDecline && (
        <ConfirmDialog
          title={`Decline ${pendingDecline.clientName}'s request?`}
          body={`${svcById[pendingDecline.serviceId]?.name ?? 'Service'} at ${fmtTime(pendingDecline.startMin)}, the client will be notified. This can't be undone.`}
          confirmLabel="Decline request"
          onConfirm={() => p.onDecline(pendingDecline.id)}
          onClose={() => setPendingDecline(null)}
        />
      )}

      {/* remove-from-queue confirmation */}
      {pendingRemove && (
        <ConfirmDialog
          title={pendingRemove.kind === 'waitlist' ? `Remove ${pendingRemove.label} from the waitlist?` : `Remove walk-in party (${pendingRemove.label})?`}
          body="They can be added again anytime."
          confirmLabel="Remove"
          onConfirm={() => p.onRemoveQueue(pendingRemove.kind, pendingRemove.id)}
          onClose={() => setPendingRemove(null)}
        />
      )}
    </aside>
  )
}

/* ── shared bits ─────────────────────────────────────────────────────── */

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Inbox className="h-10 w-10 text-ink-faint/60" />
      <p className="text-[15px] font-bold">{title}</p>
      <p className="text-small font-medium text-ink-soft">{body}</p>
    </div>
  )
}

const field =
  'w-full rounded-[6px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring'

/* ── Waitlist builder: client lookup, service, preferred tech, availability ── */
const DAY_CHIPS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const FULL_DAY = DAY_SLOTS * SLOT_MIN // 8:00 AM → 8:00 PM in minutes-from-open
const TIME_OPTS = Array.from({ length: FULL_DAY / 30 + 1 }, (_, i) => i * 30) // 30-min steps

function WaitlistForm({ clients, onAddClient, onAdd }: {
  clients: ClientRecord[]
  onAddClient: (c: ClientRecord) => void
  onAdd: (entry: Omit<QueueEntry, 'id' | 'createdMin'>) => void
}) {
  // live catalog -- so a service just added or removed in Settings shows
  // up in the waitlist form immediately instead of the stale baseline list
  const services = activeServices(useServicesStore())
  const { techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  const [open, setOpen] = useState(false)
  const [guest, setGuest] = useState<ClientRecord | null>(null)
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '')
  const [techId, setTechId] = useState('')
  const [days, setDays] = useState<number[]>([])
  const [fromMin, setFromMin] = useState(0)
  const [toMin, setToMin] = useState(FULL_DAY)

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const text = q.toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clients
      .filter((c) => c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 5)
  }, [q, clients])

  const qualified = techs.filter((t) => t.skills.includes(serviceId))

  const pickClient = (c: ClientRecord) => {
    setGuest(c)
    setQ('')
    setSearching(false)
  }

  const createGuest = () => {
    if (!q.trim()) return
    const c: ClientRecord = { id: `c${Date.now()}`, name: q.trim(), phone: newPhone.trim() || '(555) 000-0000', visits: 0 }
    onAddClient(c)
    pickClient(c)
    setNewPhone('')
  }

  const toggleDay = (d: number) => setDays((x) => (x.includes(d) ? x.filter((v) => v !== d) : [...x, d]))

  const reset = () => {
    setGuest(null); setQ(''); setNewPhone(''); setServiceId(services[0]?.id ?? '')
    setTechId(''); setDays([]); setFromMin(0); setToMin(FULL_DAY)
  }

  const submit = () => {
    if (!guest) return
    const fullWindow = fromMin === 0 && toMin === FULL_DAY
    onAdd({
      clientId: guest.id,
      name: guest.name,
      serviceId,
      phone: guest.phone,
      preferredTechId: techId || undefined,
      days: days.length > 0 ? [...days].sort((a, b) => a - b) : undefined,
      fromMin: fullWindow ? undefined : fromMin,
      toMin: fullWindow ? undefined : toMin,
    })
    reset()
    setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong py-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-clay">
        <Plus className="h-3.5 w-3.5" /> Add to waitlist
      </button>
    )
  }

  return (
    <div className="shrink-0 space-y-2 rounded-[10px] border border-line bg-cream p-2.5">
      {/* chosen guest chip, or the lookup */}
      {guest ? (
        <div className="flex items-center gap-2 rounded-[8px] border border-clay/40 bg-clay-tint px-2 py-1.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay text-[9px] font-extrabold text-white">
            {guest.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-clay">{guest.name}</span>
          <span className="shrink-0 text-[10px] text-clay/70">{guest.phone}</span>
          <button type="button" onClick={() => setGuest(null)} className="shrink-0 text-clay/70 hover:text-rust" title="Change guest">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearching(true) }}
            onFocus={() => setSearching(true)}
            onBlur={() => setTimeout(() => setSearching(false), 150)}
            placeholder="Search client, name or phone"
            className={`${field} pl-7`}
          />
          {searching && q.trim() && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[10px] border border-line bg-popover shadow-sh-2">
              {matches.map((c) => (
                <button key={c.id} type="button" onMouseDown={() => pickClient(c)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cream">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[9px] font-extrabold text-clay">
                    {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="text-[10px] text-ink-faint">{c.phone}</span>
                </button>
              ))}
              <div className="border-t border-line p-1.5">
                <div className="flex items-center gap-1">
                  <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder={`New guest "${q}", phone`}
                    className="min-w-0 flex-1 rounded-[6px] border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
                  />
                  <button type="button" onMouseDown={createGuest} className="rounded-[6px] bg-clay px-2 py-1 text-[11px] font-semibold text-white">
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* service + preferred technician (only techs who can do it) */}
      <SearchSelect
        options={services.map((s) => ({ value: s.id, label: s.name, sublabel: `${s.durationMin}m` }))}
        value={serviceId}
        onChange={(v) => { setServiceId(v); setTechId('') }}
        searchPlaceholder="Search services"
        className="w-full"
      />
      <SearchSelect
        options={[{ value: '', label: 'Any technician' }, ...qualified.map((t) => ({ value: t.id, label: t.name, avatarText: t.initials }))]}
        value={techId}
        onChange={setTechId}
        searchPlaceholder="Search technicians"
        className="w-full"
      />

      {/* available days, none picked means any day */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-ink-soft">
          Available days {days.length === 0 && <span className="font-medium text-ink-faint">any day</span>}
        </div>
        <div className="flex gap-1">
          {DAY_CHIPS.map((label, d) => {
            const on = days.includes(d)
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(d)}
                className={`flex h-7 flex-1 items-center justify-center rounded-[6px] border text-[10.5px] font-bold transition-colors ${
                  on ? 'border-clay bg-clay-tint text-clay' : 'border-line bg-surface text-ink-faint hover:border-line-strong hover:text-ink-soft'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* time range */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-ink-soft">
          Time range {fromMin === 0 && toMin === FULL_DAY && <span className="font-medium text-ink-faint">any time</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={fromMin}
            onChange={(e) => {
              const v = Number(e.target.value)
              setFromMin(v)
              if (v >= toMin) setToMin(Math.min(FULL_DAY, v + 30))
            }}
            className={field}
          >
            {TIME_OPTS.slice(0, -1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
          </select>
          <span className="shrink-0 text-[11px] font-bold text-ink-faint">to</span>
          <select
            value={toMin}
            onChange={(e) => {
              const v = Number(e.target.value)
              setToMin(v)
              if (v <= fromMin) setFromMin(Math.max(0, v - 30))
            }}
            className={field}
          >
            {TIME_OPTS.slice(1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-1.5 pt-0.5">
        <button onClick={submit} disabled={!guest} className="flex-1 rounded-[8px] bg-clay py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
          Add to waitlist
        </button>
        <button onClick={() => { reset(); setOpen(false) }} className="rounded-[8px] px-2.5 text-[12px] font-semibold text-ink-soft hover:bg-surface">Cancel</button>
      </div>
    </div>
  )
}

/* ── Walk-in builder: client search, new-guest, multi-service, party ── */
function WalkInBuilder({ clients, onAddClient, onAdd }: {
  clients: ClientRecord[]
  onAddClient: (c: ClientRecord) => void
  onAdd: (guests: WalkInGuest[]) => void
}) {
  // live catalog -- so a service just added or removed in Settings shows
  // up in the walk-in builder immediately instead of the stale baseline list
  const services = activeServices(useServicesStore())
  const [open, setOpen] = useState(false)
  const [guests, setGuests] = useState<WalkInGuest[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [newPhone, setNewPhone] = useState('')

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const text = q.toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clients
      .filter((c) => c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 5)
  }, [q, clients])

  const active = guests[activeIdx]
  const canSubmit = guests.length > 0 && guests.every((g) => g.serviceIds.length > 0)

  const pickClient = (c: ClientRecord) => {
    setGuests((g) => {
      if (g.some((x) => x.name === c.name)) return g
      const n = [...g, { clientId: c.id, name: c.name, serviceIds: [] }]
      setActiveIdx(n.length - 1)
      return n
    })
    setQ('')
    setSearching(false)
  }

  const createGuest = () => {
    if (!q.trim()) return
    const c: ClientRecord = { id: `c${Date.now()}`, name: q.trim(), phone: newPhone.trim() || '(555) 000-0000', visits: 0 }
    onAddClient(c)
    pickClient(c)
    setNewPhone('')
  }

  const toggleSvc = (sid: string) =>
    setGuests((g) =>
      g.map((x, i) =>
        i === activeIdx
          ? { ...x, serviceIds: x.serviceIds.includes(sid) ? x.serviceIds.filter((s) => s !== sid) : [...x.serviceIds, sid] }
          : x,
      ),
    )

  const submit = () => {
    if (!canSubmit) return
    onAdd(guests)
    setGuests([]); setActiveIdx(0); setQ(''); setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong py-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-clay">
        <Plus className="h-3.5 w-3.5" /> Add walk-in
      </button>
    )
  }

  return (
    <div className="shrink-0 space-y-2 rounded-[10px] border border-line bg-cream p-2.5">
      {/* guest chips */}
      {guests.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {guests.map((g, i) => (
            <button
              key={g.name}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                i === activeIdx ? 'border-clay bg-clay-tint text-clay' : 'border-line bg-surface text-ink-soft hover:border-clay/50'
              }`}
              title={`Select services for ${g.name}`}
            >
              {g.name}
              <span className="text-[10px] opacity-70">{g.serviceIds.length} svc</span>
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setGuests((x) => x.filter((_, j) => j !== i)); setActiveIdx(0) }}
                className="hover:text-rust"
                title={`Remove ${g.name}`}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* client search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSearching(true) }}
          onFocus={() => setSearching(true)}
          onBlur={() => setTimeout(() => setSearching(false), 150)}
          placeholder={guests.length === 0 ? 'Search client, name or phone' : 'Add another guest, name or phone'}
          className={`${field} pl-7`}
        />
        {searching && q.trim() && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[10px] border border-line bg-popover shadow-sh-2">
            {matches.map((c) => (
              <button key={c.id} type="button" onMouseDown={() => pickClient(c)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cream">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[9px] font-extrabold text-clay">
                  {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="text-[10px] text-ink-faint">{c.phone}</span>
              </button>
            ))}
            <div className="border-t border-line p-1.5">
              <div className="flex items-center gap-1">
                <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder={`New guest "${q}", phone`}
                  className="min-w-0 flex-1 rounded-[6px] border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
                />
                <button type="button" onMouseDown={createGuest} className="rounded-[6px] bg-clay px-2 py-1 text-[11px] font-semibold text-white">
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* services for active guest */}
      {active && (
        <>
          <div className="text-[11px] font-semibold text-ink-soft">
            Services for <span className="text-clay">{active.name}</span>
            {active.serviceIds.length === 0 && <span className="ml-1 text-rust">pick at least one</span>}
          </div>
          <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto">
            {services.map((s) => {
              const on = active.serviceIds.includes(s.id)
              const cat = catById[s.categoryId]
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSvc(s.id)}
                  className={`flex items-center gap-1.5 rounded-[6px] border px-1.5 py-1 text-left text-[11px] transition-colors ${
                    on ? 'border-clay bg-clay-tint font-semibold text-clay' : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.line }} />
                  <span className="truncate">{s.short}</span>
                  {on && <Check className="ml-auto h-3 w-3 shrink-0" />}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="flex gap-1.5 pt-0.5">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-clay py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          <Users className="h-3.5 w-3.5" />
          Add {guests.length > 1 ? `party of ${guests.length}` : 'walk-in'}
        </button>
        <button onClick={() => { setOpen(false); setGuests([]) }} className="rounded-[8px] px-2.5 text-[12px] font-semibold text-ink-soft hover:bg-surface">
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ── waitlist card ── */
function QueueCard({ entry, onRemove, onDrag, onOpenProfile }: {
  entry: QueueEntry
  onRemove: () => void
  onDrag: (e: React.PointerEvent) => void
  onOpenProfile: (name: string) => void
}) {
  const svc = svcById[entry.serviceId]
  const cat = catById[svc.categoryId]
  const tech: Tech | undefined = entry.preferredTechId ? techById()[entry.preferredTechId] : undefined
  const wait = Math.max(0, DEMO_NOW_MIN - entry.createdMin)

  return (
    <div className="shrink-0 overflow-hidden rounded-[10px] bg-cream p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-bold leading-5">
          <button type="button" onClick={() => onOpenProfile(entry.name)} className="text-clay hover:underline" title={`Open ${entry.name}'s profile`}>
            {entry.name}
          </button>
        </p>
        <span className={`tnum shrink-0 text-[11px] font-bold ${wait >= 20 ? 'text-rust' : 'text-ink-faint'}`}>{wait} min</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-small font-semibold text-ink-soft">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.line }} />
        <span className="truncate">{svc.name}</span>
        <span className="tnum text-ink-faint">{svc.durationMin}m</span>
      </div>
      <div className="mt-1 text-small font-medium text-ink-soft">
        {tech ? <>wants: <strong className="text-ink">{tech.name}</strong></> : 'any technician'}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-small font-medium text-ink-soft">
        <Clock className="h-3 w-3 shrink-0 text-ink-faint" />
        <span>
          {entry.days && entry.days.length > 0
            ? [...entry.days].sort((a, b) => a - b).map((d) => DAY_CHIPS[d]).join(' ')
            : 'Any day'}
          {' · '}
          {entry.fromMin != null && entry.toMin != null ? `${fmtTime(entry.fromMin)} to ${fmtTime(entry.toMin)}` : 'any time'}
        </span>
      </div>
      {entry.notes && <p className="mt-1 text-small font-medium italic text-ink-soft">“{entry.notes}”</p>}
      <CardActions onDrag={onDrag} onRemove={onRemove} />
    </div>
  )
}

/* ── walk-in group card: every service row is its own drag ── */
function WalkInGroupCard({ group, onRemove, onDrag, onOpenProfile }: {
  group: WalkInGroup
  onRemove: () => void
  onDrag: (e: React.PointerEvent, guestName: string, serviceId: string) => void
  onOpenProfile: (name: string) => void
}) {
  const wait = Math.max(0, DEMO_NOW_MIN - group.createdMin)
  return (
    <div className="shrink-0 overflow-hidden rounded-[10px] bg-cream p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-bold leading-5">
          {group.guests.map((g, i) => (
            <span key={g.name}>
              {i > 0 && ' & '}
              <button
                type="button"
                onClick={() => onOpenProfile(g.name)}
                className="text-clay hover:underline"
                title={`Open ${g.name}'s profile`}
              >
                {g.name}
              </button>
            </span>
          ))}
        </p>
        <div className="flex items-center gap-1.5">
          <span className={`tnum shrink-0 text-[11px] font-bold ${wait >= 20 ? 'text-rust' : 'text-ink-faint'}`}>{wait} min</span>
          <button type="button" onClick={onRemove} className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:bg-rust-tint hover:text-rust" title="Remove group">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {group.guests.length > 1 && (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-clay-tint px-2 py-0.5 text-[10px] font-bold text-clay">
          <Users className="h-3 w-3" /> Party of {group.guests.length}
        </span>
      )}
      <div className="mt-1.5 space-y-1.5">
        {group.guests.map((g) => (
          <div key={g.name}>
            {group.guests.length > 1 && <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{g.name}</div>}
            <div className="space-y-1">
              {g.serviceIds.map((sid) => {
                const svc = svcById[sid]
                const cat = catById[svc.categoryId]
                return (
                  <button
                    key={sid}
                    type="button"
                    onPointerDown={(e) => onDrag(e, g.name, sid)}
                    className="flex w-full cursor-grab items-center gap-1.5 rounded-[6px] border border-line bg-surface px-1.5 py-1 text-left text-small font-semibold text-ink-soft transition-colors hover:border-clay hover:text-clay active:cursor-grabbing"
                    title={`Drag ${svc.short} onto the calendar`}
                  >
                    <GripVertical className="h-3 w-3 shrink-0 text-ink-faint" />
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.line }} />
                    <span className="truncate">{svc.name}</span>
                    <span className="tnum ml-auto shrink-0 text-ink-faint">{svc.durationMin}m</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CardActions({ onDrag, onRemove }: { onDrag: (e: React.PointerEvent) => void; onRemove: () => void }) {
  return (
    <div className="mt-2.5 flex gap-1.5">
      <button
        type="button"
        onPointerDown={onDrag}
        className="flex h-8 flex-1 cursor-grab items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[12px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-clay active:cursor-grabbing"
        title="Drag onto the calendar"
      >
        <GripVertical className="h-3.5 w-3.5" /> Drag to calendar
      </button>
      <button type="button" onClick={onRemove} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-faint transition-colors hover:bg-rust-tint hover:text-rust" title="Remove">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ── approved card, draggable onto the calendar like a walk-in service ── */
function ApprovedCard({ item, onDrag }: { item: ApprovedItem; onDrag: (e: React.PointerEvent) => void }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-[10px] border border-olive/40 bg-olive-tint/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-bold leading-5">{item.clientName}</p>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-olive px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">
          <Check className="h-2.5 w-2.5" /> Approved
        </span>
      </div>
      {item.services.map((s, i) => {
        const svc = svcById[s.serviceId]
        const cat = catById[svc.categoryId]
        return (
          <div key={i} className="mt-1.5 flex items-center gap-1.5 text-small font-semibold text-ink-soft">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.line }} />
            <span className="truncate">{svc.name}</span>
            <span className="tnum text-ink-faint">{s.durationMin}m</span>
          </div>
        )
      })}
      {/* what the client asked for — so the salon books it the same way */}
      {(item.requestedStartMin != null || item.requestedTechId) && (
        <p className="mt-1.5 flex items-center gap-1 text-small font-medium text-ink-soft">
          <Clock className="h-3 w-3 shrink-0 text-ink-faint" />
          <span>
            requested {item.requestedStartMin != null ? fmtTime(item.requestedStartMin) : 'any time'}
            {' · '}
            {item.requestedTechId ? (techById()[item.requestedTechId]?.name ?? 'any tech') : 'any tech'}
          </span>
        </p>
      )}
      {item.isPair && <p className="mt-1 text-[11px] font-bold text-olive">⚡ same-time services, they drop together</p>}
      <button
        type="button"
        onPointerDown={onDrag}
        className="mt-2.5 flex h-8 w-full cursor-grab items-center justify-center gap-1.5 rounded-[8px] border border-olive/50 bg-surface text-[12px] font-semibold text-olive transition-colors hover:bg-olive hover:text-white active:cursor-grabbing"
        title="Drag onto the calendar"
      >
        <GripVertical className="h-3.5 w-3.5" /> Drag to calendar
      </button>
    </div>
  )
}

/* ── request card (approval queue) ── */
function RequestCard({ req, appts, blocks, onApprove, onAskDecline, onPropose }: {
  req: Appointment
  appts: Appointment[]
  blocks: TimeBlock[]
  onApprove: (id: string) => void
  onAskDecline: () => void
  onPropose: (id: string, startMin: number) => void
}) {
  const [mode, setMode] = useState<'idle' | 'propose'>('idle')
  const svc = svcById[req.serviceId]
  const cat = catById[svc.categoryId]
  const tech: Tech | undefined = techById()[req.techId]
  const slots = mode === 'propose' ? nearestSlots(appts, req.serviceId, 3, blocks) : []

  return (
    <div className="shrink-0 overflow-hidden rounded-[10px] bg-cream p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-bold leading-5">{req.clientName}</p>
        <span className="tnum shrink-0 rounded-full bg-clay-tint px-2 py-0.5 text-[11.5px] font-bold text-clay">
          {fmtTime(req.startMin)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-small font-semibold text-ink-soft">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.line }} />
        <span className="truncate">{svc.name}</span>
        <span className="tnum text-ink-faint">{req.durationMin}m</span>
      </div>
      <div className="mt-1.5 text-small font-medium text-ink-soft">
        wants: <strong className="text-ink">{tech?.name ?? 'Any available'}</strong>
      </div>
      {req.notes && <p className="mt-1.5 text-small font-medium italic text-ink-soft">“{req.notes}”</p>}

      {mode === 'idle' && (
        <div className="mt-2.5 flex gap-1.5">
          <button type="button" onClick={() => onApprove(req.id)} title="Approve, then drag it onto the calendar"
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-clay text-[13px] font-semibold text-white transition-all duration-150 hover:bg-clay-deep">
            <Check className="h-3.5 w-3.5" /> Approve
          </button>
          <button type="button" onClick={onAskDecline} title="Decline this request"
            className="flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[13px] font-semibold text-rust transition-colors hover:bg-rust-tint">
            <X className="h-3.5 w-3.5" /> Decline
          </button>
          <button type="button" onClick={() => setMode('propose')} title="Propose a different time"
            className="flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-surface">
            <Clock className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {mode === 'propose' && (
        <div className="mt-2.5 rounded-[6px] border border-line bg-surface p-2">
          <p className="text-micro font-bold uppercase text-ink-faint">Nearest bookable times</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {slots.length === 0 && <span className="text-small font-medium text-ink-faint">No open slots today</span>}
            {slots.map((s) => (
              <button key={s} type="button" onClick={() => onPropose(req.id, s)}
                className="tnum rounded-full border border-clay/40 bg-clay-tint px-2.5 py-1 text-[12px] font-bold text-clay transition-colors hover:bg-clay hover:text-white">
                {fmtTime(s)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setMode('idle')}
            className="mt-1.5 flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-semibold text-ink-soft hover:bg-cream">
            <Send className="h-3 w-3 rotate-180" /> Back
          </button>
        </div>
      )}
    </div>
  )
}
