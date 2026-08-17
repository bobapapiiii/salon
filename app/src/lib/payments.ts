// ─── Shared payment-ledger types and math ────────────────────────────────────
// Checkout, reopen/refund, the register, and receipts all need the same
// notion of "what's on this ticket, what's been collected, what's been given
// back" -- kept here so those modules read from one place instead of
// importing pieces from each other.

/** one tender against a ticket -- cash, or a card with its last 4 digits, for
 *  a specific amount. A ticket can be split across several of these, and each
 *  one can later be refunded (in full or in part) on its own */
export interface PaymentSource {
  id: string
  method: string
  /** card only */
  last4?: string
  amount: number
}

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

/** the slice of a payment record paymentSources() needs */
export interface PaymentWithSources {
  total: number
  sources?: PaymentSource[]
  method: string
}

/** every payment has at least one source going forward; older records saved
 *  before split tender existed only have a single `method`/`total`, so they
 *  fall back to reading as one source covering the whole ticket */
export function paymentSources(p: PaymentWithSources): PaymentSource[] {
  return p.sources && p.sources.length > 0 ? p.sources : [{ id: `${p.method}-legacy`, method: p.method, amount: p.total }]
}

export function refundedBySource(refunds: RefundRecord[] | undefined, sourceId: string): number {
  return (refunds ?? []).filter((r) => r.sourceId === sourceId).reduce((s, r) => s + r.amount, 0)
}

export function totalRefunded(refunds: RefundRecord[] | undefined): number {
  return (refunds ?? []).reduce((s, r) => s + r.amount, 0)
}

export const round2 = (v: number) => Math.round(v * 100) / 100

/** what's actually left in the client's hands after refunds */
export function netCollected(sources: PaymentSource[], refunds: RefundRecord[] | undefined): number {
  return round2(sources.reduce((s, x) => s + x.amount, 0) - totalRefunded(refunds))
}

/** what's still owed on top of what's been collected -- 0 once paid in full */
export function balanceDue(total: number, sources: PaymentSource[], refunds: RefundRecord[] | undefined): number {
  return Math.max(0, round2(total - netCollected(sources, refunds)))
}
