import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Heart, Link2, Mail, Phone, Plus, Search, UserPlus, Users, X, Zap,
} from 'lucide-react'
import { useSettingsStore } from '@/lib/settings-store'
import type { Appointment, ClientRecord, ServiceAddon, TimeBlock } from '@/lib/booking-types'
import { DAY_SLOTS, SLOT_MIN, fmtTime, overlaps } from '@/lib/booking-types'
import { boardTechs, getStaff, useStaffStore } from '@/lib/staff-store'
import { activeServices, orderedServices, serviceGroupLabel, svcById, useServicesStore } from '@/lib/services-store'
import { catById, useCategoriesStore } from '@/lib/categories-store'
import { DatePickerPopover } from './LegendPopover'
import { SearchSelect } from './SearchSelect'
import type { RealVisit } from './ClientProfile'

const DAY_MIN = DAY_SLOTS * SLOT_MIN

/** small local date helpers, duplicated from AppointmentBook to avoid a circular import */
function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabelOf(key: string) {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** select with a proper chevron that never covers the text */
export function Sel({ value, onChange, title, disabled, className = '', children }: {
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
        className="w-full appearance-none rounded-[8px] border border-input bg-background py-1.5 pl-2 pr-7 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-ink-faint/70" />
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
  /** this client's real completed checkouts, newest first -- powers the
   *  guest's History tab, same data source as the client profile */
  buildRealVisits: (clientName: string) => RealVisit[]
  prefillTime: number | null
  prefillTechId?: string | null
  /** the day currently open on the calendar behind this panel */
  dateKey: string
  /** switch the day shown on the calendar behind this panel (and in `appts`/`blocks` above) */
  onPreviewDay: (key: string) => void
  /** a slot that doesn't currently fit — search whether relocating some other
   *  (non-requested) booking would open it up; null when there's no way */
  findMakeRoomPlan: (groups: SlotGroup[], startMin: number) => Appointment[] | null
  /** confirm and apply a make-room plan found above, then run `thenSelect` */
  onRequestMakeRoom: (moves: Appointment[], startMin: number, thenSelect: () => void) => void
  onBook: (services: BookedService[], linkGroup: boolean) => void
  /** open the guest's full profile, when they already have an account */
  onViewProfile: (clientName: string) => void
  /** fires when an existing client is picked for this booking -- surfaces
   *  any of their notes flagged "pop up on: Making an appointment" */
  onClientAlert?: (clientName: string) => void
  onClose: () => void
}

type Step = 'guest' | 'services' | 'details'

interface SlotItem {
  serviceId: string
  offset: number
  /** effective duration for this item, including any addon minutes */
  durationMin: number
  /** a specific requested techId, a soft 'pref-female'/'pref-male' preference,
   *  or undefined for "any qualified tech" */
  techChoice?: string
}

/** a set of services to book together, plus who (if anyone specific) each one is for —
 *  shared by the new-appointment panel and the edit panel's time rail */
export interface SlotGroup {
  svcIds: string[]
  parallel: boolean
  /** serviceId → requested techId / 'pref-female' / 'pref-male', when known */
  techChoices?: Record<string, string>
  /** serviceId → effective total minutes (base + addons), when known —
   *  falls back to the service's base durationMin when a service is missing here */
  durations?: Record<string, number>
}

/** chained (back-to-back) or parallel (same start) layout for a set of services.
 *  `durationOf` lets callers supply an addon-aware duration per service; defaults
 *  to the service's base durationMin */
export function layoutItems(svcIds: string[], parallel: boolean, durationOf?: (id: string) => number): SlotItem[] {
  let offset = 0
  return svcIds.map((id) => {
    const dur = durationOf?.(id) ?? svcById[id].durationMin
    const item = { serviceId: id, offset: parallel ? 0 : offset, durationMin: dur }
    if (!parallel) offset += dur
    return item
  })
}

export function spanOf(svcIds: string[], parallel: boolean, durationOf?: (id: string) => number): number {
  if (svcIds.length === 0) return 0
  const dur = (id: string) => durationOf?.(id) ?? svcById[id].durationMin
  return parallel
    ? Math.max(...svcIds.map(dur))
    : svcIds.reduce((s, id) => s + dur(id), 0)
}

/** can every item get a distinct qualified tech at start `s`? (greedy, least-flexible first).
 *  an item with a specific techChoice must get exactly that tech; a pref-female/pref-male
 *  choice is a soft filter (falls back to any qualified tech if nobody of that gender is free) */
export function fitsAt(appts: Appointment[], items: SlotItem[], s: number, blocks: TimeBlock[] = []): boolean {
  const sorted = [...items].sort(
    (a, b) =>
      boardTechs(getStaff().techs).filter((t) => t.skills.includes(a.serviceId)).length -
      boardTechs(getStaff().techs).filter((t) => t.skills.includes(b.serviceId)).length,
  )
  const used: { techId: string; from: number; to: number }[] = []
  for (const item of sorted) {
    const from = s + item.offset
    const to = from + item.durationMin
    let pool = boardTechs(getStaff().techs).filter(
      (t) =>
        t.skills.includes(item.serviceId) &&
        !used.some((u) => u.techId === t.id && overlaps(from, to, u.from, u.to)) &&
        !appts.some((a) => a.techId === t.id && overlaps(from, to, a.startMin, a.startMin + a.durationMin)) &&
        !blocks.some((b) => b.techId === t.id && overlaps(from, to, b.startMin, b.startMin + b.durationMin)),
    )
    if (item.techChoice === 'pref-female' || item.techChoice === 'pref-male') {
      const gp = pool.filter((t) => t.gender === (item.techChoice === 'pref-female' ? 'female' : 'male'))
      if (gp.length > 0) pool = gp
    } else if (item.techChoice) {
      pool = pool.filter((t) => t.id === item.techChoice)
    }
    const tech = pool[0]
    if (!tech) return false
    used.push({ techId: tech.id, from, to })
  }
  return true
}

export function findSlotsFor(appts: Appointment[], groups: SlotGroup[], blocks: TimeBlock[] = []): number[] {
  return allSlotsFor(appts, groups, blocks).filter((x) => x.available).map((x) => x.start)
}

/** every start-of-day time the group could begin at, each flagged available or not —
 *  lets the UI show the whole day with the closed-off times greyed out instead of hidden */
export function allSlotsFor(
  appts: Appointment[], groups: SlotGroup[], blocks: TimeBlock[] = [],
): { start: number; available: boolean }[] {
  const items = groups.flatMap((g) => {
    const durationOf = (id: string) => g.durations?.[id] ?? svcById[id].durationMin
    return layoutItems(g.svcIds, g.parallel, durationOf).map((it) => ({ ...it, techChoice: g.techChoices?.[it.serviceId] }))
  })
  if (items.length === 0) return []
  const span = Math.max(
    ...groups.filter((g) => g.svcIds.length > 0).map((g) => spanOf(g.svcIds, g.parallel, (id) => g.durations?.[id] ?? svcById[id].durationMin)),
  )
  const out: { start: number; available: boolean }[] = []
  for (let s = 0; s <= DAY_MIN - span; s += SLOT_MIN) {
    out.push({ start: s, available: fitsAt(appts, items, s, blocks) })
  }
  return out
}

const DUR_OPTS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

export function BookingPanel({
  appts, blocks, clients, onAddClient, buildRealVisits, prefillTime, prefillTechId, dateKey, onPreviewDay,
  findMakeRoomPlan, onRequestMakeRoom, onBook, onViewProfile, onClientAlert, onClose,
}: Props) {
  // live catalog -- so a service just added or removed in Settings shows
  // up in the service picker immediately instead of the stale baseline list
  const services = activeServices(useServicesStore())
  const categories = useCategoriesStore()
  // same order as the Settings service list, for anywhere services get listed
  const orderedSvcs = orderedServices(services, categories)
  const { roles, techs: allTechs } = useStaffStore()
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
  // the "add another guest" search stays hidden behind an explicit button until
  // clicked -- an always-open search field next to the first client read as
  // ambiguous to new users (unclear it was even for adding a second person)
  const [addGuestOpen, setAddGuestOpen] = useState(false)
  const [svcQuery, setSvcQuery] = useState('')
  const [svcsByGuest, setSvcsByGuest] = useState<string[][]>([[], []])
  const [parallelGuest, setParallelGuest] = useState<boolean[]>([false, false])
  const [techByService, setTechByService] = useState<Record<string, string>>(
    preTech ? { '0:__first__': preTech } : {},
  )
  // request type per service: '' (not yet chosen) / any / requested-by-name / gender preference / issue
  const [typeByService, setTypeByService] = useState<Record<string, string>>({})
  const [time, setTime] = useState<number | null>(prefillTime)
  const [dayPickerAnchor, setDayPickerAnchor] = useState<DOMRect | null>(null)
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'services' | 'history' | 'notes'>('services')
  const [groupName, setGroupName] = useState('')
  const [hostIdx, setHostIdx] = useState(0)
  // per-service time overrides from the details page: key `${gi}:${serviceId}`
  const [timeEdits, setTimeEdits] = useState<Record<string, { start: number; end: number }>>({})
  // add-ons picked per service: key `${gi}:${serviceId}` → snapshots
  const [addonsByService, setAddonsByService] = useState<Record<string, ServiceAddon[]>>({})

  // 18px = the exact left offset gridRow's "left" column starts at (icon slot
  // 12px + gap 6px) -- lines the chips up under the request-type dropdown
  // ("Any tech") instead of the technician name dropdown next to it, and
  // stays on one line (scrolling sideways if a lot of add-ons don't fit)
  // rather than wrapping across several
  const addonChips = (gi: number, svcId: string) => {
    const svc = svcById[svcId]
    if (!svc?.addons?.length) return null
    const key = `${gi}:${svcId}`
    const on = addonsByService[key] ?? []
    return (
      <div className="mt-1.5 flex flex-nowrap gap-1 overflow-x-auto pl-[18px]">
        {svc.addons.map((a) => {
          const has = on.some((x) => x.id === a.id)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAddonsByService((m) => ({ ...m, [key]: has ? on.filter((x) => x.id !== a.id) : [...on, a] }))}
              className={`shrink-0 whitespace-nowrap rounded-[8px] border px-2 py-0.5 text-[10.5px] font-bold transition-colors ${
                has ? 'border-clay/60 bg-clay-tint text-clay' : 'border-line text-ink-faint hover:border-clay/40'
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

  // base service duration plus any addon minutes selected for it — the duration
  // the slot-fitting engine and the details-page time editors should actually use
  const effectiveDurationMin = (gi: number, svcId: string) =>
    svcById[svcId].durationMin + (addonsByService[`${gi}:${svcId}`] ?? []).reduce((s, a) => s + a.mins, 0)

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
        const dur = effectiveDurationMin(gi, sid)
        const prev = n[key] ?? { start: defStart, end: defStart + dur }
        n[key] = { start: v, end: Math.min(DAY_MIN, v + (prev.end - prev.start)) }
      }
      return n
    })
  }

  const editEnd = (gi: number, svcId: string, defStart: number, v: number) => {
    const key = `${gi}:${svcId}`
    setTimeEdits((m) => {
      const prev = m[key] ?? { start: defStart, end: defStart + effectiveDurationMin(gi, svcId) }
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

  // "Any tech" (the default) / gender preference / issue are all fine as-is;
  // "Requested" is the one case that needs an actual name picked before the
  // times shown would mean anything — who ends up free depends on the answer
  const serviceReady = (gi: number, svcId: string): boolean => {
    const key = `${gi}:${svcId}`
    const type = typeByService[key] ?? 'any'
    if (type === 'requested') {
      const t = techByService[key]
      return !!t && t !== 'first'
    }
    return true
  }

  // the specific techId / gender preference to fit this service against, or
  // undefined for "any qualified tech" (also covers a specific name picked
  // under "Any tech" without formally flagging it as Requested)
  const techChoiceFor = (gi: number, svcId: string): string | undefined => {
    const key = `${gi}:${svcId}`
    const type = typeByService[key] ?? 'any'
    if (type === 'pref-female' || type === 'pref-male') return type
    if (type === 'any' || type === 'requested') {
      const t = techByService[key]
      return t && t !== 'first' ? t : undefined
    }
    return undefined
  }

  const groups = useMemo<SlotGroup[]>(
    () => guests.map((_g, i) => {
      const svcIds = svcsByGuest[i] ?? []
      const techChoices: Record<string, string> = {}
      const durations: Record<string, number> = {}
      for (const sid of svcIds) {
        const choice = techChoiceFor(i, sid)
        if (choice) techChoices[sid] = choice
        durations[sid] = effectiveDurationMin(i, sid)
      }
      return { svcIds, parallel: parallelGuest[i] ?? false, techChoices, durations }
    }).filter((x) => x.svcIds.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guests, svcsByGuest, parallelGuest, typeByService, techByService, addonsByService],
  )

  const allTechsReady = guests.length > 0 &&
    guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0 && (svcsByGuest[i] ?? []).every((sid) => serviceReady(i, sid)))

  // each slot is 'open' (fits as-is), 'movable' (fits if a non-requested
  // booking blocking it gets relocated — findMakeRoomPlan only runs for
  // slots that don't already fit, to keep this cheap), or 'blocked'
  const slotPlans = useMemo(() => {
    if (guests.length === 0 || !guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0) || !allTechsReady) return []
    return allSlotsFor(appts, groups, blocks).map(({ start, available }) => {
      if (available) return { start, status: 'open' as const, moves: undefined as Appointment[] | undefined }
      const moves = findMakeRoomPlan(groups, start)
      return { start, status: moves ? ('movable' as const) : ('blocked' as const), moves: moves ?? undefined }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appts, blocks, groups, guests, svcsByGuest, allTechsReady])

  const shiftDay = (delta: number) => {
    const d = new Date(dateKey + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    onPreviewDay(dayKeyOf(d))
  }

  // picking a new overall time from the rail should win over any per-service
  // start/duration tweaks made earlier in the details step — otherwise a
  // manually-edited service's timeEdits entry keeps overriding `time` forever,
  // making the rail look stuck on whatever time was last hand-picked
  const selectTime = (s: number) => {
    setTime(s)
    setTimeEdits({})
  }

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
    onClientAlert?.(c.name)
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

  // guest + services picked — enough to move from the services step into the
  // details step, where the technician choices that unlock times actually live
  const canProceedToDetails =
    guests.length >= 1 && guests[0]?.clientId != null &&
    guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0)
  // additionally needs an actual time picked — required to book
  const canProceed = canProceedToDetails && time != null

  const book = () => {
    const out: BookedService[] = []
    const groupNote = [isParty && groupName.trim() ? `Group: ${groupName.trim()}` : '', note]
      .filter(Boolean).join(' · ') || undefined
    guests.forEach((g, gi) => {
      const items = layoutItems(svcsByGuest[gi] ?? [], parallelGuest[gi] ?? false, (id) => effectiveDurationMin(gi, id))
      items.forEach((item, ii) => {
        const t = timesFor(gi, item.serviceId, time! + item.offset, effectiveDurationMin(gi, item.serviceId))
        const addons = addonsByService[`${gi}:${item.serviceId}`] ?? []
        const choiceType = typeByService[`${gi}:${item.serviceId}`] ?? 'any'
        const special = choiceType === 'pref-female' || choiceType === 'pref-male' || choiceType === 'issue'
        const techVal = special ? choiceType : techByService[`${gi}:${item.serviceId}`] ?? (gi === 0 && ii === 0 && preTech ? preTech : 'first')
        out.push({
          clientName: g.name,
          serviceId: item.serviceId,
          techId: techVal,
          startMin: t.start,
          durationMin: t.end - t.start,
          notes: groupNote,
          addons,
          guestOf: g.isGuest ? guests[0]?.clientId : undefined,
          techRequested: !special && choiceType === 'requested' && techVal !== 'first' ? true : undefined,
        })
      })
    })
    onBook(out, isParty || out.length > 1)
  }

  // shared column template so the time editor (row A) and technician picker (row B)
  // line up cleanly when stacked — a fixed-width left gutter (to match the Clock icon
  // in row A) plus a 2-column grid (fixed left column, flexible right column)
  // shared column template so the time editor (row A) and technician picker (row B) line
  // up cleanly when stacked — a fixed-width left gutter (to match the Clock icon in row A),
  // a fixed-width "for" gutter in the middle, and matching left/right select columns, so the
  // start-time select lines up with the request-type select, and the duration select lines
  // up with the technician-name select (this is what makes "First available" sit directly
  // under/over the duration value instead of drifting depending on the "for" label's width)
  const gridRow = (icon: React.ReactNode, left: React.ReactNode, mid: React.ReactNode, right: React.ReactNode) => (
    <div className="flex items-center gap-1.5">
      <span className="flex h-3 w-3 shrink-0 items-center justify-center">{icon}</span>
      <div className="grid min-w-0 flex-1 grid-cols-[112px_20px_1fr] items-center gap-1.5">
        {left}
        <span className="flex items-center justify-center text-[10px] font-semibold text-ink-faint">{mid}</span>
        {right}
      </div>
    </div>
  )

  // the duration select's fixed option list is a set of "clean" round numbers — when addon
  // minutes push the real duration off that grid (e.g. base 45 + a 20-minute addon = 65),
  // the value wouldn't match any <option> and the browser would silently fall back to
  // displaying the first option (15m) even though the underlying duration is correct.
  // Always including the actual current value as an option keeps the display honest.
  const durOptions = (current: number) =>
    (DUR_OPTS.includes(current) ? DUR_OPTS : [...DUR_OPTS, current].sort((a, b) => a - b))

  const techSelect = (gi: number, svcId: string) => {
    const key = `${gi}:${svcId}`
    const type = typeByService[key] ?? 'any'
    const tech = techByService[key] ?? (gi === 0 && preTech ? preTech : 'first')
    // the tech's own call, not the client's -- still bookable, just flagged
    // so the front desk sees it before going ahead (see Settings → Techs →
    // Clients not taken)
    const guestClientId = guests[gi]?.clientId
    const bannedTech = guestClientId ? techs.find((t) => t.id === tech && (t.bannedClientIds ?? []).includes(guestClientId)) : undefined
    return (
      <>
        {gridRow(
          null,
          <Sel
            value={type}
            onChange={(v) => setTypeByService((m) => ({ ...m, [key]: v }))}
            title="Request type"
            className="w-full"
          >
            <option value="any">Any tech</option>
            <option value="requested">Requested</option>
            <option value="pref-female">Female preferred</option>
            <option value="pref-male">Male preferred</option>
            <option value="issue">Issue</option>
          </Sel>,
          null,
          <SearchSelect
            options={[
              ...(type !== 'requested' ? [{ value: 'first', label: 'First available' }] : []),
              ...roles.flatMap((role) => techs.filter((t) => t.teamId === role.id && t.skills.includes(svcId)).sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
                value: t.id, label: t.name, group: role.name,
              }))),
            ]}
            value={tech}
            disabled={type !== 'any' && type !== 'requested'}
            onChange={(v) => setTechByService((m) => ({ ...m, [key]: v }))}
            placeholder={type === 'requested' ? 'Choose technician…' : 'First available'}
            searchPlaceholder="Search technicians"
            className="min-w-0 w-full"
          />,
        )}
        {bannedTech && (
          <p className="mt-1 flex items-center gap-1.5 pl-[18px] text-[10.5px] font-semibold text-rust">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {bannedTech.name} has stopped taking {guests[gi]?.name.split(' ')[0]}
          </p>
        )}
      </>
    )
  }

  // pretty start + duration editor for each service on the details page
  const timeEditor = (gi: number, svcIds: string[], defStart: number, svcIdForEnd: string) => {
    const dur0 = effectiveDurationMin(gi, svcIdForEnd)
    const cur = timesFor(gi, svcIdForEnd, defStart, dur0)
    const durVal = cur.end - cur.start
    return gridRow(
      <Clock className="h-3 w-3 text-ink-faint" />,
      <Sel value={cur.start} onChange={(v) => editStart(gi, svcIds, defStart, Number(v))} title="Start time" className="tnum w-full font-semibold">
        {Array.from({ length: DAY_MIN / increment }, (_, i) => i * increment).map((m) => (
          <option key={m} value={m}>{fmtTime(m)}</option>
        ))}
      </Sel>,
      'for',
      <Sel
        value={durVal}
        onChange={(v) => editEnd(gi, svcIdForEnd, defStart, cur.start + Number(v))}
        title="Duration"
        className="tnum w-full font-semibold"
      >
        {durOptions(durVal).map((d) => <option key={d} value={d}>{d}m</option>)}
      </Sel>,
    )
  }

  // apply a client's standing preference to whichever of this guest's
  // already-picked services fall in that category -- request this tech for
  // those (covers a service added through the regular picker before this
  // preference was noticed)
  const applyPreference = (gi: number, pref: { techId: string; categoryIds: string[] }) => {
    const svcIds = svcsByGuest[gi] ?? []
    const matches = svcIds.filter((id) => pref.categoryIds.includes(svcById[id]?.categoryId ?? ''))
    if (matches.length === 0) return
    setTechByService((m) => {
      const n = { ...m }
      matches.forEach((id) => { n[`${gi}:${id}`] = pref.techId })
      return n
    })
    setTypeByService((m) => {
      const n = { ...m }
      matches.forEach((id) => { n[`${gi}:${id}`] = 'requested' })
      return n
    })
  }

  // add a specific service to this guest's ticket, with the preferred tech
  // pre-assigned and requested -- the shortcut for "pick exactly which
  // pedicure, JJ does it" once the front desk knows the actual service
  const addPreferredService = (gi: number, techId: string, svcId: string) => {
    setSvcsByGuest((arr) => {
      const n = arr.map((x) => [...x])
      const list = n[gi] ?? []
      n[gi] = list.includes(svcId) ? list : [...list, svcId]
      return n
    })
    setTechByService((m) => ({ ...m, [`${gi}:${svcId}`]: techId }))
    setTypeByService((m) => ({ ...m, [`${gi}:${svcId}`]: 'requested' }))
  }

  // this guest's standing tech preferences, set on their client profile —
  // reminds the front desk who this client wants for this type of service.
  // Preferences are tracked at the category level (e.g. "pedicures"), not an
  // exact service, so this offers a shortcut to add one of that category's
  // services directly (tech pre-assigned), and to sync the tech onto
  // whatever's already picked -- it's purely additive, choosing a service in
  // a different category entirely, from the regular picker, still works fine
  const preferenceBanner = (gi: number) => {
    const g = guests[gi]
    if (!g || g.isGuest || !g.clientId) return null
    const client = clients.find((c) => c.id === g.clientId)
    const prefs = (client?.preferredTechs ?? []).filter((p) => p.categoryIds.length > 0)
    if (prefs.length === 0) return null
    const svcIds = svcsByGuest[gi] ?? []
    return (
      <div className="mb-3 space-y-2 rounded-xl border border-clay/30 bg-clay-tint/20 p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-clay">
          <Heart className="h-3 w-3 shrink-0" style={{ fill: 'currentColor' }} /> {g.name.split(' ')[0]}&rsquo;s usual
        </div>
        {prefs.map((p) => {
          const tech = techs.find((t) => t.id === p.techId)
          if (!tech) return null
          const matchIds = svcIds.filter((id) => p.categoryIds.includes(svcById[id]?.categoryId ?? ''))
          const applied = matchIds.length > 0 && matchIds.every((id) => techByService[`${gi}:${id}`] === p.techId)
          const catServices = orderedSvcs.filter((s) => p.categoryIds.includes(s.categoryId))
          return (
            <div key={p.id} className="space-y-1.5 rounded-lg bg-surface px-2 py-1.5 text-[12px]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-ink-soft">
                  <b className="font-semibold text-ink">{tech.name}</b>
                  {' — '}
                  {p.categoryIds.map((id) => catById[id]?.name ?? id).join(', ')}
                </span>
                {matchIds.length > 0 && (
                  <button
                    onClick={() => applyPreference(gi, p)}
                    disabled={applied}
                    className="shrink-0 rounded-[8px] border border-clay/40 px-2 py-0.5 text-[10.5px] font-semibold text-clay transition-colors hover:bg-clay-tint disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {applied ? 'Applied' : 'Apply to picked'}
                  </button>
                )}
              </div>
              {catServices.length > 0 && (
                <SearchSelect
                  options={catServices.map((s) => ({ value: s.id, label: s.name, sublabel: `$${s.price}`, group: serviceGroupLabel(s, categories) }))}
                  value={catServices.find((s) => svcIds.includes(s.id))?.id ?? ''}
                  onChange={(svcId) => addPreferredService(gi, p.techId, svcId)}
                  placeholder="+ Add service"
                  searchPlaceholder="Search services"
                  className="w-full"
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const parallelBanner = (gi: number) => {
    const svcs = svcsByGuest[gi] ?? []
    if (svcs.length < 2) return null
    if (parallelGuest[gi]) {
      return (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-clay/40 bg-clay-tint/40 px-3 py-2 text-[12px] text-ink">
          <Zap className="h-3.5 w-3.5 text-clay" />
          <span className="flex-1">Services will run <b>in parallel</b> at the same time.</span>
          <button onClick={() => setParallelGuest((p) => { const n = [...p]; n[gi] = false; return n })} className="font-semibold text-clay underline">
            Split back-to-back
          </button>
        </div>
      )
    }
    return (
      <div className="mb-3 rounded-xl border border-line bg-cream px-3 py-2 text-[12px] text-ink-faint">
        {svcs.map((id) => svcById[id].short).join(' and ')} can be scheduled at the same time.{' '}
        <button onClick={() => setParallelGuest((p) => { const n = [...p]; n[gi] = true; return n })} className="font-semibold text-clay underline">
          Combine parallel services
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[85] flex w-[596px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* header */}
      <div className="border-b border-line bg-cream px-4 py-3.5">
        <div className="flex items-start gap-3">
          {step !== 'guest' && (
            <button
              onClick={() => setStep(step === 'details' ? 'services' : 'guest')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {guests[0] ? (
            <>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay-tint text-sm font-bold text-clay">
                {guests[0].name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {guests[0].isGuest ? (
                    <span className="truncate text-[14px] font-bold text-ink">{guests[0].name}</span>
                  ) : (
                    <button onClick={() => onViewProfile(guests[0].name)} className="truncate text-[14px] font-bold text-ink hover:text-clay" title="Open guest profile">
                      {guests[0].name}
                    </button>
                  )}
                  <span className="flex items-center gap-1 rounded-full bg-clay-tint px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-clay">
                    <span className="h-1.5 w-1.5 rounded-full bg-clay" />
                    New
                  </span>
                </div>
                <div className="mt-1 space-y-0.5 text-[11px] text-ink-faint">
                  {guests[0].phone && (
                    <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {guests[0].phone}</div>
                  )}
                  {!guests[0].isGuest && (
                    <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {guests[0].name.split(' ')[0].toLowerCase()}@email.com</div>
                  )}
                  <div className="flex items-center gap-1.5">Host: Front desk{guests.length > 1 && (
                    <span className="flex items-center gap-0.5 text-clay"><Link2 className="h-3 w-3" /> group of {guests.length}</span>
                  )}</div>
                  {!guests[0].isGuest && (
                    <button onClick={() => onViewProfile(guests[0].name)} className="font-semibold text-clay hover:underline">View full profile →</button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1 text-[14px] font-bold text-ink">New appointment</div>
          )}
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* main column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {step === 'guest' && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search guest by name or phone"
                  className="w-full rounded-[8px] border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-faint hover:bg-cream hover:text-ink"
                  title="Add new guest"
                >
                  <UserPlus className="h-4 w-4" />
                </button>
              </div>

              {addOpen && (
                <div className="mt-2 space-y-2 rounded-xl border border-line bg-surface p-3">
                  <div className="text-xs font-bold text-ink">New client account</div>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name"
                    className="w-full rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring" />
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (required for an account)"
                    className="w-full rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring" />
                  <button onClick={createGuest} disabled={!newName.trim() || !newPhone.trim()}
                    className="w-full rounded-[8px] bg-clay py-1.5 text-sm font-semibold text-white transition-colors hover:bg-clay-deep disabled:opacity-40">
                    Create account &amp; select
                  </button>
                  <p className="text-[10.5px] text-ink-faint">
                    Bringing someone along? Add them later as a name-only guest, no account needed.
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-1">
                {matches.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickGuest(c)}
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-line hover:bg-cream"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay-tint text-xs font-bold text-clay">
                      {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                      <span className="block text-[11px] text-ink-faint">{c.phone} · {c.visits} visits</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-faint" />
                  </button>
                ))}
                {matches.length === 0 && (
                  <div className="py-8 text-center text-sm text-ink-faint">
                    No clients match, <button onClick={() => setAddOpen(true)} className="text-clay underline">create their account</button>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'services' && (
            <>
              {/* guest chips + add guest -- sticky so they stay visible while the
                  services list below scrolls */}
              <div className="sticky top-0 z-10 bg-popover pb-3">
                {/* guest chips, click to edit that guest's services; X removes */}
                <div className="flex flex-wrap gap-2">
                  {guests.map((g, i) => (
                    <button
                      key={g.id}
                      onClick={() => setActiveGuest(i)}
                      className={`flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        activeGuest === i ? 'border-clay/60 bg-clay-tint text-ink' : 'border-line text-ink-faint hover:border-clay/40'
                      }`}
                      title={`Select services for ${g.name}`}
                    >
                      {g.name}
                      {g.isGuest ? (
                        <span className="rounded-full bg-cream px-1.5 text-[10px] font-semibold text-ink-faint">guest</span>
                      ) : isParty && hostIdx === i && (
                        <span className="rounded-full bg-amberw-tint px-1.5 text-[10px] font-semibold text-amberw">host</span>
                      )}
                      <span className="rounded-full bg-olive-tint px-1.5 text-[10px] text-olive">
                        {(svcsByGuest[i] ?? []).length} svc
                      </span>
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); removeGuest(i) }}
                        className="hover:text-rust"
                        title={`Remove ${g.name}`}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </button>
                  ))}
                  {!addGuestOpen && (
                    <button
                      onClick={() => setAddGuestOpen(true)}
                      className="flex items-center gap-1.5 rounded-[8px] border border-dashed border-input px-3 py-1.5 text-xs font-semibold text-ink-faint transition-colors hover:border-clay/40 hover:text-clay"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Add Guest
                    </button>
                  )}
                </div>

                {/* add another guest, hidden behind the button above until clicked */}
                {addGuestOpen && (
                <div className="mt-2">
                  <AddAnotherGuest
                    clients={clients}
                    guests={guests}
                    primaryName={guests[0]?.name ?? ''}
                    onPick={(c) => { pickGuest(c); setAddGuestOpen(false) }}
                    onPickNameOnly={(name) => { pickNameOnlyGuest(name); setAddGuestOpen(false) }}
                    onCreate={(name, phone) => {
                      const c: ClientRecord = { id: `c${Date.now()}`, name, phone: phone || '(555) 000-0000', visits: 0 }
                      onAddClient(c)
                      pickGuest(c)
                      setAddGuestOpen(false)
                    }}
                  />
                </div>
                )}
              </div>

              {/* tabs */}
              <div className="mb-3 mt-4 flex gap-4 border-b border-line text-sm">
                {(['services', 'history', 'notes'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 pb-2 capitalize ${tab === t ? 'border-clay font-semibold text-ink' : 'border-transparent text-ink-faint'}`}>
                    {t === 'history' ? 'Appointments' : t}
                  </button>
                ))}
              </div>

              {tab === 'services' && (
                <>
                  {preferenceBanner(activeGuest)}
                  {parallelBanner(activeGuest)}
                  <div className="space-y-1">
                    <div className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      Services for {guests[activeGuest]?.name}
                    </div>
                    <div className="relative mb-2">
                      <Search className="pointer-events-none absolute left-2.5 top-[9px] h-3.5 w-3.5 text-ink-faint" />
                      <input
                        value={svcQuery}
                        onChange={(e) => setSvcQuery(e.target.value)}
                        placeholder="Search services"
                        className="w-full rounded-[8px] border border-input bg-background py-1.5 pl-8 pr-3 text-[13px] outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    {(() => {
                      const query = svcQuery.trim().toLowerCase()
                      const filteredSvcs = query ? orderedSvcs.filter((s) => s.name.toLowerCase().includes(query)) : orderedSvcs
                      if (filteredSvcs.length === 0) {
                        return <div className="py-6 text-center text-sm text-ink-faint">No services match "{svcQuery.trim()}"</div>
                      }
                      return filteredSvcs.map((s, i) => {
                        const group = serviceGroupLabel(s, categories)
                        const showHeader = group !== undefined && (i === 0 || group !== serviceGroupLabel(filteredSvcs[i - 1], categories))
                        const selected = (svcsByGuest[activeGuest] ?? []).includes(s.id)
                        return (
                          <div key={s.id}>
                            {showHeader && (
                              <div className={`px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint ${i === 0 ? '' : 'pt-2.5'}`}>
                                {group}
                              </div>
                            )}
                            <button
                              onClick={() => toggleService(s.id)}
                              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                                selected ? 'border-clay/60 bg-clay-tint/30' : 'border-transparent hover:border-line hover:bg-cream'
                              }`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-ink">{s.name}</span>
                                <span className="block text-[11px] text-ink-faint">${s.price} · {s.durationMin}min</span>
                              </span>
                              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-clay bg-clay text-white' : 'border-line'}`}>
                                {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                              </span>
                            </button>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </>
              )}

              {tab === 'history' && (() => {
                const pg = guests[activeGuest] ?? guests[0]
                if (pg?.isGuest) {
                  return (
                    <div className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-ink-faint">
                      Name-only guest, their visits are tracked under {guests[0]?.name}&rsquo;s profile, in the Guests tab.
                    </div>
                  )
                }
                const acc = clients.find((c) => c.id === pg?.clientId)
                const visits = acc
                  ? [...buildRealVisits(acc.name)].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5)
                  : []
                return (
                  <div className="space-y-2">
                    {visits.map((h) => (
                      <div key={h.paymentId} className="rounded-xl border border-line p-3 text-sm">
                        <div className="text-[11px] text-ink-faint">{h.date}</div>
                        <div className="font-semibold text-ink">{h.services.join(' + ')}</div>
                        <div className="text-[11px] text-ink-faint">Gloss Nail Bar · ${h.price.toFixed(2)}</div>
                      </div>
                    ))}
                    {visits.length === 0 && <div className="py-6 text-center text-sm text-ink-faint">New client, no past visits</div>}
                  </div>
                )
              })()}

              {tab === 'notes' && (
                <div className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-ink-faint">
                  No notes yet for this guest.
                </div>
              )}
            </>
          )}

          {step === 'details' && (
            <div className="space-y-3">
              {isParty && (
                <div className="flex items-center gap-2 rounded-xl border border-line bg-cream px-3 py-2 text-xs text-ink-faint">
                  <Users className="h-3.5 w-3.5" />
                  <input
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Group name (optional)"
                    className="w-40 rounded-[8px] border border-input bg-background px-2 py-1 text-[11px] outline-none"
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
                      <span className="text-sm font-bold text-ink">{g.name}</span>
                      {isParty && (
                        <label className="flex items-center gap-1 text-[11px] text-ink-faint">
                          <input
                            type="radio"
                            name="host"
                            checked={hostIdx === gi}
                            onChange={() => setHostIdx(gi)}
                            className="accent-clay"
                          />
                          Host of the group?
                        </label>
                      )}
                    </div>
                    {parallelBanner(gi)}
                    {isPar && (
                      <div className="rounded-xl border border-clay/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-clay">
                          <Zap className="h-3.5 w-3.5" /> Parallel Services, shared start
                        </div>
                        {/* start picker + dynamic end: ends whenever the LONGEST service finishes —
                            only meaningful once a time is actually picked */}
                        {time != null && (() => {
                          const cur = timesFor(gi, svcs[0], time, effectiveDurationMin(gi, svcs[0]))
                          const longest = Math.max(...svcs.map((id) => timesFor(gi, id, time, effectiveDurationMin(gi, id)).end - time), 0)
                          const end = time + longest
                          return (
                            <div className="mb-2.5 flex items-center gap-1.5">
                              <Clock className="h-3 w-3 shrink-0 text-ink-faint" />
                              <Sel value={cur.start} onChange={(v) => editStart(gi, svcs, time, Number(v))} title="Shared start time" className="tnum w-[104px] shrink-0 font-semibold">
                                {Array.from({ length: DAY_MIN / increment }, (_, i) => i * increment).map((m) => (
                                  <option key={m} value={m}>{fmtTime(m)}</option>
                                ))}
                              </Sel>
                              <span className="text-[10px] font-semibold text-ink-faint">to</span>
                              <span className="tnum rounded-[8px] border border-dashed border-input bg-cream px-2 py-1 text-[11px] font-bold text-ink-faint" title="Ends when the longest service finishes">
                                {fmtTime(end)}
                              </span>
                              <span className="text-[10px] text-ink-faint">({longest}m, longest)</span>
                            </div>
                          )
                        })()}
                        {/* services + technician choices show up front, regardless of whether a
                            time's been picked yet — picking a time in the rail needs to know who's
                            being requested first */}
                        <div className="space-y-2">
                          {svcs.map((id) => {
                            const cur = timesFor(gi, id, time ?? 0, effectiveDurationMin(gi, id))
                            const durVal = cur.end - cur.start
                            return (
                              <div key={id} className="rounded-xl border border-line p-2">
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{svcById[id].name}
                                    <span className="ml-1 text-[10.5px] font-normal text-ink-faint">
                                      ${priceWithAddons(gi, id)}{time != null && ` · ends ${fmtTime(cur.end)}`}
                                    </span>
                                  </span>
                                  <Sel
                                    value={durVal}
                                    onChange={(v) => editEnd(gi, id, time ?? 0, cur.start + Number(v))}
                                    title="Duration"
                                    className="tnum w-[76px] shrink-0 font-semibold"
                                  >
                                    {durOptions(durVal).map((d) => <option key={d} value={d}>{d}m</option>)}
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
                    {!isPar && layoutItems(svcs, false, (id) => effectiveDurationMin(gi, id)).map((item) => {
                      const svc0 = svcById[item.serviceId]
                      const cur = timesFor(gi, item.serviceId, (time ?? 0) + item.offset, effectiveDurationMin(gi, item.serviceId))
                      return (
                        <div key={item.serviceId} className="rounded-xl border border-line p-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-semibold text-ink">{svc0.name}</span>
                            <span className="text-ink-faint">${priceWithAddons(gi, item.serviceId)} · {cur.end - cur.start}m</span>
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
                className="w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {/* day + available-times rail */}
        {step !== 'guest' && (
          <div className="w-48 shrink-0 overflow-y-auto border-l border-line p-3">
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
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {isParty || parallelGuest.some(Boolean) ? 'Start together' : 'Available times'}
            </div>
            {slotPlans.length === 0 && (
              <div className="text-[11px] text-ink-faint">
                {allSvcs.length === 0 || !guests.every((_g, i) => (svcsByGuest[i] ?? []).length > 0)
                  ? isParty ? 'Pick services for each guest' : 'Select services to view openings'
                  : !allTechsReady ? 'Choose who’s requested to see available times'
                    : 'No slots this day'}
              </div>
            )}
            <div className="space-y-1">
              {slotPlans.map(({ start: s, status, moves }) => (
                <button
                  key={s}
                  onClick={() => {
                    if (status === 'open') selectTime(s)
                    else if (status === 'movable' && moves) onRequestMakeRoom(moves, s, () => selectTime(s))
                    else selectTime(s)
                  }}
                  title={
                    status === 'blocked' ? 'No qualified tech free — booking this will double-book a tech'
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
        )}
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
            {allSvcs.length > 0 ? `${allSvcs.length} Selected` : 'Total'}
          </span>
          <span className="ml-2 text-ink-faint">
            {totalMin > 0 && `${totalMin}min · `}{`$${total.toFixed(2)}`}
          </span>
        </div>
        {step === 'services' ? (
          <button
            onClick={() => setStep('details')}
            disabled={!canProceedToDetails}
            className="ml-auto flex items-center justify-center gap-2 rounded-[10px] bg-clay px-5 py-2 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep disabled:opacity-40"
          >
            Proceed <ChevronRight className="h-4 w-4" />
          </button>
        ) : step === 'details' ? (
          <button
            onClick={book}
            disabled={!canProceed}
            className="ml-auto flex items-center justify-center gap-2 rounded-[10px] bg-clay px-5 py-2 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep disabled:opacity-40"
          >
            <Check className="h-4 w-4" /> Book now
          </button>
        ) : (
          <button onClick={onClose} className="ml-auto rounded-[8px] border border-line px-4 py-2 text-sm font-semibold text-ink-faint transition-colors hover:bg-cream hover:text-ink">
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
      <Search className="pointer-events-none absolute left-2.5 top-[7px] h-3.5 w-3.5 text-ink-faint" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Guest name or phone number"
        className="w-full rounded-[8px] border border-dashed border-input bg-background py-1.5 pl-8 pr-3 text-[12px] outline-none focus:ring-1 focus:ring-ring"
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
                {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
              <span className="text-[10px] text-ink-faint">{c.phone}</span>
            </button>
          ))}
          {/* name-only guest, no profile, linked to the booking client */}
          <button
            type="button"
            onMouseDown={() => { onPickNameOnly(q.trim()); setQ(''); setPhone('') }}
            className="flex w-full items-center gap-2 border-t border-line bg-clay-tint/20 px-2.5 py-2 text-left text-[12px] hover:bg-clay-tint/40"
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-clay" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-ink">Add &ldquo;{q.trim()}&rdquo; as guest</span>
              <span className="block text-[10px] text-ink-faint">name only, no profile, links to {primaryName}</span>
            </span>
          </button>
          {/* or create a full account for them, phone required */}
          <div className="border-t border-line p-1.5">
            <div className="flex items-center gap-1">
              <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={`New account "${q}", phone`}
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
            <p className="mt-1 pl-5 text-[10px] text-ink-faint">phone required for an account, or use the guest option above</p>
          </div>
        </div>
      )}
    </div>
  )
}
