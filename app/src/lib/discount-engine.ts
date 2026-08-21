// ─── Discount engine, pure pricing math ──────────────────────────────────────
// Deliberately has zero React/DOM/localStorage dependencies -- only plain
// functions over plain data -- so this file can move server-side largely
// unchanged once the real backend lands (see HANDOFF.md, section 9). All
// money math inside this file happens in integer minor currency units
// (cents) to avoid float drift; callers on dollar-based screens convert at
// the boundary with `toCents`/`fromCents`.
//
// This is the ONLY place discount math happens. POS and checkout call into
// it and do not re-derive pricing themselves, so there is exactly one
// definition of "how much did this discount save."

import type { Discount, BogoConfig, AppliesTo, DiscountChannel } from './discounts-store'

// ── money helpers ────────────────────────────────────────────────────────────

export const toCents = (dollars: number): number => Math.round(dollars * 100)
export const fromCents = (cents: number): number => Math.round(cents) / 100

// ── engine inputs ────────────────────────────────────────────────────────────

/** one priceable line on the ticket being evaluated */
export interface EngineLine {
  /** unique within this ticket, e.g. the SaleRow/appointment id */
  id: string
  serviceId: string
  categoryId?: string
  /** top-level parent category, if the service's category is a subcategory */
  parentCategoryId?: string
  serviceTags?: string[]
  techId: string
  techRoleId?: string
  techTags?: string[]
  /** who this line is for, for group/party allocation and per-guest display */
  person?: string
  unitPriceCents: number
}

export interface EngineContext {
  lines: EngineLine[]
  /** ISO date (YYYY-MM-DD) the sale is happening on */
  dateKey: string
  /** minutes from midnight, local salon time */
  minutesOfDay: number
  /** 0=Sun..6=Sat, local salon time */
  dayOfWeek: number
  locationId: string
  channel: DiscountChannel
  clientId?: string
  clientTags?: string[]
  isNewClient?: boolean
  /** promo code as typed, engine normalizes (trim + uppercase) before compare */
  promoCode?: string
  /** discount ids the staff explicitly picked from the "staff select" list */
  staffSelectedIds?: string[]
}

export interface RedemptionCounts {
  /** total times this discount has ever been redeemed, salon-wide */
  overall: number
  /** times this discount has been redeemed by ctx.clientId (0 if no client, or unknown) */
  byThisCustomer: number
}

export const subtotalCents = (lines: EngineLine[]): number => lines.reduce((s, l) => s + l.unitPriceCents, 0)

// ── candidacy: is this discount even in play for this ticket? ───────────────
// Cheap, non-eligibility filters -- status/date/channel/location/redemption
// method -- run first so the more expensive per-line eligibility pass below
// only touches discounts that could plausibly apply.

export function isCandidate(d: Discount, ctx: EngineContext): boolean {
  if (d.status !== 'active') return false
  const av = d.availability
  if (!av.startNow && av.startDate && av.startDate > ctx.dateKey) return false
  if (av.endDate && av.endDate < ctx.dateKey) return false
  if (av.locationIds && av.locationIds.length > 0 && !av.locationIds.includes(ctx.locationId)) return false
  if (d.advanced.channels && d.advanced.channels.length > 0 && !d.advanced.channels.includes(ctx.channel)) return false
  if (d.howReceived === 'promo_code') {
    const code = (ctx.promoCode ?? '').trim().toUpperCase()
    if (!code || code !== (d.promoCode ?? '').trim().toUpperCase()) return false
  }
  if (d.howReceived === 'staff_select') {
    if (!ctx.staffSelectedIds?.includes(d.id)) return false
  }
  // 'automatic' discounts need no extra signal -- they're always a candidate
  // once status/date/location/channel pass.
  return true
}

// ── eligibility: does this ticket actually qualify? ──────────────────────────

export interface EligibilityResult {
  eligible: boolean
  /** human-readable reasons it's NOT eligible, empty when eligible */
  reasons: string[]
}

