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
 *  card or cash it was originally taken on), in full or in part. Also always
 *  charged against either the service value or the tip of one technician, so
 *  payroll (commission off sales, or the tip payout) reflects the giveback */
export interface RefundRecord {
  id: string
  at: number
  amount: number
  /** which PaymentSource this money is coming back from */
  sourceId: string
  reason?: string
  by: string
  /** 'service' reduces that tech's commission-earning sales; 'tip' reduces
   *  their tip payout. Omitted only for legacy refunds recorded before this
   *  existed, or a ticket with no tech/tip to charge it against */
  from?: 'service' | 'tip'
  /** the technician this refund's service or tip reduction applies to */
  techId?: string
}

/** the slice of a payment record paymentSources() needs -- also carries the
 *  per-tech breakdown so a refund can be charged against the right person's
 *  commission or tip */
export interface PaymentWithSources {
  total: number
  sources?: PaymentSource[]
  method: string
  /** service value per line item, source of each tech's commission basis */
  lines?: { techId: string; price: number }[]
  /** tip payout per tech */
  tipByTech?: { techId: string; amount: number }[]
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

/** a service refund reduces that tech's commission-earning sales -- eats
 *  into their line items (in order) until the refunded amount is used up,
 *  never past zero, even if the refund is larger than what's left on the lines */
export function reduceTechLines(
  lines: { techId: string; price: number }[] | undefined,
  techId: string,
  amount: number,
): { techId: string; price: number }[] | undefined {
  if (!lines) return lines
  let remaining = amount
  return lines.map((l) => {
    if (l.techId !== techId || remaining <= 0.004) return l
    const cut = Math.min(l.price, remaining)
    remaining = round2(remaining - cut)
    return { ...l, price: round2(l.price - cut) }
  })
}

/** a tip refund reduces that tech's tip payout, never past zero */
export function reduceTechTip(
  tipByTech: { techId: string; amount: number }[] | undefined,
  techId: string,
  amount: number,
): { techId: string; amount: number }[] | undefined {
  if (!tipByTech) return tipByTech
  return tipByTech.map((t) => (t.techId === techId ? { ...t, amount: Math.max(0, round2(t.amount - amount)) } : t))
}

/** each tech's current service value on this ticket -- what a "from
 *  services" refund reduces, i.e. their commission basis */
export function techServiceTotals(lines: { techId: string; price: number }[] | undefined): { techId: string; value: number }[] {
  const m = new Map<string, number>()
  for (const l of lines ?? []) m.set(l.techId, round2((m.get(l.techId) ?? 0) + l.price))
  return [...m.entries()].filter(([, v]) => v > 0.004).map(([techId, value]) => ({ techId, value }))
}

/** each tech's current tip payout on this ticket -- what a "from tip"
 *  refund reduces */
export function techTipTotals(tipByTech: { techId: string; amount: number }[] | undefined): { techId: string; value: number }[] {
  return (tipByTech ?? []).filter((t) => t.amount > 0.004).map((t) => ({ techId: t.techId, value: t.amount }))
}
