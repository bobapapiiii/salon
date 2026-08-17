// ─── Refund a paid ticket, in full or partial ────────────────────────────────
// Reached from the edit panel's Refund button next to View / print receipt
// and Reopen Ticket. Unlike Reopen Ticket (which voids the payment and drops
// back into checkout to fix a mistake before it happened), a refund keeps the
// original sale on the books and records money going back, either because
// the salon overcharged on a service or a client's tip was entered wrong.
import { useState } from 'react'
import { Banknote, DollarSign, Undo2, X } from 'lucide-react'

/** one refund against a payment — a full refund is just every dollar still
 *  available split across service/tip in separate records, so the history
 *  always reads the same way whether it happened in one step or several */
export interface RefundRecord {
  id: string
  at: number
  amount: number
  /** where the money is coming back from — the service charge or the tip,
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

export function RefundDialog({ payment, onRefund, onClose }: {
  payment: RefundablePayment
  onRefund: (lines: { amount: number; type: 'service' | 'tip'; reason?: string }[]) => void
  onClose: () => void
}) {
  const refundedService = refundedByType(payment.refunds, 'service')
  const refundedTip = refundedByType(payment.refunds, 'tip')
  const availableService = Math.max(0, Math.round((payment.subtotal - refundedService) * 100) / 100)
  const availableTip = Math.max(0, Math.round((payment.tip - refundedTip) * 100) / 100)
  const availableTotal = Math.round((availableService + availableTip) * 100) / 100
  const alreadyRefunded = totalRefunded(payment.refunds)

  const [mode, setMode] = useState<'full' | 'partial'>('full')
  const [source, setSource] = useState<'service' | 'tip'>(availableService > 0 ? 'service' : 'tip')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')

  const sourceAvailable = source === 'service' ? availableService : availableTip
  const partialAmount = Number(amountText) || 0
  const partialValid = partialAmount > 0 && partialAmount <= sourceAvailable + 0.005

  const submit = () => {
    if (availableTotal <= 0) return
    if (mode === 'full') {
      const lines: { amount: number; type: 'service' | 'tip'; reason?: string }[] = []
      if (availableService > 0) lines.push({ amount: availableService, type: 'service', reason: reason.trim() || undefined })
      if (availableTip > 0) lines.push({ amount: availableTip, type: 'tip', reason: reason.trim() || undefined })
      if (lines.length > 0) onRefund(lines)
    } else if (partialValid) {
      onRefund([{ amount: Math.round(partialAmount * 100) / 100, type: source, reason: reason.trim() || undefined }])
    }
  }

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div className="relative w-[420px] rounded-2xl border border-line bg-popover p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rust-tint text-rust">
            <Undo2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold leading-5 text-ink">Refund {payment.clientName}</h3>
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

        {availableTotal <= 0 ? (
          <p className="mt-4 rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-[12.5px] text-ink-soft">
            Nothing left to refund, this ticket has already been fully refunded.
          </p>
        ) : (
          <>
            <div className="mt-4 flex rounded-[10px] border border-line p-0.5">
              {(['full', 'partial'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-[8px] py-1.5 text-[12.5px] font-bold transition-colors ${
                    mode === m ? 'bg-clay-tint text-clay' : 'text-ink-faint hover:text-ink'
                  }`}
                >
                  {m === 'full' ? 'Full refund' : 'Partial refund'}
                </button>
              ))}
            </div>

            {mode === 'full' ? (
              <div className="mt-3.5 space-y-1.5 rounded-xl border border-line bg-cream/50 p-3.5 text-[12.5px]">
                {availableService > 0 && (
                  <div className="flex justify-between"><span className="text-ink-soft">From services</span><span className="tnum font-semibold text-ink">{money(availableService)}</span></div>
                )}
                {availableTip > 0 && (
                  <div className="flex justify-between"><span className="text-ink-soft">From tip</span><span className="tnum font-semibold text-ink">{money(availableTip)}</span></div>
                )}
                <div className="flex justify-between border-t border-line pt-1.5 text-[14px] font-bold text-ink">
                  <span>Total refund</span><span className="tnum">{money(availableTotal)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-3.5 space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Refund from</label>
                  <div className="flex gap-1.5">
                    {(['service', 'tip'] as const).map((t) => {
                      const avail = t === 'service' ? availableService : availableTip
                      return (
                        <button
                          key={t}
                          type="button"
                          disabled={avail <= 0}
                          onClick={() => setSource(t)}
                          title={avail <= 0 ? `No ${t === 'service' ? 'service charge' : 'tip'} left to refund` : undefined}
                          className={`flex flex-1 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            source === t ? 'border-clay bg-clay-tint' : 'border-line hover:bg-cream'
                          }`}
                        >
                          <span className={`flex items-center gap-1.5 text-[12.5px] font-bold ${source === t ? 'text-clay' : 'text-ink'}`}>
                            {t === 'service' ? <Banknote className="h-3.5 w-3.5" /> : <DollarSign className="h-3.5 w-3.5" />}
                            {t === 'service' ? 'Services' : 'Tip'}
                          </span>
                          <span className="text-[11px] text-ink-faint">{money(avail)} available</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Amount to refund</label>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-ink-faint">$</span>
                    <input
                      type="number"
                      min={0}
                      max={sourceAvailable}
                      step="0.01"
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="0.00"
                      className="tnum h-10 w-32 rounded-[8px] border border-input bg-background px-2.5 text-[15px] font-bold outline-none focus:border-clay"
                    />
                    <button
                      type="button"
                      onClick={() => setAmountText(String(sourceAvailable))}
                      className="text-[11.5px] font-semibold text-clay hover:underline"
                    >
                      Refund all {money(sourceAvailable)}
                    </button>
                  </div>
                  {amountText.trim() !== '' && !partialValid && (
                    <p className="mt-1 text-[11px] text-rust">
                      {partialAmount <= 0 ? 'Enter an amount greater than $0' : `Only ${money(sourceAvailable)} is available from ${source === 'service' ? 'services' : 'the tip'}`}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="mt-3.5">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional), e.g. overcharged for the gel add-on"
                className="w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-clay"
              />
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            {availableTotal <= 0 ? 'Close' : 'Cancel'}
          </button>
          {availableTotal > 0 && (
            <button
              type="button"
              onClick={submit}
              disabled={mode === 'partial' && !partialValid}
              className="rounded-[10px] bg-rust px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refund {mode === 'full' ? money(availableTotal) : (partialValid ? money(partialAmount) : '')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
