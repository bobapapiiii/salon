// ─── Reopen a paid ticket ─────────────────────────────────────────────────
// Reached from the edit panel's Reopen Ticket button. The payment stays on
// the books the moment this opens -- nothing changes until a refund is
// actually submitted from here. It shows the services that were sold, and
// two editable fields (services total, tip) that default to what's still
// on the ticket; pulling either one down produces a refund for the
// difference, sourced from that bucket. That covers a full refund (drag
// both to $0), a partial one (an overcharged service, a mistyped tip), or
// just looking the ticket over without changing anything.
import { useState } from 'react'
import { Undo2, X } from 'lucide-react'
import type { Appointment } from '@/lib/booking-types'
import { fmtTime } from '@/lib/booking-types'
import { useStaffStore } from '@/lib/staff-store'
import { svcById } from '@/lib/services-store'

/** one refund against a payment -- a full refund is just every dollar still
 *  available split across service/tip in separate records, so the history
 *  always reads the same way whether it happened in one step or several */
export interface RefundRecord {
  id: string
  at: number
  amount: number
  /** where the money is coming back from -- the service charge or the tip,
   *  so an overcharge and an accidental big tip are tracked separately */
  type: 'service' | 'tip'
  reason?: string
  by: string
}

export function refundedByType(refunds: RefundRecord[] | undefined, type: 'service' | 'tip'): number {
  return (refunds ?? []).filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0)
}

export function totalRefunded(refunds: RefundRecord[] | undefined): number {
  return (refunds ?? []).reduce((s, r) => s + r.amount, 0)
}

const money = (v: number) => `$${v.toFixed(2)}`
const round2 = (v: number) => Math.round(v * 100) / 100

/** the slice of a payment record this dialog needs */
export interface RefundablePayment {
  id: string
  clientName: string
  subtotal: number
  tip: number
  total: number
  method: string
  refunds?: RefundRecord[]
}

export function ReopenTicketDialog({ payment, items, onRefund, onClose }: {
  payment: RefundablePayment
  items: Appointment[]
  onRefund: (lines: { amount: number; type: 'service' | 'tip'; reason?: string }[]) => void
  onClose: () => void
}) {
  const { techs } = useStaffStore()
  const refundedService = refundedByType(payment.refunds, 'service')
  const refundedTip = refundedByType(payment.refunds, 'tip')
  const availableService = Math.max(0, round2(payment.subtotal - refundedService))
  const availableTip = Math.max(0, round2(payment.tip - refundedTip))
  const alreadyRefunded = totalRefunded(payment.refunds)

  const [serviceText, setServiceText] = useState(String(availableService))
  const [tipText, setTipText] = useState(String(availableTip))
  const [reason, setReason] = useState('')

  const clamp = (text: string, max: number) => Math.min(max, Math.max(0, Number(text) || 0))
  const correctedService = clamp(serviceText, availableService)
  const correctedTip = clamp(tipText, availableTip)
  const serviceRefund = round2(availableService - correctedService)
  const tipRefund = round2(availableTip - correctedTip)
  const totalRefund = round2(serviceRefund + tipRefund)
  const nothingLeft = availableService <= 0 && availableTip <= 0

  const refundEverything = () => {
    setServiceText('0')
    setTipText('0')
  }

  const submit = () => {
    const lines: { amount: number; type: 'service' | 'tip'; reason?: string }[] = []
    if (serviceRefund > 0.004) lines.push({ amount: serviceRefund, type: 'service', reason: reason.trim() || undefined })
    if (tipRefund > 0.004) lines.push({ amount: tipRefund, type: 'tip', reason: reason.trim() || undefined })
    if (lines.length > 0) onRefund(lines)
  }

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div className="relative max-h-[85vh] w-[440px] overflow-y-auto rounded-2xl border border-line bg-popover p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clay-tint text-clay">
            <Undo2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold leading-5 text-ink">Reopen ticket, {payment.clientName}</h3>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-soft">
              Paid {money(payment.total)} by {payment.method}
              {alreadyRefunded > 0 && ` · ${money(alreadyRefunded)} already refunded`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-cream hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {items.length > 0 && (
          <div className="mt-4 space-y-1 rounded-xl border border-line bg-cream/50 p-3 text-[12px]">
            {items.map((a) => {
              const svc = svcById[a.serviceId]
              const price = (a.priceOverride ?? svc?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0)
              return (
                <div key={a.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-ink-soft">
                    {svc?.name ?? a.serviceId}
                    <span className="text-ink-faint"> · {fmtTime(a.startMin)} · {techs.find((t) => t.id === a.techId)?.name ?? 'Any'}</span>
                  </span>
                  <span className="tnum shrink-0 font-semibold text-ink">{money(price)}</span>
                </div>
              )
            })}
          </div>
        )}

        {nothingLeft ? (
          <p className="mt-4 rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-[12.5px] text-ink-soft">
            Nothing left to refund, this ticket has already been refunded in full.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Services total</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold text-ink-faint">$</span>
                  <input
                    type="number"
                    min={0}
                    max={availableService}
                    step="0.01"
                    value={serviceText}
                    disabled={availableService <= 0}
                    onChange={(e) => setServiceText(e.target.value.replace(/[^\d.]/g, ''))}
                    className="tnum h-10 w-full rounded-[8px] border border-input bg-background px-2.5 text-[15px] font-bold outline-none focus:border-clay disabled:opacity-40"
                  />
                </div>
                <p className="mt-1 text-[10.5px] text-ink-faint">of {money(availableService)}</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tip</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold text-ink-faint">$</span>
                  <input
                    type="number"
                    min={0}
                    max={availableTip}
                    step="0.01"
                    value={tipText}
                    disabled={availableTip <= 0}
                    onChange={(e) => setTipText(e.target.value.replace(/[^\d.]/g, ''))}
                    className="tnum h-10 w-full rounded-[8px] border border-input bg-background px-2.5 text-[15px] font-bold outline-none focus:border-clay disabled:opacity-40"
                  />
                </div>
                <p className="mt-1 text-[10.5px] text-ink-faint">of {money(availableTip)}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={refundEverything}
              className="mt-2 text-[11.5px] font-semibold text-clay hover:underline"
            >
              Refund everything
            </button>

            <div className="mt-3.5">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional), e.g. overcharged for the gel add-on"
                className="w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-clay"
              />
            </div>

            <div className="mt-3.5 flex justify-between rounded-xl border border-line bg-cream/50 px-3.5 py-2.5 text-[13px]">
              <span className="font-semibold text-ink-soft">Refund</span>
              <span className={`tnum font-bold ${totalRefund > 0 ? 'text-rust' : 'text-ink-faint'}`}>{money(totalRefund)}</span>
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            {totalRefund > 0 ? 'Cancel' : 'Close'}
          </button>
          {totalRefund > 0 && (
            <button
              type="button"
              onClick={submit}
              className="rounded-[10px] bg-rust px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Refund {money(totalRefund)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
