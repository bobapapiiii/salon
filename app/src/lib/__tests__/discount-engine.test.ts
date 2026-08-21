// ─── Discount engine tests ────────────────────────────────────────────────
// Pure unit tests against discount-engine.ts only -- no store, no React, no
// DOM. Every case here was independently verified against the same
// assertions before this file existed (see the session's final report);
// this file is what `npm test` runs going forward.
import { describe, it, expect } from 'vitest'
import {
  toCents, fromCents, computeDiscountAmount, evaluateEligibility, isCandidate,
  resolveCombination, allocateProportionally, combinedPerLine,
  type EngineLine, type EngineContext,
} from '../discount-engine'
import type { Discount, AdvancedRules } from '../discounts-store'

const baseAdvanced: AdvancedRules = { priority: 100, combinable: false }

function mkLine(over: Partial<EngineLine> = {}): EngineLine {
  return { id: 'l1', serviceId: 's1', techId: 't1', unitPriceCents: 5000, ...over }
}
function mkCtx(lines: EngineLine[], over: Partial<EngineContext> = {}): EngineContext {
  return { lines, dateKey: '2026-08-21', minutesOfDay: 600, dayOfWeek: 5, locationId: 'gloss-nail-bar', channel: 'front_desk', ...over }
}
function mkDiscount(over: Partial<Discount> = {}): Discount {
  return {
    id: 'd1', name: 'Test', status: 'active', offerType: 'percent', value: 10,
    appliesTo: { kind: 'entire_sale' }, howReceived: 'automatic',
    availability: { startNow: true }, advanced: { ...baseAdvanced },
    createdAt: 0, updatedAt: 0, createdBy: 'u1', ...over,
  }
}

describe('money helpers', () => {
  it('round-trips dollars through integer cents without float drift', () => {
    expect(toCents(12.34)).toBe(1234)
    expect(fromCents(1234)).toBe(12.34)
    expect(toCents(0.1) + toCents(0.2)).toBe(30)
  })
})

describe('percent discounts', () => {
  it('cuts each targeted line by the percentage, capped at the line price', () => {
    const lines = [mkLine({ id: 'a', unitPriceCents: 10000 }), mkLine({ id: 'b', unitPriceCents: 3000 })]
    const d = mkDiscount({ offerType: 'percent', value: 20 })
    const { totalCents, perLine } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(2600)
    expect(perLine.get('a')).toBe(2000)
    expect(perLine.get('b')).toBe(600)
  })

  it('targeted to a specific service only touches that line', () => {
    const lines = [mkLine({ id: 'a', serviceId: 'mani', unitPriceCents: 5000 }), mkLine({ id: 'b', serviceId: 'pedi', unitPriceCents: 6000 })]
    const d = mkDiscount({ offerType: 'percent', value: 50, appliesTo: { kind: 'services', serviceIds: ['mani'] } })
    const { totalCents, perLine } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(2500)
    expect(perLine.has('b')).toBe(false)
  })
})

describe('fixed $ discounts', () => {
  it('spreads proportionally across targeted lines, never past a line price', () => {
    const lines = [mkLine({ id: 'a', unitPriceCents: 8000 }), mkLine({ id: 'b', unitPriceCents: 2000 })]
    const d = mkDiscount({ offerType: 'fixed', value: 15 })
    const { totalCents, perLine } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(1500)
    expect(perLine.get('a')).toBe(1200)
    expect(perLine.get('b')).toBe(300)
  })

  it('caps at the targeted subtotal, never goes negative', () => {
    const lines = [mkLine({ id: 'a', unitPriceCents: 1000 })]
    const d = mkDiscount({ offerType: 'fixed', value: 50 })
    const { totalCents, perLine } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(1000)
    expect(perLine.get('a')).toBe(1000)
  })
})

describe('set-price discounts', () => {
  it('reduces each targeted line down to the set price', () => {
    const lines = [mkLine({ id: 'a', unitPriceCents: 6000 }), mkLine({ id: 'b', unitPriceCents: 4000 })]
    const d = mkDiscount({ offerType: 'set_price', value: 35, appliesTo: { kind: 'all_services' } })
    const { perLine } = computeDiscountAmount(d, mkCtx(lines))
    expect(perLine.get('a')).toBe(2500)
    expect(perLine.get('b')).toBe(500)
  })
})