function inDayTimeWindow(d: Discount, ctx: EngineContext): boolean {
  const windows = d.advanced.dayTimeWindows
  if (!windows || windows.length === 0) return true
  return windows.some((w) => w.day === ctx.dayOfWeek && ctx.minutesOfDay >= w.startMin && ctx.minutesOfDay < w.endMin)
}

/** lines this discount's `appliesTo` targets, before any BOGO/qty narrowing */
export function targetedLines(appliesTo: AppliesTo, lines: EngineLine[]): EngineLine[] {
  switch (appliesTo.kind) {
    case 'entire_sale':
    case 'all_services':
      return lines
    case 'categories': {
      const ids = new Set(appliesTo.categoryIds ?? [])
      return lines.filter((l) => (l.categoryId && ids.has(l.categoryId)) || (l.parentCategoryId && ids.has(l.parentCategoryId)))
    }
    case 'services': {
      const ids = new Set(appliesTo.serviceIds ?? [])
      return lines.filter((l) => ids.has(l.serviceId))
    }
    case 'service_tags': {
      const tags = new Set(appliesTo.tags ?? [])
      return lines.filter((l) => l.serviceTags?.some((t) => tags.has(t)))
    }
    // products/packages/memberships: no such records exist in this build yet
    // (see HANDOFF.md, section 9) -- always zero candidate lines, never a crash.
    case 'products':
    case 'packages':
    case 'memberships':
      return []
    default:
      return []
  }
}

function matchesTechTargeting(d: Discount, lines: EngineLine[]): EngineLine[] {
  const t = d.advanced.targeting
  if (!t || (!t.roleIds?.length && !t.techIds?.length && !t.techTags?.length)) return lines
  return lines.filter((l) => {
    if (t.techIds?.length && t.techIds.includes(l.techId)) return true
    if (t.roleIds?.length && l.techRoleId && t.roleIds.includes(l.techRoleId)) return true
    if (t.techTags?.length && l.techTags?.some((tag) => t.techTags!.includes(tag))) return true
    return false
  })
}

export function evaluateEligibility(d: Discount, ctx: EngineContext, redemptions: RedemptionCounts): EligibilityResult {
  const reasons: string[] = []
  const subCents = subtotalCents(ctx.lines)

  if (!inDayTimeWindow(d, ctx)) reasons.push('Outside this discount\'s day/time window')

  const elig = d.advanced.customerEligibility
  if (elig && !elig.allClients) {
    const clientOk =
      (elig.clientIds?.includes(ctx.clientId ?? '') ?? false) ||
      (elig.tags?.some((t) => ctx.clientTags?.includes(t)) ?? false) ||
      (elig.newClientsOnly === true && ctx.isNewClient === true)
    if (!clientOk) reasons.push('Client is not in the eligible group for this discount')
  }

  const limit = d.advanced.redemptionLimit
  if (limit?.overall != null && redemptions.overall >= limit.overall) reasons.push('Overall redemption limit reached')
  if (limit?.perCustomer != null && redemptions.byThisCustomer >= limit.perCustomer) reasons.push('This client has already used this discount the maximum number of times')

  if (d.advanced.minSubtotal != null && subCents < toCents(d.advanced.minSubtotal)) reasons.push(`Ticket subtotal is below the ${money(d.advanced.minSubtotal)} minimum`)
  if (d.advanced.maxSubtotal != null && subCents > toCents(d.advanced.maxSubtotal)) reasons.push(`Ticket subtotal is above the ${money(d.advanced.maxSubtotal)} maximum`)

  let targeted = targetedLines(d.appliesTo, ctx.lines)
  targeted = matchesTechTargeting(d, targeted)
  if (d.offerType === 'bogo') {
    const buyPool = bogoBuyPool(d.bogo!, targeted)
    if (buyPool.length < d.bogo!.buyQty) reasons.push(`Needs at least ${d.bogo!.buyQty} qualifying item${d.bogo!.buyQty === 1 ? '' : 's'} to trigger`)
  } else {
    const minQty = d.advanced.minQty ?? 1
    if (targeted.length < minQty) reasons.push(`Needs at least ${minQty} qualifying item${minQty === 1 ? '' : 's'} on the ticket`)
  }

  return { eligible: reasons.length === 0, reasons }
}

