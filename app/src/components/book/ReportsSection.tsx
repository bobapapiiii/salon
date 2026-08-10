// ─── Reports, salon analytics drawn from the book's own data ────────────────
// Sources: completed checkouts (payments-v1), the appointment book itself
// (appts-v1), and the client list (clients-v1). Everything computes live from
// whatever date range is picked, so it stays honest as the salon works.
import { useMemo, useState } from "react";
import type { Appointment } from "../../lib/booking-types";
import { OPEN_MIN, fmtTime } from "../../lib/booking-types";
import { sdata, usePersistentState } from "../../lib/persist";
import { svcById } from "../../lib/services-store";
import { catById } from "../../lib/categories-store";
import { roleColor, useStaffStore } from "../../lib/staff-store";

// ── data shapes ──────────────────────────────────────────────────────────────
interface PaymentRec {
  id: string;
  dateKey: string;
  clientName: string;
  itemCount: number;
  subtotal: number;
  tip: number;
  total: number;
  method: string;
  points: number;
  notes?: string;
  pos?: boolean;
  party?: number;
  discount?: number;
  redeemed?: { name: string; points: number; value: number };
  lines?: { techId: string; price: number }[];
  apptIds?: string[];
  tipByTech?: { techId: string; amount: number }[];
}
interface ClientRec {
  id: string;
  name: string;
  phone: string;
  visits: number;
  guests?: { id: string; name: string }[];
}

// ── date helpers ─────────────────────────────────────────────────────────────
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (key: string) => new Date(key + "T12:00:00");
const addDays = (key: string, n: number) => {
  const d = dateOf(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};
function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  let k = from;
  let guard = 0;
  while (k <= to && guard < 370) {
    out.push(k);
    k = addDays(k, 1);
    guard++;
  }
  return out;
}
const dayLabel = (key: string) =>
  dateOf(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Preset = "today" | "yesterday" | "week" | "lastweek" | "month" | "lastmonth" | "30d" | "all" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "lastweek", label: "Last week" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];
function presetRange(p: Preset, today: string): { from: string; to: string } {
  switch (p) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "week": {
      const dow = dateOf(today).getDay();
      return { from: addDays(today, -dow), to: today };
    }
    case "lastweek": {
      const dow = dateOf(today).getDay();
      return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) };
    }
    case "month": return { from: today.slice(0, 8) + "01", to: today };
    case "lastmonth": {
      const first = dateOf(today.slice(0, 8) + "01");
      first.setMonth(first.getMonth() - 1);
      const from = keyOf(first);
      const next = new Date(first);
      next.setMonth(next.getMonth() + 1);
      next.setDate(0);
      return { from, to: keyOf(next) };
    }
    case "30d": return { from: addDays(today, -29), to: today };
    case "all": return { from: "2000-01-01", to: "2100-01-01" };
    case "custom": return { from: today, to: today };
  }
}

// ── formatting ───────────────────────────────────────────────────────────────
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = (mins: number) => `${(mins / 60).toFixed(1)}h`;

