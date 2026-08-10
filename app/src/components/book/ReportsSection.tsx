// ─── Reports, salon analytics drawn from the book's own data ────────────────
// Sources: completed checkouts (payments-v1), the appointment book itself
// (appts-v1), and the client list (clients-v1). Everything computes live from
// whatever date range is picked, so it stays honest as the salon works.
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import type { Appointment } from "../../lib/booking-types";
import { OPEN_MIN, fmtTime } from "../../lib/booking-types";
import { sdata, usePersistentState } from "../../lib/persist";
import { svcById } from "../../lib/services-store";
import { catById } from "../../lib/categories-store";
import { roleColor, useStaffStore } from "../../lib/staff-store";
import { useSettingsStore } from "../../lib/settings-store";

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
interface CancellationRec {
  id: string;
  apptId: string;
  dateKey: string;
  clientName: string;
  serviceId: string;
  techId: string;
  startMin: number;
  durationMin: number;
  bookedAt?: number;
  cancelledAt: number;
  groupSize: number;
}
interface TurnawayRec {
  id: string;
  dateKey: string;
  clientName: string;
  phone?: string;
  serviceId?: string;
  requestedTechId?: string;
  reason: "no_availability" | "price" | "didnt_like_options" | "other";
  notes?: string;
  loggedAt: number;
}

// ── date helpers ─────────────────────────────────────────────────────────────
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (key: string) => new Date(key + "T12:00:00");
/** midnight local time, use this (not dateOf, which is noon) when adding minutes-from-open */
const dayStartMs = (key: string) => new Date(key + "T00:00:00").getTime();
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

// ── CSV export, every table can hand its rows to an accountant or payroll ────
function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function ExportButton({ filename, headers, rows }: { filename: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <button
      onClick={() => downloadCsv(filename, headers, rows)}
      disabled={rows.length === 0}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-[#F4F0F5] hover:text-[#5B54D6] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      title="Export as CSV"
    >
      <Download className="h-3 w-3" /> Export
    </button>
  );
}
function CardHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between">
      <h3 className="text-[13px] font-bold text-slate-800">{title}</h3>
      <span className="flex items-center gap-2">
        {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
        {action}
      </span>
    </div>
  );
}

