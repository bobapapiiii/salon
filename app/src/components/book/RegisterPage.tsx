// ─── Manage register, the cash drawer's open/close ──────────────────────────
// Full-screen section. The salon opens the register at the start of the day
// with a starting float, takes payments all day, then closes it by counting
// the drawer: the register works out what SHOULD be in there (float + the cash
// it took) and compares that to what was actually counted, so any over/short
// is caught the same day instead of going unnoticed.
//
// Deliberately not here: mid-day counts and tips payout — cash leaves the
// drawer only through the close count in this build.
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Banknote, Check, ChevronDown, Lock, LockOpen, Scale, X,
} from 'lucide-react'
import type { RegisterConfig } from '@/lib/settings-store'
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
}

/** every payment carries a time, one way or another — new records stamp `at`,
 *  older ones still have the `pay${Date.now()}` id they were created with */
export const paymentAt = (p: RegisterPayment): number => p.at ?? (Number(p.id.replace(/\D/g, '')) || 0)

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
  /** today's appointments still needing checkout — closing is blocked while this is above 0 */
  openTicketsToday: number
  /** today's tickets left with a balance due after a partial payment — closing is blocked while this is above 0 too */
  balanceDueToday: number
  onOpenRegister: (s: RegisterSession) => void
  onCloseRegister: (id: string, patch: Partial<RegisterSession>) => void
  onClose: () => void
}

export function RegisterPage({
  open, registers, defaultRegisterId, sessions, payments, userName, todayKey, openTicketsToday, balanceDueToday,
  onOpenRegister, onCloseRegister, onClose,
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
  const history = useMemo(
    () => (selected
      ? sessions.filter((s) => s.registerId === selected.id && s.closedAt != null).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      : []),
    [sessions, selected],
  )

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
                  out and every partial payment today has been settled */}
              {!closing ? (
                openTicketsToday > 0 || balanceDueToday > 0 ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amberw/40 bg-amberw-tint/50 px-3.5 py-2.5 text-[12px] text-ink">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amberw" />
                    <span>
                      {openTicketsToday > 0 && (
                        <>{openTicketsToday} appointment{openTicketsToday === 1 ? '' : 's'} today still {openTicketsToday === 1 ? 'needs' : 'need'} to be checked out</>
                      )}
                      {openTicketsToday > 0 && balanceDueToday > 0 && <> and </>}
                      {balanceDueToday > 0 && (
                        <>{balanceDueToday} ticket{balanceDueToday === 1 ? '' : 's'} today still {balanceDueToday === 1 ? 'has' : 'have'} a balance due</>
                      )}
                      {' '}before any register can close.
                    </span>
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

                  <div className="mt-3.5 flex gap-2">
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
                <table className="w-full border-t border-line text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2 font-bold">Day</th>
                      <th className="px-4 py-2 font-bold">Opened</th>
                      <th className="px-4 py-2 font-bold">Closed</th>
                      <th className="px-4 py-2 text-right font-bold">Float</th>
                      <th className="px-4 py-2 text-right font-bold">Expected</th>
                      <th className="px-4 py-2 text-right font-bold">Counted</th>
                      <th className="px-4 py-2 text-right font-bold">Over / short</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => {
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
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            )}
          </div>
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