// ── small UI pieces ──────────────────────────────────────────────────────────
const card = "rounded-xl border border-[#EDE7EE] bg-white p-4";
const th = "px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-400";
const td = "px-3 py-2 text-[12.5px] text-slate-700";
const tdn = "px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums text-slate-800";

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className={card}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: accent ?? "#1E293B" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
function ShareBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}
function VBars({ data, color }: { data: { label: string; title?: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-36 items-end gap-1">
      {data.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={d.title ?? `${d.label}: ${d.value}`}>
          <div className="flex h-28 w-full items-end justify-center">
            <div
              className="w-full max-w-7 rounded-t-md transition-all"
              style={{ height: `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * 100)}%`, background: color }}
            />
          </div>
          <span className="w-full truncate text-center text-[9.5px] text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className={`${card} py-10 text-center text-[12.5px] text-slate-400`}>{text}</div>;
}

type Tab = "overview" | "revenue" | "techs" | "services" | "clients" | "appts";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "revenue", label: "Revenue" },
  { id: "techs", label: "Technicians" },
  { id: "services", label: "Services" },
  { id: "clients", label: "Clients" },
  { id: "appts", label: "Appointments" },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  booked: { label: "Booked", color: "#D99B26" },
  requested: { label: "Requested", color: "#D99B26" },
  confirmed: { label: "Confirmed", color: "#2FA883" },
  checked_in: { label: "Checked in", color: "#6B4FC4" },
  in_service: { label: "In service", color: "#6B4FC4" },
  completed: { label: "Checked out", color: "#64748B" },
  no_show: { label: "No-show", color: "#B3402F" },
};
const apptPrice = (a: Appointment) =>
  (a.priceOverride ?? svcById[a.serviceId]?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0);

export function ReportsSection() {
  const today = keyOf(new Date());
  const [preset, setPreset] = useState<Preset>("week");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: addDays(today, -6), to: today });
  const [tab, setTab] = useState<Tab>("overview");
  const [techSort, setTechSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "sales", dir: -1 });

  const [payments] = usePersistentState<PaymentRec[]>(sdata("payments-v1"), []);
  const [apptDays] = usePersistentState<Record<string, Appointment[]>>(sdata("appts-v1"), {});
  const [clients] = usePersistentState<ClientRec[]>(sdata("clients-v1"), []);
  const staff = useStaffStore();

  const range = preset === "custom" ? custom : presetRange(preset, today);
  const days = useMemo(() => listDays(range.from, range.to), [range.from, range.to]);
  const pays = useMemo(
    () => payments.filter((p) => p.dateKey >= range.from && p.dateKey <= range.to),
    [payments, range.from, range.to],
  );
  const appts = useMemo(() => {
    const out: Appointment[] = [];
    for (const k of days) for (const a of apptDays[k] ?? []) out.push(a);
    return out;
  }, [apptDays, days]);
  const completed = useMemo(() => appts.filter((a) => a.status === "completed"), [appts]);

  // ── core money math ────────────────────────────────────────────────────────
  const sums = useMemo(() => {
    const sales = pays.reduce((s, p) => s + p.subtotal, 0);
    const tips = pays.reduce((s, p) => s + p.tip, 0);
    const total = pays.reduce((s, p) => s + p.total, 0);
    const discounts = pays.reduce((s, p) => s + (p.discount ?? 0), 0);
    const redeemedVal = pays.reduce((s, p) => s + (p.redeemed?.value ?? 0), 0);
    const pointsEarned = pays.reduce((s, p) => s + (p.points ?? 0), 0);
    const pointsRedeemed = pays.reduce((s, p) => s + (p.redeemed?.points ?? 0), 0);
    const services = pays.reduce((s, p) => s + p.itemCount, 0);
    const tickets = pays.length;
    return { sales, tips, total, discounts, redeemedVal, pointsEarned, pointsRedeemed, services, tickets };
  }, [pays]);

  // per-day revenue for charts + the revenue table
  const byDay = useMemo(() => {
    const map = new Map(days.map((k) => [k, { tickets: 0, services: 0, sales: 0, tips: 0, total: 0, discounts: 0 }]));
    for (const p of pays) {
      const r = map.get(p.dateKey);
      if (!r) continue;
      r.tickets++;
      r.services += p.itemCount;
      r.sales += p.subtotal;
      r.tips += p.tip;
      r.total += p.total;
      r.discounts += (p.discount ?? 0) + (p.redeemed?.value ?? 0);
    }
    return map;
  }, [days, pays]);

  // per-tech rollup: sales + tips pro-rata from payment lines, work from the book
  const techRows = useMemo(() => {
    const rows = new Map<string, {
      id: string; name: string; roleId: string; services: number; mins: number; sales: number; tips: number;
      requested: number; noShows: number; schedMins: number; firstAvailable: number;
    }>();
    const ensure = (id: string) => {
      let r = rows.get(id);
      if (!r) {
        const t = staff.techs.find((x) => x.id === id);
        r = { id, name: t?.name ?? "Unassigned", roleId: t?.teamId ?? "", services: 0, mins: 0, sales: 0, tips: 0, requested: 0, noShows: 0, schedMins: 0, firstAvailable: 0 };
        rows.set(id, r);
      }
      return r;
    };
    for (const p of pays) {
      for (const l of p.lines ?? []) {
        const r = ensure(l.techId);
        r.sales += l.price;
      }
      // tip: the checkout's recorded split wins, older tickets fall back to pro-rata
      if (p.tip > 0) {
        if (p.tipByTech && p.tipByTech.length > 0) {
          for (const t of p.tipByTech) ensure(t.techId).tips += t.amount;
        } else if (p.subtotal > 0) {
          for (const l of p.lines ?? []) ensure(l.techId).tips += (p.tip * l.price) / p.subtotal;
        }
      }
    }
    for (const a of completed) {
      const r = ensure(a.techId);
      r.services++;
      r.mins += a.durationMin + (a.addons ?? []).reduce((x, ad) => x + ad.mins, 0);
      if (a.techRequested) r.requested++;
      if (a.requestedTechChoice === "first") r.firstAvailable++;
    }
    for (const a of appts) {
      if (a.status === "no_show") ensure(a.techId).noShows++;
    }
    // scheduled minutes across the range, from each tech's permanent schedule
    for (const t of staff.techs) {
      const r = rows.get(t.id);
      if (!r) continue;
      for (const k of days) {
        const wd = t.weeklySchedule?.[dateOf(k).getDay()];
        if (wd && !wd.off) r.schedMins += Math.max(0, (wd.endMin ?? 720) - (wd.startMin ?? 0));
      }
    }
    return [...rows.values()];
  }, [pays, completed, appts, days, staff.techs]);

  // per-service rollup from completed appointments
  const svcRows = useMemo(() => {
    const map = new Map<string, { id: string; count: number; revenue: number; mins: number }>();
    for (const a of completed) {
      let r = map.get(a.serviceId);
      if (!r) { r = { id: a.serviceId, count: 0, revenue: 0, mins: 0 }; map.set(a.serviceId, r); }
      r.count++;
      r.revenue += apptPrice(a);
      r.mins += a.durationMin;
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [completed]);
  const addonRows = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    for (const a of completed) {
      for (const ad of a.addons ?? []) {
        let r = map.get(ad.id);
        if (!r) { r = { name: ad.name, count: 0, revenue: 0 }; map.set(ad.id, r); }
        r.count++;
        r.revenue += ad.price;
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [completed]);

  // per-client rollup
  const clientRows = useMemo(() => {
    const map = new Map<string, { name: string; tickets: number; services: number; spend: number; tips: number; last: string }>();
    for (const p of pays) {
      let r = map.get(p.clientName);
      if (!r) { r = { name: p.clientName, tickets: 0, services: 0, spend: 0, tips: 0, last: p.dateKey }; map.set(p.clientName, r); }
      r.tickets++;
      r.services += p.itemCount;
      r.spend += p.total;
      r.tips += p.tip;
      if (p.dateKey > r.last) r.last = p.dateKey;
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [pays]);
  const firstTimeCount = useMemo(() => {
    // a client is "first time" in range when their earliest ticket ever is in range
    const firstEver = new Map<string, string>();
    for (const p of payments) {
      const cur = firstEver.get(p.clientName);
      if (!cur || p.dateKey < cur) firstEver.set(p.clientName, p.dateKey);
    }
    let n = 0;
    for (const [, k] of firstEver) if (k >= range.from && k <= range.to) n++;
    return n;
  }, [payments, range.from, range.to]);
  const guestVisitCount = useMemo(() => completed.filter((a) => a.guestOf).length, [completed]);

  // appointment-mix stats
  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of appts) map.set(a.status, (map.get(a.status) ?? 0) + 1);
    return map;
  }, [appts]);
  const hourCounts = useMemo(() => {
    const arr = Array.from({ length: 13 }, () => 0); // 8 AM to 8 PM
    for (const a of appts) {
      const h = Math.floor((OPEN_MIN + a.startMin) / 60) - 8;
      if (h >= 0 && h < arr.length) arr[h]++;
    }
    return arr;
  }, [appts]);
  const weekdayCounts = useMemo(() => {
    const arr = [0, 0, 0, 0, 0, 0, 0];
    for (const k of days) arr[dateOf(k).getDay()] += (apptDays[k] ?? []).length;
    return arr;
  }, [days, apptDays]);
  const bookingMix = useMemo(() => {
    let requested = 0, pref = 0, any = 0;
    for (const a of appts) {
      if (a.techRequested) requested++;
      else if (a.requestedTechChoice === "pref-female" || a.requestedTechChoice === "pref-male") pref++;
      else any++;
    }
    return { requested, pref, any };
  }, [appts]);
  const parallelGroups = useMemo(() => new Set(appts.map((a) => a.parallelGroup).filter(Boolean)).size, [appts]);
  const partyTickets = useMemo(() => pays.filter((p) => (p.party ?? 0) > 1).length, [pays]);

  const busy = pays.length === 0 && appts.length === 0;
  const sortTech = (key: string) =>
    setTechSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  const techVal = (r: (typeof techRows)[number], key: string): number => {
    switch (key) {
      case "services": return r.services;
      case "mins": return r.mins;
      case "sales": return r.sales;
      case "tips": return r.tips;
      case "commission": return r.sales * ((staff.techs.find((t) => t.id === r.id)?.commissionPct ?? 0) / 100);
      case "util": return r.schedMins > 0 ? r.mins / r.schedMins : 0;
      case "requested": return r.requested;
      case "noShows": return r.noShows;
      default: return r.sales;
    }
  };
  const sortedTechs = [...techRows].sort((a, b) => {
    if (techSort.key === "name") return techSort.dir * a.name.localeCompare(b.name);
    return techSort.dir * (techVal(a, techSort.key) - techVal(b, techSort.key));
  });
  const sortHead = (key: string, label: string, align: "l" | "r" = "r") => (
    <th
      className={`${th} cursor-pointer select-none hover:text-slate-600 ${align === "r" ? "text-right" : ""}`}
      onClick={() => sortTech(key)}
    >
      {label}{techSort.key === key ? (techSort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );

  const rangeLabel = preset === "custom" ? `${dayLabel(range.from)} to ${dayLabel(range.to)}` : PRESETS.find((p) => p.id === preset)?.label;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[17px] font-bold text-slate-900">Reports</h2>
        <p className="text-[12px] text-slate-400">Live numbers from the appointment book, checkout, and client list.</p>
      </div>

      {/* range picker */}
      <div className={`${card} mb-4`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                preset === p.id ? "bg-[#5B54D6] text-white" : "bg-[#F4F0F5] text-slate-600 hover:bg-[#EBE5EC]"
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <span className="ml-1 flex items-center gap-1.5">
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="rounded-lg border border-[#E3DDE3] px-2 py-1 text-[12px] outline-none focus:border-[#5B54D6]" />
              <span className="text-[11px] text-slate-400">to</span>
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="rounded-lg border border-[#E3DDE3] px-2 py-1 text-[12px] outline-none focus:border-[#5B54D6]" />
            </span>
          )}
          <span className="ml-auto text-[11.5px] font-semibold text-slate-400">
            {dayLabel(range.from)}{range.from !== range.to ? ` to ${dayLabel(range.to)}` : ""} · {days.length} {days.length === 1 ? "day" : "days"}
          </span>
        </div>
      </div>

      {/* tabs */}
      <div className="mb-4 flex gap-1 border-b border-[#EDE7EE]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-[12.5px] font-semibold transition ${
              tab === t.id ? "bg-[#5B54D6]/[0.07] text-[#5B54D6] shadow-[inset_0_-2px_0_#5B54D6]" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {busy && <Empty text={`No activity recorded for ${rangeLabel}. Checkouts and appointments show up here as the salon works.`} />}

      {!busy && tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Gross collected" value={money2(sums.total)} sub={`${sums.tickets} ${sums.tickets === 1 ? "ticket" : "tickets"}`} accent="#5B54D6" />
            <Kpi label="Service sales" value={money2(sums.sales)} sub={`${sums.services} services`} />
            <Kpi label="Tips" value={money2(sums.tips)} sub={sums.sales > 0 ? `${((sums.tips / sums.sales) * 100).toFixed(1)}% of sales` : undefined} accent="#2FA883" />
            <Kpi label="Avg ticket" value={money2(sums.tickets > 0 ? sums.total / sums.tickets : 0)} sub={`${money2(sums.services > 0 ? sums.sales / sums.services : 0)} per service`} />
            <Kpi label="Clients served" value={String(clientRows.length)} sub={`${firstTimeCount} first time`} />
            <Kpi label="Appointments" value={String(appts.length)} sub={`${statusCounts.get("no_show") ?? 0} no-show`} />
            <Kpi label="Discounts given" value={money2(sums.discounts + sums.redeemedVal)} sub={sums.redeemedVal > 0 ? `${money2(sums.redeemedVal)} loyalty` : undefined} accent="#B3402F" />
            <Kpi label="Points earned" value={String(sums.pointsEarned)} sub={`${sums.pointsRedeemed} redeemed`} />
          </div>

          <div className={card}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[13px] font-bold text-slate-800">Collected per day</h3>
              <span className="text-[11px] text-slate-400">{money2(sums.total)} total</span>
            </div>
            <VBars
              color="#5B54D6"
              data={days.map((k) => ({
                label: days.length > 14 ? dateOf(k).getDate().toString() : dayLabel(k).split(",")[0],
                title: `${dayLabel(k)}: ${money2(byDay.get(k)?.total ?? 0)} across ${byDay.get(k)?.tickets ?? 0} tickets`,
                value: byDay.get(k)?.total ?? 0,
              }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Top services by revenue</h3>
              {svcRows.slice(0, 5).map((r) => {
                const svc = svcById[r.id];
                const max = svcRows[0]?.revenue ?? 1;
                return (
                  <div key={r.id} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: svc ? catById[svc.categoryId]?.line : "#CBD5E1" }} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{svc?.name ?? r.id}</span>
                    <span className="text-[11px] tabular-nums text-slate-400">{r.count}</span>
                    <ShareBar pct={(r.revenue / max) * 100} color={svc ? catById[svc.categoryId]?.line ?? "#5B54D6" : "#5B54D6"} />
                    <span className="w-16 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{money(r.revenue)}</span>
                  </div>
                );
              })}
              {svcRows.length === 0 && <p className="text-[12px] text-slate-400">No completed services in this range.</p>}
            </div>
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Top technicians by sales</h3>
              {sortedTechs.filter((r) => r.sales > 0).slice(0, 5).map((r) => {
                const max = sortedTechs[0]?.sales ?? 1;
                return (
                  <div key={r.id} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: roleColor(staff.roles, r.roleId) }} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{r.name}</span>
                    <span className="text-[11px] tabular-nums text-slate-400">{r.services} svc</span>
                    <ShareBar pct={(r.sales / max) * 100} color="#2FA883" />
                    <span className="w-16 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{money(r.sales)}</span>
                  </div>
                );
              })}
              {techRows.every((r) => r.sales === 0) && <p className="text-[12px] text-slate-400">No checked out sales in this range.</p>}
            </div>
          </div>
        </div>
      )}

      {!busy && tab === "revenue" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Gross collected" value={money2(sums.total)} accent="#5B54D6" />
            <Kpi label="Service sales" value={money2(sums.sales)} />
            <Kpi label="Tips collected" value={money2(sums.tips)} accent="#2FA883" />
            <Kpi label="Discounts & redemptions" value={money2(sums.discounts + sums.redeemedVal)} accent="#B3402F" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Payment methods</h3>
              {(() => {
                const map = new Map<string, { tickets: number; total: number }>();
                for (const p of pays) {
                  const r = map.get(p.method) ?? { tickets: 0, total: 0 };
                  r.tickets++;
                  r.total += p.total;
                  map.set(p.method, r);
                }
                const rows = [...map.entries()].sort((a, b) => b[1].total - a[1].total);
                const max = rows[0]?.[1].total ?? 1;
                return rows.map(([m, r]) => (
                  <div key={m} className="mb-2 flex items-center gap-2.5">
                    <span className="w-24 truncate text-[12.5px] text-slate-700">{m}</span>
                    <span className="text-[11px] tabular-nums text-slate-400">{r.tickets}</span>
                    <ShareBar pct={(r.total / max) * 100} color="#5B54D6" />
                    <span className="ml-auto w-20 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{money2(r.total)}</span>
                    <span className="w-12 text-right text-[11px] tabular-nums text-slate-400">{sums.total > 0 ? `${((r.total / sums.total) * 100).toFixed(0)}%` : ""}</span>
                  </div>
                ));
              })()}
            </div>
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Ticket type & loyalty</h3>
              {(() => {
                const pos = pays.filter((p) => p.pos);
                const appt = pays.filter((p) => !p.pos);
                const row = (label: string, a: string, b: string) => (
                  <div key={label} className="flex items-center justify-between border-b border-[#F4F0F5] py-2 last:border-0">
                    <span className="text-[12.5px] text-slate-600">{label}</span>
                    <span className="text-[12.5px] font-semibold tabular-nums text-slate-800">{a}<span className="ml-2 text-[11px] font-normal text-slate-400">{b}</span></span>
                  </div>
                );
                return (
                  <>
                    {row("Appointment checkouts", money2(appt.reduce((s, p) => s + p.total, 0)), `${appt.length} tickets`)}
                    {row("POS sales", money2(pos.reduce((s, p) => s + p.total, 0)), `${pos.length} tickets`)}
                    {row("Party tickets", money2(pays.filter((p) => (p.party ?? 0) > 1).reduce((s, p) => s + p.total, 0)), `${partyTickets} tickets`)}
                    {row("Loyalty points earned", String(sums.pointsEarned), "points")}
                    {row("Loyalty redemptions", money2(sums.redeemedVal), `${sums.pointsRedeemed} points`)}
                    {row("Discounts", money2(sums.discounts), "manual")}
                  </>
                );
              })()}
            </div>
          </div>

          <div className={card}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[13px] font-bold text-slate-800">Revenue by hour</h3>
              <span className="text-[11px] text-slate-400">completed services, by start time</span>
            </div>
            <VBars
              color="#2FA883"
              data={hourCounts.map((_, h) => {
                const v = completed
                  .filter((a) => Math.floor((OPEN_MIN + a.startMin) / 60) === h + 8)
                  .reduce((s, a) => s + apptPrice(a), 0);
                return { label: fmtTime(h * 60).replace(":00", ""), title: `${fmtTime(h * 60)}: ${money2(v)}`, value: v };
              })}
            />
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Day</th>
                  <th className={`${th} text-right`}>Tickets</th>
                  <th className={`${th} text-right`}>Services</th>
                  <th className={`${th} text-right`}>Sales</th>
                  <th className={`${th} text-right`}>Tips</th>
                  <th className={`${th} text-right`}>Discounts</th>
                  <th className={`${th} text-right`}>Collected</th>
                </tr>
              </thead>
              <tbody>
                {days.map((k) => {
                  const r = byDay.get(k)!;
                  return (
                    <tr key={k} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                      <td className={`${td} font-medium`}>{dayLabel(k)}</td>
                      <td className={tdn}>{r.tickets || ""}</td>
                      <td className={tdn}>{r.services || ""}</td>
                      <td className={tdn}>{r.sales > 0 ? money2(r.sales) : ""}</td>
                      <td className={tdn}>{r.tips > 0 ? money2(r.tips) : ""}</td>
                      <td className={tdn}>{r.discounts > 0 ? money2(r.discounts) : ""}</td>
                      <td className={`${tdn} text-[#5B54D6]`}>{r.total > 0 ? money2(r.total) : ""}</td>
                    </tr>
                  );
                })}
                <tr className="bg-[#FAF8FA] font-bold">
                  <td className={td}>Total</td>
                  <td className={tdn}>{sums.tickets}</td>
                  <td className={tdn}>{sums.services}</td>
                  <td className={tdn}>{money2(sums.sales)}</td>
                  <td className={tdn}>{money2(sums.tips)}</td>
                  <td className={tdn}>{money2(sums.discounts + sums.redeemedVal)}</td>
                  <td className={`${tdn} text-[#5B54D6]`}>{money2(sums.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!busy && tab === "techs" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Techs with sales" value={String(techRows.filter((r) => r.sales > 0).length)} sub={`of ${staff.techs.length} on roster`} />
            <Kpi label="Avg sales per tech" value={money2(techRows.length > 0 ? sums.sales / Math.max(1, techRows.filter((r) => r.sales > 0).length) : 0)} />
            <Kpi label="Tips to techs" value={money2(sums.tips)} sub="pro-rata by service value" accent="#2FA883" />
            <Kpi label="Commission est" value={money2(techRows.reduce((s, r) => s + techVal(r, "commission"), 0))} sub="from each tech's rate" accent="#6B4FC4" />
          </div>
          <div className={`${card} overflow-x-auto p-0`}>
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={`${th} cursor-pointer select-none hover:text-slate-600`} onClick={() => sortTech("name")}>
                    Technician{techSort.key === "name" ? (techSort.dir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                  {sortHead("services", "Services")}
                  {sortHead("mins", "Hours")}
                  {sortHead("sales", "Sales")}
                  {sortHead("tips", "Tips")}
                  {sortHead("commission", "Commission")}
                  {sortHead("util", "Utilization")}
                  {sortHead("requested", "Requested")}
                  {sortHead("noShows", "No-shows")}
                </tr>
              </thead>
              <tbody>
                {sortedTechs.map((r) => {
                  const t = staff.techs.find((x) => x.id === r.id);
                  const role = staff.roles.find((x) => x.id === r.roleId);
                  return (
                    <tr key={r.id} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                      <td className={td}>
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: roleColor(staff.roles, r.roleId) }} />
                          <span>
                            <span className="block text-[12.5px] font-semibold text-slate-800">{r.name}</span>
                            <span className="block text-[10.5px] text-slate-400">{role?.name ?? ""}{t?.commissionPct != null ? ` · ${t.commissionPct}%` : ""}</span>
                          </span>
                        </span>
                      </td>
                      <td className={tdn}>{r.services || ""}</td>
                      <td className={tdn}>{r.mins > 0 ? hours(r.mins) : ""}</td>
                      <td className={tdn}>{r.sales > 0 ? money2(r.sales) : ""}</td>
                      <td className={tdn}>{r.tips > 0 ? money2(r.tips) : ""}</td>
                      <td className={tdn}>{r.sales > 0 ? money2(techVal(r, "commission")) : ""}</td>
                      <td className={tdn}>{r.schedMins > 0 ? `${((r.mins / r.schedMins) * 100).toFixed(0)}%` : ""}</td>
                      <td className={tdn}>{r.requested || ""}</td>
                      <td className={`${tdn} ${r.noShows > 0 ? "text-[#B3402F]" : ""}`}>{r.noShows || ""}</td>
                    </tr>
                  );
                })}
                {sortedTechs.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={9}>No technician activity in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Sales and tips come from checkout lines, tips split pro-rata by each tech's share of the ticket. Utilization is booked hours against the tech's permanent weekly schedule. Commission uses the rate set in Technician settings.
          </p>
        </div>
      )}

      {!busy && tab === "services" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Services performed" value={String(completed.length)} />
            <Kpi label="Service revenue" value={money2(svcRows.reduce((s, r) => s + r.revenue, 0))} accent="#5B54D6" />
            <Kpi label="Add-on revenue" value={money2(addonRows.reduce((s, r) => s + r.revenue, 0))} sub={`${addonRows.reduce((s, r) => s + r.count, 0)} add-ons`} accent="#2FA883" />
            <Kpi label="Avg service value" value={money2(completed.length > 0 ? svcRows.reduce((s, r) => s + r.revenue, 0) / completed.length : 0)} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">By category</h3>
              {(() => {
                const map = new Map<string, { count: number; revenue: number }>();
                for (const r of svcRows) {
                  const cid = svcById[r.id]?.categoryId ?? "";
                  const cur = map.get(cid) ?? { count: 0, revenue: 0 };
                  cur.count += r.count;
                  cur.revenue += r.revenue;
                  map.set(cid, cur);
                }
                const rows = [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
                const total = rows.reduce((s, [, r]) => s + r.revenue, 0);
                return rows.map(([cid, r]) => (
                  <div key={cid || "none"} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: catById[cid]?.line ?? "#CBD5E1" }} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{catById[cid]?.name ?? "Uncategorized"}</span>
                    <span className="text-[11px] tabular-nums text-slate-400">{r.count}</span>
                    <ShareBar pct={total > 0 ? (r.revenue / total) * 100 : 0} color={catById[cid]?.line ?? "#5B54D6"} />
                    <span className="w-16 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{money(r.revenue)}</span>
                    <span className="w-10 text-right text-[11px] tabular-nums text-slate-400">{total > 0 ? `${((r.revenue / total) * 100).toFixed(0)}%` : ""}</span>
                  </div>
                ));
              })()}
              {svcRows.length === 0 && <p className="text-[12px] text-slate-400">No completed services in this range.</p>}
            </div>
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Add-ons</h3>
              {addonRows.map((r) => (
                <div key={r.name} className="flex items-center justify-between border-b border-[#F4F0F5] py-2 last:border-0">
                  <span className="text-[12.5px] text-slate-700">{r.name}</span>
                  <span className="text-[12.5px] font-semibold tabular-nums text-slate-800">{money2(r.revenue)}<span className="ml-2 text-[11px] font-normal text-slate-400">{r.count} sold</span></span>
                </div>
              ))}
              {addonRows.length === 0 && <p className="text-[12px] text-slate-400">No add-ons sold in this range.</p>}
            </div>
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Service</th>
                  <th className={`${th} text-right`}>Done</th>
                  <th className={`${th} text-right`}>Hours</th>
                  <th className={`${th} text-right`}>Revenue</th>
                  <th className={`${th} text-right`}>Avg price</th>
                  <th className={`${th} text-right`}>Share</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const total = svcRows.reduce((s, r) => s + r.revenue, 0);
                  return svcRows.map((r) => {
                    const svc = svcById[r.id];
                    return (
                      <tr key={r.id} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                        <td className={td}>
                          <span className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: svc ? catById[svc.categoryId]?.line : "#CBD5E1" }} />
                            <span className="text-[12.5px] font-medium text-slate-800">{svc?.name ?? r.id}</span>
                          </span>
                        </td>
                        <td className={tdn}>{r.count}</td>
                        <td className={tdn}>{hours(r.mins)}</td>
                        <td className={tdn}>{money2(r.revenue)}</td>
                        <td className={tdn}>{money2(r.revenue / r.count)}</td>
                        <td className={tdn}>{total > 0 ? `${((r.revenue / total) * 100).toFixed(1)}%` : ""}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!busy && tab === "clients" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Clients served" value={String(clientRows.length)} />
            <Kpi label="First-time clients" value={String(firstTimeCount)} sub="first ticket ever in range" accent="#2FA883" />
            <Kpi label="Avg spend per client" value={money2(clientRows.length > 0 ? sums.total / clientRows.length : 0)} />
            <Kpi label="Guest visits" value={String(guestVisitCount)} sub="name-only guests of clients" />
          </div>
          <div className={`${card} overflow-x-auto p-0`}>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Client</th>
                  <th className={`${th} text-right`}>Tickets</th>
                  <th className={`${th} text-right`}>Services</th>
                  <th className={`${th} text-right`}>Spent</th>
                  <th className={`${th} text-right`}>Tips</th>
                  <th className={`${th} text-right`}>Avg ticket</th>
                  <th className={`${th} text-right`}>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {clientRows.slice(0, 25).map((r) => {
                  const rec = clients.find((c) => c.name === r.name);
                  return (
                    <tr key={r.name} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                      <td className={td}>
                        <span className="block text-[12.5px] font-semibold text-slate-800">{r.name}</span>
                        <span className="block text-[10.5px] text-slate-400">{rec?.phone ?? "walk-in"}</span>
                      </td>
                      <td className={tdn}>{r.tickets}</td>
                      <td className={tdn}>{r.services}</td>
                      <td className={tdn}>{money2(r.spend)}</td>
                      <td className={tdn}>{money2(r.tips)}</td>
                      <td className={tdn}>{money2(r.spend / r.tickets)}</td>
                      <td className={`${tdn} font-normal text-slate-500`}>{dayLabel(r.last)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">Top 25 clients by spend in the selected range. Full client profiles live on the calendar, click any name there.</p>
        </div>
      )}

      {!busy && tab === "appts" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Appointments" value={String(appts.length)} />
            <Kpi label="Same-time bookings" value={String(parallelGroups)} sub="mani + pedi together, etc" accent="#6B4FC4" />
            <Kpi label="Party tickets" value={String(partyTickets)} sub="checked out together" />
            <Kpi label="No-show rate" value={`${appts.length > 0 ? (((statusCounts.get("no_show") ?? 0) / appts.length) * 100).toFixed(1) : "0"}%`} accent="#B3402F" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">By status</h3>
              {Object.entries(STATUS_META).map(([id, meta]) => {
                const n = statusCounts.get(id) ?? 0;
                if (n === 0) return null;
                return (
                  <div key={id} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                    <span className="min-w-0 flex-1 text-[12.5px] text-slate-700">{meta.label}</span>
                    <ShareBar pct={(n / appts.length) * 100} color={meta.color} />
                    <span className="w-10 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{n}</span>
                    <span className="w-10 text-right text-[11px] tabular-nums text-slate-400">{((n / appts.length) * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Tech requests</h3>
              {(() => {
                const rows = [
                  { label: "Requested by name", n: bookingMix.requested, color: "#2FA883" },
                  { label: "Female or male preferred", n: bookingMix.pref, color: "#E0517E" },
                  { label: "Any available tech", n: bookingMix.any, color: "#64748B" },
                ];
                const total = Math.max(1, rows.reduce((s, r) => s + r.n, 0));
                return rows.map((r) => (
                  <div key={r.label} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="min-w-0 flex-1 text-[12.5px] text-slate-700">{r.label}</span>
                    <ShareBar pct={(r.n / total) * 100} color={r.color} />
                    <span className="w-10 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{r.n}</span>
                    <span className="w-10 text-right text-[11px] tabular-nums text-slate-400">{((r.n / total) * 100).toFixed(0)}%</span>
                  </div>
                ));
              })()}
              <p className="mt-2 text-[11px] text-slate-400">Requested appointments hold their tech, the rest can be reshuffled to balance the day.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2 text-[13px] font-bold text-slate-800">Busiest hours</h3>
              <VBars
                color="#D99B26"
                data={hourCounts.map((v, h) => ({
                  label: fmtTime(h * 60).replace(":00", ""),
                  title: `${fmtTime(h * 60)}: ${v} appointments`,
                  value: v,
                }))}
              />
            </div>
            <div className={card}>
              <h3 className="mb-2 text-[13px] font-bold text-slate-800">Busiest weekdays</h3>
              <VBars
                color="#8A6AE0"
                data={weekdayCounts.map((v, i) => ({ label: WEEKDAYS[i], title: `${WEEKDAYS[i]}: ${v} appointments`, value: v }))}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
