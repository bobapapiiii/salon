// ─── Tech daily schedule overrides (Phase 2) ──────────────────────────────
// Kept as its own store, separate from appointments-store.ts, since it's
// tech-scoped rather than appointment-scoped and has a different consumer
// (TechSchedulePanel.tsx) -- but it reads/writes the SAME day-bundle cache
// appointments-store.ts already fetches (GET /api/staff/day/:dateKey
// returns scheduleOverrides bundled with appointments+blocks in one round
// trip), so there's no separate fetch to coordinate here.
//
// No optimistic-concurrency version column on this table (deliberate --
// see the Phase 2 plan's schema section: low-frequency, single-row
// upserts from one settings panel, not a drag-heavy shared surface), so
// mutations here are a plain optimistic-apply + rollback-on-failure, no
// 409/expectedVersion dance.
import { toast } from "sonner";
import type { DaySchedule, TechDay } from "@/components/book/TechSchedulePanel";
import {
  deleteScheduleOverride as apiDeleteScheduleOverride,
  putScheduleOverride as apiPutScheduleOverride,
  type ApiScheduleOverride,
  ApiError,
} from "./appointments-api";
import { getDayScheduleOverrides, setDayScheduleOverrides, useDayScheduleOverrides } from "./appointments-store";

function apiToTechDay(row: ApiScheduleOverride): TechDay {
  return {
    status: row.status as TechDay["status"],
    ...(row.startMin != null ? { startMin: row.startMin } : {}),
    ...(row.endMin != null ? { endMin: row.endMin } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  };
}

/** DaySchedule (Record<techId, TechDay>) for the given day -- what
 *  TechSchedulePanel.tsx and the calendar's effective-schedule tier-1
 *  lookup both want, reactive via the shared day-bundle cache. */
export function useDaySchedule(dateKey: string): DaySchedule {
  const overrides = useDayScheduleOverrides(dateKey);
  const out: DaySchedule = {};
  for (const row of overrides) out[row.techId] = apiToTechDay(row);
  return out;
}

/** Non-hook read, for effects/computed values outside render (mirrors the
 *  getX() pattern every other Phase 1/2 store exposes). */
export function getDaySchedule(dateKey: string): DaySchedule {
  const out: DaySchedule = {};
  for (const row of getDayScheduleOverrides(dateKey)) out[row.techId] = apiToTechDay(row);
  return out;
}

function errorMessage(err: unknown) {
  return err instanceof ApiError ? err.message : "Couldn't save that change -- please try again";
}

/** Shallow-merge upsert, matching the existing setTechDay's semantics
 *  exactly (AppointmentBook.tsx: effective = day[id] ?? {status:'working'},
 *  then merge patch over it) -- TechSchedulePanel.tsx's onSet prop keeps
 *  this exact signature, only what AppointmentBook.tsx does inside it
 *  changes (calls this instead of the old local usePersistentState setter). */
export function setTechDay(dateKey: string, techId: string, patch: Partial<TechDay>) {
  const current = getDayScheduleOverrides(dateKey);
  const before = current.find((o) => o.techId === techId);
  const effective: TechDay = before ? apiToTechDay(before) : { status: "working" };
  const merged: TechDay = { ...effective, ...patch };

  const optimistic: ApiScheduleOverride = {
    techId,
    dateKey,
    status: merged.status,
    startMin: merged.startMin ?? null,
    endMin: merged.endMin ?? null,
    notes: merged.notes ?? null,
  };
  setDayScheduleOverrides(dateKey, [...current.filter((o) => o.techId !== techId), optimistic]);

  apiPutScheduleOverride(techId, dateKey, {
    status: merged.status,
    startMin: merged.startMin ?? null,
    endMin: merged.endMin ?? null,
    notes: merged.notes ?? null,
  }).catch((err) => {
    const rolledBack = getDayScheduleOverrides(dateKey).filter((o) => o.techId !== techId);
    setDayScheduleOverrides(dateKey, before ? [...rolledBack, before] : rolledBack);
    toast.error(errorMessage(err));
  });
}

/** Clear the override entirely -- falls back to the tech's normal
 *  timeOff/weeklySchedule tiers (tiers 2/3 of the existing 3-tier
 *  effective-schedule fallback, unchanged by Phase 2). */
export function clearTechDay(dateKey: string, techId: string) {
  const current = getDayScheduleOverrides(dateKey);
  const before = current.find((o) => o.techId === techId);
  if (!before) return;
  setDayScheduleOverrides(dateKey, current.filter((o) => o.techId !== techId));

  apiDeleteScheduleOverride(techId, dateKey).catch((err) => {
    setDayScheduleOverrides(dateKey, [...getDayScheduleOverrides(dateKey), before]);
    toast.error(errorMessage(err));
  });
}