type Tab = "overview" | "revenue" | "techs" | "payroll" | "services" | "clients" | "retention" | "loyalty" | "appts" | "closeout";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "revenue", label: "Revenue" },
  { id: "techs", label: "Technicians" },
  { id: "payroll", label: "Payroll" },
  { id: "services", label: "Services" },
  { id: "clients", label: "Clients" },
  { id: "retention", label: "Retention" },
  { id: "loyalty", label: "Loyalty" },
  { id: "appts", label: "Appointments" },
  { id: "closeout", label: "Close-out" },
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
  const [closeDay, setCloseDay] = useState<string>(keyOf(new Date()));

  const [payments] = usePersistentState<PaymentRec[]>(sdata("payments-v1"), []);
  const [apptDays] = usePersistentState<Record<string, Appointment[]>>(sdata("appts-v1"), {});
  const [clients] = usePersistentState<ClientRec[]>(sdata("clients-v1"), []);
  const [cancellations] = usePersistentState<CancellationRec[]>(sdata("cancellations-v1"), []);
  const [turnaways] = usePersistentState<TurnawayRec[]>(sdata("turnaways-v1"), []);
  const [pointsByClient] = usePersistentState<Record<string, number>>(sdata("loyalty-v1"), {});
  const staff = useStaffStore();
  const settings = useSettingsStore();

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

  // ── cancellations & booking funnel ──────────────────────────────────────────
  // cancelling removes the appointment from the board entirely, so this separate
  // log is the only record; a booked slot either ends in completed/no_show
  // (still in appts) or cancelled (only here)
  const cancellationsInRange = useMemo(
    () => cancellations.filter((c) => c.dateKey >= range.from && c.dateKey <= range.to),
    [cancellations, range.from, range.to],
  );
  const totalBooked = appts.length + cancellationsInRange.length;
  const cancellationRate = totalBooked > 0 ? (cancellationsInRange.length / totalBooked) * 100 : 0;
  // appointments keep their day association only via the apptDays bucket they live in,
  // so re-derive {dateKey, appt} pairs for anything that needs a real timestamp
  const apptsWithDay = useMemo(() => {
    const out: { dateKey: string; appt: Appointment }[] = [];
    for (const k of days) for (const a of apptDays[k] ?? []) out.push({ dateKey: k, appt: a });
    return out;
  }, [apptDays, days]);
  const avgLeadHrs = useMemo(() => {
    const leads: number[] = [];
    for (const { dateKey: k, appt: a } of apptsWithDay) {
      const booked = a.log?.[0]?.at;
      if (!booked) continue;
      const apptMs = dayStartMs(k) + (OPEN_MIN + a.startMin) * 60000;
      const hrs = (apptMs - booked) / 3600000;
      if (hrs >= 0 && hrs < 24 * 120) leads.push(hrs); // sanity bound, drop bad clocks
    }
    return leads.length > 0 ? leads.reduce((s, v) => s + v, 0) / leads.length : null;
  }, [apptsWithDay]);
  const avgCancelNoticeHrs = useMemo(() => {
    const notices = cancellationsInRange
      .map((c) => (dayStartMs(c.dateKey) + (OPEN_MIN + c.startMin) * 60000 - c.cancelledAt) / 3600000)
      .filter((h) => Number.isFinite(h));
    return notices.length > 0 ? notices.reduce((s, v) => s + v, 0) / notices.length : null;
  }, [cancellationsInRange]);

  // ── client retention & marketing ────────────────────────────────────────────
  // all-time (not range-bound) per-client rollup, for lifetime value + lapse detection
  const allTimeClientRows = useMemo(() => {
    const map = new Map<string, { name: string; tickets: number; spend: number; first: string; last: string }>();
    for (const p of payments) {
      let r = map.get(p.clientName);
      if (!r) { r = { name: p.clientName, tickets: 0, spend: 0, first: p.dateKey, last: p.dateKey }; map.set(p.clientName, r); }
      r.tickets++;
      r.spend += p.total;
      if (p.dateKey < r.first) r.first = p.dateKey;
      if (p.dateKey > r.last) r.last = p.dateKey;
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [payments]);
  const daysSince = (k: string) => Math.round((dayStartMs(today) - dayStartMs(k)) / 86400000);
  const lapsedClients = useMemo(
    () => allTimeClientRows
      .map((r) => ({ ...r, sinceLast: daysSince(r.last) }))
      .filter((r) => r.sinceLast >= 45 && r.sinceLast < 365)
      .sort((a, b) => b.sinceLast - a.sinceLast),
    [allTimeClientRows, today],
  );
  // approximation: a client "rebooked" if they have any future appointment on the
  // book right now, not necessarily booked at the moment of checkout
  const rebookingRate = useMemo(() => {
    if (clientRows.length === 0) return null;
    const namesWithFuture = new Set<string>();
    for (const k of Object.keys(apptDays)) {
      if (k <= today) continue;
      for (const a of apptDays[k] ?? []) namesWithFuture.add(a.clientName);
    }
    const rebooked = clientRows.filter((r) => namesWithFuture.has(r.name)).length;
    return (rebooked / clientRows.length) * 100;
  }, [clientRows, apptDays, today]);
  const firstEverMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of payments) {
      const cur = m.get(p.clientName);
      if (!cur || p.dateKey < cur) m.set(p.clientName, p.dateKey);
    }
    return m;
  }, [payments]);
  const newVsReturningByDay = useMemo(
    () => days.map((k) => {
      let n = 0, ret = 0;
      for (const p of pays) {
        if (p.dateKey !== k) continue;
        if (firstEverMap.get(p.clientName) === k) n++; else ret++;
      }
      return { k, n, ret };
    }),
    [days, pays, firstEverMap],
  );

  // ── payroll-ready technician payout ─────────────────────────────────────────
  const payrollRows = useMemo(() => {
    return techRows.map((r) => {
      const t = staff.techs.find((x) => x.id === r.id);
      const role = staff.roles.find((x) => x.id === r.roleId);
      const commissionPct = t?.commissionPct ?? 0;
      const commission = r.sales * (commissionPct / 100);
      return { ...r, roleName: role?.name ?? "", commissionPct, commission, payout: r.tips + commission };
    }).sort((a, b) => b.payout - a.payout);
  }, [techRows, staff.techs, staff.roles]);

  // ── loyalty program financials ──────────────────────────────────────────────
  const redemptionRowsRange = useMemo(() => {
    const map = new Map<string, { count: number; value: number; points: number }>();
    for (const p of pays) {
      if (!p.redeemed) continue;
      const r = map.get(p.redeemed.name) ?? { count: 0, value: 0, points: 0 };
      r.count++;
      r.value += p.redeemed.value;
      r.points += p.redeemed.points;
      map.set(p.redeemed.name, r);
    }
    return [...map.entries()].map(([name, r]) => ({ name, ...r })).sort((a, b) => b.value - a.value);
  }, [pays]);
  // $ value per point, derived from this salon's own redemption history so far;
  // falls back to the cheapest active "amount" reward once nothing's been redeemed yet
  const valuePerPoint = useMemo(() => {
    const allTimePoints = payments.reduce((s, p) => s + (p.redeemed?.points ?? 0), 0);
    const allTimeValue = payments.reduce((s, p) => s + (p.redeemed?.value ?? 0), 0);
    if (allTimePoints > 0) return allTimeValue / allTimePoints;
    const amountRewards = settings.loyalty.redemptions.filter((r) => r.type === "amount" && r.pointsCost > 0);
    return amountRewards.length > 0 ? Math.min(...amountRewards.map((r) => r.value / r.pointsCost)) : 0;
  }, [payments, settings.loyalty.redemptions]);
  const loyaltyBalances = useMemo(() => {
    const rows = Object.entries(pointsByClient)
      .filter(([, pts]) => pts > 0)
      .map(([clientId, pts]) => ({ clientId, name: clients.find((c) => c.id === clientId)?.name ?? "Unknown", points: pts }))
      .sort((a, b) => b.points - a.points);
    const totalPoints = rows.reduce((s, r) => s + r.points, 0);
    return { rows, totalPoints, liability: totalPoints * valuePerPoint };
  }, [pointsByClient, clients, valuePerPoint]);

  // ── wait time, check-in to service start ────────────────────────────────────
  const waitTimes = useMemo(() => {
    const rows: { techId: string; waitMin: number }[] = [];
    for (const a of appts) {
      if (a.checkedInMin != null && a.startedMin != null && a.startedMin >= a.checkedInMin) {
        rows.push({ techId: a.techId, waitMin: a.startedMin - a.checkedInMin });
      }
    }
    return rows;
  }, [appts]);
  const avgWaitMin = waitTimes.length > 0 ? waitTimes.reduce((s, r) => s + r.waitMin, 0) / waitTimes.length : null;
  const waitByTech = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    for (const r of waitTimes) {
      const e = map.get(r.techId) ?? { sum: 0, count: 0 };
      e.sum += r.waitMin;
      e.count++;
      map.set(r.techId, e);
    }
    return [...map.entries()]
      .map(([techId, e]) => ({ techId, name: staff.techs.find((t) => t.id === techId)?.name ?? "Unknown", avg: e.sum / e.count, count: e.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [waitTimes, staff.techs]);

  // ── booking source ───────────────────────────────────────────────────────────
  const SOURCE_LABEL: Record<string, string> = { front_desk: "Front desk", walk_in: "Walk-in", online: "Online", unknown: "Unknown (before tracking)" };
  const sourceRows = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const a of completed) {
      const key = a.bookingSource ?? "unknown";
      const e = map.get(key) ?? { count: 0, revenue: 0 };
      e.count++;
      e.revenue += apptPrice(a);
      map.set(key, e);
    }
    return [...map.entries()].map(([key, r]) => ({ key, label: SOURCE_LABEL[key] ?? key, ...r })).sort((a, b) => b.count - a.count);
  }, [completed]);

  // ── turnaways, demand the salon couldn't fit in ─────────────────────────────
  const TURNAWAY_REASON_LABEL: Record<string, string> = {
    no_availability: "No availability", price: "Price", didnt_like_options: "Didn't like the options", other: "Other",
  };
  const turnawaysInRange = useMemo(
    () => turnaways.filter((t) => t.dateKey >= range.from && t.dateKey <= range.to),
    [turnaways, range.from, range.to],
  );
  const turnawaysByReason = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of turnawaysInRange) map.set(t.reason, (map.get(t.reason) ?? 0) + 1);
    return [...map.entries()].map(([reason, n]) => ({ reason, label: TURNAWAY_REASON_LABEL[reason] ?? reason, n })).sort((a, b) => b.n - a.n);
  }, [turnawaysInRange]);
  const turnawayEstRevenue = useMemo(
    () => turnawaysInRange.reduce((s, t) => s + (t.serviceId ? svcById[t.serviceId]?.price ?? 0 : 0), 0),
    [turnawaysInRange],
  );

  // ── time off / leave usage, from each tech's timeOff records ────────────────
  const leaveRows = useMemo(() => {
    const rows: { techId: string; name: string; status: string; days: number }[] = [];
    for (const t of staff.techs) {
      const counts = new Map<string, number>();
      for (const off of t.timeOff ?? []) {
        const from = off.from > range.from ? off.from : range.from;
        const to = off.to < range.to ? off.to : range.to;
        if (from > to) continue;
        const n = listDays(from, to).length;
        counts.set(off.status, (counts.get(off.status) ?? 0) + n);
      }
      for (const [status, days] of counts) rows.push({ techId: t.id, name: t.name, status, days });
    }
    return rows.sort((a, b) => b.days - a.days);
  }, [staff.techs, range.from, range.to]);
  const LEAVE_LABEL: Record<string, string> = { vacation: "Vacation", off: "Off", emergency: "Emergency", late: "Late arrival", early: "Left early" };
  const leaveByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of leaveRows) map.set(r.status, (map.get(r.status) ?? 0) + r.days);
    return [...map.entries()].map(([status, days]) => ({ status, label: LEAVE_LABEL[status] ?? status, days })).sort((a, b) => b.days - a.days);
  }, [leaveRows]);

  // ── tech scorecard, one compact card per active technician ──────────────────
  const scorecardRows = useMemo(
    () => payrollRows
      .filter((r) => r.services > 0 || r.sales > 0)
      .map((r) => ({
        ...r,
        waitAvg: waitByTech.find((w) => w.techId === r.id)?.avg,
        leaveDays: leaveRows.filter((l) => l.techId === r.id).reduce((s, l) => s + l.days, 0),
      })),
    [payrollRows, waitByTech, leaveRows],
  );

  // ── new guests, a follow-up list beyond just the KPI count ─────────────────
  const newGuestRows = useMemo(() => {
    const namesInRangeFirst = pays.filter((p) => firstEverMap.get(p.clientName) === p.dateKey).map((p) => p.clientName);
    const uniq = [...new Set(namesInRangeFirst)];
    return uniq.map((name) => {
      const rec = clients.find((c) => c.name === name);
      const rows = pays.filter((p) => p.clientName === name);
      return { name, phone: rec?.phone ?? "", firstVisit: rows[0]?.dateKey ?? "", spend: rows.reduce((s, p) => s + p.total, 0) };
    }).sort((a, b) => a.firstVisit.localeCompare(b.firstVisit));
  }, [pays, firstEverMap, clients]);

  // ── retention by technician, does a client come back after their first visit
  //    with this tech (to anyone, within 60 days)? all-time, not range-bound ──
  const retentionByTech = useMemo(() => {
    const allEntries: { dateKey: string; appt: Appointment }[] = [];
    for (const k of Object.keys(apptDays)) for (const a of apptDays[k] ?? []) if (a.status === "completed") allEntries.push({ dateKey: k, appt: a });
    allEntries.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const firstByClient = new Map<string, { dateKey: string; techId: string }>();
    const visitsByClient = new Map<string, string[]>();
    for (const { dateKey: k, appt: a } of allEntries) {
      if (!firstByClient.has(a.clientName)) firstByClient.set(a.clientName, { dateKey: k, techId: a.techId });
      const arr = visitsByClient.get(a.clientName) ?? [];
      arr.push(k);
      visitsByClient.set(a.clientName, arr);
    }
    const byTech = new Map<string, { first: number; returned: number }>();
    for (const [client, f] of firstByClient) {
      const e = byTech.get(f.techId) ?? { first: 0, returned: 0 };
      e.first++;
      const visits = visitsByClient.get(client) ?? [];
      const returned = visits.some((k) => k > f.dateKey && (dayStartMs(k) - dayStartMs(f.dateKey)) / 86400000 <= 60);
      if (returned) e.returned++;
      byTech.set(f.techId, e);
    }
    return [...byTech.entries()]
      .map(([techId, e]) => ({ techId, name: staff.techs.find((t) => t.id === techId)?.name ?? "Unknown", first: e.first, returned: e.returned, rate: e.first > 0 ? (e.returned / e.first) * 100 : 0 }))
      .sort((a, b) => b.first - a.first);
  }, [apptDays, staff.techs]);

  // ── end-of-day close-out, always single-day regardless of the range picker ──
  const closePayments = useMemo(() => payments.filter((p) => p.dateKey === closeDay), [payments, closeDay]);
  const closeAppts = apptDays[closeDay] ?? [];
  const closeCancellations = useMemo(() => cancellations.filter((c) => c.dateKey === closeDay), [cancellations, closeDay]);
  const closeByMethod = useMemo(() => {
    const map = new Map<string, { tickets: number; total: number }>();
    for (const p of closePayments) {
      const r = map.get(p.method) ?? { tickets: 0, total: 0 };
      r.tickets++;
      r.total += p.total;
      map.set(p.method, r);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [closePayments]);
  const closeSums = useMemo(() => ({
    total: closePayments.reduce((s, p) => s + p.total, 0),
    sales: closePayments.reduce((s, p) => s + p.subtotal, 0),
    tips: closePayments.reduce((s, p) => s + p.tip, 0),
    discounts: closePayments.reduce((s, p) => s + (p.discount ?? 0) + (p.redeemed?.value ?? 0), 0),
    tickets: closePayments.length,
  }), [closePayments]);
  const closeStatusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of closeAppts) map.set(a.status, (map.get(a.status) ?? 0) + 1);
    return map;
  }, [closeAppts]);
  const nextDayCount = (apptDays[addDays(closeDay, 1)] ?? []).length;
  const printCloseOut = () => {
    const rows = closeByMethod
      .map(([m, r]) => `<tr><td>${m}</td><td style="text-align:right">${r.tickets}</td><td style="text-align:right">${money2(r.total)}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><title>Close-out, ${dayLabel(closeDay)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #1E293B; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  .sub { color: #64748B; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: left; }
  th { color: #94A3B8; font-size: 10.5px; text-transform: uppercase; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; border-bottom: 1px solid #F1F5F9; }
  .totals .grand { font-weight: 700; font-size: 15px; border-bottom: none; margin-top: 6px; }
</style></head><body>
<h1>End-of-day close-out</h1>
<div class="sub">${dayLabel(closeDay)}</div>
<table><thead><tr><th>Method</th><th style="text-align:right">Tickets</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="totals">
  <div><span>Service sales</span><span>${money2(closeSums.sales)}</span></div>
  <div><span>Tips</span><span>${money2(closeSums.tips)}</span></div>
  <div><span>Discounts and redemptions</span><span>${money2(closeSums.discounts)}</span></div>
  <div class="grand"><span>Total collected</span><span>${money2(closeSums.total)}</span></div>
</div>
<table><thead><tr><th>Appointments</th><th style="text-align:right">Count</th></tr></thead><tbody>
  <tr><td>Completed</td><td style="text-align:right">${closeStatusCounts.get("completed") ?? 0}</td></tr>
  <tr><td>No-shows</td><td style="text-align:right">${closeStatusCounts.get("no_show") ?? 0}</td></tr>
  <tr><td>Cancelled</td><td style="text-align:right">${closeCancellations.length}</td></tr>
  <tr><td>Total on the book today</td><td style="text-align:right">${closeAppts.length}</td></tr>
  <tr><td>Tomorrow's bookings so far</td><td style="text-align:right">${nextDayCount}</td></tr>
</tbody></table>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

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

      {busy && tab !== "retention" && tab !== "loyalty" && tab !== "closeout" && (
        <Empty text={`No activity recorded for ${rangeLabel}. Checkouts and appointments show up here as the salon works.`} />
      )}

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
            <div className="flex items-center justify-between px-4 pt-4">
              <h3 className="text-[13px] font-bold text-slate-800">Revenue by day</h3>
              <ExportButton
                filename={`revenue_${range.from}_to_${range.to}.csv`}
                headers={["Day", "Tickets", "Services", "Sales", "Tips", "Discounts", "Collected"]}
                rows={days.map((k) => {
                  const r = byDay.get(k)!;
                  return [dayLabel(k), r.tickets, r.services, r.sales.toFixed(2), r.tips.toFixed(2), r.discounts.toFixed(2), r.total.toFixed(2)];
                })}
              />
            </div>
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
          <div className="flex justify-end">
            <ExportButton
              filename={`technicians_${range.from}_to_${range.to}.csv`}
              headers={["Technician", "Role", "Services", "Hours", "Sales", "Tips", "Commission", "Utilization %", "Requested", "No-shows"]}
              rows={sortedTechs.map((r) => [
                r.name, staff.roles.find((x) => x.id === r.roleId)?.name ?? "", r.services,
                (r.mins / 60).toFixed(1), r.sales.toFixed(2), r.tips.toFixed(2), techVal(r, "commission").toFixed(2),
                r.schedMins > 0 ? ((r.mins / r.schedMins) * 100).toFixed(0) : "0", r.requested, r.noShows,
              ])}
            />
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

          <div className={card}>
            <CardHead title="Technician scorecard" sub={rangeLabel} />
            {scorecardRows.length === 0 ? (
              <p className="text-[12px] text-slate-400">No technician activity in this range.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {scorecardRows.map((r) => (
                  <div key={r.id} className="rounded-lg border border-[#F0EAF1] p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: roleColor(staff.roles, r.roleId) }} />
                      <span className="truncate text-[12.5px] font-bold text-slate-800">{r.name}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      <div><span className="text-slate-400">Services</span><div className="tabular-nums font-semibold text-slate-800">{r.services}</div></div>
                      <div><span className="text-slate-400">Hours</span><div className="tabular-nums font-semibold text-slate-800">{hours(r.mins)}</div></div>
                      <div><span className="text-slate-400">Sales</span><div className="tabular-nums font-semibold text-slate-800">{money2(r.sales)}</div></div>
                      <div><span className="text-slate-400">Payout</span><div className="tabular-nums font-semibold text-[#5B54D6]">{money2(r.payout)}</div></div>
                      <div><span className="text-slate-400">Utilization</span><div className="tabular-nums font-semibold text-slate-800">{r.schedMins > 0 ? `${((r.mins / r.schedMins) * 100).toFixed(0)}%` : "-"}</div></div>
                      <div><span className="text-slate-400">Avg wait</span><div className="tabular-nums font-semibold text-slate-800">{r.waitAvg != null ? `${r.waitAvg.toFixed(1)}m` : "-"}</div></div>
                      <div><span className="text-slate-400">No-shows</span><div className={`tabular-nums font-semibold ${r.noShows > 0 ? "text-[#B3402F]" : "text-slate-800"}`}>{r.noShows}</div></div>
                      <div><span className="text-slate-400">Leave days</span><div className="tabular-nums font-semibold text-slate-800">{r.leaveDays || "-"}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">Time off & leave usage</h3>
                <p className="text-[11px] text-slate-400">Days within this range, from each tech's schedule</p>
              </div>
              <ExportButton
                filename={`leave_usage_${range.from}_to_${range.to}.csv`}
                headers={["Technician", "Type", "Days"]}
                rows={leaveRows.map((r) => [r.name, LEAVE_LABEL[r.status] ?? r.status, r.days])}
              />
            </div>
            {leaveByType.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 px-4 pb-3 pt-1">
                {leaveByType.map((r) => (
                  <span key={r.status} className="text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-800">{r.days}</span> {r.label} days
                  </span>
                ))}
              </div>
            )}
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Technician</th>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Days</th>
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((r, i) => (
                  <tr key={`${r.techId}-${r.status}-${i}`} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={`${td} font-medium`}>{r.name}</td>
                    <td className={td}>{LEAVE_LABEL[r.status] ?? r.status}</td>
                    <td className={tdn}>{r.days}</td>
                  </tr>
                ))}
                {leaveRows.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={3}>No time off recorded in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!busy && tab === "payroll" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Total payout" value={money2(payrollRows.reduce((s, r) => s + r.payout, 0))} sub="commission + tips" accent="#5B54D6" />
            <Kpi label="Commission" value={money2(payrollRows.reduce((s, r) => s + r.commission, 0))} accent="#6B4FC4" />
            <Kpi label="Tips" value={money2(payrollRows.reduce((s, r) => s + r.tips, 0))} accent="#2FA883" />
            <Kpi label="Techs paid out" value={String(payrollRows.filter((r) => r.payout > 0).length)} sub={`of ${staff.techs.length} on roster`} />
          </div>
          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <h3 className="text-[13px] font-bold text-slate-800">Payout by technician</h3>
              <ExportButton
                filename={`payroll_${range.from}_to_${range.to}.csv`}
                headers={["Technician", "Role", "Services", "Hours", "Sales", "Commission %", "Commission $", "Tips", "Total payout"]}
                rows={payrollRows.map((r) => [r.name, r.roleName, r.services, (r.mins / 60).toFixed(1), r.sales.toFixed(2), r.commissionPct, r.commission.toFixed(2), r.tips.toFixed(2), r.payout.toFixed(2)])}
              />
            </div>
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Technician</th>
                  <th className={`${th} text-right`}>Services</th>
                  <th className={`${th} text-right`}>Hours</th>
                  <th className={`${th} text-right`}>Sales</th>
                  <th className={`${th} text-right`}>Commission</th>
                  <th className={`${th} text-right`}>Tips</th>
                  <th className={`${th} text-right`}>Total payout</th>
                </tr>
              </thead>
              <tbody>
                {payrollRows.map((r) => (
                  <tr key={r.id} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={td}>
                      <span className="block text-[12.5px] font-semibold text-slate-800">{r.name}</span>
                      <span className="block text-[10.5px] text-slate-400">{r.roleName}{r.commissionPct ? ` · ${r.commissionPct}%` : ""}</span>
                    </td>
                    <td className={tdn}>{r.services || ""}</td>
                    <td className={tdn}>{r.mins > 0 ? hours(r.mins) : ""}</td>
                    <td className={tdn}>{r.sales > 0 ? money2(r.sales) : ""}</td>
                    <td className={tdn}>{r.commission > 0 ? money2(r.commission) : ""}</td>
                    <td className={tdn}>{r.tips > 0 ? money2(r.tips) : ""}</td>
                    <td className={`${tdn} text-[#5B54D6]`}>{r.payout > 0 ? money2(r.payout) : ""}</td>
                  </tr>
                ))}
                {payrollRows.every((r) => r.payout === 0) && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={7}>No payout to record in this range.</td></tr>
                )}
                <tr className="bg-[#FAF8FA] font-bold">
                  <td className={td}>Total</td>
                  <td className={tdn}></td>
                  <td className={tdn}></td>
                  <td className={tdn}>{money2(payrollRows.reduce((s, r) => s + r.sales, 0))}</td>
                  <td className={tdn}>{money2(payrollRows.reduce((s, r) => s + r.commission, 0))}</td>
                  <td className={tdn}>{money2(payrollRows.reduce((s, r) => s + r.tips, 0))}</td>
                  <td className={`${tdn} text-[#5B54D6]`}>{money2(payrollRows.reduce((s, r) => s + r.payout, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Ready to hand to payroll for the selected range. Commission uses each tech's rate from Technician settings against their sales; this does not include an hourly wage component if your salon pays one on top of commission.
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
            <div className="flex items-center justify-between px-4 pt-4">
              <h3 className="text-[13px] font-bold text-slate-800">By service</h3>
              <ExportButton
                filename={`services_${range.from}_to_${range.to}.csv`}
                headers={["Service", "Done", "Hours", "Revenue", "Avg price", "Share %"]}
                rows={(() => {
                  const total = svcRows.reduce((s, r) => s + r.revenue, 0);
                  return svcRows.map((r) => [
                    svcById[r.id]?.name ?? r.id, r.count, (r.mins / 60).toFixed(1), r.revenue.toFixed(2),
                    (r.revenue / r.count).toFixed(2), total > 0 ? ((r.revenue / total) * 100).toFixed(1) : "0",
                  ]);
                })()}
              />
            </div>
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
            <div className="flex items-center justify-between px-4 pt-4">
              <h3 className="text-[13px] font-bold text-slate-800">Top clients by spend</h3>
              <ExportButton
                filename={`clients_${range.from}_to_${range.to}.csv`}
                headers={["Client", "Phone", "Tickets", "Services", "Spent", "Tips", "Avg ticket", "Last visit"]}
                rows={clientRows.slice(0, 25).map((r) => [
                  r.name, clients.find((c) => c.name === r.name)?.phone ?? "", r.tickets, r.services,
                  r.spend.toFixed(2), r.tips.toFixed(2), (r.spend / r.tickets).toFixed(2), r.last,
                ])}
              />
            </div>
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

      {tab === "retention" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="New clients" value={String(firstTimeCount)} sub="in this range" accent="#2FA883" />
            <Kpi label="Returning clients" value={String(Math.max(0, clientRows.length - firstTimeCount))} sub="in this range" />
            <Kpi label="Rebooking rate" value={rebookingRate != null ? `${rebookingRate.toFixed(0)}%` : "-"} sub="have a future visit on the book" accent="#5B54D6" />
            <Kpi label="Lapsed clients" value={String(lapsedClients.length)} sub="no visit in 45+ days" accent="#B3402F" />
          </div>

          <div className={card}>
            <CardHead title="New vs returning" sub={`by day, ${rangeLabel}`} />
            {pays.length === 0 ? (
              <p className="text-[12px] text-slate-400">No tickets in this range yet.</p>
            ) : (
              <div className="flex h-36 items-end gap-1">
                {newVsReturningByDay.map(({ k, n, ret }) => {
                  const max = Math.max(1, ...newVsReturningByDay.map((d) => d.n + d.ret));
                  const total = n + ret;
                  return (
                    <div key={k} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${dayLabel(k)}: ${n} new, ${ret} returning`}>
                      <div className="flex h-28 w-full flex-col-reverse items-center justify-end overflow-hidden rounded-t-md">
                        {total > 0 && (
                          <>
                            <div className="w-full max-w-7" style={{ height: `${Math.max(2, (ret / max) * 100)}%`, background: "#94A3B8" }} />
                            <div className="w-full max-w-7" style={{ height: `${Math.max(n > 0 ? 2 : 0, (n / max) * 100)}%`, background: "#2FA883" }} />
                          </>
                        )}
                      </div>
                      <span className="w-full truncate text-center text-[9.5px] text-slate-400">
                        {newVsReturningByDay.length > 14 ? dateOf(k).getDate() : dayLabel(k).split(",")[0]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2FA883]" /> New</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#94A3B8]" /> Returning</span>
            </div>
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">At-risk clients</h3>
                <p className="text-[11px] text-slate-400">Regulars who have gone quiet, sorted by longest since their last visit, all time</p>
              </div>
              <ExportButton
                filename={`at_risk_clients_${today}.csv`}
                headers={["Client", "Phone", "Last visit", "Days since", "Lifetime visits", "Lifetime spend"]}
                rows={lapsedClients.map((r) => [
                  r.name, clients.find((c) => c.name === r.name)?.phone ?? "", r.last, r.sinceLast, r.tickets, r.spend.toFixed(2),
                ])}
              />
            </div>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Client</th>
                  <th className={`${th} text-right`}>Last visit</th>
                  <th className={`${th} text-right`}>Days since</th>
                  <th className={`${th} text-right`}>Lifetime visits</th>
                  <th className={`${th} text-right`}>Lifetime spend</th>
                </tr>
              </thead>
              <tbody>
                {lapsedClients.slice(0, 25).map((r) => {
                  const rec = clients.find((c) => c.name === r.name);
                  return (
                    <tr key={r.name} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                      <td className={td}>
                        <span className="block text-[12.5px] font-semibold text-slate-800">{r.name}</span>
                        <span className="block text-[10.5px] text-slate-400">{rec?.phone ?? "walk-in"}</span>
                      </td>
                      <td className={tdn}>{dayLabel(r.last)}</td>
                      <td className={`${tdn} ${r.sinceLast >= 90 ? "text-[#B3402F]" : ""}`}>{r.sinceLast}</td>
                      <td className={tdn}>{r.tickets}</td>
                      <td className={tdn}>{money2(r.spend)}</td>
                    </tr>
                  );
                })}
                {lapsedClients.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={5}>No lapsed clients, everyone's been in within 45 days.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">Lifetime value</h3>
                <p className="text-[11px] text-slate-400">All-time spend per client, not limited to the selected range</p>
              </div>
              <ExportButton
                filename={`lifetime_value_${today}.csv`}
                headers={["Client", "Phone", "First visit", "Last visit", "Lifetime visits", "Lifetime spend", "Avg ticket"]}
                rows={allTimeClientRows.slice(0, 25).map((r) => [
                  r.name, clients.find((c) => c.name === r.name)?.phone ?? "", r.first, r.last, r.tickets, r.spend.toFixed(2), (r.spend / r.tickets).toFixed(2),
                ])}
              />
            </div>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Client</th>
                  <th className={`${th} text-right`}>First visit</th>
                  <th className={`${th} text-right`}>Lifetime visits</th>
                  <th className={`${th} text-right`}>Lifetime spend</th>
                  <th className={`${th} text-right`}>Avg ticket</th>
                </tr>
              </thead>
              <tbody>
                {allTimeClientRows.slice(0, 25).map((r) => (
                  <tr key={r.name} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={`${td} font-semibold`}>{r.name}</td>
                    <td className={tdn}>{dayLabel(r.first)}</td>
                    <td className={tdn}>{r.tickets}</td>
                    <td className={tdn}>{money2(r.spend)}</td>
                    <td className={tdn}>{money2(r.spend / r.tickets)}</td>
                  </tr>
                ))}
                {allTimeClientRows.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={5}>No checkouts recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={card}>
            <CardHead title="Retention by technician" sub="returns within 60 days, all time" />
            {retentionByTech.length === 0 ? (
              <p className="text-[12px] text-slate-400">No completed appointments yet.</p>
            ) : (
              retentionByTech.map((r) => (
                <div key={r.techId} className="mb-2 flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{r.name}</span>
                  <ShareBar pct={r.rate} color="#5B54D6" />
                  <span className="w-10 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{r.rate.toFixed(0)}%</span>
                  <span className="w-16 text-right text-[11px] tabular-nums text-slate-400">{r.returned}/{r.first}</span>
                </div>
              ))
            )}
            <p className="mt-2 text-[11px] text-slate-400">Which clients came back to anyone within 60 days of their first visit with each tech, all-time.</p>
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">New guests</h3>
                <p className="text-[11px] text-slate-400">First-time clients in this range, {rangeLabel}</p>
              </div>
              <ExportButton
                filename={`new_guests_${range.from}_to_${range.to}.csv`}
                headers={["Client", "Phone", "First visit", "Spend since"]}
                rows={newGuestRows.map((r) => [r.name, r.phone, dayLabel(r.firstVisit), r.spend.toFixed(2)])}
              />
            </div>
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Client</th>
                  <th className={th}>First visit</th>
                  <th className={`${th} text-right`}>Spend since</th>
                </tr>
              </thead>
              <tbody>
                {newGuestRows.map((r) => (
                  <tr key={r.name} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={td}>
                      <span className="block text-[12.5px] font-semibold text-slate-800">{r.name}</span>
                      {r.phone && <span className="block text-[10.5px] text-slate-400">{r.phone}</span>}
                    </td>
                    <td className={td}>{dayLabel(r.firstVisit)}</td>
                    <td className={tdn}>{money2(r.spend)}</td>
                  </tr>
                ))}
                {newGuestRows.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={3}>No new guests in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-400">
            Rebooking rate is an approximation: the share of clients served in this range who currently have any future appointment on the book, not necessarily one booked at checkout. At-risk, lifetime value, and retention by technician are always all-time, independent of the range picker above.
          </p>
        </div>
      )}

      {tab === "loyalty" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Points earned" value={String(sums.pointsEarned)} sub="in this range" accent="#2FA883" />
            <Kpi label="Points redeemed" value={String(sums.pointsRedeemed)} sub={money2(sums.redeemedVal)} />
            <Kpi label="Points outstanding" value={loyaltyBalances.totalPoints.toLocaleString()} sub="across all clients" accent="#6B4FC4" />
            <Kpi label="Estimated liability" value={money2(loyaltyBalances.liability)} sub="if all outstanding points were redeemed" accent="#B3402F" />
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <h3 className="text-[13px] font-bold text-slate-800">Redemptions in this range</h3>
              <ExportButton
                filename={`loyalty_redemptions_${range.from}_to_${range.to}.csv`}
                headers={["Reward", "Times redeemed", "Points spent", "Value given"]}
                rows={redemptionRowsRange.map((r) => [r.name, r.count, r.points, r.value.toFixed(2)])}
              />
            </div>
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Reward</th>
                  <th className={`${th} text-right`}>Times redeemed</th>
                  <th className={`${th} text-right`}>Points spent</th>
                  <th className={`${th} text-right`}>Value given</th>
                </tr>
              </thead>
              <tbody>
                {redemptionRowsRange.map((r) => (
                  <tr key={r.name} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={`${td} font-medium`}>{r.name}</td>
                    <td className={tdn}>{r.count}</td>
                    <td className={tdn}>{r.points}</td>
                    <td className={tdn}>{money2(r.value)}</td>
                  </tr>
                ))}
                {redemptionRowsRange.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={4}>No redemptions in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">Outstanding balances</h3>
                <p className="text-[11px] text-slate-400">Clients holding the most unredeemed points, all time</p>
              </div>
              <ExportButton
                filename={`loyalty_balances_${today}.csv`}
                headers={["Client", "Points balance", "Estimated value"]}
                rows={loyaltyBalances.rows.slice(0, 25).map((r) => [r.name, r.points, (r.points * valuePerPoint).toFixed(2)])}
              />
            </div>
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Client</th>
                  <th className={`${th} text-right`}>Points</th>
                  <th className={`${th} text-right`}>Est. value</th>
                </tr>
              </thead>
              <tbody>
                {loyaltyBalances.rows.slice(0, 25).map((r) => (
                  <tr key={r.clientId} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={`${td} font-medium`}>{r.name}</td>
                    <td className={tdn}>{r.points.toLocaleString()}</td>
                    <td className={tdn}>{money2(r.points * valuePerPoint)}</td>
                  </tr>
                ))}
                {loyaltyBalances.rows.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={3}>No outstanding points balances.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Estimated value uses {valuePerPoint > 0 ? `$${valuePerPoint.toFixed(4)} per point, derived from this salon's own redemption history (or the cheapest active reward if nothing's been redeemed yet)` : "no redemption history yet, so it shows as $0 until the first reward is redeemed"}. Configure rewards in Settings, Loyalty.
          </p>
        </div>
      )}

      {!busy && tab === "appts" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Appointments" value={String(appts.length)} sub={`${totalBooked} booked incl. cancellations`} />
            <Kpi label="Same-time bookings" value={String(parallelGroups)} sub="mani + pedi together, etc" accent="#6B4FC4" />
            <Kpi label="No-show rate" value={`${appts.length > 0 ? (((statusCounts.get("no_show") ?? 0) / appts.length) * 100).toFixed(1) : "0"}%`} accent="#B3402F" />
            <Kpi label="Cancellation rate" value={`${cancellationRate.toFixed(1)}%`} sub={`${cancellationsInRange.length} cancelled`} accent="#B3402F" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Booking funnel</h3>
              {(() => {
                const rows = [
                  { label: "Booked", n: totalBooked, color: "#D99B26" },
                  { label: "Checked in or later", n: appts.filter((a) => a.checkedInMin != null).length, color: "#6B4FC4" },
                  { label: "Completed", n: statusCounts.get("completed") ?? 0, color: "#64748B" },
                  { label: "No-show", n: statusCounts.get("no_show") ?? 0, color: "#B3402F" },
                  { label: "Cancelled", n: cancellationsInRange.length, color: "#B3402F" },
                ];
                const max = Math.max(1, ...rows.map((r) => r.n));
                return rows.map((r) => (
                  <div key={r.label} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="min-w-0 flex-1 text-[12.5px] text-slate-700">{r.label}</span>
                    <ShareBar pct={(r.n / max) * 100} color={r.color} />
                    <span className="w-10 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{r.n}</span>
                  </div>
                ));
              })()}
              <p className="mt-2 text-[11px] text-slate-400">Party tickets: {partyTickets} checked out together.</p>
            </div>
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Lead time</h3>
              <div className="space-y-3 pt-1">
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Avg booking lead time</div>
                  <div className="mt-1 text-[19px] font-bold tabular-nums text-slate-800">
                    {avgLeadHrs != null ? (avgLeadHrs >= 48 ? `${(avgLeadHrs / 24).toFixed(1)} days` : `${avgLeadHrs.toFixed(1)} hours`) : "-"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">from booking to the appointment</div>
                </div>
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Avg cancellation notice</div>
                  <div className="mt-1 text-[19px] font-bold tabular-nums text-slate-800">
                    {avgCancelNoticeHrs != null ? (avgCancelNoticeHrs >= 48 ? `${(avgCancelNoticeHrs / 24).toFixed(1)} days` : `${avgCancelNoticeHrs.toFixed(1)} hours`) : "-"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">how far ahead clients cancel, before the appointment time</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Wait time</h3>
              {avgWaitMin != null ? (
                <>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Avg check-in to service start</div>
                  <div className="mt-1 text-[19px] font-bold tabular-nums text-slate-800">{avgWaitMin.toFixed(1)} min</div>
                  <div className="mt-3 space-y-1.5">
                    {waitByTech.slice(0, 6).map((r) => (
                      <div key={r.techId} className="flex items-center gap-2.5">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{r.name}</span>
                        <span className="text-[11px] text-slate-400">{r.count} checked in</span>
                        <span className="w-14 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{r.avg.toFixed(1)} min</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-slate-400">No check-in times recorded in this range yet.</p>
              )}
            </div>
            <div className={card}>
              <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Booking source</h3>
              {sourceRows.length === 0 ? (
                <p className="text-[12px] text-slate-400">No completed tickets in this range yet.</p>
              ) : (() => {
                const max = Math.max(1, ...sourceRows.map((r) => r.count));
                return sourceRows.map((r) => (
                  <div key={r.key} className="mb-2 flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.key === "online" ? "#2FA883" : r.key === "walk_in" ? "#D99B26" : r.key === "front_desk" ? "#6B4FC4" : "#94A3B8" }} />
                    <span className="min-w-0 flex-1 text-[12.5px] text-slate-700">{r.label}</span>
                    <ShareBar pct={(r.count / max) * 100} color={r.key === "online" ? "#2FA883" : r.key === "walk_in" ? "#D99B26" : r.key === "front_desk" ? "#6B4FC4" : "#94A3B8"} />
                    <span className="w-10 text-right text-[12.5px] font-semibold tabular-nums text-slate-800">{r.count}</span>
                    <span className="w-16 text-right text-[11px] tabular-nums text-slate-400">{money(r.revenue)}</span>
                  </div>
                ));
              })()}
            </div>
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

          <div className={`${card} overflow-x-auto p-0`}>
            <div className="flex items-center justify-between px-4 pt-4">
              <div>
                <h3 className="text-[13px] font-bold text-slate-800">Turnaways</h3>
                <p className="text-[11px] text-slate-400">Demand we couldn't fit in, logged from the calendar toolbar · est. {money2(turnawayEstRevenue)} in missed revenue</p>
              </div>
              <ExportButton
                filename={`turnaways_${range.from}_to_${range.to}.csv`}
                headers={["Date", "Client", "Phone", "Service requested", "Tech requested", "Reason", "Notes"]}
                rows={turnawaysInRange.map((t) => [
                  dayLabel(t.dateKey), t.clientName, t.phone ?? "",
                  t.serviceId ? svcById[t.serviceId]?.name ?? "" : "Any",
                  t.requestedTechId ? staff.techs.find((x) => x.id === t.requestedTechId)?.name ?? "" : "Any",
                  TURNAWAY_REASON_LABEL[t.reason] ?? t.reason, t.notes ?? "",
                ])}
              />
            </div>
            {turnawaysByReason.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 px-4 pb-3 pt-1">
                {turnawaysByReason.map((r) => (
                  <span key={r.reason} className="text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-800">{r.n}</span> {r.label}
                  </span>
                ))}
              </div>
            )}
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[#EDE7EE] bg-[#FAF8FA]">
                  <th className={th}>Date</th>
                  <th className={th}>Client</th>
                  <th className={th}>Wanted</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {turnawaysInRange.slice().reverse().map((t) => (
                  <tr key={t.id} className="border-b border-[#F4F0F5] last:border-0 hover:bg-[#FAF8FA]">
                    <td className={td}>{dayLabel(t.dateKey)}</td>
                    <td className={td}>
                      <span className="block text-[12.5px] font-semibold text-slate-800">{t.clientName}</span>
                      {t.phone && <span className="block text-[10.5px] text-slate-400">{t.phone}</span>}
                    </td>
                    <td className={td}>
                      {t.serviceId ? svcById[t.serviceId]?.name ?? "Service" : "Any service"}
                      {t.requestedTechId && (
                        <span className="text-slate-400"> · {staff.techs.find((x) => x.id === t.requestedTechId)?.name ?? "requested tech"}</span>
                      )}
                    </td>
                    <td className={td}>{TURNAWAY_REASON_LABEL[t.reason] ?? t.reason}</td>
                    <td className={`${td} text-slate-400`}>{t.notes ?? ""}</td>
                  </tr>
                ))}
                {turnawaysInRange.length === 0 && (
                  <tr><td className={`${td} py-8 text-center text-slate-400`} colSpan={5}>No turnaways logged in this range. Use the phone-off icon in the calendar toolbar to log one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "closeout" && (
        <div className="space-y-4">
          <div className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCloseDay((k) => addDays(k, -1))}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-[#F4F0F5]"
              >
                ◀
              </button>
              <input
                type="date" value={closeDay} onChange={(e) => setCloseDay(e.target.value)}
                className="rounded-lg border border-[#E3DDE3] px-2 py-1 text-[12px] outline-none focus:border-[#5B54D6]"
              />
              <button
                onClick={() => setCloseDay((k) => addDays(k, 1))}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-[#F4F0F5]"
              >
                ▶
              </button>
              <button
                onClick={() => setCloseDay(keyOf(new Date()))}
                className="rounded-lg bg-[#F4F0F5] px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-[#EBE5EC]"
              >
                Today
              </button>
              <span className="text-[12.5px] font-semibold text-slate-700">{dayLabel(closeDay)}</span>
              <button
                onClick={printCloseOut}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#5B54D6] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#4A44B8]"
              >
                <Printer className="h-3.5 w-3.5" /> Print close-out
              </button>
            </div>
          </div>

          {closePayments.length === 0 && closeAppts.length === 0 ? (
            <Empty text={`No activity recorded for ${dayLabel(closeDay)} yet.`} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Total collected" value={money2(closeSums.total)} sub={`${closeSums.tickets} tickets`} accent="#5B54D6" />
                <Kpi label="Service sales" value={money2(closeSums.sales)} />
                <Kpi label="Tips" value={money2(closeSums.tips)} accent="#2FA883" />
                <Kpi label="Discounts & redemptions" value={money2(closeSums.discounts)} accent="#B3402F" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className={card}>
                  <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">By payment method</h3>
                  {closeByMethod.map(([m, r]) => (
                    <div key={m} className="flex items-center justify-between border-b border-[#F4F0F5] py-2 last:border-0">
                      <span className="text-[12.5px] text-slate-700">{m}</span>
                      <span className="text-[12.5px] font-semibold tabular-nums text-slate-800">{money2(r.total)}<span className="ml-2 text-[11px] font-normal text-slate-400">{r.tickets} tickets</span></span>
                    </div>
                  ))}
                  {closeByMethod.length === 0 && <p className="text-[12px] text-slate-400">No tickets closed out today.</p>}
                </div>
                <div className={card}>
                  <h3 className="mb-2.5 text-[13px] font-bold text-slate-800">Today's appointments</h3>
                  {[
                    { label: "Completed", n: closeStatusCounts.get("completed") ?? 0 },
                    { label: "No-shows", n: closeStatusCounts.get("no_show") ?? 0 },
                    { label: "Cancelled", n: closeCancellations.length },
                    { label: "Total on the book", n: closeAppts.length },
                    { label: "Tomorrow's bookings so far", n: nextDayCount },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between border-b border-[#F4F0F5] py-2 last:border-0">
                      <span className="text-[12.5px] text-slate-700">{r.label}</span>
                      <span className="text-[12.5px] font-semibold tabular-nums text-slate-800">{r.n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <p className="text-[11px] text-slate-400">Always a single day, independent of the date range picker above. Use Print close-out for a clean printable copy for the register.</p>
        </div>
      )}
    </div>
  );
}