function money(v: number): string {
  return `$${v.toFixed(2)}`
}

// ── BOGO ──────────────────────────────────────────────────────────────────

function bogoBuyPool(bogo: BogoConfig, targeted: EngineLine[]): EngineLine[] {
  if (!bogo.buyServiceIds || bogo.buyServiceIds.length === 0) return targeted
  const ids = new Set(bogo.buyServiceIds)
  return targeted.filter((l) => ids.has(l.serviceId))
}

/** Which items in `pool` are eligible to be the reward, given the config's
 *  optional reward-service restriction (unset/empty = anything targeted). */
function rewardEligible(bogo: BogoConfig, pool: EngineLine[]): EngineLine[] {
  if (!bogo.rewardServiceIds || bogo.rewardServiceIds.length === 0) return pool
  const ids = new Set(bogo.rewardServiceIds)
  return pool.filter((l) => ids.has(l.serviceId))
}

/** BOGO priced per reward line, one "set" (buyQty bought + rewardQty
 *  rewarded) at a time, so allocation can attribute savings to the exact
 *  line(s) that were comped/reduced -- never a single lump sum, and no
 *  single line is ever double-counted as both a paid and a rewarded item.
 *  Buy and reward candidates are drawn from the SAME remaining pool each
 *  round, which is what makes overlapping buy/reward targeting (the common
 *  "buy any service, get any service" case) consume correctly instead of
 *  exhausting every eligible item on "buy" before any is left to reward. */
function computeBogoAmount(d: Discount, targeted: EngineLine[]): { totalCents: number; perLine: Map<string, number> } {
  const bogo = d.bogo!
  const perLine = new Map<string, number>()
  let remaining = targeted
  let total = 0
  let sets = 0
  const maxSets = bogo.repeat ? Infinity : 1
  const maxSetsFromCap = bogo.maxRewardsPerSale != null ? Math.floor(bogo.maxRewardsPerSale / bogo.rewardQty) : Infinity

  while (sets < maxSets && sets < maxSetsFromCap) {
    const buyCandidates = [...bogoBuyPool(bogo, remaining)].sort((a, b) => b.unitPriceCents - a.unitPriceCents)
    if (buyCandidates.length < bogo.buyQty) break
    const buyPicked = new Set(buyCandidates.slice(0, bogo.buyQty).map((l) => l.id))
    const afterBuy = remaining.filter((l) => !buyPicked.has(l.id))

    const rewardCandidates = [...rewardEligible(bogo, afterBuy)].sort((a, b) =>
      bogo.rewardSelection === 'most_expensive' ? b.unitPriceCents - a.unitPriceCents : a.unitPriceCents - b.unitPriceCents,
    )
    if (rewardCandidates.length < bogo.rewardQty) break
    const rewardPicked = rewardCandidates.slice(0, bogo.rewardQty)

    for (const l of rewardPicked) {
      const cut =
        bogo.rewardType === 'free' ? l.unitPriceCents
        : bogo.rewardType === 'percent' ? Math.round((l.unitPriceCents * (bogo.rewardValue ?? 0)) / 100)
        : Math.min(l.unitPriceCents, toCents(bogo.rewardValue ?? 0)) // fixed $ off, never past the line's own price
      const capped = Math.max(0, Math.min(cut, l.unitPriceCents))
      if (capped > 0) {
        perLine.set(l.id, (perLine.get(l.id) ?? 0) + capped)
        total += capped
      }
    }
    const rewardPickedIds = new Set(rewardPicked.map((l) => l.id))
    remaining = afterBuy.filter((l) => !rewardPickedIds.has(l.id))
    sets++
  }
  return { totalCents: total, perLine }
}