describe('BOGO', () => {
  it('buy-1-get-1-free comps the cheapest of two by default selection', () => {
    const lines = [mkLine({ id: 'a', unitPriceCents: 6000 }), mkLine({ id: 'b', unitPriceCents: 4000 })]
    const d = mkDiscount({
      offerType: 'bogo', appliesTo: { kind: 'all_services' },
      bogo: { buyQty: 1, rewardQty: 1, rewardType: 'free', rewardSelection: 'cheapest', repeat: false },
    })
    const { totalCents, perLine } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(4000)
    expect(perLine.get('b')).toBe(4000)
    expect(perLine.has('a')).toBe(false)
  })

  it('repeat:true fires multiple times when enough items qualify, from a shared buy/reward pool', () => {
    const lines = ['a', 'b', 'c', 'd'].map((id) => mkLine({ id, unitPriceCents: 5000 }))
    const d = mkDiscount({
      offerType: 'bogo', appliesTo: { kind: 'all_services' },
      bogo: { buyQty: 1, rewardQty: 1, rewardType: 'free', rewardSelection: 'cheapest', repeat: true },
    })
    const { totalCents } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(10000) // 2 of the 4 equal-priced items go free
  })

  it('repeat:false fires only once even with enough items for more', () => {
    const lines = ['a', 'b', 'c', 'd'].map((id) => mkLine({ id, unitPriceCents: 5000 }))
    const d = mkDiscount({
      offerType: 'bogo', appliesTo: { kind: 'all_services' },
      bogo: { buyQty: 1, rewardQty: 1, rewardType: 'free', rewardSelection: 'cheapest', repeat: false },
    })
    const { totalCents } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(5000)
  })

  it('maxRewardsPerSale caps how many reward units apply', () => {
    const lines = Array.from({ length: 8 }, (_, i) => mkLine({ id: `l${i}`, unitPriceCents: 5000 }))
    const d = mkDiscount({
      offerType: 'bogo', appliesTo: { kind: 'all_services' },
      bogo: { buyQty: 1, rewardQty: 1, rewardType: 'free', rewardSelection: 'cheapest', repeat: true, maxRewardsPerSale: 2 },
    })
    const { totalCents } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(10000)
  })

  it('not enough qualifying items yields zero discount and fails eligibility', () => {
    const lines = [mkLine({ id: 'a', unitPriceCents: 5000 })]
    const d = mkDiscount({
      offerType: 'bogo', appliesTo: { kind: 'all_services' },
      bogo: { buyQty: 2, rewardQty: 1, rewardType: 'free', rewardSelection: 'cheapest', repeat: false },
    })
    const { totalCents } = computeDiscountAmount(d, mkCtx(lines))
    expect(totalCents).toBe(0)
    expect(evaluateEligibility(d, mkCtx(lines), { overall: 0, byThisCustomer: 0 }).eligible).toBe(false)
  })
})

describe('eligibility', () => {
  it('blocks a ticket below the minimum subtotal', () => {
    const lines = [mkLine({ unitPriceCents: 2000 })]
    const d = mkDiscount({ advanced: { ...baseAdvanced, minSubtotal: 50 } })
    expect(evaluateEligibility(d, mkCtx(lines), { overall: 0, byThisCustomer: 0 }).eligible).toBe(false)
  })

  it('only admits tickets inside the configured day/time window', () => {
    const lines = [mkLine()]
    const d = mkDiscount({ advanced: { ...baseAdvanced, dayTimeWindows: [{ day: 5, startMin: 0, endMin: 300 }] } })
    expect(evaluateEligibility(d, mkCtx(lines, { dayOfWeek: 5, minutesOfDay: 100 }), { overall: 0, byThisCustomer: 0 }).eligible).toBe(true)
    expect(evaluateEligibility(d, mkCtx(lines, { dayOfWeek: 5, minutesOfDay: 400 }), { overall: 0, byThisCustomer: 0 }).eligible).toBe(false)
  })

  it('blocks once redemption limits are reached, overall and per customer', () => {
    const lines = [mkLine()]
    const d = mkDiscount({ advanced: { ...baseAdvanced, redemptionLimit: { overall: 5, perCustomer: 1 } } })
    expect(evaluateEligibility(d, mkCtx(lines), { overall: 5, byThisCustomer: 0 }).eligible).toBe(false)
    expect(evaluateEligibility(d, mkCtx(lines, { clientId: 'c1' }), { overall: 0, byThisCustomer: 1 }).eligible).toBe(false)
    expect(evaluateEligibility(d, mkCtx(lines, { clientId: 'c1' }), { overall: 0, byThisCustomer: 0 }).eligible).toBe(true)
  })

  it('admits tagged clients and blocks others when eligibility is tag-restricted', () => {
    const lines = [mkLine()]
    const d = mkDiscount({ advanced: { ...baseAdvanced, customerEligibility: { allClients: false, tags: ['vip'] } } })
    expect(evaluateEligibility(d, mkCtx(lines, { clientTags: ['vip'] }), { overall: 0, byThisCustomer: 0 }).eligible).toBe(true)
    expect(evaluateEligibility(d, mkCtx(lines, { clientTags: ['regular'] }), { overall: 0, byThisCustomer: 0 }).eligible).toBe(false)
  })
})

