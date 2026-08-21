// ─── Discounts store, salon-configurable promotions ──────────────────────────
// Mirrors services-store.ts's pattern: a flat array, salon-shared (sdata),
// persisted to localStorage, with a live id lookup. The pricing math itself
// lives in discount-engine.ts (pure, no store access) -- this file only owns
// the records: CRUD, status transitions, redemption tracking, and the audit
// log every mutating action writes to.
import { useSyncExternalStore } from "react";
import { sdata } from "./persist";
import { getCurrentUser, type SessionUser } from "./current-user";

// ── types ─────────────────────────────────────────────────────────────────

export type DiscountStatus = "draft" | "scheduled" | "active" | "paused" | "expired" | "archived";
export type OfferType = "percent" | "fixed" | "set_price" | "bogo";
export type HowReceived = "automatic" | "staff_select" | "promo_code";
export type DiscountChannel = "front_desk" | "walk_in" | "online";
export type AppliesToKind = "entire_sale" | "all_services" | "categories" | "services" | "service_tags" | "products" | "packages" | "memberships";

export interface AppliesTo {
  kind: AppliesToKind;
  categoryIds?: string[];
  serviceIds?: string[];
  tags?: string[];
  /** reserved for when products/packages/memberships exist -- see HANDOFF.md */
  productIds?: string[];
  packageIds?: string[];
  membershipIds?: string[];
}

export interface Availability {
  /** true = starts the moment it's activated (default) */
  startNow: boolean;
  /** ISO date, only meaningful when startNow is false */
  startDate?: string;
  /** ISO date, open-ended if unset */
  endDate?: string;
  /** defaults to the current (only) location when unset */
  locationIds?: string[];
}

export interface BogoConfig {
  buyQty: number;
  /** which services count toward "buy" -- unset/empty means any targeted service */
  buyServiceIds?: string[];
  rewardQty: number;
  rewardType: "free" | "percent" | "fixed";
  /** percent (0-100) or a flat $ amount, ignored when rewardType is "free" */
  rewardValue?: number;
  rewardSelection: "cheapest" | "most_expensive";
  /** which services can be the free/discounted reward -- unset/empty means any targeted service */
  rewardServiceIds?: string[];
  /** false = the deal fires once per ticket even if there are enough items for more sets */
  repeat: boolean;
  maxRewardsPerSale?: number;
}

export interface DayTimeWindow {
  /** 0=Sun..6=Sat */
  day: number;
  /** minutes from midnight */
  startMin: number;
  endMin: number;
}

export interface CustomerEligibility {
  allClients: boolean;
  tags?: string[];
  clientIds?: string[];
  newClientsOnly?: boolean;
}

export interface RedemptionLimit {
  overall?: number;
  perCustomer?: number;
}

export interface DiscountTargeting {
  roleIds?: string[];
  techIds?: string[];
  techTags?: string[];
}

export interface AdvancedRules {
  /** in dollars, matches the rest of the app's money convention */
  minSubtotal?: number;
  maxSubtotal?: number;
  minQty?: number;
  dayTimeWindows?: DayTimeWindow[];
  /** IANA zone name; unset = salon's local time (this build has one location) */
  timezone?: string;
  customerEligibility?: CustomerEligibility;
  redemptionLimit?: RedemptionLimit;
  channels?: DiscountChannel[];
  locationIds?: string[];
  targeting?: DiscountTargeting;
  /** lower number = applied first / preferred when discounts conflict */
  priority: number;
  /** can this discount stack with others already applied to the same ticket? */
  combinable: boolean;
}

export interface Discount {
  id: string;
  name: string;
  description?: string;
  status: DiscountStatus;
  offerType: OfferType;
  /** percent (0-100, exclusive of 0, inclusive of 100), fixed $ amount, or
   *  set-price $ amount -- unused for bogo, which carries its own config */
  value?: number;
  bogo?: BogoConfig;
  appliesTo: AppliesTo;
  howReceived: HowReceived;
  /** trimmed + uppercased on save, unique among non-archived discounts */
  promoCode?: string;
  availability: Availability;
  advanced: AdvancedRules;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  archivedAt?: number;
}

export const DEFAULT_ADVANCED: AdvancedRules = { priority: 100, combinable: false };

export const DEFAULT_AVAILABILITY: Availability = { startNow: true };

/** one redemption of a discount on a specific ticket, kept so redemption
 *  limits (overall + per-customer) can be checked and so a discount's usage
 *  is auditable. Deletion of the discount never deletes this history. */
