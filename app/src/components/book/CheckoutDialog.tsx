// ─── Payment panel + checkout ────────────────────────────────────────────────
// PaymentFlow is the shared right-side panel: line items, tip, payment method,
// receipt. CheckoutDialog feeds it a client's live appointment ticket — every
// edit (service, tech, time, price, added services) lands on the book instantly
// and persists if the panel closes mid-edit. POS feeds it manual sale lines.
import { useMemo, useState } from "react";
import { Banknote, Check, CreditCard, Plus, Receipt, Smartphone, X } from "lucide-react";
import type { Appointment } from "@/lib/booking-types";
import { DAY_SLOTS, SLOT_MIN, fmtTime } from "@/lib/booking-types";
import { SERVICES } from "@/lib/mock-data";
import { getStaff } from "@/lib/staff-store";
import { useSettingsStore } from "@/lib/settings-store";
import { svcById } from "@/lib/services-store";
import { catById } from "@/lib/categories-store";
import { paymentSources, refundedBySource, round2, techServiceTotals, techTipTotals, totalRefunded, type PaymentSource, type PaymentWithSources, type RefundRecord } from "@/lib/payments";

export { paymentSources, type PaymentSource, type PaymentWithSources } from "@/lib/payments";

export const METHOD_ICONS = { Cash: Banknote, Card: CreditCard, Venmo: Smartphone, Zelle: Smartphone } as const;


export interface PaymentLine {
  id: string;
  label: string;
  sub?: string;
  badge?: string;
  color?: string;
  price: number;
  /** groups the ticket per person for party checkouts */
  person?: string;
  /** present on appointment-backed lines, enables live editing at checkout */
  serviceId?: string;
  /** appointment start, minutes from OPEN_MIN */
  startMin?: number;
  /** assigned technician */
  techId?: string;
  /** salon-defined per-service notation (polish color, etc.), keyed by field id */
  customFields?: Record<string, string>;
}

export interface PaymentResult {
  /** single method name, or "Split" once a ticket carries more than one source */
  method: string;
  /** the actual tender(s) taken against this ticket */
  sources: PaymentSource[];
  /** total minus what the sources add up to -- >0 means this was left as a
   *  partial payment, the rest still owed */
  balanceDue: number;
  tip: number;
  subtotal: number;
  total: number;
  points: number;
  notes?: string;
  discount?: number;
  redeemed?: { name: string; points: number; value: number };
  /** general checkout field values, keyed by field id */
  customFields?: Record<string, string>;
  /** how the tip splits across providers (always sums to tip) */
  tipByTech?: { techId: string; amount: number }[];
  /** the appointment ids on this ticket at the moment payment completed --
   *  only set when reopening an existing payment, where it can have changed */
  apptIds?: string[];
}

/** a service added to the invoice at checkout time (kept for API compat) */
export interface CheckoutExtra {
  id: string;
  serviceId: string;
  techId: string;
  person?: string;
}

/** one editable row in the payment list, before it's turned into a real
 *  PaymentSource at charge time -- amount stays free text while typing */
export interface CheckoutSourceDraft {
  id: string;
  method: string;
  last4: string;
  amountText: string;
}

export interface CheckoutDraftState {
  tipPct: number | null;
  tipCustom: string;
  method: string;
  /** card only, single-source fast path */
  last4?: string;
  /** the payment list, once it's been touched -- while unset, the panel shows
   *  one implicit row for the full total on the selected method, kept in
   *  sync automatically as the ticket total changes */
  sources?: CheckoutSourceDraft[];
  note: string;
  redeemId: string | null;
  /** general checkout field values, keyed by field id */
  custom?: Record<string, string>;
  /** per-provider tip overrides, techId to dollar text; missing rows split pro-rata */
  tipByTech?: Record<string, string>;
}

const money = (v: number) => `$${v.toFixed(2)}`;

