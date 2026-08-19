// ─── Team schedule, per-day tech status, hours, and notes ───────────────────
// Left slide-out panel. Each tech gets a status for the viewed day (working,
// day off, vacation, emergency call out, coming late, leaving early), optional
// start/end times, and a note. Changes apply instantly and persist per day.
import { useMemo, useState } from "react";
import { Check, ChevronDown, Clock, Search, X } from "lucide-react";
import { DAY_SLOTS, SLOT_MIN, fmtTime } from "@/lib/booking-types";
import { useStaffStore } from "@/lib/staff-store";

const DAY_MIN = DAY_SLOTS * SLOT_MIN;
const TIME_OPTS = Array.from({ length: DAY_SLOTS + 1 }, (_, i) => i * SLOT_MIN);

export interface TechDay {
  status: "working" | "off" | "vacation" | "emergency" | "late" | "early";
  startMin?: number;
  endMin?: number;
  notes?: string;
}
export type DaySchedule = Record<string, TechDay>;

export const STATUS_META: Record<TechDay["status"], { label: string; color: string; fill: string }> = {
  working: { label: "Working", color: "#2F7D5B", fill: "#D8EEE4" },
  off: { label: "Day off", color: "#64748B", fill: "#E8ECF1" },
  vacation: { label: "Vacation", color: "#2D7FB8", fill: "#DCEBF7" },
  emergency: { label: "Emergency call out", color: "#B3402F", fill: "#F5DFDB" },
  late: { label: "Coming late", color: "#9A6B0F", fill: "#F9EBCB" },
  early: { label: "Leaving early", color: "#6B4FC4", fill: "#E8E0FA" },
};

const STATUS_ORDER: TechDay["status"][] = ["working", "off", "vacation", "emergency", "late", "early"];

const field =
  "w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring";

export function TechSchedulePanel({ dateLabel, day, onSet, onClose, focusTechId }: {
  dateLabel: string;
  day: DaySchedule;
  onSet: (techId: string, patch: Partial<TechDay>) => void;
  onClose: () => void;
  /** opened from a specific tech's own ⋯ menu on the calendar rather than
   *  the general Schedule shortcut -- pre-filters the list to just them and
   *  opens their row straight away, so marking someone out sick or coming
   *  in late is a couple of clicks, not a search through the whole team */
  focusTechId?: string;
}) {
  const { roles, techs } = useStaffStore();
  const [q, setQ] = useState(() => (focusTechId ? techs.find((t) => t.id === focusTechId)?.name ?? "" : ""));
  const [openId, setOpenId] = useState<string | null>(focusTechId ?? null);

  const groups = useMemo(() => {
    const text = q.trim().toLowerCase();
    return roles
      .map((role) => ({
        role,
        techs: techs
          .filter((t) => t.teamId === role.id)
          .filter((t) => !text || t.name.toLowerCase().includes(text))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.techs.length > 0);
  }, [roles, techs, q]);

  const effective = (id: string): TechDay => day[id] ?? { status: "working" };
  const workingCount = techs.filter((t) => effective(t.id).status === "working" || effective(t.id).status === "late" || effective(t.id).status === "early").length;

  return (
    <div className="fixed inset-y-0 left-[76px] z-[85] flex w-[340px] max-w-[90vw] flex-col border-r border-line bg-popover shadow-2xl">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <Clock className="h-4 w-4 text-clay" /> Team schedule
          </h2>
          <p className="text-[11px] text-ink-faint">{dateLabel} · {workingCount} of {techs.length} working</p>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-cream hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* search */}
      <div className="border-b border-line px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search tech"
            className={`${field} pl-8`}
          />
        </div>
      </div>

      {/* tech list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {groups.length === 0 && <p className="py-8 text-center text-[12px] text-ink-faint">No techs match “{q}”</p>}
        {groups.map(({ role, techs: inRole }) => (
          <div key={role.id} className="mb-3">
            <p className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">{role.name}</p>
            <div className="space-y-1">
              {inRole.map((t) => {
                const d = effective(t.id);
                const meta = STATUS_META[d.status];
                const open = openId === t.id;
                const hasTimes = d.status === "working" || d.status === "late" || d.status === "early";
                const from = d.startMin ?? 0;
                const to = d.endMin ?? DAY_MIN;
                return (
                  <div key={t.id} className="shrink-0 overflow-hidden rounded-[10px] border border-line bg-surface">
                    <button
                      onClick={() => setOpenId(open ? null : t.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-cream"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{t.name}</span>
                        <span className="block text-[10.5px] text-ink-faint">
                          {d.status === "working" && from === 0 && to === DAY_MIN
                            ? "Full day"
                            : d.status === "late"
                              ? `In at ${fmtTime(from)}`
                              : d.status === "early"
                                ? `Out at ${fmtTime(to)}`
                                : d.status === "working"
                                  ? `${fmtTime(from)} to ${fmtTime(to)}`
                                  : meta.label}
                          {d.notes ? ` · ${d.notes}` : ""}
                        </span>
                      </span>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                        style={{ background: meta.fill, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>

                    {open && (
                      <div className="space-y-2.5 border-t border-line bg-cream/50 p-3">
                        {/* status options */}
                        <div className="grid grid-cols-2 gap-1">
                          {STATUS_ORDER.map((st) => {
                            const m = STATUS_META[st];
                            const on = d.status === st;
                            return (
                              <button
                                key={st}
                                onClick={() => onSet(t.id, { status: st })}
                                className={`flex items-center gap-1.5 rounded-[8px] border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                                  on ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
                                }`}
                              >
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                                {on && <Check className="h-3 w-3 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>

                        {/* shift times */}
                        {hasTimes && (
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 text-[10.5px] font-semibold text-ink-faint">
                              {d.status === "late" ? "Arrives" : "Start"}
                            </span>
                            <select
                              value={from}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                onSet(t.id, { startMin: v, ...(v >= to ? { endMin: Math.min(DAY_MIN, v + SLOT_MIN * 4) } : {}) });
                              }}
                              className={field}
                            >
                              {TIME_OPTS.slice(0, -1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                            </select>
                            <span className="shrink-0 text-[10.5px] font-semibold text-ink-faint">
                              {d.status === "early" ? "Leaves" : "End"}
                            </span>
                            <select
                              value={to}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                onSet(t.id, { endMin: v, ...(v <= from ? { startMin: Math.max(0, v - SLOT_MIN * 4) } : {}) });
                              }}
                              className={field}
                            >
                              {TIME_OPTS.slice(1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                            </select>
                          </div>
                        )}

                        {/* notes */}
                        <input
                          value={d.notes ?? ""}
                          onChange={(e) => onSet(t.id, { notes: e.target.value || undefined })}
                          placeholder="Note (optional), e.g. doctor appointment at 2"
                          className={field}
                        />
                        <p className="text-[10px] text-ink-faint">Changes save automatically for {dateLabel}.</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