export interface RedemptionRecord {
  id: string;
  discountId: string;
  at: number;
  clientId?: string;
  clientName?: string;
  paymentId: string;
  amountCents: number;
}

export type AuditAction =
  | "created" | "edited" | "activated" | "paused" | "resumed" | "archived" | "duplicated"
  | "manual_apply" | "manual_apply_approved" | "manual_apply_denied";

export interface AuditLogEntry {
  id: string;
  at: number;
  userId: string;
  userName: string;
  action: AuditAction;
  discountId?: string;
  discountName?: string;
  /** shallow before/after snapshot for edits, omitted for pure lifecycle actions */
  before?: unknown;
  after?: unknown;
  detail?: string;
}

/** salon-wide policy for the separate "manual one-time discount" flow at
 *  checkout -- distinct from the managed Discount records above. */
export interface ManualDiscountSettings {
  /** which session titles may apply a manual discount at all */
  allowedTitles: string[];
  requireReason: boolean;
  /** a manual discount at or above this % of the ticket needs a second,
   *  higher-tier approval before it can be applied; 0 disables the gate */
  managerApprovalThresholdPct: number;
  /** titles who can grant that second approval */
  approverTitles: string[];
}

export const DEFAULT_MANUAL_SETTINGS: ManualDiscountSettings = {
  allowedTitles: ["Manager", "Owner"],
  requireReason: true,
  managerApprovalThresholdPct: 20,
  approverTitles: ["Owner"],
};

// ── persistence ──────────────────────────────────────────────────────────────

interface DiscountsState {
  discounts: Discount[];
  redemptions: RedemptionRecord[];
  auditLog: AuditLogEntry[];
  manualSettings: ManualDiscountSettings;
}

const KEY = sdata("discounts-v1");

function load(): DiscountsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { discounts: [], redemptions: [], auditLog: [], manualSettings: { ...DEFAULT_MANUAL_SETTINGS } };
    const parsed = JSON.parse(raw) as Partial<DiscountsState>;
    return {
      discounts: Array.isArray(parsed.discounts) ? parsed.discounts : [],
      redemptions: Array.isArray(parsed.redemptions) ? parsed.redemptions : [],
      auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : [],
      manualSettings: { ...DEFAULT_MANUAL_SETTINGS, ...parsed.manualSettings },
    };
  } catch {
    return { discounts: [], redemptions: [], auditLog: [], manualSettings: { ...DEFAULT_MANUAL_SETTINGS } };
  }
}

let state: DiscountsState = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked/full, keep serving the in-memory state */
  }
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDiscountsStore(): DiscountsState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getDiscounts(): DiscountsState {
  return state;
}

/** live id → discount lookup, indexed like svcById/catById elsewhere */
export const discountById: Record<string, Discount> = new Proxy({} as Record<string, Discount>, {
  get: (_, id: string) => state.discounts.find((d) => d.id === id),
  has: (_, id: string) => state.discounts.some((d) => d.id === id),
});

export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

function logEntry(action: AuditAction, patch: Partial<AuditLogEntry> = {}): AuditLogEntry {
  const actor = getCurrentUser();
  return { id: uid("audit"), at: Date.now(), userId: actor.id, userName: actor.name, action, ...patch };
}

function commit(next: DiscountsState) {
  state = next;
  persist();
  emit();
}

// ── status derivation ────────────────────────────────────────────────────────
// "Scheduled" and "Expired" are derived from dates rather than stored
// separately, so an editor can never leave a discount silently stuck in the
// wrong bucket -- only draft/active/paused/archived are ever written by hand.

