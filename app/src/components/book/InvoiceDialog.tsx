// ─── Invoice / printable receipt ─────────────────────────────────────────────
// Right-click a checked-out appointment → View invoice. Shows the ticket with
// salon branding and prints via the browser (only the receipt prints).
import { Printer, X } from "lucide-react";
import type { Appointment } from "@/lib/booking-types";
import { fmtTime } from "@/lib/booking-types";
import { useSettingsStore } from "@/lib/settings-store";
import { useStaffStore } from "@/lib/staff-store";
import { svcById } from "@/lib/services-store";
import { totalRefunded, type RefundRecord } from "./RefundDialog";

export interface InvoicePayment {
  id: string;
  dateKey: string;
  clientName: string;
  subtotal: number;
  tip: number;
  total: number;
  method: string;
  points: number;
  discount?: number;
  redeemed?: { name: string; points: number; value: number };
  notes?: string;
  party?: number;
  refunds?: RefundRecord[];
}

export function InvoiceDialog({ payment, items, onClose }: {
  payment: InvoicePayment;
  items: Appointment[];
  onClose: () => void;
}) {
  const settings = useSettingsStore();
  const { techs } = useStaffStore();
  const salon = settings.general;
  const money = (v: number) => `$${v.toFixed(2)}`;
  const invoiceNo = `INV-${payment.id.replace(/\D/g, "").slice(-6)}`;
  const dateLabel = new Date(payment.dateKey + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  const refunded = totalRefunded(payment.refunds);
  const refundStamp = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-slate-900/45 p-4">
      {/* only this block prints */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
      <div className="print-area relative w-[400px] max-w-[95vw] rounded-2xl border border-line bg-popover shadow-2xl">
        {/* salon header */}
        <div className="border-b border-dashed border-line px-6 pb-3 pt-5 text-center">
          <h2 className="font-display text-[19px] font-bold tracking-wide">{salon.name}</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">{salon.address}</p>
          <p className="text-[11px] text-ink-faint">{salon.phone}{salon.website ? ` · ${salon.website}` : ""}</p>
        </div>

        {/* invoice meta */}
        <div className="flex items-center justify-between px-6 pt-3 text-[12px]">
          <span className="font-bold">{invoiceNo}</span>
          <span className="tnum text-ink-faint">{dateLabel}</span>
        </div>
        <div className="px-6 pt-1 text-[13px]">
          Client: <b>{payment.clientName}</b>
          {payment.party && payment.party > 1 && <span className="text-ink-faint"> · party of {payment.party}</span>}
        </div>

        {/* line items */}
        <div className="mt-2 border-t border-line/60 px-6 pt-2">
          {items.map((a) => {
            const svc = svcById[a.serviceId];
            const price = (a.priceOverride ?? svc?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0);
            return (
              <div key={a.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {svc?.name ?? a.serviceId}
                    {a.clientName !== payment.clientName && <span className="ml-1 text-[10px] text-ink-faint">({a.clientName})</span>}
                  </p>
                  <p className="text-[10.5px] text-ink-faint">
                    {fmtTime(a.startMin)} · {a.durationMin}m · {techs.find((t) => t.id === a.techId)?.name ?? "Any"}
                    {(a.addons ?? []).length > 0 && ` · +${a.addons!.map((x) => x.name).join(", +")}`}
                  </p>
                  {settings.checkout.serviceFields.some((f) => a.customFields?.[f.id]?.trim()) && (
                    <p className="text-[10.5px] font-medium text-ink-soft">
                      {settings.checkout.serviceFields
                        .filter((f) => a.customFields?.[f.id]?.trim())
                        .map((f) => `${f.label}: ${a.customFields![f.id].trim()}`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <span className="tnum shrink-0 font-semibold">{money(price)}</span>
              </div>
            );
          })}
        </div>

        {/* totals */}
        <div className="mt-2 space-y-1 border-t border-dashed border-line px-6 pt-2.5 text-[13px]">
          <div className="flex justify-between"><span className="text-ink-faint">Subtotal</span><span className="tnum">{money(payment.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-ink-faint">Tip</span><span className="tnum">{money(payment.tip)}</span></div>
          {(payment.discount ?? 0) > 0 && payment.redeemed && (
            <div className="flex justify-between text-violet-500"><span>Redeemed: {payment.redeemed.name}</span><span className="tnum">−{money(payment.discount!)}</span></div>
          )}
          <div className="flex justify-between border-t border-line pt-1.5 text-[15px] font-bold">
            <span>Total</span><span className="tnum">{money(payment.total)}</span>
          </div>
          <div className="flex justify-between text-[12px]"><span className="text-ink-faint">Paid with</span><span className="font-semibold">{payment.method}</span></div>
          <div className="flex justify-between text-[11px] text-ink-faint"><span>Loyalty earned</span><span>+{payment.points.toLocaleString()} pts</span></div>
          {payment.notes && <p className="pt-1 text-[11px] italic text-ink-faint">{payment.notes}</p>}
        </div>

        {(payment.refunds ?? []).length > 0 && (
          <div className="mt-2 space-y-1 border-t border-dashed border-line px-6 pt-2.5 text-[12px]">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Refunds</p>
            {payment.refunds!.map((r) => (
              <div key={r.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-ink-soft">
                  {refundStamp(r.at)}, {r.type === "service" ? "services" : "tip"}
                  {r.reason && <span className="text-ink-faint"> · {r.reason}</span>}
                </span>
                <span className="tnum shrink-0 font-semibold text-rust">−{money(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-1.5 text-[13.5px] font-bold">
              <span>Net paid</span><span className="tnum">{money(payment.total - refunded)}</span>
            </div>
          </div>
        )}

        <p className="px-6 pb-3 pt-3 text-center text-[11px] text-ink-faint">Thank you for visiting {salon.name}!</p>

        {/* actions (hidden in print via visibility of parent) */}
        <div className="flex gap-2 border-t border-line px-6 py-3.5">
          <button
            onClick={() => window.print()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-clay-deep"
          >
            <Printer className="h-4 w-4" /> Print receipt
          </button>
          <button
            onClick={onClose}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-line text-ink-soft transition-colors hover:bg-cream"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
