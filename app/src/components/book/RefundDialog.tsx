// ─── Reopen a paid ticket ─────────────────────────────────────────────────
// Reached from the edit panel's Reopen Ticket button. Styled like the
// checkout screen since it's doing the same job in reverse: the service
// prices and tip are editable here too, and any difference from what's
// already on the books gets settled right in this panel, either by charging
// the remainder (a new payment source) or refunding it (from an existing
// one, in full or in part). The payment stays on the books the moment this
// opens -- nothing changes until one of the actions below is submitted.
import { useState } from 'react'
import { Undo2, X } from 'lucide-react'
import type { Appointment } from '@/lib/booking-types'
import { fmtTime } from '@/lib/booking-types'
import { useSettingsStore } from '@/lib/settings-store'
import { useStaffStore } from '@/lib/staff-store'
import { svcById } from '@/lib/services-store'
import { METHOD_ICONS, paymentSources, type PaymentSource } from './CheckoutDialog'

/** one refund against a payment -- always drawn from a specific source (the
 *  card or cash it was originally taken on), in full or in part */
export interface RefundRecord {
  id: string
  at: number
  amount: number
  /** which PaymentSource this money is coming back from */
  sourceId: string
  reason?: string
  by: string
}

export function refundedBySource(refunds: RefundRecord[] | undefined, sourceId: string): number {
  return (refunds ?? []).filter((r) => r.sourceId === sourceId).reduce((s, r) => s + r.amount, 0)
}

export function totalRefunded(refunds: RefundRecord[] | undefined): number {
  return (refunds ?? []).reduce((s, r) => s + r.amount, 0)
}

const round2 = (v: number) => Math.round(v * 100) / 100
const money = (v: number) => `$${v.toFixed(2)}`

/** what's actually left in the client's hands after refunds */
export function netCollected(sources: PaymentSource[], refunds: RefundRecord[] | undefined): number {
  return round2(sources.reduce((s, x) => s + x.amount, 0) - totalRefunded(refunds))
}

/** what's still owed on top of what's been collected -- 0 once paid in full */
export function balanceDue(total: number, sources: PaymentSource[], refunds: RefundRecord[] | undefined): number {
  return Math.max(0, round2(total - netCollected(sources, refunds)))
}

/** the slice of a payment record this dialog needs */
export interface RefundablePayment {
  id: string
  clientName: string
  subtotal: number
  tip: number
  total: number
  discount?: number
  method: string
  sources?: PaymentSource[]
  refunds?: RefundRecord[]
}

/** what a save/charge/refund action from this panel produces -- always
 *  carries the current price/tip correction, plus at most one settlement */
export type ReopenCommit = {
  items: { id: string; price: number }[]
  subtotal: number
  tip: number
  total: number
} & (
  | { kind: 'save' }
  | { kind: 'charge'; source: { method: string; last4?: string; amount: number } }
  | { kind: 'refund'; sourceId: string; amount: number; reason?: string }
)

