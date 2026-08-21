// ─── Discounts, Settings section ─────────────────────────────────────────────
// Management table (search, filters, create, row actions) + a single
// responsive builder drawer for create/edit. Matches the rest of Settings'
// visual language (card/inputCls/Field/Toggle/ConfirmDialog) and the app's
// 634px right-drawer convention used by booking/checkout/POS panels.
//
// All pricing math is delegated to discount-engine.ts -- this file only
// collects the record's fields and renders the live summary/test results
// that engine returns. See discounts-store.ts for the data model and
// discount-engine.ts for the pure math.
import { useMemo, useState } from "react";
import {
  Archive, BadgePercent, ChevronDown, ChevronUp, Copy, FlaskConical, Gift, Pause, Play, Plus,
  Search, ShieldAlert, Ticket, Trash2, Users, X,
} from "lucide-react";
import {
  canManageDiscounts, createDiscount, duplicateDiscount, effectiveStatus, normalizePromoCode,
  promoCodeTaken, setDiscountStatus, updateDiscount, useDiscountsStore, DEFAULT_ADVANCED, DEFAULT_AVAILABILITY,
  type AdvancedRules, type AppliesTo, type AppliesToKind, type Availability, type BogoConfig, type Discount,
  type DiscountChannel, type DiscountStatus, type HowReceived, type OfferType,
} from "@/lib/discounts-store";
import {
  computeDiscountAmount, evaluateEligibility, fromCents, toCents, type EngineContext, type EngineLine,
} from "@/lib/discount-engine";
import { orderedServices, useServicesStore } from "@/lib/services-store";
import { useCategoriesStore } from "@/lib/categories-store";
import { useStaffStore } from "@/lib/staff-store";
import { SALON_ID } from "@/lib/session";
import { ConfirmDialog } from "./ConfirmDialog";

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const inputCls =
  "w-full rounded-lg border border-[#E3DDE3] bg-white px-2.5 py-1.5 text-[12.5px] text-slate-800 outline-none transition focus:border-[#5B54D6] focus:ring-2 focus:ring-[#5B54D6]/15";
const card = "rounded-xl border border-[#EDE7EE] bg-white p-4";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

const STATUS_META: Record<DiscountStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-500" },
  scheduled: { label: "Scheduled", cls: "bg-sky-50 text-sky-600" },
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-600" },
  paused: { label: "Paused", cls: "bg-amber-50 text-amber-600" },
  expired: { label: "Expired", cls: "bg-slate-100 text-slate-400" },
  archived: { label: "Archived", cls: "bg-slate-100 text-slate-400" },
};

