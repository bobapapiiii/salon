import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, Clock, Plus, Search, UserPlus, Users, X, Zap,
} from 'lucide-react'
import { useSettingsStore } from '@/lib/settings-store'
import type { Appointment, ClientRecord, ServiceAddon, TimeBlock } from '@/lib/booking-types'
import { DAY_SLOTS, SLOT_MIN, fmtTime, overlaps } from '@/lib/booking-types'
import { SERVICES } from '@/lib/mock-data'
import { boardTechs, getStaff, useStaffStore } from '@/lib/staff-store'
import { svcById } from '@/lib/services-store'

const DAY_MIN = DAY_SLOTS * SLOT_MIN

/** select with a proper chevron that never covers the text */
function Sel({ value, onChange, title, disabled, className = '', children }: {
  value: string | number
  onChange: (v: string) => void
  title?: string
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={`relative inline-flex min-w-0 items-center ${className}`}>
      <select
        value={value}
        title={title}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-md border border-input bg-background py-1.5 pl-2 pr-7 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground/70" />
    </span>
  )
}

export interface BookedService {
  clientName: string
  serviceId: string
  techId: string | 'first'
  startMin: number
  durationMin?: number // override when edited on the details page
  notes?: string
  addons: ServiceAddon[]
  /** set when this service is for a name-only guest of the booking client */
  guestOf?: string
  /** client asked for the chosen tech by name */
  techRequested?: boolean
}

/** a guest in the builder, either an account client or a name-only guest of one */
interface PanelGuest {
  id: string
  clientId?: string
  name: string
  phone?: string
  isGuest: boolean
}

interface Props {
  appts: Appointment[]
  blocks: TimeBlock[]
  clients: ClientRecord[]
  onAddClient: (c: ClientRecord) => void
  prefillTime: number | null
  prefillTechId?: string | null
  onBook: (services: BookedService[], linkGroup: boolean) => void
  onClose: () => void
}

type Step = 'guest' | 'services' | 'details'

interface SlotItem {
  serviceId: string
  offset: number
}

/** chained (back-to-back) or parallel (same start) layout for a set of services */
export function layoutItems(svcIds: string[], parallel: boolean): SlotItem[] {
  let offset = 0
  return svcIds.map((id) => {
    const item = { serviceId: id, offset: parallel ? 0 : offset }
    if (!parallel) offset += svcById[id].durationMin
    return item
  })
}

export function spanOf(svcIds: string[], parallel: boolean): number {
  if (svcIds.length === 0) return 0
  return parallel
    ? Math.max(...svcIds.map((id) => svcById[id].durationMin))
    : svcIds.reduce((s, id) => s + svcById[id].durationMin, 0)
}

/** can every item get a distinct qualified tech at start `s`? (greedy, least-flexible first) */
function fitsAt(appts: Appointment[], items: SlotItem[], s: number, blocks: TimeBlock[] = []): boolean {
  const sorted = [...items].sort(
    (a, b) =>
      boardTechs(getStaff().techs).filter((t) => t.skills.includes(a.serviceId)).length -
      boardTechs(getStaff().techs).filter((t) => t.skills.includes(b.serviceId)).length,
  )
  const used: { techId: string; from: number; to: number }[] = []
  for (const item of sorted) {
    const from = s + item.offset
    const to = from + svcById[item.serviceId].durationMin
    const tech = boardTechs(getStaff().techs).find(
      (t) =>
        t.skills.includes(item.serviceId) &&
        !used.some((u) => u.techId === t.id && overlaps(from, to, u.from, u.to)) &&
        !appts.some((a) => a.techId === t.id && overlaps(from, to, a.startMin, a.startMin + a.durationMin)) &&
        !blocks.some((b) => b.techId === t.id && overlaps(from, to, b.startMin, b.startMin + b.durationMin)),
    )
    if (!tech) return false
    used.push({ techId: tech.id, from, to })
  }
  return true
}