export function ReopenTicketDialog({ payment, items, onCommit, onClose }: {
  payment: RefundablePayment
  items: Appointment[]
  onCommit: (c: ReopenCommit) => void
  onClose: () => void
}) {
  const settings = useSettingsStore()
  const { techs } = useStaffStore()
  const methods = settings.payments.methods.filter((m) => m in METHOD_ICONS)
  const sources = paymentSources(payment)

  const priceOf = (a: Appointment) => (a.priceOverride ?? svcById[a.serviceId]?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0)
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((a) => [a.id, String(priceOf(a))])),
  )
  const [tipText, setTipText] = useState(String(payment.tip))
  const [reason, setReason] = useState('')
  const [refundOpenId, setRefundOpenId] = useState<string | null>(null)
  const [refundAmountText, setRefundAmountText] = useState('')
  const [chargeMethod, setChargeMethod] = useState(methods[0] ?? 'Cash')
  const [chargeLast4, setChargeLast4] = useState('')
  const [chargeAmountText, setChargeAmountText] = useState('')

  const draftSubtotal = round2(items.reduce((s, a) => s + (Number(priceDraft[a.id]) || 0), 0))
  const draftTip = round2(Number(tipText) || 0)
  const draftTotal = Math.max(0, round2(draftSubtotal + draftTip - (payment.discount ?? 0)))
  const netPaid = netCollected(sources, payment.refunds)
  const due = Math.max(0, round2(draftTotal - netPaid))
  const overpaid = Math.max(0, round2(netPaid - draftTotal))
  const isDirty = draftSubtotal !== round2(payment.subtotal) || draftTip !== round2(payment.tip)
  const chargeAmount = Math.round((Number(chargeAmountText || due) || 0) * 100) / 100

  const commitBase = () => ({
    items: items.map((a) => ({ id: a.id, price: Math.max(0, Math.round((Number(priceDraft[a.id]) || 0) * 100) / 100) })),
    subtotal: draftSubtotal,
    tip: draftTip,
    total: draftTotal,
  })

  const submitSave = () => {
    onCommit({ ...commitBase(), kind: 'save' })
    onClose()
  }
  const submitCharge = () => {
    if (!(chargeAmount > 0 && chargeAmount <= due + 0.005)) return
    onCommit({
      ...commitBase(),
      kind: 'charge',
      source: { method: chargeMethod, last4: chargeMethod === 'Card' && chargeLast4.trim() ? chargeLast4.trim() : undefined, amount: chargeAmount },
    })
    onClose()
  }
  const submitRefund = (sourceId: string, available: number) => {
    const amount = Math.round((Number(refundAmountText) || 0) * 100) / 100
    if (!(amount > 0 && amount <= available + 0.005)) return
    onCommit({ ...commitBase(), kind: 'refund', sourceId, amount, reason: reason.trim() || undefined })
    onClose()
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[94] flex w-[634px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clay-tint text-clay">
            <Undo2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[16px] font-bold text-ink">Reopen ticket, {payment.clientName}</h2>
            <p className="text-[11.5px] text-ink-faint">Adjust the price or tip, charge a remainder, or refund a payment source</p>
          </div>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-cream hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* line items, price editable */}
        <div className="overflow-hidden rounded-xl border border-line">
          {items.map((a) => {
            const svc = svcById[a.serviceId]
            return (
              <div key={a.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#5B54D6' }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{svc?.name ?? a.serviceId}</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">
                    {fmtTime(a.startMin)} · {techs.find((t) => t.id === a.techId)?.name ?? 'Any'}
                  </p>
                </div>
                <span className="flex h-[30px] shrink-0 items-center text-[13px] font-semibold">
                  $<input
                    type="number"
                    min={0}
                    step={1}
                    value={priceDraft[a.id]}
                    onChange={(e) => setPriceDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                    className="tnum h-[30px] w-16 rounded-[8px] border border-input bg-background px-1.5 text-right text-[12px] font-semibold outline-none focus:border-clay"
                  />
                </span>
              </div>
            )
          })}
          <div className="flex items-center justify-between bg-cream/60 px-3.5 py-2.5">
            <span className="text-[12px] font-semibold text-ink-soft">Subtotal</span>
            <span className="tnum text-[13px] font-bold">{money(draftSubtotal)}</span>
          </div>
        </div>

        {/* tip */}
        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tip</p>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold text-ink-faint">$</span>
          <input
            value={tipText}
            onChange={(e) => setTipText(e.target.value.replace(/[^\d.]/g, ''))}
            className="tnum h-9 w-28 rounded-[8px] border border-input bg-background px-2.5 text-[14px] font-bold outline-none focus:border-clay"
          />
        </div>

        {/* new total vs what was originally charged */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-cream/50 px-3.5 py-2.5 text-[13px]">
          <span className="font-semibold text-ink-soft">{isDirty ? 'Corrected total' : 'Total'}</span>
          <span className="tnum text-[15px] font-bold text-ink">
            {money(draftTotal)}
            {isDirty && <span className="ml-1.5 text-[11px] font-normal text-ink-faint">was {money(payment.total)}</span>}
          </span>
        </div>

        {/* payment sources, each refundable on its own */}
        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Payment sources</p>
        <div className="space-y-1.5">
          {sources.map((s) => {
            const refunded = refundedBySource(payment.refunds, s.id)
            const available = Math.max(0, round2(s.amount - refunded))
            const Icon = METHOD_ICONS[s.method as keyof typeof METHOD_ICONS]
            const open = refundOpenId === s.id
            return (
              <div key={s.id} className="rounded-[10px] border border-line bg-surface p-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-tint text-clay">
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">
                    {s.method}{s.last4 ? ` ····${s.last4}` : ''}
                    {refunded > 0 && <span className="ml-1.5 font-normal text-ink-faint">· {money(refunded)} refunded</span>}
                  </span>
                  <span className="tnum shrink-0 text-[12.5px] font-bold">{money(s.amount)}</span>
                  {available > 0.004 && (
                    <button
                      onClick={() => { setRefundOpenId(open ? null : s.id); setRefundAmountText(available.toFixed(2)) }}
                      className="shrink-0 text-[11px] font-semibold text-rust hover:underline"
                    >
                      {open ? 'Cancel' : 'Refund'}
                    </button>
                  )}
                </div>
                {open && (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2">
                    <span className="text-[11px] font-bold text-ink-faint">$</span>
                    <input
                      value={refundAmountText}
                      onChange={(e) => setRefundAmountText(e.target.value.replace(/[^\d.]/g, ''))}
                      className="tnum h-7 w-20 shrink-0 rounded-[7px] border border-input bg-background px-1.5 text-[12px] font-bold outline-none focus:border-clay"
                    />
                    <button onClick={() => setRefundAmountText(available.toFixed(2))} className="shrink-0 text-[10.5px] font-semibold text-clay hover:underline">
                      Full {money(available)}
                    </button>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="h-7 min-w-0 flex-1 rounded-[7px] border border-input bg-background px-2 text-[11px] outline-none focus:border-clay"
                    />
                    <button
                      onClick={() => submitRefund(s.id, available)}
                      disabled={!(Number(refundAmountText) > 0 && Number(refundAmountText) <= available + 0.005)}
                      className="shrink-0 rounded-[7px] bg-rust px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Refund
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* charge the remainder, whether it's from an original partial
            payment or from raising the price above what's already collected */}
        {due > 0.004 && (
          <div className="mt-3 rounded-[10px] border border-amberw/40 bg-amberw-tint/40 p-2.5">
            <p className="text-[11.5px] font-semibold text-ink">Amount due: {money(due)}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <select
                value={chargeMethod}
                onChange={(e) => setChargeMethod(e.target.value)}
                className="h-8 w-[92px] shrink-0 rounded-[7px] border border-input bg-background px-1.5 text-[11.5px] font-semibold outline-none focus:border-clay"
              >
                {methods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {chargeMethod === 'Card' && (
                <input
                  value={chargeLast4}
                  onChange={(e) => setChargeLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Last 4"
                  maxLength={4}
                  className="tnum h-8 w-16 shrink-0 rounded-[7px] border border-input bg-background px-1.5 text-center text-[11.5px] outline-none focus:border-clay"
                />
              )}
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-ink-faint">$</span>
                <input
                  value={chargeAmountText}
                  onChange={(e) => setChargeAmountText(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={due.toFixed(2)}
                  className="tnum h-8 w-full rounded-[7px] border border-input bg-background py-1 pl-5 pr-1.5 text-[12.5px] font-bold outline-none focus:border-clay"
                />
              </div>
              <button
                onClick={submitCharge}
                disabled={!(chargeAmount > 0 && chargeAmount <= due + 0.005)}
                className="shrink-0 rounded-[7px] bg-clay px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Charge {money(chargeAmount)}
              </button>
            </div>
          </div>
        )}

        {overpaid > 0.004 && (
          <p className="mt-3 text-[11.5px] font-semibold text-rust">
            {money(overpaid)} more has been collected than the corrected total, refund it from a source above
          </p>
        )}
      </div>

      {/* footer -- a plain correction with nothing owed or overpaid saves
          directly; charging or refunding (above) already saves the
          correction as part of that action */}
      <div className="border-t border-line px-5 py-3.5">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            Close
          </button>
          {isDirty && due <= 0.004 && overpaid <= 0.004 && (
            <button
              type="button"
              onClick={submitSave}
              className="rounded-[10px] bg-clay px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Save changes
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