function StatusBadge({ d }: { d: Discount }) {
  const s = effectiveStatus(d, todayKey());
  const meta = STATUS_META[s];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${meta.cls}`}>{meta.label}</span>;
}

const OFFER_LABEL: Record<OfferType, string> = { percent: "% off", fixed: "$ off", set_price: "Set price", bogo: "Buy X Get Y" };
const HOW_LABEL: Record<HowReceived, string> = { automatic: "Automatic", staff_select: "Staff picks", promo_code: "Promo code" };

function offerSummary(d: Discount): string {
  if (d.offerType === "percent") return `${d.value ?? 0}% off`;
  if (d.offerType === "fixed") return `$${d.value ?? 0} off`;
  if (d.offerType === "set_price") return `Set to $${d.value ?? 0}`;
  const b = d.bogo;
  if (!b) return "Buy X Get Y";
  const reward = b.rewardType === "free" ? "free" : b.rewardType === "percent" ? `${b.rewardValue}% off` : `$${b.rewardValue} off`;
  return `Buy ${b.buyQty} get ${b.rewardQty} ${reward}`;
}

function appliesToSummary(a: AppliesTo, categories: { id: string; name: string }[], services: { id: string; name: string }[]): string {
  if (a.kind === "entire_sale") return "Entire sale";
  if (a.kind === "all_services") return "All services";
  if (a.kind === "categories") {
    const ids = a.categoryIds ?? [];
    if (ids.length === 1) return categories.find((c) => c.id === ids[0])?.name ?? "1 category";
    return `${ids.length} categories`;
  }
  if (a.kind === "services") {
    const n = (a.serviceIds ?? []).length;
    if (n === 1) return services.find((s) => s.id === a.serviceIds![0])?.name ?? "1 service";
    return `${n} services`;
  }
  if (a.kind === "service_tags") return `Tag: ${(a.tags ?? []).join(", ") || "none"}`;
  return "Products / packages / memberships (coming soon)";
}

// ── main section: search, filter, table ──────────────────────────────────────

type StatusFilter = "all" | DiscountStatus;

export function DiscountsSection() {
  const { discounts, redemptions } = useDiscountsStore();
  const services = useServicesStore();
  const categories = useCategoriesStore();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [offerFilter, setOfferFilter] = useState<OfferType | "all">("all");
  const [howFilter, setHowFilter] = useState<HowReceived | "all">("all");
  const [editing, setEditing] = useState<Discount | "new" | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Discount | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Discount | null>(null);
  const canManage = canManageDiscounts();
  const today = todayKey();

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return discounts
      .filter((d) => (text ? d.name.toLowerCase().includes(text) || (d.promoCode ?? "").toLowerCase().includes(text) : true))
      .filter((d) => (statusFilter === "all" ? true : effectiveStatus(d, today) === statusFilter))
      .filter((d) => (offerFilter === "all" ? true : d.offerType === offerFilter))
      .filter((d) => (howFilter === "all" ? true : d.howReceived === howFilter))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [discounts, q, statusFilter, offerFilter, howFilter, today]);

  const redeemedCount = (id: string) => redemptions.filter((r) => r.discountId === id).length;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900">Discounts</h2>
          <p className="text-[12px] text-slate-400">Promotions, promo codes, and Buy X Get Y deals</p>
        </div>
        {canManage && (
          <button
            onClick={() => setEditing("new")}
            className="flex items-center gap-1.5 rounded-lg bg-[#5B54D6] px-3 py-2 text-[12.5px] font-bold text-white transition hover:bg-[#4C46C4]"
          >
            <Plus className="h-3.5 w-3.5" /> Create discount
          </button>
        )}
      </div>

      {!canManage && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11.5px] text-amber-700">
          <ShieldAlert className="h-4 w-4 shrink-0" /> Only managers and owners can create or edit discounts. You can still view them here.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[#E3DDE3] bg-white px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or promo code" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="h-9 rounded-lg border border-[#E3DDE3] bg-white px-2 text-[12px] font-semibold text-slate-600 outline-none">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_META) as DiscountStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select value={offerFilter} onChange={(e) => setOfferFilter(e.target.value as OfferType | "all")} className="h-9 rounded-lg border border-[#E3DDE3] bg-white px-2 text-[12px] font-semibold text-slate-600 outline-none">
          <option value="all">All offer types</option>
          {(Object.keys(OFFER_LABEL) as OfferType[]).map((o) => <option key={o} value={o}>{OFFER_LABEL[o]}</option>)}
        </select>
        <select value={howFilter} onChange={(e) => setHowFilter(e.target.value as HowReceived | "all")} className="h-9 rounded-lg border border-[#E3DDE3] bg-white px-2 text-[12px] font-semibold text-slate-600 outline-none">
          <option value="all">All redemption methods</option>
          {(Object.keys(HOW_LABEL) as HowReceived[]).map((h) => <option key={h} value={h}>{HOW_LABEL[h]}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#EDE7EE] bg-white">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA] text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
              <th className="px-3.5 py-2.5">Name</th>
              <th className="px-3.5 py-2.5">Status</th>
              <th className="px-3.5 py-2.5">Offer</th>
              <th className="px-3.5 py-2.5">Applies to</th>
              <th className="px-3.5 py-2.5">Redemption</th>
              <th className="px-3.5 py-2.5">Updated</th>
              <th className="px-3.5 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3.5 py-8 text-center text-[12px] text-slate-400">No discounts match. {canManage && "Create one to get started."}</td></tr>
            )}
            {rows.map((d) => {
              const redeemed = redeemedCount(d.id);
              const s = effectiveStatus(d, today);
              return (
                <tr key={d.id} className="border-b border-[#EDE7EE] last:border-0 hover:bg-[#FAF8FA]">
                  <td className="px-3.5 py-2.5">
                    <button onClick={() => canManage && setEditing(d)} className={`text-left font-semibold text-slate-800 ${canManage ? "hover:text-[#5B54D6]" : "cursor-default"}`}>
                      {d.name}
                    </button>
                    {d.promoCode && <span className="ml-1.5 text-[10.5px] text-slate-400">{d.promoCode}</span>}
                  </td>
                  <td className="px-3.5 py-2.5"><StatusBadge d={d} /></td>
                  <td className="px-3.5 py-2.5 text-slate-600">{offerSummary(d)}</td>
                  <td className="px-3.5 py-2.5 text-slate-600">{appliesToSummary(d.appliesTo, categories, services)}</td>
                  <td className="px-3.5 py-2.5 text-slate-600">{HOW_LABEL[d.howReceived]}</td>
                  <td className="px-3.5 py-2.5 text-slate-400">{new Date(d.updatedAt).toLocaleDateString()}</td>
                  <td className="px-3.5 py-2.5">
                    {canManage && (
                      <div className="flex items-center justify-end gap-1">
                        {(s === "active" || s === "scheduled") && (
                          <button title="Pause" onClick={() => setDiscountStatus(d.id, "paused", "paused")} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-amber-50 hover:text-amber-600">
                            <Pause className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {s === "paused" && (
                          <button title="Resume" onClick={() => setDiscountStatus(d.id, "active", "resumed")} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {s === "draft" && (
                          <button title="Activate" onClick={() => setDiscountStatus(d.id, "active", "activated")} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button title="Duplicate" onClick={() => duplicateDiscount(d.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {s !== "archived" && (
                          <button title="Archive" onClick={() => setConfirmArchive(d)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {redeemed === 0 && (
                          <button title="Delete (never redeemed)" onClick={() => setConfirmDelete(d)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && <DiscountBuilder discount={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      {confirmArchive && (
        <ConfirmDialog
          title={`Archive "${confirmArchive.name}"?`}
          body="It stops applying anywhere (POS, promo code entry, staff picker) but its history and audit trail stay intact."
          confirmLabel="Archive"
          onConfirm={() => setDiscountStatus(confirmArchive.id, "archived", "archived")}
          onClose={() => setConfirmArchive(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          body="This discount has never been redeemed, so it can be removed outright. This can't be undone."
          confirmLabel="Delete discount"
          onConfirm={() => setDiscountStatus(confirmDelete.id, "archived", "archived")}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ── fast-setup templates ──────────────────────────────────────────────────────

interface Template {
  label: string;
  icon: typeof BadgePercent;
  build: () => Partial<Discount>;
}

const TEMPLATES: Template[] = [
  {
    label: "10% off entire sale", icon: BadgePercent,
    build: () => ({ offerType: "percent", value: 10, appliesTo: { kind: "entire_sale" }, howReceived: "automatic" }),
  },
  {
    label: "$10 off, promo code", icon: Ticket,
    build: () => ({ offerType: "fixed", value: 10, appliesTo: { kind: "entire_sale" }, howReceived: "promo_code" }),
  },
  {
    label: "Buy 1 service, get 1 free", icon: Gift,
    build: () => ({
      offerType: "bogo", appliesTo: { kind: "all_services" }, howReceived: "staff_select",
      bogo: { buyQty: 1, rewardQty: 1, rewardType: "free", rewardSelection: "cheapest", repeat: false },
    }),
  },
  {
    label: "New client 15% off", icon: Users,
    build: () => ({
      offerType: "percent", value: 15, appliesTo: { kind: "entire_sale" }, howReceived: "automatic",
      advanced: { ...DEFAULT_ADVANCED, customerEligibility: { allClients: false, newClientsOnly: true } },
    }),
  },
];

// ── builder drawer ────────────────────────────────────────────────────────────

function riskWarnings(d: {
  offerType: OfferType; value?: number; bogo?: BogoConfig; howReceived: HowReceived; availability: Availability;
  appliesTo: AppliesTo; advanced: AdvancedRules;
}): string[] {
  const warnings: string[] = [];
  if (d.offerType === "percent" && (d.value ?? 0) >= 100) warnings.push("This discounts 100% off -- the service will be free whenever it applies.");
  if (d.howReceived === "automatic" && !d.availability.endDate) warnings.push("Automatic with no end date -- this will keep applying to every qualifying sale indefinitely.");
  if (d.howReceived === "automatic" && d.appliesTo.kind === "entire_sale" && !d.availability.endDate) warnings.push("Automatic, entire sale, no end date -- double check this is meant to run indefinitely on every ticket.");
  if (d.advanced.combinable && d.offerType !== "bogo") warnings.push("Combinable is on -- this can stack with other combinable discounts on the same ticket, which can add up fast.");
  return warnings;
}

function DiscountBuilder({ discount, onClose }: { discount: Discount | null; onClose: () => void }) {
  const services = useServicesStore();
  const categories = useCategoriesStore();
  const isNew = discount === null;

  const [name, setName] = useState(discount?.name ?? "");
  const [description, setDescription] = useState(discount?.description ?? "");
  const [offerType, setOfferType] = useState<OfferType>(discount?.offerType ?? "percent");
  const [value, setValue] = useState(discount?.value ?? 10);
  const [bogo, setBogo] = useState<BogoConfig>(discount?.bogo ?? { buyQty: 1, rewardQty: 1, rewardType: "free", rewardSelection: "cheapest", repeat: false });
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(discount?.appliesTo ?? { kind: "entire_sale" });
  const [howReceived, setHowReceived] = useState<HowReceived>(discount?.howReceived ?? "automatic");
  const [promoCode, setPromoCode] = useState(discount?.promoCode ?? "");
  const [availability, setAvailability] = useState<Availability>(discount?.availability ?? { ...DEFAULT_AVAILABILITY });
  const [advanced, setAdvanced] = useState<AdvancedRules>(discount?.advanced ?? { ...DEFAULT_ADVANCED });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testerOpen, setTesterOpen] = useState(false);
  const [testSubtotal, setTestSubtotal] = useState(100);
  const [testItems, setTestItems] = useState(2);
  const [codeError, setCodeError] = useState<string | null>(null);

  const svcOptions = orderedServices(services.filter((s) => s.active !== false), categories);

  const patch = (): Partial<Discount> => ({ name: name.trim() || "Untitled discount", description: description.trim() || undefined, offerType, value: offerType === "bogo" ? undefined : value, bogo: offerType === "bogo" ? bogo : undefined, appliesTo, howReceived, promoCode: howReceived === "promo_code" ? normalizePromoCode(promoCode) : undefined, availability, advanced });

  const save = (status: "draft" | "active") => {
    if (howReceived === "promo_code") {
      const norm = normalizePromoCode(promoCode);
      if (!norm) { setCodeError("Enter a promo code"); return; }
      if (promoCodeTaken(norm, discount?.id)) { setCodeError("That code is already in use by another discount"); return; }
    }
    if (isNew) createDiscount({ ...patch(), status } as Omit<Discount, "id" | "createdAt" | "updatedAt" | "createdBy" | "status"> & { status?: DiscountStatus });
    else updateDiscount(discount!.id, { ...patch(), status });
    onClose();
  };

  const applyTemplate = (t: Template) => {
    const p = t.build();
    if (p.name !== undefined) setName(p.name);
    if (p.offerType) setOfferType(p.offerType);
    if (p.value !== undefined) setValue(p.value);
    if (p.bogo) setBogo(p.bogo);
    if (p.appliesTo) setAppliesTo(p.appliesTo);
    if (p.howReceived) setHowReceived(p.howReceived);
    if (p.advanced) setAdvanced(p.advanced);
    if (!name) setName(t.label);
  };

  // live summary + price preview, using the exact same engine POS will use
  const draftDiscount: Discount = {
    id: discount?.id ?? "preview", createdAt: 0, updatedAt: 0, createdBy: "", status: "active",
    name: name || "Untitled discount", offerType, value, bogo: offerType === "bogo" ? bogo : undefined,
    appliesTo, howReceived, promoCode, availability, advanced,
  };
  const testLines: EngineLine[] = Array.from({ length: Math.max(1, testItems) }, (_, i) => ({
    id: `t${i}`, serviceId: svcOptions[0]?.id ?? "svc", techId: "tech", unitPriceCents: Math.round(toCents(testSubtotal) / Math.max(1, testItems)),
  }));
  const testCtx: EngineContext = { lines: testLines, dateKey: todayKey(), minutesOfDay: 600, dayOfWeek: new Date().getDay(), locationId: SALON_ID, channel: "front_desk", promoCode: howReceived === "promo_code" ? promoCode : undefined, staffSelectedIds: howReceived === "staff_select" ? ["preview"] : undefined };
  const testAmount = computeDiscountAmount(draftDiscount, testCtx);
  const testEligibility = evaluateEligibility(draftDiscount, testCtx, { overall: 0, byThisCustomer: 0 });

  const summary = useMemo(() => {
    const applies = appliesToSummary(appliesTo, categories, services);
    const offer = offerSummary(draftDiscount);
    const how = howReceived === "automatic" ? "applies automatically" : howReceived === "promo_code" ? `with promo code ${normalizePromoCode(promoCode) || "___"}` : "when staff selects it";
    return `${offer} on ${applies.toLowerCase()}, ${how}.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliesTo, offerType, value, bogo, howReceived, promoCode, categories, services]);

  const warnings = riskWarnings({ offerType, value, bogo, howReceived, availability, appliesTo, advanced });

  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div className="relative flex h-full w-[634px] max-w-[95vw] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#EDE7EE] px-5 py-4">
          <h2 className="text-[15px] font-bold text-slate-900">{isNew ? "Create discount" : `Edit ${discount!.name}`}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isNew && (
            <div className="mb-4">
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Fast setup</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button key={t.label} onClick={() => applyTemplate(t)} className="flex items-center gap-1.5 rounded-lg border border-[#E3DDE3] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-600 transition hover:border-[#5B54D6] hover:text-[#5B54D6]">
                    <t.icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`${card} space-y-3`}>
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Mani Special" className={inputCls} /></Field>
            <Field label="Description (optional)"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} /></Field>

            <Field label="Offer type">
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.keys(OFFER_LABEL) as OfferType[]).map((o) => (
                  <button key={o} onClick={() => setOfferType(o)} className={`rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition ${offerType === o ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#E3DDE3] text-slate-500 hover:border-slate-300"}`}>
                    {OFFER_LABEL[o]}
                  </button>
                ))}
              </div>
            </Field>

            {offerType !== "bogo" ? (
              <Field label={offerType === "percent" ? "Percent off" : offerType === "fixed" ? "Amount off ($)" : "Set price ($)"}>
                <input type="number" min={0} max={offerType === "percent" ? 100 : undefined} step={offerType === "percent" ? 1 : 0.5} value={value} onChange={(e) => setValue(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-32`} />
              </Field>
            ) : (
              <BogoFields bogo={bogo} onChange={setBogo} />
            )}

            <Field label="Applies to">
              <AppliesToPicker appliesTo={appliesTo} onChange={setAppliesTo} services={svcOptions} categories={categories} />
            </Field>

            <Field label="How it's received">
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(HOW_LABEL) as HowReceived[]).map((h) => (
                  <button key={h} onClick={() => setHowReceived(h)} className={`rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition ${howReceived === h ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#E3DDE3] text-slate-500 hover:border-slate-300"}`}>
                    {HOW_LABEL[h]}
                  </button>
                ))}
              </div>
            </Field>
            {howReceived === "promo_code" && (
              <Field label="Promo code" hint="Trimmed and uppercased automatically; must be unique">
                <input value={promoCode} onChange={(e) => { setPromoCode(e.target.value); setCodeError(null); }} placeholder="e.g. SUMMER10" className={`${inputCls} font-mono uppercase`} />
                {codeError && <span className="mt-1 block text-[10.5px] font-semibold text-red-500">{codeError}</span>}
              </Field>
            )}

            <Field label="Availability">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                  <input type="checkbox" checked={availability.startNow} onChange={(e) => setAvailability((a) => ({ ...a, startNow: e.target.checked }))} /> Start now
                </label>
                {!availability.startNow && (
                  <input type="date" value={availability.startDate ?? ""} onChange={(e) => setAvailability((a) => ({ ...a, startDate: e.target.value }))} className={`${inputCls} w-40`} />
                )}
                <span className="text-[11px] text-slate-400">until</span>
                <input type="date" value={availability.endDate ?? ""} onChange={(e) => setAvailability((a) => ({ ...a, endDate: e.target.value || undefined }))} className={`${inputCls} w-40`} placeholder="No end date" />
              </div>
              <span className="mt-1 block text-[10.5px] text-slate-400">Location: current location (this build has one). Multi-location targeting is wired up for when a second location exists.</span>
            </Field>
          </div>

          {/* advanced rules, collapsed */}
          <div className={`${card} mt-3`}>
            <button onClick={() => setAdvancedOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
              <span className="text-[12.5px] font-bold text-slate-800">Advanced rules</span>
              {advancedOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {advancedOpen && <AdvancedRulesEditor advanced={advanced} onChange={setAdvanced} />}
          </div>

          {/* test discount tool */}
          <div className={`${card} mt-3`}>
            <button onClick={() => setTesterOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
              <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-800"><FlaskConical className="h-3.5 w-3.5" /> Test this discount</span>
              {testerOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {testerOpen && (
              <div className="mt-3 space-y-2.5">
                <div className="flex gap-3">
                  <Field label="Test ticket subtotal ($)"><input type="number" min={0} value={testSubtotal} onChange={(e) => setTestSubtotal(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-32`} /></Field>
                  <Field label="Number of items"><input type="number" min={1} value={testItems} onChange={(e) => setTestItems(Math.max(1, Number(e.target.value) || 1))} className={`${inputCls} w-24`} /></Field>
                </div>
                {testEligibility.eligible ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">
                    Eligible -- saves ${fromCents(testAmount.totalCents).toFixed(2)} on this test ticket
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                    Not eligible on this test ticket: {testEligibility.reasons.join("; ")}
                  </div>
                )}
              </div>
            )}
          </div>

          {warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-4 text-amber-700">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* sticky live summary + actions */}
        <div className="border-t border-[#EDE7EE] bg-[#FAF8FA] px-5 py-3.5">
          <p className="mb-2.5 text-[12px] leading-4 text-slate-600"><span className="font-bold text-slate-800">{name || "This discount"}:</span> {summary}</p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
            <button onClick={() => save("draft")} className="rounded-lg border border-[#E3DDE3] bg-white px-3.5 py-2 text-[12.5px] font-bold text-slate-600 hover:border-slate-300">Save draft</button>
            <button onClick={() => save("active")} className="rounded-lg bg-[#5B54D6] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#4C46C4]">Activate</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BogoFields({ bogo, onChange }: { bogo: BogoConfig; onChange: (b: BogoConfig) => void }) {
  const p = (patch: Partial<BogoConfig>) => onChange({ ...bogo, ...patch });
  return (
    <div className="rounded-lg border border-[#EDE7EE] bg-[#FAF8FA] p-3">
      <p className="mb-2 text-[11px] font-bold text-slate-500">Buy X, Get Y -- one unified rule</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Buy quantity"><input type="number" min={1} value={bogo.buyQty} onChange={(e) => p({ buyQty: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} /></Field>
        <Field label="Get quantity"><input type="number" min={1} value={bogo.rewardQty} onChange={(e) => p({ rewardQty: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} /></Field>
        <Field label="Reward type">
          <select value={bogo.rewardType} onChange={(e) => p({ rewardType: e.target.value as BogoConfig["rewardType"] })} className={inputCls}>
            <option value="free">Free</option>
            <option value="percent">% off</option>
            <option value="fixed">$ off</option>
          </select>
        </Field>
        {bogo.rewardType !== "free" && (
          <Field label={bogo.rewardType === "percent" ? "Reward %" : "Reward $"}>
            <input type="number" min={0} value={bogo.rewardValue ?? 0} onChange={(e) => p({ rewardValue: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} />
          </Field>
        )}
        <Field label="Reward picks the">
          <select value={bogo.rewardSelection} onChange={(e) => p({ rewardSelection: e.target.value as BogoConfig["rewardSelection"] })} className={inputCls}>
            <option value="cheapest">Cheapest eligible item</option>
            <option value="most_expensive">Most expensive eligible item</option>
          </select>
        </Field>
        <Field label="Max reward units per sale (optional)"><input type="number" min={0} value={bogo.maxRewardsPerSale ?? ""} onChange={(e) => p({ maxRewardsPerSale: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} className={inputCls} /></Field>
      </div>
      <label className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
        <input type="checkbox" checked={bogo.repeat} onChange={(e) => p({ repeat: e.target.checked })} /> Repeat -- fire again if the ticket has enough items for another set
      </label>
    </div>
  );
}

function AppliesToPicker({ appliesTo, onChange, services, categories }: {
  appliesTo: AppliesTo; onChange: (a: AppliesTo) => void;
  services: { id: string; name: string }[]; categories: { id: string; name: string; parentId?: string }[];
}) {
  const kinds: { id: AppliesToKind; label: string; disabled?: boolean }[] = [
    { id: "entire_sale", label: "Entire sale" },
    { id: "all_services", label: "All services" },
    { id: "categories", label: "Categories" },
    { id: "services", label: "Specific services" },
    { id: "service_tags", label: "Service tags" },
    { id: "products", label: "Products", disabled: true },
    { id: "packages", label: "Packages", disabled: true },
    { id: "memberships", label: "Memberships", disabled: true },
  ];
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {kinds.map((k) => (
          <button
            key={k.id}
            disabled={k.disabled}
            title={k.disabled ? "Not available yet -- there's no products/packages/memberships module in this build" : undefined}
            onClick={() => onChange({ kind: k.id })}
            className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${appliesTo.kind === k.id ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#E3DDE3] text-slate-500 hover:border-slate-300"} ${k.disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {appliesTo.kind === "categories" && (
        <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[#EDE7EE] p-2">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="checkbox" checked={(appliesTo.categoryIds ?? []).includes(c.id)} onChange={(e) => {
                const cur = new Set(appliesTo.categoryIds ?? []);
                if (e.target.checked) cur.add(c.id); else cur.delete(c.id);
                onChange({ ...appliesTo, categoryIds: [...cur] });
              }} /> {c.parentId ? `— ${c.name}` : c.name}
            </label>
          ))}
        </div>
      )}
      {appliesTo.kind === "services" && (
        <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[#EDE7EE] p-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="checkbox" checked={(appliesTo.serviceIds ?? []).includes(s.id)} onChange={(e) => {
                const cur = new Set(appliesTo.serviceIds ?? []);
                if (e.target.checked) cur.add(s.id); else cur.delete(s.id);
                onChange({ ...appliesTo, serviceIds: [...cur] });
              }} /> {s.name}
            </label>
          ))}
        </div>
      )}
      {appliesTo.kind === "service_tags" && (
        <input
          value={(appliesTo.tags ?? []).join(", ")}
          onChange={(e) => onChange({ ...appliesTo, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
          placeholder="comma-separated tags, e.g. add-on friendly, premium"
          className={`${inputCls} mt-2`}
        />
      )}
    </div>
  );
}

function AdvancedRulesEditor({ advanced, onChange }: { advanced: AdvancedRules; onChange: (a: AdvancedRules) => void }) {
  const staff = useStaffStore();
  const p = (patch: Partial<AdvancedRules>) => onChange({ ...advanced, ...patch });
  const CHANNELS: { id: DiscountChannel; label: string }[] = [
    { id: "front_desk", label: "Front desk" }, { id: "walk_in", label: "Walk-in / POS" }, { id: "online", label: "Online booking" },
  ];

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Min ticket subtotal ($, optional)"><input type="number" min={0} value={advanced.minSubtotal ?? ""} onChange={(e) => p({ minSubtotal: e.target.value ? Number(e.target.value) : undefined })} className={inputCls} /></Field>
        <Field label="Max ticket subtotal ($, optional)"><input type="number" min={0} value={advanced.maxSubtotal ?? ""} onChange={(e) => p({ maxSubtotal: e.target.value ? Number(e.target.value) : undefined })} className={inputCls} /></Field>
        <Field label="Min quantity of eligible items"><input type="number" min={1} value={advanced.minQty ?? 1} onChange={(e) => p({ minQty: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} /></Field>
        <Field label="Priority (lower applies first)"><input type="number" min={1} value={advanced.priority} onChange={(e) => p({ priority: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} /></Field>
      </div>

      <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
        <input type="checkbox" checked={advanced.combinable} onChange={(e) => p({ combinable: e.target.checked })} /> Combinable with other discounts on the same ticket
      </label>

      <Field label="Sales channels (unset = all channels)">
        <div className="flex gap-3">
          {CHANNELS.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="checkbox" checked={(advanced.channels ?? []).includes(c.id)} onChange={(e) => {
                const cur = new Set(advanced.channels ?? []);
                if (e.target.checked) cur.add(c.id); else cur.delete(c.id);
                p({ channels: cur.size > 0 ? [...cur] : undefined });
              }} /> {c.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Redemption limits (optional)">
        <div className="flex gap-2.5">
          <input type="number" min={0} placeholder="Overall" value={advanced.redemptionLimit?.overall ?? ""} onChange={(e) => p({ redemptionLimit: { ...advanced.redemptionLimit, overall: e.target.value ? Number(e.target.value) : undefined } })} className={`${inputCls} w-28`} />
          <input type="number" min={0} placeholder="Per customer" value={advanced.redemptionLimit?.perCustomer ?? ""} onChange={(e) => p({ redemptionLimit: { ...advanced.redemptionLimit, perCustomer: e.target.value ? Number(e.target.value) : undefined } })} className={`${inputCls} w-28`} />
        </div>
      </Field>

      <Field label="Customer eligibility">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <input type="radio" checked={advanced.customerEligibility?.allClients !== false} onChange={() => p({ customerEligibility: undefined })} /> All clients
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <input type="radio" checked={advanced.customerEligibility?.allClients === false && !advanced.customerEligibility?.newClientsOnly} onChange={() => p({ customerEligibility: { allClients: false, tags: [] } })} /> Clients tagged
          </label>
          {advanced.customerEligibility?.allClients === false && !advanced.customerEligibility?.newClientsOnly && (
            <input value={(advanced.customerEligibility?.tags ?? []).join(", ")} onChange={(e) => p({ customerEligibility: { allClients: false, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) } })} placeholder="comma-separated tags, e.g. VIP" className={`${inputCls} ml-5 w-[calc(100%-1.25rem)]`} />
          )}
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <input type="radio" checked={advanced.customerEligibility?.newClientsOnly === true} onChange={() => p({ customerEligibility: { allClients: false, newClientsOnly: true } })} /> New clients only
          </label>
        </div>
      </Field>

      <Field label="Technician targeting (optional -- unset applies to any tech)">
        <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-[#EDE7EE] p-2">
          {staff.roles.map((r) => (
            <label key={r.id} className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="checkbox" checked={(advanced.targeting?.roleIds ?? []).includes(r.id)} onChange={(e) => {
                const cur = new Set(advanced.targeting?.roleIds ?? []);
                if (e.target.checked) cur.add(r.id); else cur.delete(r.id);
                p({ targeting: { ...advanced.targeting, roleIds: cur.size > 0 ? [...cur] : undefined } });
              }} /> {r.name}
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}