export function findSlotsFor(appts: Appointment[], groups: { svcIds: string[]; parallel: boolean }[], blocks: TimeBlock[] = []): number[] {
  const items = groups.flatMap((g) => layoutItems(g.svcIds, g.parallel))
  if (items.length === 0) return []
  const span = Math.max(...groups.filter((g) => g.svcIds.length > 0).map((g) => spanOf(g.svcIds, g.parallel)))
  const out: number[] = []
  for (let s = 0; s <= DAY_MIN - span; s += SLOT_MIN) {
    if (fitsAt(appts, items, s, blocks)) out.push(s)
  }
  return out
}

const DUR_OPTS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

export function BookingPanel({ appts, blocks, clients, onAddClient, prefillTime, prefillTechId, onBook, onClose }: Props) {
  const { techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  const increment = useSettingsStore().booking.increment
  // a double-click on the Unassigned rail means "first available tech"
  const preTech = prefillTechId && prefillTechId !== 'unassigned' ? prefillTechId : null
  const [step, setStep] = useState<Step>('guest')
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [guests, setGuests] = useState<PanelGuest[]>([])
  const [activeGuest, setActiveGuest] = useState(0)
  const [svcsByGuest, setSvcsByGuest] = useState<string[][]>([[], []])
  const [parallelGuest, setParallelGuest] = useState<boolean[]>([false, false])
  const [techByService, setTechByService] = useState<Record<string, string>>(
    preTech ? { '0:__first__': preTech } : {},
  )
  const [time, setTime] = useState<number | null>(prefillTime)
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'services' | 'history' | 'notes'>('services')
  const [groupName, setGroupName] = useState('')
  const [hostIdx, setHostIdx] = useState(0)
  // per-service time overrides from the details page: key `${gi}:${serviceId}`
  const [timeEdits, setTimeEdits] = useState<Record<string, { start: number; end: number }>>({})
  // add-ons picked per service: key `${gi}:${serviceId}` → snapshots
  const [addonsByService, setAddonsByService] = useState<Record<string, ServiceAddon[]>>({})

  const addonChips = (gi: number, svcId: string) => {
    const svc = svcById[svcId]
    if (!svc?.addons?.length) return null
    const key = `${gi}:${svcId}`
    const on = addonsByService[key] ?? []
    return (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {svc.addons.map((a) => {
          const has = on.some((x) => x.id === a.id)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAddonsByService((m) => ({ ...m, [key]: has ? on.filter((x) => x.id !== a.id) : [...on, a] }))}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition-colors ${
                has ? 'border-sky-500/60 bg-sky-500/10 text-sky-600' : 'border-border text-muted-foreground hover:border-sky-500/40'
              }`}
            >
              + {a.name} · {a.mins}m · ${a.price}
            </button>
          )
        })}
      </div>
    )
  }

  const priceWithAddons = (gi: number, svcId: string) =>
    svcById[svcId].price + (addonsByService[`${gi}:${svcId}`] ?? []).reduce((s, a) => s + a.price, 0)

  const isParty = guests.length > 1

  const timesFor = useCallback((gi: number, svcId: string, defStart: number, dur: number) => {
    const key = `${gi}:${svcId}`
    return timeEdits[key] ?? { start: defStart, end: defStart + dur }
  }, [timeEdits])

  const editStart = (gi: number, svcIds: string[], defStart: number, v: number) => {
    // move start for all listed services (parallel siblings move together), keep each duration
    setTimeEdits((m) => {
      const n = { ...m }
      for (const sid of svcIds) {
        const key = `${gi}:${sid}`
        const dur = svcById[sid].durationMin
        const prev = n[key] ?? { start: defStart, end: defStart + dur }
        n[key] = { start: v, end: Math.min(DAY_MIN, v + (prev.end - prev.start)) }
      }
      return n
    })
  }

  const editEnd = (gi: number, svcId: string, defStart: number, v: number) => {
    const key = `${gi}:${svcId}`
    setTimeEdits((m) => {
      const prev = m[key] ?? { start: defStart, end: defStart + svcById[svcId].durationMin }
      return { ...m, [key]: { start: prev.start, end: Math.max(prev.start + SLOT_MIN, v) } }
    })
  }

  const matches = useMemo(() => {
    if (!q.trim()) return clients.slice(0, 8)
    const s = q.toLowerCase().replace(/\D/g, '')
    const sText = q.toLowerCase()
    return clients
      .filter((c) => c.name.toLowerCase().includes(sText) || (s && c.phone.replace(/\D/g, '').includes(s)))
      .slice(0, 8)
  }, [q, clients])

  const groups = useMemo(
    () => guests.map((_g, i) => ({ svcIds: svcsByGuest[i] ?? [], parallel: parallelGuest[i] ?? false })).filter((x) => x.svcIds.length > 0),
    [guests, svcsByGuest, parallelGuest],
  )

  const slots = useMemo(() => {
    if (guests.length === 0 || !guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0)) return []
    return findSlotsFor(appts, groups, blocks)
  }, [appts, blocks, groups, guests, svcsByGuest])

  const allSvcs = groups.flatMap((g) => g.svcIds)
  const total = allSvcs.reduce((sum, id) => sum + svcById[id].price, 0) +
    guests.reduce((sum, _g, gi) => sum + (svcsByGuest[gi] ?? []).reduce((s2, id) => s2 + (addonsByService[`${gi}:${id}`] ?? []).reduce((s3, a) => s3 + a.price, 0), 0), 0)
  const totalMin = groups.reduce((m, g) => Math.max(m, spanOf(g.svcIds, g.parallel)), 0)

  const toggleService = (svcId: string) => {
    setSvcsByGuest((arr) => {
      const n = arr.map((x) => [...x])
      const list = n[activeGuest] ?? []
      n[activeGuest] = list.includes(svcId) ? list.filter((id) => id !== svcId) : [...list, svcId]
      return n
    })
    // combining needs ≥2 services
    setParallelGuest((p) => {
      const n = [...p]
      const newCount = (svcsByGuest[activeGuest]?.length ?? 0) + (svcsByGuest[activeGuest]?.includes(svcId) ? -1 : 1)
      if (newCount < 2) n[activeGuest] = false
      return n
    })
  }

  const pickGuest = (c: ClientRecord) => {
    setGuests((g) => {
      if (g.some((x) => x.clientId === c.id)) return g
      const n = [...g, { id: c.id, clientId: c.id, name: c.name, phone: c.phone, isGuest: false }]
      setActiveGuest(n.length - 1)
      return n
    })
    setStep('services')
    setQ('')
  }

  // name-only guest, no profile; the visit links to the first (account) client
  const pickNameOnlyGuest = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setGuests((g) => {
      if (g.some((x) => x.name.toLowerCase() === trimmed.toLowerCase())) return g
      const n = [...g, { id: `guest-${Date.now()}`, name: trimmed, isGuest: true }]
      setActiveGuest(n.length - 1)
      return n
    })
    setQ('')
  }

  const removeGuest = (idx: number) => {
    setGuests((g) => g.filter((_, i) => i !== idx))
    setSvcsByGuest((arr) => arr.filter((_, i) => i !== idx))
    setParallelGuest((p) => p.filter((_, i) => i !== idx))
    setActiveGuest(0)
  }

  const createGuest = () => {
    if (!newName.trim() || !newPhone.trim()) return // an account needs a phone number
    const c: ClientRecord = { id: `c${Date.now()}`, name: newName.trim(), phone: newPhone.trim(), visits: 0 }
    onAddClient(c)
    pickGuest(c)
    setAddOpen(false)
    setNewName(''); setNewPhone('')
  }

  const canProceed =
    guests.length >= 1 && guests[0]?.clientId != null &&
    guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0) && time != null

  const book = () => {
    const out: BookedService[] = []
    const groupNote = [isParty && groupName.trim() ? `Group: ${groupName.trim()}` : '', note]
      .filter(Boolean).join(' · ') || undefined
    guests.forEach((g, gi) => {
      const items = layoutItems(svcsByGuest[gi] ?? [], parallelGuest[gi] ?? false)
      items.forEach((item, ii) => {
        const svc = svcById[item.serviceId]
        const t = timesFor(gi, item.serviceId, time! + item.offset, svc.durationMin)
        const addons = addonsByService[`${gi}:${item.serviceId}`] ?? []
        const addonMins = addons.reduce((m, a) => m + a.mins, 0)
        const manual = timeEdits[`${gi}:${item.serviceId}`] != null
        const choiceType = typeByService[`${gi}:${item.serviceId}`] ?? 'any'
        const special = choiceType === 'pref-female' || choiceType === 'pref-male' || choiceType === 'issue'
        const techVal = special ? choiceType : techByService[`${gi}:${item.serviceId}`] ?? (gi === 0 && ii === 0 && preTech ? preTech : 'first')
        out.push({
          clientName: g.name,
          serviceId: item.serviceId,
          techId: techVal,
          startMin: t.start,
          durationMin: t.end - t.start + (manual ? 0 : addonMins),
          notes: groupNote,
          addons,
          guestOf: g.isGuest ? guests[0]?.clientId : undefined,
          techRequested: !special && choiceType === 'requested' && techVal !== 'first' ? true : undefined,
        })
      })
    })
    onBook(out, isParty || out.length > 1)
  }

  const fakeHistory = (c: ClientRecord) =>
    Array.from({ length: Math.min(3, c.visits) }, (_, i) => {
      const svc = SERVICES[(Number(c.id.replace(/\D/g, '')) + i * 3) % SERVICES.length]
      return { svc, when: `${['Apr', 'May', 'Jun'][i]} ${4 + i * 7}` }
    })

  // request type per service: any / requested-by-name / gender preference / issue
  const [typeByService, setTypeByService] = useState<Record<string, string>>({})
  const techSelect = (gi: number, svcId: string) => {
    const key = `${gi}:${svcId}`
    const type = typeByService[key] ?? 'any'
    const tech = techByService[key] ?? (gi === 0 && preTech ? preTech : 'first')
    return (
      <div className="flex min-w-0 flex-1 gap-1.5">
        <Sel
          value={type}
          onChange={(v) => setTypeByService((m) => ({ ...m, [key]: v }))}
          title="Request type"
          className="w-[112px] shrink-0"
        >
          <option value="any">Any tech</option>
          <option value="requested">Requested</option>
          <option value="pref-female">Female preferred</option>
          <option value="pref-male">Male preferred</option>
          <option value="issue">Issue</option>
        </Sel>
        <Sel
          value={tech}
          disabled={type !== 'any' && type !== 'requested'}
          onChange={(v) => setTechByService((m) => ({ ...m, [key]: v }))}
          title="Technician"
          className="min-w-0 flex-1"
        >
          <option value="first">First available</option>
          {techs.filter((t) => t.skills.includes(svcId)).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Sel>
      </div>
    )
  }

  // pretty start + duration editor for each service on the details page
  const timeEditor = (gi: number, svcIds: string[], defStart: number, svcIdForEnd: string) => {
    const dur0 = svcById[svcIdForEnd].durationMin
    const cur = timesFor(gi, svcIdForEnd, defStart, dur0)
    return (
      <div className="flex items-center gap-1.5">
        <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
        <Sel value={cur.start} onChange={(v) => editStart(gi, svcIds, defStart, Number(v))} title="Start time" className="tnum w-[86px] shrink-0 font-semibold">
          {Array.from({ length: DAY_MIN / increment }, (_, i) => i * increment).map((m) => (
            <option key={m} value={m}>{fmtTime(m)}</option>
          ))}
        </Sel>
        <span className="text-[10px] font-semibold text-muted-foreground">for</span>
        <Sel
          value={cur.end - cur.start}
          onChange={(v) => editEnd(gi, svcIdForEnd, defStart, cur.start + Number(v))}
          title="Duration"
          className="tnum w-[76px] shrink-0 font-semibold"
        >
          {DUR_OPTS.map((d) => <option key={d} value={d}>{d}m</option>)}
        </Sel>
      </div>
    )
  }

  const parallelBanner = (gi: number) => {
    const svcs = svcsByGuest[gi] ?? []
    if (svcs.length < 2) return null
    if (parallelGuest[gi]) {
      return (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[12px]">
          <Zap className="h-3.5 w-3.5 text-sky-500" />
          <span className="flex-1">Services will run <b>in parallel</b> at the same time.</span>
          <button onClick={() => setParallelGuest((p) => { const n = [...p]; n[gi] = false; return n })} className="text-sky-600 underline">
            Split back-to-back
          </button>
        </div>
      )
    }
    return (
      <div className="mb-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
        {svcs.map((id) => svcById[id].short).join(' and ')} can be scheduled at the same time.{' '}
        <button onClick={() => setParallelGuest((p) => { const n = [...p]; n[gi] = true; return n })} className="font-medium text-sky-600 underline">
          Combine parallel services
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[85] flex w-[580px] max-w-[95vw] flex-col border-l border-border bg-popover shadow-2xl">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {step !== 'guest' && (
          <button onClick={() => setStep(step === 'details' ? 'services' : 'guest')} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="text-sm font-semibold">New appointment</div>
        <button onClick={onClose} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* main column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {step === 'guest' && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search guest by name or phone"
                  className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Add new guest"
                >
                  <UserPlus className="h-4 w-4" />
                </button>
              </div>

              {addOpen && (
                <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3">
                  <div className="text-xs font-semibold">New client account</div>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring" />
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (required for an account)"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring" />
                  <button onClick={createGuest} disabled={!newName.trim() || !newPhone.trim()}
                    className="w-full rounded-md bg-primary py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40">
                    Create account &amp; select
                  </button>
                  <p className="text-[10.5px] text-muted-foreground">
                    Bringing someone along? Add them later as a name-only guest, no account needed.
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-1">
                {matches.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickGuest(c)}
                    className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-border hover:bg-accent"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                      {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{c.phone} · {c.visits} visits</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
                {matches.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No clients match, <button onClick={() => setAddOpen(true)} className="text-sky-500 underline">create their account</button>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'services' && (
            <>
              {/* guest chips, click to edit that guest's services; X removes */}
              <div className="mb-3 flex flex-wrap gap-2">
                {guests.map((g, i) => (
                  <button
                    key={g.id}
                    onClick={() => setActiveGuest(i)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      activeGuest === i ? 'border-sky-500/60 bg-sky-500/10 text-foreground' : 'border-border text-muted-foreground hover:border-sky-500/40'
                    }`}
                    title={`Select services for ${g.name}`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">
                      {g.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                    {g.name}
                    {g.isGuest ? (
                      <span className="rounded-full bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground">guest</span>
                    ) : isParty && hostIdx === i && (
                      <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-500">host</span>
                    )}
                    <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] text-emerald-600">
                      {(svcsByGuest[i] ?? []).length} svc
                    </span>
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); removeGuest(i) }}
                      className="hover:text-red-400"
                      title={`Remove ${g.name}`}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>

              {/* add another guest */}
              <AddAnotherGuest
                clients={clients}
                guests={guests}
                primaryName={guests[0]?.name ?? ''}
                onPick={pickGuest}
                onPickNameOnly={pickNameOnlyGuest}
                onCreate={(name, phone) => {
                  const c: ClientRecord = { id: `c${Date.now()}`, name, phone: phone || '(555) 000-0000', visits: 0 }
                  onAddClient(c)
                  pickGuest(c)
                }}
              />

              {/* tabs */}
              <div className="mb-3 mt-4 flex gap-4 border-b border-border text-sm">
                {(['services', 'history', 'notes'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 pb-2 capitalize ${tab === t ? 'border-sky-500 font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}>
                    {t === 'history' ? 'Appointments' : t}
                  </button>
                ))}
              </div>

              {tab === 'services' && (
                <>
                  {parallelBanner(activeGuest)}
                  <div className="space-y-1">
                    <div className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Services for {guests[activeGuest]?.name}
                    </div>
                    {SERVICES.map((s) => {
                      const selected = (svcsByGuest[activeGuest] ?? []).includes(s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => toggleService(s.id)}
                          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                            selected ? 'border-sky-500/60 bg-sky-500/10' : 'border-transparent hover:border-border hover:bg-accent'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{s.name}</span>
                            <span className="block text-[11px] text-muted-foreground">${s.price} · {s.durationMin}min</span>
                          </span>
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-sky-500 bg-sky-500 text-white' : 'border-border'}`}>
                            {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {tab === 'history' && (() => {
                const pg = guests[activeGuest] ?? guests[0]
                if (pg?.isGuest) {
                  return (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                      Name-only guest, their visits are tracked under {guests[0]?.name}&rsquo;s profile, in the Guests tab.
                    </div>
                  )
                }
                const acc = clients.find((c) => c.id === pg?.clientId)
                return (
                  <div className="space-y-2">
                    {acc && fakeHistory(acc).map((h, i) => (
                      <div key={i} className="rounded-lg border border-border p-3 text-sm">
                        <div className="text-[11px] text-muted-foreground">{h.when}</div>
                        <div className="font-medium">{h.svc.name}</div>
                        <div className="text-[11px] text-muted-foreground">Gloss Nail Bar · ${h.svc.price}</div>
                      </div>
                    ))}
                    {(acc?.visits ?? 0) === 0 && <div className="py-6 text-center text-sm text-muted-foreground">New client, no past visits</div>}
                  </div>
                )
              })()}

              {tab === 'notes' && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No notes yet for this guest.
                </div>
              )}
            </>
          )}

          {step === 'details' && (
            <div className="space-y-3">
              {isParty && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  <input
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Group name (optional)"
                    className="w-40 rounded-md border border-input bg-background px-2 py-1 text-[11px] outline-none"
                  />
                  Party of {guests.length}, pick the host
                </div>
              )}
              {guests.map((g, gi) => {
                const svcs = svcsByGuest[gi] ?? []
                const isPar = (parallelGuest[gi] ?? false) && svcs.length > 1
                return (
                  <div key={g.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{g.name}</span>
                      {isParty && (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <input
                            type="radio"
                            name="host"
                            checked={hostIdx === gi}
                            onChange={() => setHostIdx(gi)}
                            className="accent-violet-500"
                          />
                          Host of the group?
                        </label>
                      )}
                    </div>
                    {parallelBanner(gi)}
                    {isPar && time != null && (
                      <div className="rounded-lg border border-sky-500/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-600">
                          <Zap className="h-3.5 w-3.5" /> Parallel Services, shared start
                        </div>
                        {/* start picker + dynamic end: ends whenever the LONGEST service finishes */}
                        {(() => {
                          const cur = timesFor(gi, svcs[0], time!, svcById[svcs[0]].durationMin)
                          const longest = Math.max(...svcs.map((id) => timesFor(gi, id, time!, svcById[id].durationMin).end - time!), 0)
                          const end = time! + longest
                          return (
                            <div className="mb-2.5 flex items-center gap-1.5">
                              <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <Sel value={cur.start} onChange={(v) => editStart(gi, svcs, time!, Number(v))} title="Shared start time" className="tnum w-[86px] shrink-0 font-semibold">
                                {Array.from({ length: DAY_MIN / increment }, (_, i) => i * increment).map((m) => (
                                  <option key={m} value={m}>{fmtTime(m)}</option>
                                ))}
                              </Sel>
                              <span className="text-[10px] font-semibold text-muted-foreground">to</span>
                              <span className="tnum rounded-md border border-dashed border-input bg-secondary/40 px-2 py-1 text-[11px] font-bold text-muted-foreground" title="Ends when the longest service finishes">
                                {fmtTime(end)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">({longest}m, longest)</span>
                            </div>
                          )
                        })()}
                        <div className="space-y-2">
                          {svcs.map((id) => {
                            const cur = timesFor(gi, id, time!, svcById[id].durationMin)
                            return (
                              <div key={id} className="rounded-lg border border-border p-2">
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="min-w-0 flex-1 truncate font-medium">{svcById[id].name}
                                    <span className="ml-1 text-[10.5px] font-normal text-muted-foreground">${priceWithAddons(gi, id)} · ends {fmtTime(cur.end)}</span>
                                  </span>
                                  <Sel
                                    value={cur.end - cur.start}
                                    onChange={(v) => editEnd(gi, id, time!, cur.start + Number(v))}
                                    title="Duration"
                                    className="tnum w-[70px] shrink-0 font-semibold"
                                  >
                                    {DUR_OPTS.map((d) => <option key={d} value={d}>{d}m</option>)}
                                  </Sel>
                                </div>
                                <div className="mt-1.5">{techSelect(gi, id)}</div>
                                {addonChips(gi, id)}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {!isPar && layoutItems(svcs, false).map((item) => {
                      const svc0 = svcById[item.serviceId]
                      const cur = timesFor(gi, item.serviceId, (time ?? 0) + item.offset, svc0.durationMin)
                      return (
                        <div key={item.serviceId} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{svc0.name}</span>
                            <span className="text-muted-foreground">${priceWithAddons(gi, item.serviceId)} · {cur.end - cur.start}m</span>
                          </div>
                          {time != null && (
                            <div className="mt-2">{timeEditor(gi, [item.serviceId], time + item.offset, item.serviceId)}</div>
                          )}
                          <div className="mt-2">{techSelect(gi, item.serviceId)}</div>
                          {addonChips(gi, item.serviceId)}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isParty ? 'Add group notes, occasion, preferences' : 'Add note, allergies, design refs'}
                className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {/* available-times rail */}
        {step !== 'guest' && (
          <div className="w-44 shrink-0 overflow-y-auto border-l border-border p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isParty || parallelGuest.some(Boolean) ? 'Start together' : 'Available times'}
            </div>
            {slots.length === 0 && (
              <div className="text-[11px] text-muted-foreground">
                {allSvcs.length === 0 || !guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0)
                  ? isParty ? 'Pick services for each guest' : 'Select services to view openings'
                  : 'No open slots today'}
              </div>
            )}
            <div className="space-y-1">
              {slots.slice(0, 60).map((s) => (
                <button
                  key={s}
                  onClick={() => setTime(s)}
                  className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px] ${
                    time === s ? 'border-sky-500 bg-sky-500/15 font-medium text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Clock className="h-3 w-3" /> {fmtTime(s)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center gap-3 border-t border-border px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold">
            {allSvcs.length > 0 ? `${allSvcs.length} Selected` : 'Total'}
          </span>
          <span className="ml-2 text-muted-foreground">
            {totalMin > 0 && `${totalMin}min · `}{`$${total.toFixed(2)}`}
          </span>
        </div>
        {step === 'services' ? (
          <button
            onClick={() => setStep('details')}
            disabled={!canProceed}
            className="ml-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Proceed
          </button>
        ) : step === 'details' ? (
          <button
            onClick={book}
            disabled={!canProceed}
            className="ml-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Book now
          </button>
        ) : (
          <button onClick={onClose} className="ml-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

/* ── inline "add another guest", search clients, create an account, or a name-only guest ── */
function AddAnotherGuest({ clients, guests, primaryName, onPick, onPickNameOnly, onCreate }: {
  clients: ClientRecord[]
  guests: PanelGuest[]
  primaryName: string
  onPick: (c: ClientRecord) => void
  onPickNameOnly: (name: string) => void
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
      .filter((c) => !guests.some((g) => g.clientId === c.id))
      .filter((c) => c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 5)
  }, [q, clients, guests])

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={guests.length === 0 ? 'Search another guest' : 'Add another guest, name or phone'}
        className="w-full rounded-md border border-dashed border-input bg-background py-1.5 pl-8 pr-3 text-[12px] outline-none focus:ring-1 focus:ring-ring"
      />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-xl">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={() => { onPick(c); setQ('') }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-accent"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold">
                {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              <span className="text-[10px] text-muted-foreground">{c.phone}</span>
            </button>
          ))}
          {/* name-only guest, no profile, linked to the booking client */}
          <button
            type="button"
            onMouseDown={() => { onPickNameOnly(q.trim()); setQ(''); setPhone('') }}
            className="flex w-full items-center gap-2 border-t border-border bg-sky-500/5 px-2.5 py-2 text-left text-[12px] hover:bg-sky-500/10"
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-sky-600" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Add &ldquo;{q.trim()}&rdquo; as guest</span>
              <span className="block text-[10px] text-muted-foreground">name only, no profile, links to {primaryName}</span>
            </span>
          </button>
          {/* or create a full account for them, phone required */}
          <div className="border-t border-border p-1.5">
            <div className="flex items-center gap-1">
              <UserPlus className="h-3.5 w-3.5 shrink-0 text-sky-600" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={`New account "${q}", phone`}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
              />
              <button
                type="button"
                disabled={!q.trim() || !phone.trim()}
                onMouseDown={() => { if (q.trim() && phone.trim()) { onCreate(q.trim(), phone.trim()); setQ(''); setPhone('') } }}
                className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="mt-1 pl-5 text-[10px] text-muted-foreground">phone required for an account, or use the guest option above</p>
          </div>
        </div>
      )}
    </div>
  )
}