describe('candidacy', () => {
  it('rejects a promo-code discount without the matching code, case-insensitively otherwise', () => {
    const d = mkDiscount({ howReceived: 'promo_code', promoCode: 'SAVE10' })
    expect(isCandidate(d, mkCtx([mkLine()], { promoCode: 'WRONG' }))).toBe(false)
    expect(isCandidate(d, mkCtx([mkLine()], { promoCode: 'save10' }))).toBe(true)
  })

  it('respects status, date range, and channel', () => {
    expect(isCandidate(mkDiscount({ status: 'draft' }), mkCtx([mkLine()]))).toBe(false)
    expect(isCandidate(mkDiscount({ availability: { startNow: true, endDate: '2020-01-01' } }), mkCtx([mkLine()]))).toBe(false)
    const onlineOnly = mkDiscount({ advanced: { ...baseAdvanced, channels: ['online'] } })
    expect(isCandidate(onlineOnly, mkCtx([mkLine()], { channel: 'front_desk' }))).toBe(false)
    expect(isCandidate(onlineOnly, mkCtx([mkLine()], { channel: 'online' }))).toBe(true)
  })
})

describe('combination resolution', () => {
  it('a non-combinable higher-priority discount suppresses a lower-priority one', () => {
    const lines = [mkLine({ unitPriceCents: 10000 })]
    const big = mkDiscount({ id: 'big', offerType: 'percent', value: 30, advanced: { priority: 1, combinable: false } })
    const small = mkDiscount({ id: 'small', offerType: 'percent', value: 10, advanced: { priority: 2, combinable: false } })
    const result = resolveCombination([big, small], mkCtx(lines))
    expect(result.applied.map((a) => a.discountId)).toEqual(['big'])
    expect(result.suppressed.map((s) => s.discountId)).toEqual(['small'])
  })

  it('combinable discounts stack, each computed against the already-discounted price', () => {
    const lines = [mkLine({ unitPriceCents: 10000 })]
    const first = mkDiscount({ id: 'first', offerType: 'percent', value: 10, advanced: { priority: 1, combinable: true } })
    const second = mkDiscount({ id: 'second', offerType: 'percent', value: 10, advanced: { priority: 2, combinable: true } })
    const result = resolveCombination([first, second], mkCtx(lines))
    expect(result.applied[0].amountCents).toBe(1000)
    expect(result.applied[1].amountCents).toBe(900)
    expect(result.totalDiscountCents).toBe(1900)
  })

  it('breaks equal-priority ties on greatest savings, never insertion order', () => {
    const lines = [mkLine({ unitPriceCents: 10000 })]
    const small = mkDiscount({ id: 'small', offerType: 'fixed', value: 5, advanced: { priority: 1, combinable: false } })
    const big = mkDiscount({ id: 'big', offerType: 'fixed', value: 20, advanced: { priority: 1, combinable: false } })
    const result = resolveCombination([small, big], mkCtx(lines)) // small passed first on purpose
    expect(result.applied[0].discountId).toBe('big')
  })

  it('never pushes a line below zero even when several discounts target it', () => {
    const lines = [mkLine({ unitPriceCents: 1000 })]
    const a = mkDiscount({ id: 'a', offerType: 'fixed', value: 8, advanced: { priority: 1, combinable: true } })
    const b = mkDiscount({ id: 'b', offerType: 'fixed', value: 8, advanced: { priority: 2, combinable: true } })
    const result = resolveCombination([a, b], mkCtx(lines))
    const combined = combinedPerLine(result.applied)
    expect(combined.get('l1')!).toBeLessThanOrEqual(1000)
  })
})

describe('allocateProportionally', () => {
  it('distributes the remainder deterministically and sums exactly', () => {
    const items = [{ id: 'a', capCents: 100 }, { id: 'b', capCents: 100 }, { id: 'c', capCents: 100 }]
    const alloc = allocateProportionally(10, items)
    expect([...alloc.values()].reduce((s, v) => s + v, 0)).toBe(10)
    const alloc2 = allocateProportionally(10, items)
    expect([...alloc.entries()]).toEqual([...alloc2.entries()])
  })
})