// ── percent / fixed / set-price ──────────────────────────────────────────────

function computeSimpleAmount(d: Discount, targeted: EngineLine[]): { totalCents: number; perLine: Map<string, number> } {
  const perLine = new Map<string, number>()
  if (targeted.length === 0) return { totalCents: 0, perLine }
  const targetSubtotal = subtotalCents(targeted)

  if (d.offerType === 'percent') {
    const pct = d.value ?? 0
    for (const l of targeted) {
      const cut = Math.min(l.unitPriceCents, Math.round((l.unitPriceCents * pct) / 100))
      if (cut > 0) perLine.set(l.id, cut)
    }
  } else if (d.offerType === 'fixed') {
    // a flat $ amount off the targeted subtotal as a whole, spread
    // proportionally across the targeted lines (never past any one line's price)
    const flatCents = Math.min(targetSubtotal, toCents(d.value ?? 0))
    const alloc = allocateProportionally(flatCents, targeted.map((l) => ({ id: l.id, capCents: l.unitPriceCents })))
    alloc.forEach((cents, id) => { if (cents > 0) perLine.set(id, cents) })
  } else if (d.offerType === 'set_price') {
    // set-price only makes sense per item (spec: "set-price only for
    // item-level targets") -- apply the set price to each targeted line
    const setCents = toCents(d.value ?? 0)
    for (const l of targeted) {
      const cut = Math.max(0, l.unitPriceCents - setCents)
      if (cut > 0) perLine.set(l.id, cut)
    }
  }
  const totalCents = [...perLine.values()].reduce((s, v) => s + v, 0)
  return { totalCents, perLine }
}

/** Proportional split of `amountCents` across items by `capCents` weight,
 *  each item's own price as its cap, remainder assigned by largest
 *  fractional remainder, ties broken by input order -- deterministic, no
 *  "most recently edited" or other unstable tiebreak anywhere in this file. */