export function effectiveStatus(d: Discount, todayKey: string): DiscountStatus {
  if (d.status === "draft" || d.status === "paused" || d.status === "archived") return d.status;
  if (!d.availability.startNow && d.availability.startDate && d.availability.startDate > todayKey) return "scheduled";
  if (d.availability.endDate && d.availability.endDate < todayKey) return "expired";
  return "active";
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export function createDiscount(partial: Omit<Discount, "id" | "createdAt" | "updatedAt" | "createdBy" | "status"> & { status?: DiscountStatus }): Discount {
  const now = Date.now();
  const d: Discount = {
    id: uid("disc"),
    createdAt: now,
    updatedAt: now,
    createdBy: getCurrentUser().id,
    status: partial.status ?? "draft",
    ...partial,
  };
  commit({ ...state, discounts: [...state.discounts, d], auditLog: [...state.auditLog, logEntry("created", { discountId: d.id, discountName: d.name, after: d })] });
  return d;
}

export function updateDiscount(id: string, patch: Partial<Discount>) {
  const before = state.discounts.find((d) => d.id === id);
  if (!before) return;
  const after: Discount = { ...before, ...patch, updatedAt: Date.now() };
  commit({
    ...state,
    discounts: state.discounts.map((d) => (d.id === id ? after : d)),
    auditLog: [...state.auditLog, logEntry("edited", { discountId: id, discountName: after.name, before, after })],
  });
}

/** Discounts are never hard-deleted once they have redemption history -- see
 *  spec. A never-redeemed draft can still be removed outright from the UI by
 *  archiving it (archived discounts are hidden from active pickers/POS but
 *  kept for audit, same as everything else here). */
export function setDiscountStatus(id: string, status: DiscountStatus, action: AuditAction) {
  const before = state.discounts.find((d) => d.id === id);
  if (!before) return;
  const after: Discount = { ...before, status, updatedAt: Date.now(), ...(status === "archived" ? { archivedAt: Date.now() } : {}) };
  commit({
    ...state,
    discounts: state.discounts.map((d) => (d.id === id ? after : d)),
    auditLog: [...state.auditLog, logEntry(action, { discountId: id, discountName: after.name })],
  });
}

export function duplicateDiscount(id: string): Discount | undefined {
  const src = state.discounts.find((d) => d.id === id);
  if (!src) return undefined;
  const now = Date.now();
  const copy: Discount = { ...src, id: uid("disc"), name: `${src.name} (copy)`, status: "draft", promoCode: undefined, createdAt: now, updatedAt: now, createdBy: getCurrentUser().id, archivedAt: undefined };
  commit({ ...state, discounts: [...state.discounts, copy], auditLog: [...state.auditLog, logEntry("duplicated", { discountId: copy.id, discountName: copy.name, detail: `duplicated from ${src.name}` })] });
  return copy;
}

/** trimmed + uppercased, unique among non-archived discounts (excluding `excludeId` when editing) */
export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function promoCodeTaken(code: string, excludeId?: string): boolean {
  const norm = normalizePromoCode(code);
  if (!norm) return false;
  return state.discounts.some((d) => d.id !== excludeId && d.status !== "archived" && normalizePromoCode(d.promoCode ?? "") === norm);
}

// ── redemption tracking ──────────────────────────────────────────────────────
// Best-effort, in-process only -- there is exactly one browser tab today, so
// this read-then-write is not racing anyone. When the real backend lands,
// this exact check must become transactional (a DB constraint or row lock),
// per the original spec; see HANDOFF.md section 9.

export function redemptionCounts(discountId: string, clientId?: string): { overall: number; byThisCustomer: number } {
  const forDiscount = state.redemptions.filter((r) => r.discountId === discountId);
  return {
    overall: forDiscount.length,
    byThisCustomer: clientId ? forDiscount.filter((r) => r.clientId === clientId).length : 0,
  };
}

export function recordRedemptions(records: Omit<RedemptionRecord, "id">[]) {
  if (records.length === 0) return;
  const withIds = records.map((r) => ({ ...r, id: uid("redeem") }));
  commit({ ...state, redemptions: [...state.redemptions, ...withIds] });
}

// ── manual one-time discount policy ──────────────────────────────────────────

export function setManualSettings(patch: Partial<ManualDiscountSettings>) {
  commit({ ...state, manualSettings: { ...state.manualSettings, ...patch } });
}

export function logManualDiscount(action: "manual_apply" | "manual_apply_approved" | "manual_apply_denied", detail: string) {
  commit({ ...state, auditLog: [...state.auditLog, logEntry(action, { detail })] });
}

// ── permissions ────────────────────────────────────────────────────────────
// No real RBAC exists app-wide yet (see HANDOFF.md, section 9) -- these are
// stopgaps keyed off the session user's title/role name, replaceable in one
// place once real permissions land.

function titleFor(): string {
  return getCurrentUser().title;
}

export function isManagerOrAbove(): boolean {
  const t = titleFor();
  return t === "Manager" || t === "Owner";
}

/** who can create/edit/pause/archive managed Discount records */
export function canManageDiscounts(): boolean {
  return isManagerOrAbove();
}

/** who can apply the separate manual one-time discount at checkout */
export function canApplyManualDiscount(settings: ManualDiscountSettings = state.manualSettings): boolean {
  return settings.allowedTitles.includes(titleFor());
}

/** who can grant the second approval when a manual discount crosses the threshold */
export function canApproveManualDiscount(settings: ManualDiscountSettings = state.manualSettings): boolean {
  return settings.approverTitles.includes(titleFor());
}

export function currentTitle(user?: SessionUser): string {
  if (user) return user.title;
  return titleFor();
}