export function PaymentFlow({ title, subtitle, lines, onComplete, onClose, people, selected, onTogglePerson, onSelectAll, hostName, editable, addedIds, onPatchLine, onRemoveLine, onAddExtra, onRemoveExtra, loyaltyBalance, draft, onDraft, existing }: {
  title: string;
  subtitle: string;
  lines: PaymentLine[];
  onComplete: (p: PaymentResult) => void;
  onClose: () => void;
  /** party checkout: pick exactly who pays together on this ticket */
  people?: string[];
  selected?: Set<string>;
  onTogglePerson?: (name: string) => void;
  onSelectAll?: () => void;
  hostName?: string;
  /** checkout only: edit lines live (service, tech, time, price, remove) + add services */
  editable?: boolean;
  addedIds?: string[];
  onPatchLine?: (id: string, patch: Partial<Appointment>) => void;
  onRemoveLine?: (id: string) => void;
  onAddExtra?: (x: { serviceId: string; techId: string; person?: string }) => void;
  onRemoveExtra?: (id: string) => void;
  /** loyalty: the client's point balance (omit for guests) */
  loyaltyBalance?: number | null;
  /** controlled draft (persisted); POS uses the internal fallback */
  draft?: CheckoutDraftState;
  onDraft?: (patch: Partial<CheckoutDraftState>) => void;
  /** reopening a paid ticket instead of a fresh checkout: its sources show as
   *  already-collected (locked, can't be edited or removed) and count toward
   *  the total; "Add payment source" still works for charging a remainder,
   *  and a compact refund panel appears if the corrected total comes in
   *  under what's already been collected */
  existing?: {
    payment: PaymentWithSources;
    /** the tip already recorded, so the field starts at what was actually
     *  charged instead of a fresh 18% guess */
    tip: number;
    refunds?: RefundRecord[];
    onRefund: (input: {
      sourceId: string;
      amount: number;
      reason?: string;
      /** which bucket this money comes back out of -- services (reduces
       *  that tech's commission-earning sales) or tip (reduces their payout) */
      from?: "service" | "tip";
      techId?: string;
      snapshot: { apptIds: string[]; subtotal: number; tip: number; total: number; points: number };
    }) => void;
  };
}) {
  const settings = useSettingsStore();
  const TIME_OPTS = Array.from({ length: DAY_SLOTS * (SLOT_MIN / settings.booking.increment) }, (_, i) => i * settings.booking.increment);
  const [step, setStep] = useState<"pay" | "receipt">("pay");
  // internal fallback when no controlled draft is provided (POS, or reopen,
  // which starts the tip at what was already charged, not a fresh 18% guess)
  const [local, setLocal] = useState<CheckoutDraftState>(() =>
    existing
      ? { tipPct: null, tipCustom: existing.tip.toFixed(2), method: paymentSources(existing.payment)[0]?.method ?? "Cash", note: "", redeemId: null, custom: {} }
      : { tipPct: 18, tipCustom: "", method: "Cash", note: "", redeemId: null, custom: {} },
  );
  const D = draft ?? local;
  const setD = (patch: Partial<CheckoutDraftState>) => (onDraft ? onDraft(patch) : setLocal((x) => ({ ...x, ...patch })));

  const [draftSvc, setDraftSvc] = useState(SERVICES[0].id);
  const [draftTech, setDraftTech] = useState("");
  const [draftPerson, setDraftPerson] = useState(hostName ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [refundOpenId, setRefundOpenId] = useState<string | null>(null);
  const [refundAmountText, setRefundAmountText] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundFrom, setRefundFrom] = useState<"service" | "tip" | undefined>(undefined);
  const [refundTechId, setRefundTechId] = useState("");

  const methods = settings.payments.methods.filter((m) => m in METHOD_ICONS);
  const tipPresets = settings.payments.tipPresets;

  const allLines = lines;
  const subtotal = useMemo(() => allLines.reduce((s, l) => s + l.price, 0), [allLines]);
  const tip = D.tipPct != null ? Math.round(subtotal * (D.tipPct / 100) * 100) / 100 : Number(D.tipCustom) || 0;

  // tip split across providers: pro-rata by each tech's share of the service
  // value, the largest share absorbs rounding so the parts always sum to the tip
  const tipShares = useMemo(() => {
    const byTech = new Map<string, number>();
    for (const l of allLines) {
      if (!l.techId) continue;
      byTech.set(l.techId, (byTech.get(l.techId) ?? 0) + l.price);
    }
    return [...byTech.entries()].map(([techId, value]) => ({
      techId,
      value,
      name: getStaff().techs.find((t) => t.id === techId)?.name ?? "Unassigned",
    }));
  }, [allLines]);
  const tipAlloc = useMemo(() => {
    if (tipShares.length === 0 || subtotal <= 0) return new Map<string, number>();
    const parts = tipShares.map((s) => ({ id: s.techId, exact: (tip * s.value) / subtotal }));
    const rounded = parts.map((p) => Math.floor(p.exact * 100) / 100);
    let remainder = Math.round((tip - rounded.reduce((s, v) => s + v, 0)) * 100) / 100;
    // hand the leftover cents to the largest exact share
    const biggest = parts.reduce((bi, p, i) => (p.exact > parts[bi].exact ? i : bi), 0);
    rounded[biggest] = Math.round((rounded[biggest] + remainder) * 100) / 100;
    return new Map(parts.map((p, i) => [p.id, rounded[i]]));
  }, [tipShares, tip, subtotal]);
  // effective per-tech amounts: salon override wins, else the pro-rata share
  const allocOf = (techId: string) => {
    const o = D.tipByTech?.[techId];
    if (o != null && o !== "") return Number(o) || 0;
    return tipAlloc.get(techId) ?? 0;
  };
  const allocSum = tipShares.reduce((s, x) => s + allocOf(x.techId), 0);
  const allocBalanced = tipShares.length === 0 || Math.abs(allocSum - tip) < 0.005;
  const [splitOpen, setSplitOpen] = useState(false);
  const tipByTechResult = tipShares.map((s) => ({ techId: s.techId, amount: Math.round(allocOf(s.techId) * 100) / 100 }));

  // loyalty: only the redemptions this client can actually redeem right now,
  // enough points and, for free-service rewards, that service on the ticket
  const redeemable = useMemo(
    () =>
      loyaltyBalance == null
        ? []
        : settings.loyalty.redemptions.filter(
            (r) =>
              r.active &&
              (loyaltyBalance ?? 0) >= r.pointsCost &&
              (r.type !== "freeService" || allLines.some((l) => l.serviceId === r.serviceId)),
          ),
    [settings.loyalty.redemptions, loyaltyBalance, allLines],
  );
  // loyalty redemption → discount on the ticket
  const redemption = redeemable.find((r) => r.id === D.redeemId) ?? null;
  const discount = !redemption ? 0
    : redemption.type === "amount" ? Math.min(redemption.value, subtotal)
    : redemption.type === "percent" ? Math.round((subtotal * redemption.value) / 100 * 100) / 100
    : Math.min(allLines.find((l) => l.serviceId === redemption.serviceId)?.price ?? 0, subtotal);
  const total = Math.max(0, subtotal + tip - discount);
  // points earn on the discounted service value, never on tips
  const points = Math.floor(Math.max(0, subtotal - discount) * settings.loyalty.pointsPerDollar);

  // reopening a paid ticket: its existing sources show as locked rows (can't
  // be edited or removed, they're already collected) and count toward the
  // total; only newly-added rows are reported back as real charges
  const lockedSources = existing ? paymentSources(existing.payment) : [];
  const lockedIds = new Set(lockedSources.map((s) => s.id));

  // a refund on a reopened ticket comes back out of either a tech's service
  // value (their commission basis) or their tip -- these are what's left of
  // each, per tech, to pick from
  const techName = (techId: string) => getStaff().techs.find((t) => t.id === techId)?.name ?? "Unassigned";
  const serviceTechTotals = useMemo(
    () => techServiceTotals(existing?.payment.lines).map((t) => ({ ...t, name: techName(t.techId) })),
    [existing],
  );
  const tipTechTotals = useMemo(
    () => techTipTotals(existing?.payment.tipByTech).map((t) => ({ ...t, name: techName(t.techId) })),
    [existing],
  );
  const canRefundService = serviceTechTotals.length > 0;
  const canRefundTip = tipTechTotals.length > 0;
  const refundTechOptions = refundFrom === "tip" ? tipTechTotals : serviceTechTotals;

  // the payment list -- while untouched (no draft.sources yet) there's one
  // implicit row for the full total (or the existing locked sources, when
  // reopening), kept in sync as the ticket total moves; touching anything
  // (amount, method, adding a row) locks in an explicit list
  const sourceRows: CheckoutSourceDraft[] = D.sources && D.sources.length > 0
    ? D.sources
    : existing
      ? lockedSources.map((s) => ({ id: s.id, method: s.method, last4: s.last4 ?? "", amountText: s.amount.toFixed(2) }))
      : [{ id: "default", method: D.method, last4: D.last4 ?? "", amountText: total.toFixed(2) }];
  const updateSource = (id: string, patch: Partial<CheckoutSourceDraft>) => {
    if (lockedIds.has(id)) return;
    const rows = sourceRows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setD({ sources: rows, method: rows[0].method, last4: rows[0].last4 });
  };
  const addSource = () => {
    const assigned = sourceRows.reduce((s, r) => s + (Number(r.amountText) || 0), 0);
    const remaining = Math.max(0, round2(total - assigned));
    const firstFree = sourceRows.find((r) => !lockedIds.has(r.id))?.method ?? sourceRows[0]?.method;
    const otherMethod = methods.find((m) => m !== firstFree) ?? methods[0];
    setD({ sources: [...sourceRows, { id: `src${sourceRows.length}-${Date.now()}`, method: otherMethod, last4: "", amountText: remaining > 0 ? remaining.toFixed(2) : "" }] });
  };
  const removeSource = (id: string) => {
    if (lockedIds.has(id)) return;
    const rows = sourceRows.filter((r) => r.id !== id);
    setD({ sources: rows.length > 0 ? rows : undefined });
  };
  // new money only -- locked rows already exist in the payment, so they're
  // tracked net of any prior refunds instead of at face value
  const lockedGross = lockedSources.reduce((s, x) => s + x.amount, 0);
  const lockedNet = existing ? lockedGross - totalRefunded(existing.refunds) : lockedGross;
  const newRowsSum = round2(sourceRows.filter((r) => !lockedIds.has(r.id)).reduce((s, r) => s + (Number(r.amountText) || 0), 0));
  const collected = existing ? round2(lockedNet + newRowsSum) : round2(sourceRows.reduce((s, r) => s + (Number(r.amountText) || 0), 0));
  const overAssigned = !existing && collected > total + 0.005;
  const balanceDue = Math.max(0, round2(total - collected));
  // the corrected total came in under what's already been collected --
  // reopen only, a fresh checkout can't be "overpaid" before it's even charged
  const refundNeeded = existing ? Math.max(0, round2(collected - total)) : 0;
  const finalSources: PaymentSource[] = sourceRows
    .filter((r) => !lockedIds.has(r.id))
    .filter((r) => (Number(r.amountText) || 0) > 0)
    .map((r) => ({ id: r.id, method: r.method, last4: r.method === "Card" && r.last4.trim() ? r.last4.trim() : undefined, amount: round2(Number(r.amountText) || 0) }));
  const methodLabel = finalSources.length === 0 ? D.method : finalSources.length === 1 ? finalSources[0].method : "Split";
  const apptIds = lines.map((l) => l.id);

  const submitExisting = () => {
    onComplete({
      method: methodLabel, sources: finalSources, balanceDue, tip, subtotal, total, points, discount,
      redeemed: redemption ? { name: redemption.name, points: redemption.pointsCost, value: discount } : undefined,
      notes: D.note.trim() || undefined,
      customFields: Object.fromEntries(Object.entries(D.custom ?? {}).filter(([, v]) => v.trim())),
      tipByTech: tip > 0 ? tipByTechResult : undefined,
      apptIds,
    });
  };
  const submitRefund = (sourceId: string, available: number) => {
    // never more than what's actually left on this source -- cap it instead
    // of blocking the refund
    const amount = Math.min(round2(Number(refundAmountText) || 0), available);
    if (!(amount > 0)) return;
    existing?.onRefund({
      sourceId, amount, reason: refundReason.trim() || undefined,
      from: refundFrom, techId: refundTechId || undefined,
      snapshot: { apptIds, subtotal, tip, total, points },
    });
  };

  // group the ticket per person for party checkouts (host first)
  const persons = [...new Set(allLines.map((l) => l.person).filter((x): x is string => x != null))];
  const grouped = persons.length > 1;
  const orderedPersons = hostName ? [...persons].sort((a, b) => (a === hostName ? -1 : b === hostName ? 1 : 0)) : persons;

  const renderLine = (l: PaymentLine) => {
    const isAdded = addedIds?.includes(l.id) ?? false;
    const isEditing = Boolean(editable && l.serviceId);
    const qualified = l.serviceId ? getStaff().techs.filter((t) => t.skills.includes(l.serviceId!)) : [];
    return (
      <div key={l.id} className={`flex gap-3 border-b border-line/60 px-3.5 py-2.5 last:border-0 ${isEditing ? "items-start" : "items-center"}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${isEditing ? "mt-[11px]" : ""}`} style={{ background: l.color ?? "#5B54D6" }} />
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <select
                value={l.serviceId}
                onChange={(e) => onPatchLine?.(l.id, { serviceId: e.target.value })}
                title="Service"
                className="h-[30px] min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2 text-[12px] font-semibold outline-none focus:border-clay"
              >
                {SERVICES.map((sv) => <option key={sv.id} value={sv.id}>{sv.name} · ${sv.price}</option>)}
              </select>
              <select
                value={l.techId ?? ""}
                onChange={(e) => onPatchLine?.(l.id, { techId: e.target.value })}
                title="Technician"
                className="h-[30px] w-[96px] shrink-0 rounded-[8px] border border-input bg-background px-1.5 text-[11px] outline-none focus:border-clay"
              >
                {qualified.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          ) : (
            <p className="truncate text-[13px] font-semibold text-ink">
              {l.label}
              {l.badge && <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold text-muted-foreground">{l.badge}</span>}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
            {isEditing && l.startMin != null ? (
              <select
                value={l.startMin}
                onChange={(e) => onPatchLine?.(l.id, { startMin: Number(e.target.value) })}
                title="Appointment start time"
                className="tnum -ml-1 w-[74px] rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-semibold text-ink-soft outline-none transition hover:border-line focus:border-clay"
              >
                {TIME_OPTS.map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
              </select>
            ) : (
              l.startMin != null && <span className="tnum font-semibold">{fmtTime(l.startMin)}</span>
            )}
            {l.sub && <span>· {l.sub}</span>}
            {isAdded && <span className="rounded-full bg-secondary px-1.5 text-[9.5px] font-bold text-muted-foreground">added</span>}
          </p>
          {/* salon-defined per-service fields (Color by default, more in Settings, Checkout) */}
          {isEditing && settings.checkout.serviceFields.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {settings.checkout.serviceFields.map((f) => (
                <label key={f.id} className="flex items-center gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{f.label}</span>
                  <input
                    value={l.customFields?.[f.id] ?? ""}
                    onChange={(e) => onPatchLine?.(l.id, { customFields: { ...(l.customFields ?? {}), [f.id]: e.target.value } })}
                    className="h-6 w-28 rounded-[6px] border border-input bg-background px-1.5 text-[11px] outline-none focus:border-clay"
                  />
                </label>
              ))}
            </div>
          )}
          {/* read-only view of filled-in fields on non-editable lines */}
          {!isEditing && settings.checkout.serviceFields.some((f) => l.customFields?.[f.id]?.trim()) && (
            <p className="mt-0.5 text-[10.5px] text-ink-faint">
              {settings.checkout.serviceFields
                .filter((f) => l.customFields?.[f.id]?.trim())
                .map((f) => `${f.label}: ${l.customFields![f.id].trim()}`)
                .join(" · ")}
            </p>
          )}
        </div>
        {isEditing ? (
          <span className="flex h-[30px] shrink-0 items-center text-[13px] font-semibold">
            $<input
              type="number"
              min={0}
              step={1}
              value={l.price}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") onPatchLine?.(l.id, { priceOverride: undefined });
                else {
                  const n = Number(v);
                  if (!Number.isNaN(n)) onPatchLine?.(l.id, { priceOverride: Math.max(0, n) });
                }
              }}
              className="tnum h-[30px] w-16 rounded-[8px] border border-input bg-background px-1.5 text-right text-[12px] font-semibold outline-none focus:border-clay"
            />
          </span>
        ) : (
          <span className="tnum shrink-0 text-[13px] font-semibold">{money(l.price)}</span>
        )}
        {isAdded && onRemoveExtra && (
          <button
            onClick={() => onRemoveExtra(l.id)}
            className="flex h-[30px] shrink-0 items-center text-ink-faint transition-colors hover:text-rust"
            title="Remove this added service from the book"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {!isAdded && editable && onRemoveLine && (
          <button
            onClick={() => onRemoveLine(l.id)}
            className="flex h-[30px] shrink-0 items-center text-ink-faint transition-colors hover:text-rust"
            title="Remove from this invoice, stays on the book unpaid"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-y-0 right-0 z-[94] flex w-[634px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[16px] font-bold text-ink">{title}</h2>
          <p className="text-[11.5px] text-ink-faint">{subtitle}</p>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-cream hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      {step === "pay" ? (
        <>
          {/* who's on this ticket, tap people in or out, any mix */}
          {onTogglePerson && (people ?? []).length > 1 && (
            <div className="border-b border-line bg-cream/60 px-5 py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Paying together</span>
                <button onClick={onSelectAll} className="text-[10.5px] font-bold text-clay hover:underline">Select all</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(people ?? []).map((name) => {
                  const on = selected?.has(name) ?? false;
                  const personTotal = allLines.filter((l) => l.person === name).reduce((s, l) => s + l.price, 0);
                  return (
                    <button
                      key={name}
                      onClick={() => onTogglePerson(name)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition ${
                        on ? "border-clay bg-clay text-white" : "border-line bg-surface text-ink-faint hover:border-clay/50 hover:text-ink-soft"
                      }`}
                      title={on ? `Take ${name} off this ticket` : `Add ${name} to this ticket`}
                    >
                      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${on ? "border-white/70 bg-white/20" : "border-line-strong"}`}>
                        {on && <Check className="h-2.5 w-2.5" />}
                      </span>
                      {name}
                      {on && personTotal > 0 && <span className="tnum opacity-80">${personTotal.toFixed(0)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {/* line items, grouped per person on party tickets */}
            <div className="overflow-hidden rounded-xl border border-line">
              {grouped
                ? orderedPersons.map((person) => {
                    const personLines = allLines.filter((l) => l.person === person || (l.person == null && person === hostName));
                    const personTotal = personLines.reduce((s, l) => s + l.price, 0);
                    return (
                      <div key={person} className="border-b border-line/60 last:border-0">
                        <div className="flex items-center justify-between bg-secondary/50 px-3.5 py-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{person}</span>
                          <span className="tnum text-[11px] font-bold text-ink-soft">{money(personTotal)}</span>
                        </div>
                        {personLines.map(renderLine)}
                      </div>
                    );
                  })
                : allLines.map(renderLine)}

              {/* add a service to the ticket — collapsed action, expands into a small form */}
              {editable && onAddExtra && !addOpen && (
                <button
                  onClick={() => setAddOpen(true)}
                  className="flex w-full items-center justify-center gap-1.5 border-b border-line/60 px-3.5 py-2.5 text-[12px] font-semibold text-ink-faint transition-colors hover:bg-cream/60 hover:text-clay"
                >
                  <Plus className="h-3.5 w-3.5" /> Add a service to this ticket
                </button>
              )}
              {editable && onAddExtra && addOpen && (
                <div className="border-b border-line/60 bg-cream/40 px-3.5 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">New service on this ticket</span>
                    <button onClick={() => setAddOpen(false)} className="text-ink-faint transition-colors hover:text-ink" title="Close">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {(people ?? []).length > 1 && (
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Add for:</span>
                      <div className="flex flex-wrap gap-1">
                        {(people ?? []).filter((p2) => !selected || selected.has(p2)).map((p2) => (
                          <button
                            key={p2}
                            onClick={() => setDraftPerson(p2)}
                            className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition ${
                              draftPerson === p2 ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-faint hover:border-line-strong"
                            }`}
                          >
                            {p2}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={draftSvc}
                      onChange={(e) => { setDraftSvc(e.target.value); setDraftTech(""); }}
                      className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none"
                    >
                      {SERVICES.map((sv) => <option key={sv.id} value={sv.id}>{sv.name} · ${sv.price}</option>)}
                    </select>
                    <select
                      value={draftTech}
                      onChange={(e) => setDraftTech(e.target.value)}
                      className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none"
                    >
                      {getStaff().techs.filter((t) => t.skills.includes(draftSvc)).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const techId = draftTech || getStaff().techs.find((t) => t.skills.includes(draftSvc))?.id || "";
                        onAddExtra({ serviceId: draftSvc, techId, person: (people ?? []).length > 1 ? draftPerson || hostName : undefined });
                        setAddOpen(false);
                      }}
                      className="flex h-[30px] shrink-0 items-center gap-1 rounded-[8px] bg-clay px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-clay-deep"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add service
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between bg-cream/60 px-3.5 py-2.5">
                <span className="text-[12px] font-semibold text-ink-soft">Subtotal</span>
                <span className="tnum text-[13px] font-bold">{money(subtotal)}</span>
              </div>
            </div>

            {/* redeem loyalty points, only what this client can redeem right now */}
            {redeemable.length > 0 && (
              <>
                <div className="mb-1.5 mt-4 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Redeem points</p>
                  <span className="tnum rounded-full bg-violet-500/10 px-2 py-0.5 text-[10.5px] font-bold text-violet-500">
                    {(loyaltyBalance ?? 0).toLocaleString()} pts available
                  </span>
                </div>
                <div className="space-y-1">
                  {redeemable.map((r) => {
                    const on = D.redeemId === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setD({ redeemId: on ? null : r.id })}
                        className={`flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left transition ${
                          on ? "border-violet-500/50 bg-violet-500/10" : "border-line bg-surface hover:border-line-strong"
                        }`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-violet-500 bg-violet-500 text-white" : "border-line-strong"}`}>
                          {on && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className="min-w-0 flex-1 text-[12px] font-semibold text-ink">{r.name}</span>
                        <span className="tnum shrink-0 text-[10.5px] font-bold text-violet-500">{r.pointsCost.toLocaleString()} pts</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* tip */}
            <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tip</p>
            <div className="flex gap-1.5">
              {tipPresets.map((p) => (
                <button
                  key={p}
                  onClick={() => setD({ tipPct: p, tipCustom: "", tipByTech: undefined })}
                  className={`h-8 flex-1 rounded-[8px] border text-[12px] font-bold transition-colors ${
                    D.tipPct === p ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
                  }`}
                >
                  {p === 0 ? "None" : `${p}%`}
                </button>
              ))}
              <input
                value={D.tipCustom}
                onChange={(e) => setD({ tipCustom: e.target.value.replace(/[^\d.]/g, ""), tipPct: null, tipByTech: undefined })}
                placeholder="$ custom"
                className="tnum h-8 w-20 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-bold outline-none focus:border-clay"
              />
            </div>

            {/* per-provider tip split: default is pro-rata by service value */}
            {tipShares.length > 0 && tip > 0 && (
              <div className="mt-2 rounded-[10px] border border-line bg-surface">
                <button
                  onClick={() => setSplitOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1 text-[11.5px] font-semibold text-ink">
                    Split between providers
                    <span className="ml-1.5 font-normal text-ink-faint">
                      {tipShares.map((s) => `${s.name.split(" ")[0]} ${money(allocOf(s.techId))}`).join(" · ")}
                    </span>
                  </span>
                  <span className={`text-[10px] font-bold text-ink-faint transition-transform ${splitOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {splitOpen && (
                  <div className="space-y-1.5 border-t border-line px-3 py-2.5">
                    {tipShares.map((s) => (
                      <div key={s.techId} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-ink">{s.name}</span>
                          <span className="block text-[10px] text-ink-faint">
                            {money(s.value)} of services{subtotal > 0 ? ` · ${Math.round((s.value / subtotal) * 100)}%` : ""}
                          </span>
                        </span>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-ink-faint">$</span>
                          <input
                            value={D.tipByTech?.[s.techId] ?? (tipAlloc.get(s.techId) ?? 0).toFixed(2)}
                            onChange={(e) => setD({ tipByTech: { ...(D.tipByTech ?? {}), [s.techId]: e.target.value.replace(/[^\d.]/g, "") } })}
                            className="tnum h-7 w-20 rounded-[7px] border border-line bg-background pl-5 pr-1.5 text-[12px] font-bold outline-none focus:border-clay"
                          />
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-0.5">
                      <button
                        onClick={() => setD({ tipByTech: undefined })}
                        className="text-[10.5px] font-semibold text-clay hover:underline"
                      >
                        Reset to service value split
                      </button>
                      <span className={`text-[10.5px] font-bold ${allocBalanced ? "text-olive" : "text-rose-500"}`}>
                        {allocBalanced ? `${money(allocSum)} assigned` : `${money(allocSum)} of ${money(tip)} assigned`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* payment sources -- cash, or a card with its last 4 digits, each
                for its own amount; split across several to take mixed tender,
                or bring the total assigned below the ticket total to leave a
                balance due. Reopening a paid ticket shows its existing
                sources locked (already collected, not editable here), each
                with its own refund control -- available any time a source
                still has money on it, not just when a price correction
                happens to create an overage */}
            <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Payment</p>
            <div className="space-y-1.5">
              {sourceRows.map((r) => {
                const Icon = METHOD_ICONS[r.method as keyof typeof METHOD_ICONS];
                const locked = lockedIds.has(r.id);
                const refundedFromRow = locked ? refundedBySource(existing?.refunds, r.id) : 0;
                const lockedSource = locked ? lockedSources.find((s) => s.id === r.id) : undefined;
                const availableToRefund = lockedSource ? Math.max(0, round2(lockedSource.amount - refundedFromRow)) : 0;
                const refundRowOpen = refundOpenId === r.id && availableToRefund > 0.004;
                return (
                  <div key={r.id} className={`rounded-[10px] border p-1.5 ${locked ? "border-line bg-cream/50" : "border-line bg-surface"}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-clay-tint text-clay">
                        {Icon && <Icon className="h-4 w-4" />}
                      </span>
                      {locked ? (
                        <span className="min-w-0 flex-1 text-[12px] font-semibold text-ink">
                          {r.method}{r.last4 ? ` ····${r.last4}` : ""}
                          <span className="ml-1.5 font-normal text-ink-faint">already collected{refundedFromRow > 0 ? ` · ${money(refundedFromRow)} refunded` : ""}</span>
                        </span>
                      ) : (
                        <>
                          <select
                            value={r.method}
                            onChange={(e) => updateSource(r.id, { method: e.target.value, last4: e.target.value === "Card" ? r.last4 : "" })}
                            title="Payment method"
                            className="h-8 w-[88px] shrink-0 rounded-[7px] border border-input bg-background px-1.5 text-[11.5px] font-semibold outline-none focus:border-clay"
                          >
                            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          {r.method === "Card" && (
                            <input
                              value={r.last4}
                              onChange={(e) => updateSource(r.id, { last4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                              placeholder="Last 4"
                              title="Last 4 digits of the card"
                              maxLength={4}
                              className="tnum h-8 w-16 shrink-0 rounded-[7px] border border-input bg-background px-1.5 text-center text-[11.5px] outline-none focus:border-clay"
                            />
                          )}
                        </>
                      )}
                      <div className="relative min-w-0 flex-1 basis-24 grow-0">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-ink-faint">$</span>
                        {locked ? (
                          <span className="tnum flex h-8 w-full items-center rounded-[7px] pl-5 pr-1.5 text-[12.5px] font-bold text-ink-faint">{r.amountText}</span>
                        ) : (
                          <input
                            value={r.amountText}
                            onChange={(e) => updateSource(r.id, { amountText: e.target.value.replace(/[^\d.]/g, "") })}
                            placeholder="0.00"
                            className="tnum h-8 w-full rounded-[7px] border border-input bg-background py-1 pl-5 pr-1.5 text-[12.5px] font-bold outline-none focus:border-clay"
                          />
                        )}
                      </div>
                      {locked && availableToRefund > 0.004 && (
                        <button
                          onClick={() => {
                            setRefundOpenId(refundRowOpen ? null : r.id);
                            setRefundAmountText((refundNeeded > 0.004 ? Math.min(availableToRefund, refundNeeded) : availableToRefund).toFixed(2));
                            setRefundReason("");
                            const defaultFrom = canRefundService ? "service" : canRefundTip ? "tip" : undefined;
                            setRefundFrom(defaultFrom);
                            setRefundTechId((defaultFrom === "tip" ? tipTechTotals : serviceTechTotals)[0]?.techId ?? "");
                          }}
                          className="shrink-0 text-[11px] font-semibold text-rust hover:underline"
                        >
                          {refundRowOpen ? "Cancel" : "Refund"}
                        </button>
                      )}
                      {!locked && sourceRows.filter((x) => !lockedIds.has(x.id)).length > (existing ? 0 : 1) && (
                        <button
                          onClick={() => removeSource(r.id)}
                          className="shrink-0 text-ink-faint transition-colors hover:text-rust"
                          title="Remove this payment source"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {locked && refundRowOpen && (
                      <div className="mt-1.5 space-y-1.5 border-t border-line/60 pt-1.5">
                        {(canRefundService || canRefundTip) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Refund from</span>
                            {canRefundService && (
                              <button
                                onClick={() => { setRefundFrom("service"); setRefundTechId(serviceTechTotals[0]?.techId ?? ""); }}
                                className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition ${
                                  refundFrom === "service" ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-faint hover:border-line-strong"
                                }`}
                              >
                                Services
                              </button>
                            )}
                            {canRefundTip && (
                              <button
                                onClick={() => { setRefundFrom("tip"); setRefundTechId(tipTechTotals[0]?.techId ?? ""); }}
                                className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition ${
                                  refundFrom === "tip" ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-faint hover:border-line-strong"
                                }`}
                              >
                                Tip
                              </button>
                            )}
                            {refundTechOptions.length > 1 && (
                              <select
                                value={refundTechId}
                                onChange={(e) => setRefundTechId(e.target.value)}
                                title="Technician"
                                className="h-6 min-w-0 flex-1 rounded-[6px] border border-input bg-background px-1.5 text-[11px] font-semibold outline-none focus:border-clay"
                              >
                                {refundTechOptions.map((t) => <option key={t.techId} value={t.techId}>{t.name} · {money(t.value)}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-ink-faint">$</span>
                          <input
                            value={refundAmountText}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d.]/g, "");
                              const n = Number(raw);
                              // never let the field hold more than this source has left
                              setRefundAmountText(raw !== "" && !Number.isNaN(n) && n > availableToRefund ? availableToRefund.toFixed(2) : raw);
                            }}
                            className="tnum h-7 w-20 shrink-0 rounded-[7px] border border-input bg-background px-1.5 text-[12px] font-bold outline-none focus:border-clay"
                          />
                          <span className="shrink-0 text-[10px] text-ink-faint">of {money(availableToRefund)}</span>
                          <input
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            placeholder="Reason (optional)"
                            className="h-7 min-w-0 flex-1 rounded-[7px] border border-input bg-background px-2 text-[11px] outline-none focus:border-clay"
                          />
                          <button
                            onClick={() => submitRefund(r.id, availableToRefund)}
                            disabled={!(Number(refundAmountText) > 0)}
                            className="shrink-0 rounded-[7px] bg-rust px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Refund
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-2">
                {existing ? (
                  balanceDue > 0.004 ? (
                    <button onClick={addSource} className="flex items-center gap-1 text-[11.5px] font-semibold text-clay hover:underline">
                      <Plus className="h-3 w-3" /> Add a payment to cover more
                    </button>
                  ) : refundNeeded > 0.004 ? (
                    <span className="text-[11.5px] font-semibold text-rust">Refund a source above to continue</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11.5px] font-bold text-olive">
                      <Check className="h-3 w-3" /> Checkout completed
                    </span>
                  )
                ) : (
                  <button onClick={addSource} className="flex items-center gap-1 text-[11.5px] font-semibold text-clay hover:underline">
                    <Plus className="h-3 w-3" /> Add payment source
                  </button>
                )}
                <span className={`text-right text-[11px] font-bold ${overAssigned ? "text-rose-500" : refundNeeded > 0.004 ? "text-rust" : balanceDue > 0.004 ? "text-amberw" : "text-olive"}`}>
                  {overAssigned
                    ? `${money(collected)} assigned, ${money(collected - total)} over the total`
                    : refundNeeded > 0.004
                      ? `${money(refundNeeded)} more collected than the corrected total`
                      : balanceDue > 0.004
                        ? `${money(collected)} of ${money(total)}, ${money(balanceDue)} left as a balance`
                        : `${money(collected)} assigned`}
                </span>
              </div>
            </div>

            {/* invoice note */}
            <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Note <span className="font-medium normal-case text-ink-faint/70">(optional)</span>
            </p>
            <input
              value={D.note}
              onChange={(e) => setD({ note: e.target.value })}
              placeholder="e.g. birthday discount, client owes $10 next visit"
              className="w-full rounded-[8px] border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-clay"
            />

            {/* salon-defined general checkout fields (Settings, Checkout) */}
            {settings.checkout.generalFields.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {settings.checkout.generalFields.map((f) => (
                  <label key={f.id} className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-ink-faint">{f.label}</span>
                    <input
                      value={D.custom?.[f.id] ?? ""}
                      onChange={(e) => setD({ custom: { ...(D.custom ?? {}), [f.id]: e.target.value } })}
                      className="w-full rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-clay"
                    />
                  </label>
                ))}
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-ink-faint">
              Earns <b className="text-clay">{points.toLocaleString()} pts</b> on this sale
            </p>
          </div>

          {/* footer */}
          <div className="border-t border-line px-5 py-3.5">
            <div className="mb-2.5 space-y-0.5">
              <div className="flex items-baseline justify-between text-[12px] text-ink-soft">
                <span>Tip {money(tip)}</span>
                {discount > 0 && redemption && (
                  <span className="font-semibold text-violet-500">−{money(discount)} · {redemption.name}</span>
                )}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-ink-soft">{discount > 0 ? <s className="mr-1 text-ink-faint">{money(subtotal + tip)}</s> : null}</span>
                <span className="text-[15px] font-bold">
                  {existing ? "Corrected total" : "Total"} <span className="tnum text-clay">{money(total)}</span>
                  {existing && round2(total) !== round2(existing.payment.total) && (
                    <span className="ml-1.5 text-[11px] font-normal text-ink-faint">was {money(existing.payment.total)}</span>
                  )}
                </span>
              </div>
            </div>
            {/* the one thing that matters most when there's still money left --
                called out big and in rust so it's never mistaken for already
                settled, instead of only showing up in the smaller allocation
                line above the payment sources */}
            {balanceDue > 0.004 && (
              <div className="mb-2.5 flex items-center justify-between rounded-xl border border-rust/40 bg-rust-tint/40 px-3 py-2">
                <span className="text-[11.5px] font-bold uppercase tracking-wide text-rust">Still owed</span>
                <span className="tnum text-[18px] font-extrabold text-rust">{money(balanceDue)}</span>
              </div>
            )}
            {!allocBalanced && tip > 0 && (
              <p className="mb-2 text-center text-[11px] font-semibold text-rose-500">
                Tip split is {money(tip - allocSum)} short, adjust the provider amounts above
              </p>
            )}
            <button
              onClick={() => (existing ? submitExisting() : setStep("receipt"))}
              disabled={!allocBalanced || (existing ? refundNeeded > 0.004 : overAssigned || collected <= 0)}
              className="w-full rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep disabled:opacity-40"
            >
              {existing
                ? refundNeeded > 0.004
                  ? "Refund the difference above to continue"
                  : newRowsSum > 0.004
                    ? `Charge ${money(newRowsSum)}${balanceDue > 0.004 ? ` · ${money(balanceDue)} still due` : ""}`
                    : balanceDue > 0.004
                      ? `Save changes · ${money(balanceDue)} still due`
                      : "Save changes"
                : overAssigned
                  ? "Fix payment amounts to continue"
                  : balanceDue > 0.004
                    ? `Charge ${money(collected)} now · ${money(balanceDue)} due`
                    : `Charge ${money(collected)} · ${methodLabel}`}
            </button>
          </div>
        </>
      ) : (
        /* receipt */
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-olive-tint">
            <Check className="h-7 w-7 text-olive" />
          </span>
          <h3 className="mt-3 text-[17px] font-bold">{balanceDue > 0.004 ? "Partial payment recorded" : "Payment complete"}</h3>
          <p className="mt-1 text-[12.5px] text-ink-soft">{title} · {methodLabel}</p>
          <div className="mx-auto mt-4 w-64 space-y-1 rounded-xl border border-dashed border-line p-3.5 text-left text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink-faint">Services</span><span className="tnum">{money(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">Tip</span><span className="tnum">{money(tip)}</span></div>
            {tip > 0 && tipShares.length > 1 && tipByTechResult.map((s) => (
              <div key={s.techId} className="flex justify-between pl-3 text-[11px] text-ink-faint">
                <span>{tipShares.find((x) => x.techId === s.techId)?.name}</span><span className="tnum">{money(s.amount)}</span>
              </div>
            ))}
            {discount > 0 && redemption && (
              <div className="flex justify-between text-violet-500"><span>Redeemed: {redemption.name}</span><span className="tnum">−{money(discount)}</span></div>
            )}
            <div className="flex justify-between border-t border-line pt-1 font-bold"><span>Total</span><span className="tnum">{money(total)}</span></div>
            {finalSources.map((s) => (
              <div key={s.id} className="flex justify-between pl-3 text-[11px] text-ink-faint">
                <span>{s.method}{s.last4 ? ` ····${s.last4}` : ""}</span><span className="tnum">{money(s.amount)}</span>
              </div>
            ))}
            {balanceDue > 0.004 && (
              <div className="flex justify-between font-semibold text-rust"><span>Balance due</span><span className="tnum">{money(balanceDue)}</span></div>
            )}
            <div className="flex justify-between text-[11px] text-ink-faint"><span>Loyalty earned</span><span>+{points.toLocaleString()} pts</span></div>
            {D.note.trim() && <div className="flex justify-between gap-3 text-[11px] text-ink-faint"><span className="shrink-0">Note</span><span className="text-right">{D.note.trim()}</span></div>}
            {settings.checkout.generalFields.filter((f) => D.custom?.[f.id]?.trim()).map((f) => (
              <div key={f.id} className="flex justify-between gap-3 text-[11px] text-ink-faint">
                <span className="shrink-0">{f.label}</span><span className="text-right">{D.custom![f.id].trim()}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => onComplete({ method: methodLabel, sources: finalSources, balanceDue, tip, subtotal, total, points, discount, redeemed: redemption ? { name: redemption.name, points: redemption.pointsCost, value: discount } : undefined, notes: D.note.trim() || undefined, customFields: Object.fromEntries(Object.entries(D.custom ?? {}).filter(([, v]) => v.trim())), tipByTech: tip > 0 ? tipByTechResult : undefined })}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep"
          >
            <Receipt className="h-4 w-4" /> Done, close ticket
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Appointment checkout, live ticket editing ───────────────────────────────
export function CheckoutDialog({ clientName, items, dateLabel, onComplete, onClose, people, selected, onTogglePerson, onSelectAll, loyaltyBalance, addedIds, onPatchLine, onRemoveLine, onAddExtra, onRemoveExtra, draft, onDraft }: {
  clientName: string;
  items: Appointment[];
  dateLabel: string;
  onComplete: (p: PaymentResult) => void;
  onClose: () => void;
  people?: string[];
  selected?: Set<string>;
  onTogglePerson?: (name: string) => void;
  onSelectAll?: () => void;
  loyaltyBalance?: number | null;
  addedIds?: string[];
  onPatchLine?: (id: string, patch: Partial<Appointment>) => void;
  onRemoveLine?: (id: string) => void;
  onAddExtra?: (x: { serviceId: string; techId: string; person?: string }) => void;
  onRemoveExtra?: (id: string) => void;
  draft?: CheckoutDraftState;
  onDraft?: (patch: Partial<CheckoutDraftState>) => void;
}) {
  const lines: PaymentLine[] = items.map((a) => {
    const svc = svcById[a.serviceId];
    return {
      id: a.id,
      label: svc?.name ?? a.serviceId,
      badge: a.clientName !== clientName ? `${a.clientName} · guest` : undefined,
      sub: `${a.durationMin}m${(a.addons ?? []).length > 0 ? ` · +${a.addons!.map((x) => x.name).join(", +")}` : ""}`,
      color: svc ? catById[svc.categoryId]?.line : undefined,
      price: (a.priceOverride ?? svc?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0),
      person: a.clientName,
      serviceId: a.serviceId,
      startMin: a.startMin,
      techId: a.techId,
      customFields: a.customFields,
    };
  });
  return (
    <PaymentFlow
      title={selected && selected.size === 1 ? `Checkout: ${[...selected][0]}` : people && people.length > 1 ? "Checkout: Party" : `Checkout: ${clientName}`}
      subtitle={`${dateLabel} · ${items.length} ${items.length === 1 ? "service" : "services"}`}
      lines={lines}
      onComplete={onComplete}
      onClose={onClose}
      people={people}
      selected={selected}
      onTogglePerson={onTogglePerson}
      onSelectAll={onSelectAll}
      hostName={clientName}
      editable
      addedIds={addedIds}
      onPatchLine={onPatchLine}
      onRemoveLine={onRemoveLine}
      onAddExtra={onAddExtra}
      onRemoveExtra={onRemoveExtra}
      loyaltyBalance={loyaltyBalance}
      draft={draft}
      onDraft={onDraft}
    />
  );
}
