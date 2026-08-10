# Inventory Management & Gift Cards / Prepaid Cards — Scoping Plan

**Status:** Draft, scoping only — not yet implemented
**Date:** 2026-08-10
**Why now:** Came out of a gap analysis against the owner's live Zenoti reports dashboard (373 reports). Booking-source tracking, turnaways, and several smaller reports were built directly (see `HANDOFF.md`); inventory and gift cards are full modules PLAN.md already flagged as "later phases" (§10) and deserve their own design pass before writing code, since they touch new data models, new UI surfaces, and — for gift cards specifically — real money.

This document proposes a data model, key flows, and a phased build order for each module. Nothing here has been built yet; it's meant to be reviewed and adjusted before implementation starts.

---

## 1. Inventory Management

### 1.1 What it needs to do

A nail salon's inventory has two distinct categories that behave differently and should probably be modeled as one `InventoryItem` type with a `kind` flag rather than two separate systems:

- **Backbar / professional-use** — polish, gel, acrylic powder, acetone, buffers, etc. Consumed during services, never sold directly. The salon cares about *not running out mid-service* and about *cost per service* (a rough COGS number).
- **Retail** — lotions, take-home polish, tools, gift sets. Sold to clients at checkout like a line item, alongside services.

### 1.2 Data model (draft)

New file: `src/lib/inventory-types.ts`, new store: `src/lib/inventory-store.ts` (same `usePersistentState`/`sdata` pattern as services/staff).

```typescript
export interface InventoryItem {
  id: string
  name: string
  kind: 'backbar' | 'retail'
  categoryId?: string          // reuse the existing category system where it makes sense
  sku?: string
  unit: string                 // "bottle", "oz", "each" — just a label, not a conversion system
  costPerUnit: number          // what the salon pays
  retailPrice?: number         // only meaningful for kind: 'retail'
  onHand: number
  reorderPoint: number         // low-stock alert threshold
  reorderQty?: number          // suggested restock amount
  vendor?: string
  active: boolean
}

/** links a service to the backbar items it consumes, so completing a service
 *  can auto-decrement stock (Phase 2, see below) */
export interface ServiceRecipe {
  serviceId: string
  uses: { itemId: string; qty: number }[]
}

/** a stock change, receiving, manual count correction, or service consumption —
 *  kept as a log so "what happened to my inventory" is always answerable */
export interface InventoryMovement {
  id: string
  itemId: string
  dateKey: string
  delta: number                 // positive = received/adjusted up, negative = consumed/adjusted down
  reason: 'received' | 'sale' | 'service_use' | 'adjustment' | 'waste'
  note?: string
  apptId?: string                // set when reason is 'service_use', links back to the appointment
  loggedAt: number
}
```

`onHand` is a cached running total; `InventoryMovement` is the source of truth, the same "cached balance + append-only log" pattern already used for loyalty points (`pointsByClient` + redemption history) elsewhere in this codebase.

### 1.3 Key flows

- **Receiving stock** — a simple form (item, quantity, optional cost override) that writes an `InventoryMovement` with `reason: 'received'` and bumps `onHand`.
- **Low-stock alerts** — a KPI/badge wherever makes sense (Settings › Inventory, and optionally a small banner on the appointment book) whenever `onHand <= reorderPoint`. No push notifications in this app (no backend), so this is a passive "check when you look" indicator, not an active alert.
- **Retail sale at checkout** — extend the checkout ticket to allow adding retail `InventoryItem`s as line items alongside services (same UI slot as the existing "extra" checkout items). On completion, write a `-1` (or `-qty`) movement with `reason: 'sale'`.
- **Service consumption (Phase 2)** — when a `ServiceRecipe` exists for a completed service's `serviceId`, auto-write `service_use` movements for each linked backbar item. This is the piece that makes the COGS numbers real instead of just "what we bought."
- **Manual counts / waste** — a simple adjustment form (set new count, or subtract N for breakage/waste), writes an `adjustment` or `waste` movement.

### 1.4 Reporting (once the module exists, folds into the existing Reports tabs)

- Current stock levels + items below reorder point
- Retail sales by item, by category, with margin (`retailPrice - costPerUnit`)
- Estimated COGS per service (once recipes exist) and per technician/day
- Movement history export (CSV, matching every other table in Reports)

### 1.5 Phasing