export function allocateProportionally(amountCents: number, items: { id: string; capCents: number }[]): Map<string, number> {
  const result = new Map<string, number>()
  const totalWeight = items.reduce((s, i) => s + i.capCents, 0)
  if (amountCents <= 0 || totalWeight <= 0) {
    items.forEach((i) => result.set(i.id, 0))
    return result
  }
  const raw = items.map((i) => (i.capCents / totalWeight) * amountCents)
  const floors = raw.map((v) => Math.floor(v))
  let assigned = floors.reduce((s, v) => s + v, 0)
  let remainder = amountCents - assigned
  const order = items
    .map((_item, idx) => ({ idx, frac: raw[idx] - floors[idx] }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx)
  const cents = [...floors]
  for (let k = 0; k < order.length && remainder > 0; k++) {
    cents[order[k].idx] += 1
    remainder -= 1
  }
  items.forEach((item, idx) => result.set(item.id, Math.min(item.capCents, cents[idx])))
  return result
}

/** the one place per-discount math dispatches by offer type */
export function computeDiscountAmount(d: Discount, ctx: EngineContext): { totalCents: number; perLine: Map<string, number> } {
  let targeted = targetedLines(d.appliesTo, ctx.lines)
  targeted = matchesTechTargeting(d, targeted)
  if (targeted.length === 0) return { totalCents: 0, perLine: new Map() }
  return d.offerType === 'bogo' ? computeBogoAmount(d, targeted) : computeSimpleAmount(d, targeted)
}

// ── combination resolution ────────────────────────────────────────────────
// Deterministic, in this exact order: explicit priority first (lower number
// wins -- "priority 1" beats "priority 5"), then greatest valid savings as
// the tiebreak. NEVER "most recently edited" or insertion order.

export interface AppliedDiscount {
  discountId: string
  discountName: string
  offerType: Discount['offerType']
  amountCents: number
  perLineCents: Map<string, number>
  explanation: string
}

export interface CombinationResult {
  applied: AppliedDiscount[]
  totalDiscountCents: number
  /** discounts that were eligible but lost to a non-combinable winner */
  suppressed: { discountId: string; discountName: string; reason: string }[]
}

export function explain(d: Discount, amountCents: number, lineCount: number): string {
  const amt = money(fromCents(amountCents))
  if (d.offerType === 'percent') return `${d.value}% off ${lineCount} item${lineCount === 1 ? '' : 's'} = ${amt} off`
  if (d.offerType === 'fixed') return `${money(d.value ?? 0)} off, applied across ${lineCount} item${lineCount === 1 ? '' : 's'} = ${amt} off`
  if (d.offerType === 'set_price') return `Priced at ${money(d.value ?? 0)} per item = ${amt} off`
  return `Buy ${d.bogo?.buyQty ?? 1} get ${d.bogo?.rewardQty ?? 1} ${d.bogo?.rewardType === 'free' ? 'free' : `${d.bogo?.rewardType === 'percent' ? `${d.bogo?.rewardValue}% off` : `${money(d.bogo?.rewardValue ?? 0)} off`}`} = ${amt} off`
}

/** Resolve which of several eligible discounts actually apply to one ticket.
 *  `candidates` must already be filtered to eligible-only (see
 *  evaluateEligibility) and carry each discount's advanced.priority /
 *  advanced.combinable settings. */
export function resolveCombination(candidates: Discount[], ctx: EngineContext): CombinationResult {
  const suppressed: CombinationResult['suppressed'] = []
  if (candidates.length === 0) return { applied: [], totalDiscountCents: 0, suppressed }

  // rank: lower priority number first, then greater savings, stable by id
  // as the final, fully-deterministic tiebreak (never insertion/edit time)
  const scored = candidates.map((d) => ({ d, amount: computeDiscountAmount(d, ctx) }))
  scored.sort((a, b) => {
    const pa = a.d.advanced.priority ?? 100
    const pb = b.d.advanced.priority ?? 100
    if (pa !== pb) return pa - pb
    if (b.amount.totalCents !== a.amount.totalCents) return b.amount.totalCents - a.amount.totalCents
    return a.d.id.localeCompare(b.d.id)
  })

  const applied: AppliedDiscount[] = []
  let remainingLines = ctx.lines
  let anyNonCombinableApplied = false

  for (const { d, amount } of scored) {
    if (amount.totalCents <= 0) continue
    if (anyNonCombinableApplied) {
      suppressed.push({ discountId: d.id, discountName: d.name, reason: 'A non-combinable discount with higher priority already applied to this ticket' })
      continue
    }
    if (!d.advanced.combinable && applied.length > 0) {
      suppressed.push({ discountId: d.id, discountName: d.name, reason: 'This discount cannot combine with others already applied' })
      continue
    }
    // recompute against remaining (post-prior-discount) line prices so a
    // stacked discount never discounts value another discount already removed
    const recomputed = computeDiscountAmount(d, { ...ctx, lines: remainingLines })
    if (recomputed.totalCents <= 0) continue
    applied.push({
      discountId: d.id,
      discountName: d.name,
      offerType: d.offerType,
      amountCents: recomputed.totalCents,
      perLineCents: recomputed.perLine,
      explanation: explain(d, recomputed.totalCents, recomputed.perLine.size),
    })
    if (!d.advanced.combinable) anyNonCombinableApplied = true
    remainingLines = remainingLines.map((l) => {
      const cut = recomputed.perLine.get(l.id) ?? 0
      return cut > 0 ? { ...l, unitPriceCents: Math.max(0, l.unitPriceCents - cut) } : l
    })
  }

  const totalDiscountCents = applied.reduce((s, a) => s + a.amountCents, 0)
  return { applied, totalDiscountCents, suppressed }
}

/** Combined per-line discount, across every applied discount, capped so a
 *  line can never go negative even if several discounts targeted it. */
export function combinedPerLine(applied: AppliedDiscount[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of applied) {
    for (const [lineId, cents] of a.perLineCents) out.set(lineId, (out.get(lineId) ?? 0) + cents)
  }
  return out
}
