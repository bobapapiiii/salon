// ─── Tech portal, a technician's own view ───────────────────────────────────
// Their appointments for the day, day stats (services, value, commission), and
// tips earned per client (allocated pro-rata from each ticket's tip).
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LogOut, Sparkles } from "lucide-react";
import type { Appointment, Tech } from "@/lib/booking-types";
import { fmtTime } from "@/lib/booking-types";
import { useStaffStore } from "@/lib/staff-store";
import { sdata, usePersistentState } from "@/lib/persist";
import { svcById } from '@/lib/services-store'


interface PaymentRec {
  id: string;
  dateKey: string;
  clientName: string;
  subtotal: number;
  tip: number;
  total: number;
  method: string;
  lines?: { techId: string; price: number }[];
  tipByTech?: { techId: string; amount: number }[];
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  booked: { label: "Booked", cls: "bg-amber-100 text-amber-700" },
  requested: { label: "Requested", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-700" },
  checked_in: { label: "Checked in", cls: "bg-violet-100 text-violet-700" },
  in_service: { label: "In service", cls: "bg-violet-100 text-violet-700" },
  completed: { label: "Completed", cls: "bg-slate-100 text-slate-500" },
  no_show: { label: "No-show", cls: "bg-rose-100 text-rose-600" },
};

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TechPortal({ tech, onSignOut }: { tech: Tech; onSignOut: () => void }) {
  const { roles } = useStaffStore();
  const [date, setDate] = useState(() => new Date());
  const key = dayKey(date);
  const [apptDays] = usePersistentState<Record<string, Appointment[]>>(sdata("appts-v1"), {});
  const [payments] = usePersistentState<PaymentRec[]>(sdata("payments-v1"), []);

  const roleName = roles.find((r) => r.id === tech.teamId)?.name ?? "Technician";
  const myAppts = useMemo(
    () => (apptDays[key] ?? []).filter((a) => a.techId === tech.id).sort((a, b) => a.startMin - b.startMin),
    [apptDays, key, tech.id],
  )
  const doneAppts = myAppts.filter((a) => a.status !== "requested" && a.status !== "no_show");
  const dayValue = doneAppts.reduce((s, a) => s + (a.priceOverride ?? svcById[a.serviceId]?.price ?? 0), 0);
  const commission = (dayValue * (tech.commissionPct ?? 0)) / 100;

  // tips: the checkout's recorded split wins, older tickets fall back to pro-rata
  const myTips = useMemo(() => {
    const rows: { client: string; amount: number; method: string }[] = [];
    for (const p of payments) {
      if (p.dateKey !== key || p.tip <= 0) continue;
      if (p.tipByTech && p.tipByTech.length > 0) {
        const mine = p.tipByTech.filter((t) => t.techId === tech.id).reduce((s, t) => s + t.amount, 0);
        if (mine > 0) rows.push({ client: p.clientName, amount: mine, method: p.method });
        continue;
      }
      if (!p.lines || p.subtotal <= 0) continue;
      const mine = p.lines.filter((l) => l.techId === tech.id).reduce((s, l) => s + l.price, 0);
      if (mine > 0) rows.push({ client: p.clientName, amount: (p.tip * mine) / p.subtotal, method: p.method });
    }
    return rows;
  }, [payments, key, tech.id]);
  const tipTotal = myTips.reduce((s, r) => s + r.amount, 0);

  const money = (v: number) => `$${v.toFixed(2)}`;
  const label = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* header */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-clay-tint text-[14px] font-extrabold text-clay">
            {tech.initials}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-bold text-ink">{tech.name}</h1>
            <p className="text-[11.5px] text-ink-faint">{roleName} · {tech.commissionPct ?? 0}% commission</p>
          </div>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
        {/* day nav */}
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-ink-faint" />
          <span className="text-[14px] font-bold text-ink">{label}</span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-cream">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setDate(new Date())} className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-bold text-ink-soft hover:bg-cream">Today</button>
            <button onClick={() => setDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-cream">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* stat cards */}
        <div className="grid grid-cols-4 gap-2.5">
          {[
            { label: "Services", value: String(doneAppts.length) },
            { label: "Booked value", value: money(dayValue) },
            { label: "Est. commission", value: money(commission) },
            { label: "Tips", value: money(tipTotal) },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-line bg-surface p-3.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{c.label}</p>
              <p className="tnum mt-1 text-[19px] font-extrabold text-ink">{c.value}</p>
            </div>
          ))}
        </div>

        {/* appointments */}
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <p className="border-b border-line bg-cream/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            My appointments · {myAppts.length}
          </p>
          {myAppts.length === 0 && <p className="px-4 py-8 text-center text-[12.5px] text-ink-faint">Nothing booked this day.</p>}
          {myAppts.map((a) => {
            const svc = svcById[a.serviceId];
            const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.confirmed;
            return (
              <div key={a.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                <span className="tnum w-16 shrink-0 text-[13px] font-bold text-ink">{fmtTime(a.startMin)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{a.clientName}</p>
                  <p className="truncate text-[11px] text-ink-faint">{svc?.name ?? a.serviceId} · {a.durationMin}m</p>
                </div>
                <span className="tnum shrink-0 text-[12.5px] font-semibold text-ink-soft">{money(a.priceOverride ?? svc?.price ?? 0)}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${st.cls}`}>{st.label}</span>
              </div>
            );
          })}
        </div>

        {/* tips per client */}
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <p className="flex items-center gap-1.5 border-b border-line bg-cream/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            <Sparkles className="h-3 w-3 text-clay" /> Tips per client · {money(tipTotal)}
          </p>
          {myTips.length === 0 && <p className="px-4 py-8 text-center text-[12.5px] text-ink-faint">No tips recorded this day yet.</p>}
          {myTips.map((r, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{r.client}</span>
              <span className="text-[11px] text-ink-faint">{r.method}</span>
              <span className="tnum shrink-0 text-[13px] font-bold text-olive">+{money(r.amount)}</span>
            </div>
          ))}
        </div>

        <p className="pb-4 text-center text-[10.5px] text-ink-faint">
          Tips are your share of each ticket's tip, split by service value. Reports get richer as the salon checks out more clients.
        </p>
      </div>
    </div>
  );
}