| Phase | Scope |
|---|---|
| **1 — Manual tracking** | `InventoryItem` CRUD in Settings, manual receiving/adjustment, low-stock indicator, retail items sellable at checkout. No recipes yet — this alone gives real value (know what you have, know what's selling). |
| **2 — Recipe-based consumption** | `ServiceRecipe` editor, auto-deduct backbar stock on service completion, COGS reporting. |
| **3 — Vendor & ordering** | Purchase orders, vendor contact info, reorder suggestions, barcode/SKU scanning if the salon wants it. This is the part that starts to need a real backend (multi-user concurrent stock counts, vendor integrations) rather than localStorage. |

Recommend starting Phase 1 only, and deciding on Phase 2 after seeing whether the salon actually wants per-service cost tracking or just wants to know when to reorder polish.

---

## 2. Gift Cards & Prepaid Cards

**Important framing up front:** this app has no backend and no payment processor — all "money" today (tickets, tips, loyalty) is a local record of what happened, not an actual movement of funds. Gift cards are the first feature where that distinction really matters, because a gift card is a liability (money the salon owes in future services) rather than just a historical record. Phase 1 below treats it exactly like today's other local records — fine for a single-location demo/internal tool — but going live with real money changing hands needs a real backend + payment processor (Stripe, Square, etc.) before this is trustworthy at scale. That's a separate, larger project from this scoping doc.

### 2.1 What it needs to do

- Sell a gift card (fixed amount or custom amount) at POS.
- Redeem a gift card as a payment method at checkout, partially or in full, with the remainder going to another method.
- Look up a card's balance.
- Reload / top-up an existing card.
- Report on liability (total outstanding balance across all cards) and breakage (cards issued but never fully used).
- Prepaid packages (e.g. "buy 5 fills, get 1 free" or "$200 prepaid balance for 10% bonus") are a close cousin — same balance-tracking mechanism, different purchase framing. Modeled as the same underlying `GiftCard` type with a `kind` flag, so both share one system rather than building two.

### 2.2 Data model (draft)

New file: `src/lib/giftcard-types.ts`, new store: `src/lib/giftcard-store.ts`.

```typescript
export interface GiftCard {
  id: string
  code: string                   // short human-entered code, e.g. "GC-7F2K9"
  kind: 'gift_card' | 'prepaid'
  initialValue: number
  balance: number
  issuedAt: number
  issuedDateKey: string
  purchasedBy?: string           // client name, optional (can be bought for someone else)
  clientId?: string              // who it's attached to for redemption/lookup, if known
  expiresAt?: string              // dateKey, optional — many states restrict gift card expiry, default to none
  active: boolean                 // false once fully spent or voided
}

/** append-only, same pattern as InventoryMovement and loyalty's redemption log —
 *  balance is a cached total, this is the source of truth */
export interface GiftCardTransaction {
  id: string
  cardId: string
  dateKey: string
  amount: number                 // positive = sold/reloaded, negative = redeemed
  type: 'sale' | 'reload' | 'redemption' | 'void'
  apptId?: string                 // set when redeemed against a specific checkout ticket
  loggedAt: number
}
```

### 2.3 Key flows

- **Selling a card** — a POS flow: pick amount (preset buttons like the existing tip presets, plus custom), optionally attach to a client, generate a code, take payment via the existing payment methods. Writes the `GiftCard` plus a `sale` transaction.
- **Redeeming at checkout** — add "Gift card" as a payment method option in the existing checkout ticket (alongside Cash/Card/Venmo/Zelle). Entering a code looks up balance; the ticket can split between gift card and another method if the balance doesn't cover the total. Writes a `redemption` transaction and decrements balance.
- **Balance lookup** — a simple search-by-code or search-by-client screen, probably folded into the same UI area as gift card sales.
- **Reload** — same as selling, but against an existing card, writes a `reload` transaction.
- **Reporting** — outstanding liability (`sum of balance where active`), cards sold/redeemed in range, breakage estimate (cards with no activity in 12+ months, if the salon wants that number). Exports as CSV like everything else in Reports.

### 2.4 Phasing

| Phase | Scope |
|---|---|
| **1 — Digital, single-location** | Sell, redeem, reload, balance lookup, liability report. Local record only, same trust model as the rest of this app today. Fine for internal use / demo / single front-desk terminal. |
| **2 — Physical card support** | Printable/exportable card design with the code, or integration with a physical card printer/vendor if the salon uses plastic cards. |
| **3 — Real payment processing** | Actual money movement via a payment processor, multi-location balance sync, fraud/duplicate-redemption protection. This is the point where gift cards stop being "a number in localStorage" and become a real financial product — needs a backend, and is a materially bigger project than Phases 1–2. |

Recommend Phase 1 only for now, clearly labeled internally as "not yet a real payment product," same way the rest of the app's financial reports are today (record-keeping, not money movement).

---

## 3. Suggested sequencing

Both modules are independent of each other and of the reports work already shipped. If doing one first:

1. **Inventory Phase 1** is lower-risk (no money involved, pure record-keeping) and delivers value immediately (low-stock visibility, retail sell-through tracking) — a reasonable first pick.
2. **Gift Cards Phase 1** touches the checkout flow (adding a new payment method) and needs the "money we owe later" framing to be clear to the owner before building, since it's the first feature in this app that represents a financial liability rather than a historical record.

Both should get an explicit go/no-go from the owner on scope before implementation starts, same as the reports work did.
