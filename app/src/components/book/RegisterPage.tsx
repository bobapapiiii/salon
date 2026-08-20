// ─── Manage register, the cash drawer's open/close ──────────────────────────
// Full-screen section. The salon opens the register at the start of the day
// with a starting float, takes payments all day, then closes it by counting
// the drawer: the register works out what SHOULD be in there (float + the cash
// it took) and compares that to what was actually counted, so any over/short
// is caught the same day instead of going unnoticed.
//
// Deliberately not here: mid-day counts and tips payout — cash leaves the
// drawer only through the close count in this build.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Banknote, Check, ChevronDown, ChevronRight, CreditCard, Lock, LockOpen, Printer, Receipt, Scale, Search, X,
} from 'lucide-react'
import { useSettingsStore, type RegisterConfig } from '@/lib/settings-store'
import { paymentSources, type PaymentSource } from './CheckoutDialog'

/** one open→close cycle of the drawer */
export interface RegisterSession {
  id: string
  /** which configured register this shift ran on (see RegisterConfig in Settings) */
  registerId: string
  /** frozen at open time, so history still reads right if the register is later renamed or removed */
  registerName: string
  /** business day the register was opened on */
  dateKey: string
  openedAt: number
  openedBy: string
  /** cash put in the drawer to start the day */
  openingFloat: number
  /** denomination → quantity, when it was counted rather than typed as a total */
  openingCounts?: Record<string, number>
  openingNote?: string
  closedAt?: number
  closedBy?: string
  /** what was actually counted in the drawer at close */
  countedCash?: number
  closingCounts?: Record<string, number>
  /** float + cash taken, frozen at close so history never drifts */
  expectedCash?: number
  /** countedCash − expectedCash: positive is over, negative is short */
  variance?: number
  closingNote?: string
  /** what the shift took, by tender, frozen at close */
  tenders?: { method: string; amount: number; count: number }[]
}

/** the slice of a payment record this page needs */
export interface RegisterPayment {
  id: string
  dateKey: string
  clientName: string
  method: string
  total: number
  /** the actual tender(s) taken; older records fall back to method/total via paymentSources() */
  sources?: PaymentSource[]
  /** money given back on this ticket, from a specific source -- reduces what actually sits in the drawer/account */
  refunds?: { amount: number; sourceId: string }[]
  /** when it was taken; older records fall back to the timestamp in their id */
  at?: number
  /** every distinct name on the ticket (host + party/guests), so the
   *  transaction search below can find it under a guest's name too, not
   *  just whoever the ticket happens to be filed under */
  clientNames?: string[]
}

/** every payment carries a time, one way or another — new records stamp `at`,
 *  older ones still have the `pay${Date.now()}` id they were created with */
export const paymentAt = (p: RegisterPayment): number => p.at ?? (Number(p.id.replace(/\D/g, '')) || 0)

/** one line in the "still needs checkout" list -- already resolved to display
 *  strings so this page doesn't need the service catalog or staff roster */
export interface RegisterOpenAppt {
  id: string
  /** the appointment's own day -- ids reset per day, so resolving it (or
   *  routing back to the right board) needs this alongside the id */
  dateKey: string
  clientName: string
  serviceLabel: string
  techName: string
  timeLabel: string
}

/** one line in the "balance still due" list */
export interface RegisterBalanceDueItem {
  id: string
  clientName: string
  amount: number
  total: number
}

/** payments taken while this session was (or still is) open */
export function sessionPayments(s: RegisterSession, payments: RegisterPayment[]): RegisterPayment[] {
  return payments.filter((p) => {
    const at = paymentAt(p)
    return at >= s.openedAt && (s.closedAt == null || at <= s.closedAt)
  })
}

export function cashTakenIn(list: RegisterPayment[]): number {
  let total = 0
  for (const p of list) {
    for (const s of paymentSources(p)) {
      if (s.method !== 'Cash') continue
      const refunded = (p.refunds ?? []).filter((r) => r.sourceId === s.id).reduce((a, r) => a + r.amount, 0)
      total += s.amount - refunded
    }
  }
  return Math.round(total * 100) / 100
}

/** net amount actually taken per tender, across every source on every
 *  payment, with anything refunded back off a source subtracted out */
export function tenderBreakdown(list: RegisterPayment[]): { method: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>()
  for (const p of list) {
    for (const s of paymentSources(p)) {
      const refunded = (p.refunds ?? []).filter((r) => r.sourceId === s.id).reduce((a, r) => a + r.amount, 0)
      const net = Math.round((s.amount - refunded) * 100) / 100
      if (net === 0) continue
      const cur = m.get(s.method) ?? { amount: 0, count: 0 }
      m.set(s.method, { amount: Math.round((cur.amount + net) * 100) / 100, count: cur.count + 1 })
    }
  }
  return [...m.entries()]
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.amount - a.amount)
}

const DENOMS: { id: string; label: string; value: number }[] = [
  { id: 'b100', label: '$100', value: 100 },
  { id: 'b50', label: '$50', value: 50 },
  { id: 'b20', label: '$20', value: 20 },
  { id: 'b10', label: '$10', value: 10 },
  { id: 'b5', label: '$5', value: 5 },
  { id: 'b1', label: '$1', value: 1 },
  { id: 'c25', label: '25¢', value: 0.25 },
  { id: 'c10', label: '10¢', value: 0.1 },
  { id: 'c05', label: '5¢', value: 0.05 },
  { id: 'c01', label: '1¢', value: 0.01 },
]

const money = (v: number) => `$${v.toFixed(2)}`
const countsTotal = (c: Record<string, number>) =>
  Math.round(DENOMS.reduce((t, d) => t + d.value * (c[d.id] ?? 0), 0) * 100) / 100

const stamp = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const dayLabelOf = (key: string) =>
  new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

/** same invoice-number scheme InvoiceDialog prints, so a number written down
 *  from a receipt can be typed straight into the search below */
const invoiceNoOf = (p: RegisterPayment) => `INV-${p.id.replace(/\D/g, '').slice(-6)}`

const TX_RESULTS_CAP = 25

/* ── cash counter: count the drawer by denomination, or just type the total ── */
function CashCounter({ counts, onCounts, manual, onManual, byDenom, onMode, label }: {
  counts: Record<string, number>
  onCounts: (c: Record<string, number>) => void
  manual: string
  onManual: (v: string) => void
  byDenom: boolean
  onMode: (v: boolean) => void
  label: string
}) {
  const total = byDenom ? countsTotal(counts) : Number(manual) || 0
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
        <div className="flex rounded-[8px] border border-line p-0.5">
          {[true, false].map((mode) => (
            <button
              key={String(mode)}
              type="button"
              onClick={() => onMode(mode)}
              className={`rounded-[6px] px-2 py-1 text-[11px] font-bold transition-colors ${
                byDenom === mode ? 'bg-clay-tint text-clay' : 'text-ink-faint hover:text-ink'
              }`}
            >
              {mode ? 'Count by denomination' : 'Enter a total'}
            </button>
          ))}
        </div>
      </div>

      {byDenom ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3.5">
          {DENOMS.map((d) => {
            const qty = counts[d.id] ?? 0
            return (
              <div key={d.id} className="flex items-center gap-2">
                <span className="tnum w-10 shrink-0 text-[12px] font-bold text-ink-soft">{d.label}</span>
                <span className="text-[11px] text-ink-faint">×</span>
                <input
                  type="number"
                  min={0}
                  value={qty === 0 ? '' : qty}
                  placeholder="0"
                  onChange={(e) => {
                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0))
                    onCounts({ ...counts, [d.id]: n })
                  }}
                  className="tnum h-8 w-20 rounded-[8px] border border-input bg-background px-2 text-[12px] font-semibold outline-none focus:border-clay"
                />
                <span className="tnum ml-auto text-[12px] font-semibold text-ink-faint">
                  {qty > 0 ? money(d.value * qty) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3.5">
          <span className="text-[13px] font-bold text-ink-faint">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={manual}
            placeholder="0.00"
            onChange={(e) => onManual(e.target.value.replace(/[^\d.]/g, ''))}
            className="tnum h-10 w-40 rounded-[8px] border border-input bg-background px-2.5 text-[15px] font-bold outline-none focus:border-clay"
          />
          <span className="text-[11.5px] text-ink-faint">Total cash in the drawer</span>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line bg-cream/60 px-3.5 py-2.5">
        <span className="text-[12px] font-semibold text-ink-soft">Counted</span>
        <span className="tnum text-[16px] font-bold text-ink">{money(total)}</span>
      </div>
    </div>
  )
}

/* ── a labelled money row, the shared building block of both summaries ── */
function Row({ label, value, sub, strong, tone }: {
  label: string
  value: string
  sub?: string
  strong?: boolean
  tone?: 'olive' | 'rust' | 'amberw'
}) {
  const color = tone === 'olive' ? 'text-olive' : tone === 'rust' ? 'text-rust' : tone === 'amberw' ? 'text-amberw' : 'text-ink'
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'border-t border-line pt-2' : ''}`}>
      <span className={`text-[12.5px] ${strong ? 'font-bold text-ink' : 'text-ink-soft'}`}>
        {label}
        {sub && <span className="ml-1.5 text-[11px] font-normal text-ink-faint">{sub}</span>}
      </span>
      <span className={`tnum shrink-0 ${strong ? 'text-[16px] font-bold' : 'text-[13px] font-semibold'} ${color}`}>{value}</span>
    </div>
  )
}

interface Props {
  open: boolean
  /** every configured register, active or not (see RegisterConfig in Settings) */
  registers: RegisterConfig[]
  /** the register picked at today's login, preselects the panel below */
  defaultRegisterId?: string | null
  sessions: RegisterSession[]
  payments: RegisterPayment[]
  /** who's signed in, recorded as the person opening/closing */
  userName: string
  /** today's business day key, the day a new session is stamped with */
  todayKey: string
  /** appointments still needing checkout on a given day — closing is blocked
   *  while the list for the session actually being closed isn't empty. A
   *  function, not a fixed list, since the session being closed isn't
   *  necessarily today's (see staleRegisterOpen in AppointmentBook) */
  openApptsFor: (day: string) => RegisterOpenAppt[]
  /** tickets left with a balance due after a partial payment, for a given
   *  day — closing is blocked while this list isn't empty too */
  balanceDuePaymentsFor: (day: string) => RegisterBalanceDueItem[]
  /** jump straight to checking out this appointment (closes this page to do it) */
  onResolveAppt: (id: string, day: string) => void
  /** jump straight to collecting what's still owed on this ticket (closes this page to do it) */
  onResolvePayment: (id: string) => void
  onOpenRegister: (s: RegisterSession) => void
  onCloseRegister: (id: string, patch: Partial<RegisterSession>) => void
  onClose: () => void
}

export function RegisterPage({
  open, registers, defaultRegisterId, sessions, payments, userName, todayKey, openApptsFor, balanceDuePaymentsFor,
  onResolveAppt, onResolvePayment, onOpenRegister, onCloseRegister, onClose,
}: Props) {
  // active registers show in the picker; an inactive one still shows if it
  // was somehow left open, so it's never stuck un-closeable behind the toggle
  const visibleRegisters = useMemo(
    () => registers.filter((r) => r.active || sessions.some((s) => s.registerId === r.id && s.closedAt == null)),
    [registers, sessions],
  )
  const [selectedId, setSelectedId] = useState<string | null>(defaultRegisterId ?? visibleRegisters[0]?.id ?? null)
  // keep the selection valid as the configured list or today's pick changes
  useEffect(() => {
    if (selectedId && visibleRegisters.some((r) => r.id === selectedId)) return
    setSelectedId(defaultRegisterId ?? visibleRegisters[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultRegisterId, visibleRegisters.map((r) => r.id).join(',')])

  const selected = visibleRegisters.find((r) => r.id === selectedId) ?? null
  const active = selected ? sessions.find((s) => s.registerId === selected.id && s.closedAt == null) ?? null : null
  // gated on the OPEN session's own day, not always today -- a session left
  // open from a previous day closes against its own leftovers (see the
  // openApptsFor/balanceDuePaymentsFor prop docs)
  const openAppts = active ? openApptsFor(active.dateKey) : []
  const balanceDuePayments = active ? balanceDuePaymentsFor(active.dateKey) : []
  // "today" reads right for the normal same-day close; a stale session
  // being closed a day (or more) late should say which day it's actually
  // listing, so this doesn't look like it's blocking on unrelated live
  // appointments that haven't happened yet
  const closingDayLabel = active && active.dateKey !== todayKey ? dayLabelOf(active.dateKey) : 'today'
  const history = useMemo(
    () => (selected
      ? sessions.filter((s) => s.registerId === selected.id && s.closedAt != null).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      : []),
    [sessions, selected],
  )
  // closed shifts grouped by calendar month -- after a year of daily closes
  // this is a dozen collapsible headers instead of hundreds of flat rows.
  // `history` is already newest-first, so the first time a month key shows
  // up fixes that group's position; no separate sort needed
  const historyByMonth = useMemo(() => {
    const byKey = new Map<string, RegisterSession[]>()
    for (const s of history) {
      const key = s.dateKey.slice(0, 7)
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(s)
    }
    const groups: { key: string; label: string; shifts: RegisterSession[] }[] = []
    const seen = new Set<string>()
    for (const s of history) {
      const key = s.dateKey.slice(0, 7)
      if (seen.has(key)) continue
      seen.add(key)
      groups.push({
        key,
        label: new Date(key + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        shifts: byKey.get(key)!,
      })
    }
    return groups
  }, [history])

  // open form
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({})
  const [openManual, setOpenManual] = useState('')
  const [openByDenom, setOpenByDenom] = useState(true)
  const [openNote, setOpenNote] = useState('')

  // close form
  const [closing, setClosing] = useState(false)
  const [closeCounts, setCloseCounts] = useState<Record<string, number>>({})
  const [closeManual, setCloseManual] = useState('')
  const [closeByDenom, setCloseByDenom] = useState(true)
  const [closeNote, setCloseNote] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  // which month groups in Closed shifts are expanded -- the current
  // calendar month starts open, everything further back starts collapsed
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set([todayKey.slice(0, 7)]))
  const toggleMonth = (key: string) => setExpandedMonths((s) => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })
  // the closure report: `true` previews the shift about to close, using the
  // live close-form numbers below; a RegisterSession instead reprints a
  // past shift straight from its own stored record (see the history table)
  const [reportPreview, setReportPreview] = useState(false)
  const [reportSession, setReportSession] = useState<RegisterSession | null>(null)

  // this shift's takings, live while it's open
  const shift = useMemo(() => (active ? sessionPayments(active, payments) : []), [active, payments])
  const cashIn = cashTakenIn(shift)
  const tenders = tenderBreakdown(shift)
  const collected = Math.round(tenders.reduce((t, x) => t + x.amount, 0) * 100) / 100
  const expected = active ? Math.round((active.openingFloat + cashIn) * 100) / 100 : 0

  const counted = closeByDenom ? countsTotal(closeCounts) : Number(closeManual) || 0
  const variance = Math.round((counted - expected) * 100) / 100
  const openingTotal = openByDenom ? countsTotal(openCounts) : Number(openManual) || 0

  if (!open) return null

  const resetForms = () => {
    setOpenCounts({}); setOpenManual(''); setOpenNote(''); setOpenByDenom(true)
    setCloseCounts({}); setCloseManual(''); setCloseNote(''); setCloseByDenom(true); setClosing(false)
  }

  const doOpen = () => {
    if (!selected) return
    onOpenRegister({
      id: `reg${Date.now()}`,
      registerId: selected.id,
      registerName: selected.name,
      dateKey: todayKey,
      openedAt: Date.now(),
      openedBy: userName,
      openingFloat: openingTotal,
      openingCounts: openByDenom ? openCounts : undefined,
      openingNote: openNote.trim() || undefined,
    })
    resetForms()
  }

  const doClose = () => {
    if (!active) return
    onCloseRegister(active.id, {
      closedAt: Date.now(),
      closedBy: userName,
      countedCash: counted,
      closingCounts: closeByDenom ? closeCounts : undefined,
      expectedCash: expected,
      variance,
      closingNote: closeNote.trim() || undefined,
      tenders,
    })
    resetForms()
  }

  const varianceTone = variance === 0 ? 'olive' : variance > 0 ? 'amberw' : 'rust'
  const varianceLabel = variance === 0 ? 'Balanced' : variance > 0 ? `Over by ${money(variance)}` : `Short by ${money(Math.abs(variance))}`

  return (
    <>
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#FAF8FA]">
      {/* ══ header ══ */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-clay-tint text-clay">
          <Banknote className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[17px] font-extrabold leading-tight text-ink">Manage register</h1>
          <p className="truncate text-[12px] font-medium text-ink-soft">
            {!selected
              ? 'No registers configured, add one in Settings, Registers'
              : active
                ? `${selected.name}, open since ${stamp(active.openedAt)} · by ${active.openedBy}`
                : `${selected.name} is closed, open it to start taking cash`}
          </p>
        </div>
        {selected && (
          <span
            className={`ml-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              active ? 'bg-olive-tint text-olive' : 'bg-secondary text-ink-faint'
            }`}
          >
            {active ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {active ? 'Open' : 'Closed'}
          </span>
        )}
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-soft transition-colors hover:bg-cream"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ══ body ══ */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-3xl space-y-4">

          {/* ── switch between registers, only shown once there's more than one ── */}
          {visibleRegisters.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {visibleRegisters.map((r) => {
                const isOpen = sessions.some((s) => s.registerId === r.id && s.closedAt == null)
                const isSel = r.id === selected?.id
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                      isSel ? 'border-clay bg-clay-tint text-clay' : 'border-line bg-surface text-ink-soft hover:bg-cream'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOpen ? 'bg-olive' : 'bg-ink-faint/50'}`} />
                    {r.name}
                    {!r.active && <span className="text-[10px] font-normal text-ink-faint">(inactive)</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── no registers configured at all ── */}
          {!selected && (
            <div className="rounded-2xl border border-line bg-surface p-5 text-center">
              <Banknote className="mx-auto h-6 w-6 text-ink-faint" />
              <h2 className="mt-2 text-[15px] font-bold text-ink">No registers set up yet</h2>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-ink-soft">
                Add at least one cash register in Settings, Registers before you can open a drawer.
              </p>
            </div>
          )}

          {/* ── no register open: open it ── */}
          {!active && selected && (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[15px] font-bold text-ink">Open {selected.name}</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                Count the cash you're starting the drawer with. Everything taken from here until you close
                gets measured against it.
              </p>
              <div className="mt-3.5">
                <CashCounter
                  label="Starting cash (float)"
                  counts={openCounts}
                  onCounts={setOpenCounts}
                  manual={openManual}
                  onManual={setOpenManual}
                  byDenom={openByDenom}
                  onMode={setOpenByDenom}
                />
              </div>
              <input
                value={openNote}
                onChange={(e) => setOpenNote(e.target.value)}
                placeholder="Note (optional), e.g. topped up small bills from the safe"
                className="mt-3 w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-clay"
              />
              <button
                type="button"
                onClick={doOpen}
                className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep"
              >
                <LockOpen className="h-4 w-4" /> Open {selected.name} with {money(openingTotal)}
              </button>
              <p className="mt-2 text-center text-[11px] text-ink-faint">
                Opening as <b className="text-ink-soft">{userName}</b> · {dayLabelOf(todayKey)}
              </p>
            </div>
          )}

          {/* ── register open: the live shift ── */}
          {active && (
            <>
              {active.dateKey !== todayKey && (
                <div className="flex items-start gap-2 rounded-xl border border-amberw/40 bg-amberw-tint/50 px-3.5 py-2.5 text-[12px] text-ink">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amberw" />
                  <span>
                    This register has been open since <b>{dayLabelOf(active.dateKey)}</b>. Close it out so the
                    day's cash is reconciled against the right shift.
                  </span>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {/* drawer */}
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                    <Banknote className="h-4 w-4 text-clay" /> Cash drawer
                  </h2>
                  <div className="space-y-1.5">
                    <Row label="Opening float" value={money(active.openingFloat)} />
                    <Row
                      label="Cash taken"
                      sub={(() => { const n = tenders.find((t) => t.method === 'Cash')?.count ?? 0; return `${n} sale${n === 1 ? '' : 's'}` })()}
                      value={`+ ${money(cashIn)}`}
                    />
                    <Row label="Expected in drawer" value={money(expected)} strong />
                  </div>
                  {active.openingNote && (
                    <p className="mt-2.5 border-t border-line pt-2 text-[11px] italic text-ink-faint">{active.openingNote}</p>
                  )}
                </div>

                {/* every tender, so the shift reads as a whole */}
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                    <Scale className="h-4 w-4 text-clay" /> This shift
                  </h2>
                  {tenders.length === 0 ? (
                    <p className="py-3 text-[12.5px] text-ink-faint">No payments taken yet on this shift.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {tenders.map((t) => (
                        <Row key={t.method} label={t.method} sub={`${t.count} sale${t.count === 1 ? '' : 's'}`} value={money(t.amount)} />
                      ))}
                      <Row label="Total collected" value={money(collected)} strong />
                    </div>
                  )}
                  <p className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-faint">
                    Only cash sits in the drawer — card and app tenders are listed here for the shift total.
                  </p>
                </div>
              </div>

              {/* close, blocked until every appointment today has been checked
                  out and every partial payment today has been settled -- the
                  warning lists exactly which ones, each a shortcut straight
                  to resolving it, instead of just a count to go hunt down */}
              {!closing ? (
                openAppts.length > 0 || balanceDuePayments.length > 0 ? (
                  <div className="rounded-xl border border-amberw/40 bg-amberw-tint/50 p-3.5">
                    <div className="flex items-start gap-2 text-[12px] text-ink">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amberw" />
                      <span>
                        {openAppts.length > 0 && (
                          <>{openAppts.length} appointment{openAppts.length === 1 ? '' : 's'} {closingDayLabel} still {openAppts.length === 1 ? 'needs' : 'need'} to be checked out</>
                        )}
                        {openAppts.length > 0 && balanceDuePayments.length > 0 && <> and </>}
                        {balanceDuePayments.length > 0 && (
                          <>{balanceDuePayments.length} ticket{balanceDuePayments.length === 1 ? '' : 's'} {closingDayLabel} still {balanceDuePayments.length === 1 ? 'has' : 'have'} a balance due</>
                        )}
                        {' '}before any register can close.
                      </span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {openAppts.map((a) => (
                        <button
                          key={`appt-${a.id}`}
                          type="button"
                          onClick={() => onResolveAppt(a.id, a.dateKey)}
                          title="Check out this appointment"
                          className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-clay hover:bg-clay-tint/30"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amberw-tint text-amberw">
                            <CreditCard className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-bold text-ink">{a.clientName}</span>
                            <span className="block truncate text-[11px] text-ink-faint">{a.serviceLabel} · {a.techName} · {a.timeLabel}</span>
                          </span>
                          <span className="shrink-0 text-[11px] font-bold text-clay">Check out</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                        </button>
                      ))}
                      {balanceDuePayments.map((p) => (
                        <button
                          key={`pay-${p.id}`}
                          type="button"
                          onClick={() => onResolvePayment(p.id)}
                          title="Collect the rest of what's owed on this ticket"
                          className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-clay hover:bg-clay-tint/30"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amberw-tint text-amberw">
                            <Scale className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-bold text-ink">{p.clientName}</span>
                            <span className="block truncate text-[11px] text-ink-faint">{money(p.amount)} owed of {money(p.total)}</span>
                          </span>
                          <span className="shrink-0 text-[11px] font-bold text-clay">Collect</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClosing(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep"
                  >
                    <Lock className="h-4 w-4" /> Close register
                  </button>
                )
              ) : (
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <h2 className="text-[15px] font-bold text-ink">Close the register</h2>
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">
                    Count what's actually in the drawer. Anything over or short is recorded against this shift.
                  </p>
                  <div className="mt-3.5">
                    <CashCounter
                      label="Counted in drawer"
                      counts={closeCounts}
                      onCounts={setCloseCounts}
                      manual={closeManual}
                      onManual={setCloseManual}
                      byDenom={closeByDenom}
                      onMode={setCloseByDenom}
                    />
                  </div>

                  <div className="mt-3.5 space-y-1.5 rounded-xl border border-line bg-cream/50 p-3.5">
                    <Row label="Expected in drawer" sub={`float ${money(active.openingFloat)} + cash ${money(cashIn)}`} value={money(expected)} />
                    <Row label="Counted" value={money(counted)} />
                    <Row label={varianceLabel} value={variance > 0 ? `+ ${money(variance)}` : money(variance)} strong tone={varianceTone} />
                  </div>

                  {variance !== 0 && (
                    <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amberw/40 bg-amberw-tint/40 px-3.5 py-2.5 text-[11.5px] text-ink">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amberw" />
                      <span>The drawer doesn't balance. Recount, or leave a note explaining the difference before closing.</span>
                    </div>
                  )}

                  <input
                    value={closeNote}
                    onChange={(e) => setCloseNote(e.target.value)}
                    placeholder={variance === 0 ? 'Closing note (optional)' : 'Explain the difference (recommended)'}
                    className="mt-3 w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-clay"
                  />

                  <button
                    type="button"
                    onClick={() => setReportPreview(true)}
                    className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-[13px] font-bold text-ink-soft transition-colors hover:bg-cream"
                  >
                    <Printer className="h-4 w-4" /> Print closing report
                  </button>

                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setClosing(false)}
                      className="flex-1 rounded-xl border border-line py-2.5 text-[13px] font-bold text-ink-soft transition-colors hover:bg-cream"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={doClose}
                      className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep"
                    >
                      <Check className="h-4 w-4" /> Close register · {varianceLabel.toLowerCase()}
                    </button>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-ink-faint">
                    Closing as <b className="text-ink-soft">{userName}</b>
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── past shifts ── */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left"
            >
              <span className="flex-1 text-[13px] font-bold text-ink">
                Closed shifts <span className="ml-1 font-normal text-ink-faint">({history.length})</span>
              </span>
              <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
            </button>
            {historyOpen && (
              history.length === 0 ? (
                <p className="border-t border-line px-4 py-5 text-center text-[12.5px] text-ink-faint">
                  No closed shifts yet.
                </p>
              ) : (
                <div className="divide-y divide-line/60 border-t border-line">
                  {historyByMonth.map((group) => {
                    const monthOpen = expandedMonths.has(group.key)
                    const flagged = group.shifts.filter((s) => Math.abs(s.variance ?? 0) > 0.004).length
                    return (
                      <div key={group.key}>
                        <button
                          type="button"
                          onClick={() => toggleMonth(group.key)}
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-cream/60"
                        >
                          <span className="flex-1 text-[12.5px] font-bold text-ink">
                            {group.label}
                            <span className="ml-1.5 font-normal text-ink-faint">
                              ({group.shifts.length} shift{group.shifts.length === 1 ? '' : 's'})
                            </span>
                          </span>
                          {flagged > 0 && (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-rust-tint px-2 py-0.5 text-[10.5px] font-bold text-rust">
                              <AlertTriangle className="h-3 w-3" /> {flagged} off
                            </span>
                          )}
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${monthOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {monthOpen && (
                          <table className="w-full border-t border-line/60 text-[12.5px]">
                            <thead>
                              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                                <th className="px-4 py-2 font-bold">Day</th>
                                <th className="px-4 py-2 font-bold">Opened</th>
                                <th className="px-4 py-2 font-bold">Closed</th>
                                <th className="px-4 py-2 text-right font-bold">Float</th>
                                <th className="px-4 py-2 text-right font-bold">Expected</th>
                                <th className="px-4 py-2 text-right font-bold">Counted</th>
                                <th className="px-4 py-2 text-right font-bold">Over / short</th>
                                <th className="px-4 py-2 text-right font-bold"><span className="sr-only">Print</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.shifts.map((s) => {
                                const v = s.variance ?? 0
                                return (
                                  <tr key={s.id} className="border-b border-line/60 last:border-0 align-top">
                                    <td className="px-4 py-2.5 font-semibold text-ink">
                                      {dayLabelOf(s.dateKey)}
                                      {s.closingNote && <span className="mt-0.5 block text-[11px] font-normal italic text-ink-faint">{s.closingNote}</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-ink-soft">{stamp(s.openedAt)}<span className="block text-[11px] text-ink-faint">{s.openedBy}</span></td>
                                    <td className="px-4 py-2.5 text-ink-soft">{s.closedAt ? stamp(s.closedAt) : '—'}<span className="block text-[11px] text-ink-faint">{s.closedBy}</span></td>
                                    <td className="tnum px-4 py-2.5 text-right">{money(s.openingFloat)}</td>
                                    <td className="tnum px-4 py-2.5 text-right">{money(s.expectedCash ?? 0)}</td>
                                    <td className="tnum px-4 py-2.5 text-right">{money(s.countedCash ?? 0)}</td>
                                    <td className={`tnum px-4 py-2.5 text-right font-bold ${v === 0 ? 'text-olive' : v > 0 ? 'text-amberw' : 'text-rust'}`}>
                                      {v === 0 ? 'Balanced' : v > 0 ? `+ ${money(v)}` : money(v)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                      <button
                                        type="button"
                                        title="Print this shift's closure report"
                                        onClick={() => setReportSession(s)}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-faint transition-colors hover:bg-cream hover:text-ink"
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>

    {/* closure report -- a live preview of the shift about to close, built
        from the current close-form numbers above */}
    {reportPreview && active && selected && (
      <RegisterClosureReportDialog
        data={{
          registerName: selected.name,
          dateKey: active.dateKey,
          openedAt: active.openedAt,
          openedBy: active.openedBy,
          openingFloat: active.openingFloat,
          tenders,
          expectedCash: expected,
          countedCash: counted,
          variance,
          closingCounts: closeByDenom ? closeCounts : undefined,
          closingNote: closeNote.trim() || undefined,
        }}
        onClose={() => setReportPreview(false)}
      />
    )}

    {/* closure report -- a reprint of a past shift, straight from its own
        stored record in history */}
    {reportSession && (
      <RegisterClosureReportDialog
        data={closureReportFromSession(reportSession)}
        onClose={() => setReportSession(null)}
      />
    )}
    </>
  )
}

/* ── find a transaction, any day, any register -- a lightweight standalone
   modal, reachable straight from the nav rail's Search shortcut without
   detouring through the full Manage Register page. Not scoped to the
   current shift or even a particular register, so a ticket from two weeks
   ago is just as reachable as today's. Matches client name, any guest
   riding on the ticket, or the printed invoice number. ── */
export function FindTransactionModal({ open, payments, onResolvePayment, onClose }: {
  open: boolean
  payments: RegisterPayment[]
  /** open this ticket, e.g. to issue a refund -- also closes the modal */
  onResolvePayment: (id: string) => void
  onClose: () => void
}) {
  const [txQuery, setTxQuery] = useState('')
  const txInputRef = useRef<HTMLInputElement>(null)
  // jump straight into the box on open, and clear the search once it closes
  // so it doesn't carry over stale results into the next time it's opened
  useEffect(() => {
    if (open) requestAnimationFrame(() => txInputRef.current?.focus())
    else setTxQuery('')
  }, [open])
  const txAllMatches = useMemo(() => {
    const q = txQuery.trim().toLowerCase()
    if (!q) return []
    return payments
      .filter((p) => {
        const names = [p.clientName, ...(p.clientNames ?? [])]
        return names.some((n) => n.toLowerCase().includes(q)) || invoiceNoOf(p).toLowerCase().includes(q)
      })
      .sort((a, b) => paymentAt(b) - paymentAt(a))
  }, [payments, txQuery])
  const txMatches = txAllMatches.slice(0, TX_RESULTS_CAP)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/55 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-popover p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
            <Search className="h-4 w-4 text-clay" /> Find a transaction
          </h2>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-faint transition-colors hover:bg-cream"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          ref={txInputRef}
          value={txQuery}
          onChange={(e) => setTxQuery(e.target.value)}
          placeholder="Client, guest, or invoice number, any date"
          className="w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-clay"
        />
        {txQuery.trim() && (
          txMatches.length === 0 ? (
            <p className="mt-3 text-center text-[12px] text-ink-faint">No transactions match &quot;{txQuery.trim()}&quot;</p>
          ) : (
            <>
              <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
                {txMatches.map((p) => {
                  const names = [p.clientName, ...(p.clientNames ?? []).filter((n) => n !== p.clientName)]
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onResolvePayment(p.id)}
                      title="Open this ticket, e.g. to issue a refund"
                      className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-clay hover:bg-clay-tint/30"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-tint text-clay">
                        <Receipt className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-bold text-ink">{names.join(', ')}</span>
                        <span className="block truncate text-[11px] text-ink-faint">{dayLabelOf(p.dateKey)} · {invoiceNoOf(p)} · {p.method}</span>
                      </span>
                      <span className="tnum shrink-0 text-[12.5px] font-bold text-ink">{money(p.total)}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    </button>
                  )
                })}
              </div>
              {txAllMatches.length > TX_RESULTS_CAP && (
                <p className="mt-2 text-center text-[11px] text-ink-faint">
                  Showing the {TX_RESULTS_CAP} most recent of {txAllMatches.length} matches, narrow the search to see others
                </p>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}

/** everything the printable closure report needs -- built live from the
 *  in-progress close form (a preview, before Close register is even
 *  clicked) or from a stored RegisterSession (a reprint of a past shift);
 *  see closureReportFromSession below for the latter */
export interface ClosureReportData {
  registerName: string
  dateKey: string
  openedAt: number
  openedBy: string
  /** unset for a live preview -- the shift hasn't actually closed yet */
  closedAt?: number
  closedBy?: string
  openingFloat: number
  /** sales by tender for this shift -- cash, credit card, and whatever
   *  other payment sources were taken */
  tenders: { method: string; amount: number; count: number }[]
  expectedCash: number
  countedCash: number
  variance: number
  /** denomination → quantity, when the drawer was counted that way rather
   *  than typed as a single total */
  closingCounts?: Record<string, number>
  closingNote?: string
}

/** a stored session already carries everything a reprint needs, frozen at
 *  close time -- this just reshapes it into the report's own type */
export function closureReportFromSession(s: RegisterSession): ClosureReportData {
  return {
    registerName: s.registerName,
    dateKey: s.dateKey,
    openedAt: s.openedAt,
    openedBy: s.openedBy,
    closedAt: s.closedAt,
    closedBy: s.closedBy,
    openingFloat: s.openingFloat,
    tenders: s.tenders ?? [],
    expectedCash: s.expectedCash ?? 0,
    countedCash: s.countedCash ?? 0,
    variance: s.variance ?? 0,
    closingCounts: s.closingCounts,
    closingNote: s.closingNote,
  }
}

/* ── printable register closure report -- sales by tender, the cash math
   (float + cash taken vs. what was actually counted), and the denomination
   breakdown behind that count, so a manager can see exactly how the
   counted total was reached. Reachable from the close form itself (a
   preview of the shift about to close) or from a past shift in history
   (a reprint) -- same dialog either way, see ClosureReportData above. ── */
export function RegisterClosureReportDialog({ data, onClose }: {
  data: ClosureReportData
  onClose: () => void
}) {
  const settings = useSettingsStore()
  const salon = settings.general
  const dayLabel = dayLabelOf(data.dateKey)
  const collected = Math.round(data.tenders.reduce((t, x) => t + x.amount, 0) * 100) / 100
  const varianceTone = data.variance === 0 ? 'text-olive' : data.variance > 0 ? 'text-amberw' : 'text-rust'
  const varianceLabel = data.variance === 0
    ? 'Balanced'
    : data.variance > 0 ? `Over by ${money(data.variance)}` : `Short by ${money(Math.abs(data.variance))}`
  const denomLines = data.closingCounts
    ? DENOMS.map((d) => ({ ...d, qty: data.closingCounts![d.id] ?? 0 })).filter((d) => d.qty > 0)
    : []

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/45 p-4">
      {/* only this block prints, same pattern as InvoiceDialog */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
      <div className="print-area relative max-h-[90vh] w-[420px] max-w-[95vw] overflow-y-auto rounded-2xl border border-line bg-popover shadow-2xl">
        {/* salon header */}
        <div className="border-b border-dashed border-line px-6 pb-3 pt-5 text-center">
          <h2 className="font-display text-[19px] font-bold tracking-wide">{salon.name}</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">{salon.address}</p>
          <p className="text-[11px] text-ink-faint">{salon.phone}{salon.website ? ` · ${salon.website}` : ''}</p>
          <p className="mt-2 text-[13px] font-bold text-ink">Register closure report</p>
        </div>

        {/* shift meta */}
        <div className="space-y-1 border-b border-dashed border-line px-6 py-3 text-[12px]">
          <div className="flex justify-between"><span className="text-ink-faint">Register</span><span className="font-semibold">{data.registerName}</span></div>
          <div className="flex justify-between"><span className="text-ink-faint">Day</span><span className="font-semibold">{dayLabel}</span></div>
          <div className="flex justify-between"><span className="text-ink-faint">Opened</span><span className="font-semibold">{stamp(data.openedAt)} · {data.openedBy}</span></div>
          <div className="flex justify-between">
            <span className="text-ink-faint">Closed</span>
            <span className="font-semibold">{data.closedAt ? `${stamp(data.closedAt)} · ${data.closedBy}` : 'Not yet closed (preview)'}</span>
          </div>
        </div>

        {/* sales by tender */}
        <div className="space-y-1 border-b border-dashed border-line px-6 py-3 text-[13px]">
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Sales by payment method</p>
          {data.tenders.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No payments taken this shift.</p>
          ) : (
            data.tenders.map((t) => (
              <div key={t.method} className="flex justify-between">
                <span className="text-ink-soft">{t.method} <span className="text-[11px] text-ink-faint">({t.count} sale{t.count === 1 ? '' : 's'})</span></span>
                <span className="tnum font-semibold">{money(t.amount)}</span>
              </div>
            ))
          )}
          <div className="flex justify-between border-t border-line pt-1.5 text-[14px] font-bold">
            <span>Total collected</span><span className="tnum">{money(collected)}</span>
          </div>
        </div>

        {/* cash math */}
        <div className="space-y-1 border-b border-dashed border-line px-6 py-3 text-[13px]">
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Cash drawer</p>
          <div className="flex justify-between"><span className="text-ink-faint">Opening float</span><span className="tnum">{money(data.openingFloat)}</span></div>
          <div className="flex justify-between"><span className="text-ink-faint">Cash taken</span><span className="tnum">+ {money(data.tenders.find((t) => t.method === 'Cash')?.amount ?? 0)}</span></div>
          <div className="flex justify-between border-t border-line pt-1.5 font-bold"><span>Cash that should be in the drawer</span><span className="tnum">{money(data.expectedCash)}</span></div>
          <div className="flex justify-between"><span className="text-ink-faint">Cash counted</span><span className="tnum">{money(data.countedCash)}</span></div>
          <div className={`flex justify-between border-t border-line pt-1.5 text-[14px] font-bold ${varianceTone}`}>
            <span>{varianceLabel}</span>
            <span className="tnum">{data.variance > 0 ? `+ ${money(data.variance)}` : money(data.variance)}</span>
          </div>
        </div>

        {/* denomination breakdown behind the counted total, if it was counted that way */}
        {denomLines.length > 0 && (
          <div className="space-y-1 border-b border-dashed border-line px-6 py-3 text-[12.5px]">
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Counted by denomination</p>
            {denomLines.map((d) => (
              <div key={d.id} className="flex justify-between">
                <span className="text-ink-soft">{d.label} <span className="text-[11px] text-ink-faint">× {d.qty}</span></span>
                <span className="tnum font-semibold">{money(d.value * d.qty)}</span>
              </div>
            ))}
          </div>
        )}

        {data.closingNote && (
          <p className="border-b border-dashed border-line px-6 py-3 text-[11.5px] italic text-ink-faint">{data.closingNote}</p>
        )}

        {/* actions (hidden in print via visibility of parent) */}
        <div className="flex gap-2 px-6 py-3.5">
          <button
            onClick={() => window.print()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-clay-deep"
          >
            <Printer className="h-4 w-4" /> Print report
          </button>
          <button
            onClick={onClose}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-line text-ink-soft transition-colors hover:bg-cream"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── which register today, asked once a day whenever more than one is active.
   Not dismissable without picking — every sale from here on counts against
   whichever register is chosen, so this can't be skipped or clicked past. ── */
export function RegisterDayPrompt({ registers, userName, onPick }: {
  registers: RegisterConfig[]
  userName: string
  onPick: (registerId: string) => void
}) {
  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/55 p-4">
      <div className="w-[380px] rounded-2xl border border-line bg-popover p-5 shadow-2xl">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-clay-tint text-clay">
          <Banknote className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-[16px] font-bold text-ink">Which register today?</h2>
        <p className="mt-1 text-[12.5px] text-ink-soft">
          Hi {userName.split(' ')[0]}, pick the drawer you're working from today. Sales ring in against it until
          you switch registers in Manage Register or a new day starts.
        </p>
        <div className="mt-3.5 space-y-1.5">
          {registers.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-clay hover:bg-clay-tint/40"
            >
              <Banknote className="h-4 w-4 shrink-0 text-clay" />
              <span className="text-[13px] font-bold text-ink">{r.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
