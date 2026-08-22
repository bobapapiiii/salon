// ─── Calendar core: day-keyed appointment + time-block cache ─────────────
// Phase 2 of the localStorage -> Postgres migration. Deliberately NOT the
// Phase 1 whole-array-in-memory pattern (categories-store.ts et al) --
// appointments are unbounded (every day, forever) and the calendar only
// ever needs 1-3 days resident at once, so this mirrors the *existing*
// frontend architecture (apptDays, lazy goDay()) and just swaps its source
// from always-present localStorage to fetch-on-first-visit.
//
// Mutations are per-row optimistic, not whole-array diff-and-rollback:
// a single drag/patch/status-change snapshots and rolls back only the one
// affected appointment, not the whole day -- a whole-day rollback would be
// both more disruptive on failure and wrong under concurrent edits from
// another terminal touching a *different* card on the same day.
//
// Every mutating call sends `expectedVersion` (optimistic concurrency,
// see routes/appointments.ts). A 409 always carries the current server
// row (ApiConflictError.body), so conflicts are resolved by replacing the
// local row with the authoritative one + a toast, never by silently
// re-applying the stale local change.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Appointment, ApptStatus, TimeBlock } from "./booking-types";
import {
  ApiConflictError,
  ApiError,
  createAppointment as apiCreateAppointment,
  createBlock as apiCreateBlock,
  deleteBlockApi as apiDeleteBlock,
  fetchDayBundle,
  moveAppointmentApi as apiMoveAppointment,
  patchAppointmentApi as apiPatchAppointment,
  patchBlockApi as apiPatchBlock,
  setAppointmentStatusApi as apiSetAppointmentStatus,
  type ApiAppointment,
  type ApiScheduleOverride,
  type ApiTimeBlock,
} from "./appointments-api";

const RETRY_COOLDOWN_MS = 5000;
const EMPTY_APPTS: Appointment[] = [];
const EMPTY_BLOCKS: TimeBlock[] = [];
const EMPTY_OVERRIDES: ApiScheduleOverride[] = [];

interface DayState {
  appts: ApiAppointment[];
  blocks: ApiTimeBlock[];
  scheduleOverrides: ApiScheduleOverride[];
}

const days = new Map<string, DayState>();
const loadedDays = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const lastFailureAt = new Map<string, number>();

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

function loadDay(dateKey: string): Promise<void> {
  if (loadedDays.has(dateKey)) return Promise.resolve();
  const existing = inFlight.get(dateKey);
  if (existing) return existing;
  const failedAt = lastFailureAt.get(dateKey);
  if (failedAt && Date.now() - failedAt < RETRY_COOLDOWN_MS) return Promise.resolve();

  const p = fetchDayBundle(dateKey)
    .then((bundle) => {
      days.set(dateKey, { appts: bundle.appointments, blocks: bundle.blocks, scheduleOverrides: bundle.scheduleOverrides });
      loadedDays.add(dateKey);
      emit();
    })
    .catch((err) => {
      lastFailureAt.set(dateKey, Date.now());
      console.error(`Failed to load day ${dateKey}, will retry`, err);
    })
    .finally(() => {
      inFlight.delete(dateKey);
    });
  inFlight.set(dateKey, p);
  return p;
}

/** call on every render of a day-scoped hook -- cheap no-op once that day
 *  is loaded, dedup'd/cooldown'd otherwise, same convention as
 *  store-loader.ts's makeLoader (which doesn't fit here since it's keyed
 *  to one global fetch, not N per-day fetches). */
export function ensureDayLoaded(dateKey: string) {
  loadDay(dateKey);
}
export const isDayLoaded = (dateKey: string) => loadedDays.has(dateKey);
/** Every day currently resident in the cache (i.e. actually visited/fetched
 *  this session) -- NOT "every day that has ever had an appointment" the
 *  way the old all-in-localStorage apptDays map could enumerate. Call
 *  sites that used to scan every day (a client's full guest-visit history,
 *  a day-picker's "has data" set) now only see what's been loaded so far;
 *  a real cross-day search is a follow-up server endpoint, out of scope
 *  for this pass. */
export const getLoadedDayKeys = () => [...loadedDays];

// ── server row -> frontend shape ─────────────────────────────────────────
// Only sets a key when the server actually has a value for it, matching
// every other Phase 1/2 store's convention (apiToClient etc) so consumers
// that check `a.field === undefined` keep working exactly as before --
// "no value" must stay absent, not become null.

export function apiToAppointment(row: ApiAppointment): Appointment {
  return {
    id: row.id,
    techId: row.techId,
    clientName: row.clientName,
    serviceId: row.serviceId,
    startMin: row.startMin,
    durationMin: row.durationMin,
    status: row.status as ApptStatus,
    ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
    ...(row.parallelGroup ? { parallelGroup: row.parallelGroup } : {}),
    ...(typeof row.guestOf === "string" ? { guestOf: row.guestOf } : {}),
    ...(row.addons?.length ? { addons: row.addons } : {}),
    ...(typeof row.priceOverride === "number" ? { priceOverride: row.priceOverride } : {}),
    ...(row.issue ? { issue: true } : {}),
    ...(row.requestedTechChoice ? { requestedTechChoice: row.requestedTechChoice as Appointment["requestedTechChoice"] } : {}),
    ...(row.techRequested ? { techRequested: true } : {}),
    ...(row.genderMismatchOk ? { genderMismatchOk: true } : {}),
    ...(typeof row.checkedInMin === "number" ? { checkedInMin: row.checkedInMin } : {}),
    ...(typeof row.startedMin === "number" ? { startedMin: row.startedMin } : {}),
    ...(typeof row.completedMin === "number" ? { completedMin: row.completedMin } : {}),
    ...(row.customFields ? { customFields: row.customFields as Record<string, string> } : {}),
    ...(row.log?.length ? { log: row.log } : {}),
    ...(row.bookingSource ? { bookingSource: row.bookingSource as Appointment["bookingSource"] } : {}),
    ...(typeof row.walkinOrigin === "string" ? { walkinOrigin: row.walkinOrigin } : {}),
  };
}

function apiToBlock(row: ApiTimeBlock): TimeBlock {
  return { id: row.id, techId: row.techId, startMin: row.startMin, durationMin: row.durationMin, reason: row.reason };
}

/** Frontend Appointment fields map 1:1 onto the API wire shape (both use
 *  `bookingSource`) EXCEPT onlineRequestId, which is dropped -- retired as
 *  of Phase 2, nothing left to bridge (see the plan's bridge-retirement
 *  section); any lingering value on an old in-memory object is never sent. */
function apptPatchToApi(patch: Partial<Appointment> & { clientId?: string | null }): Record<string, unknown> {
  const { onlineRequestId: _drop, ...rest } = patch as Partial<Appointment> & { clientId?: string | null; onlineRequestId?: string };
  return rest;
}

// Active (rendered) statuses -- cancelled/declined are soft-deleted server
// side but the frontend's ApptStatus type never included them (a
// cancelled/declined appointment has always just vanished from the board).
// Filtering here, not server-side, preserves that exact behavior.
const HIDDEN_STATUSES = new Set(["cancelled", "declined"]);

export function useDayAppointments(dateKey: string): Appointment[] {
  ensureDayLoaded(dateKey);
  const snapshot = useSyncExternalStore(subscribe, () => days.get(dateKey)?.appts ?? null);
  if (!snapshot) return EMPTY_APPTS;
  return snapshot.filter((a) => !HIDDEN_STATUSES.has(a.status)).map(apiToAppointment);
}

export function useDayBlocks(dateKey: string): TimeBlock[] {
  ensureDayLoaded(dateKey);
  const snapshot = useSyncExternalStore(subscribe, () => days.get(dateKey)?.blocks ?? null);
  if (!snapshot) return EMPTY_BLOCKS;
  return snapshot.map(apiToBlock);
}

/** Non-hook read for event handlers/effects (mirrors getClients()) --
 *  includes cancelled/declined and the full server row (version etc),
 *  since mutation call sites need `version` to send as expectedVersion. */
export function getDayApiAppointments(dateKey: string): ApiAppointment[] {
  ensureDayLoaded(dateKey);
  return days.get(dateKey)?.appts ?? [];
}
export function getApiAppointment(dateKey: string, id: string): ApiAppointment | undefined {
  return getDayApiAppointments(dateKey).find((a) => a.id === id);
}
export function getDayApiBlocks(dateKey: string): ApiTimeBlock[] {
  ensureDayLoaded(dateKey);
  return days.get(dateKey)?.blocks ?? [];
}

// ── schedule overrides: read/write surface for schedule-store.ts. Kept
// here rather than fetched separately -- the day-bundle GET already
// returns scheduleOverrides bundled with appointments+blocks in one round
// trip, so schedule-store.ts reads/writes this slice of the same day
// cache instead of duplicating the fetch. schedule-store.ts owns the
// actual PUT/DELETE mutation calls and the tech-scoped setTechDay API. ──
export function useDayScheduleOverrides(dateKey: string): ApiScheduleOverride[] {
  ensureDayLoaded(dateKey);
  return useSyncExternalStore(subscribe, () => days.get(dateKey)?.scheduleOverrides ?? EMPTY_OVERRIDES);
}
export function getDayScheduleOverrides(dateKey: string): ApiScheduleOverride[] {
  ensureDayLoaded(dateKey);
  return days.get(dateKey)?.scheduleOverrides ?? EMPTY_OVERRIDES;
}
export function setDayScheduleOverrides(dateKey: string, scheduleOverrides: ApiScheduleOverride[]) {
  const existing = days.get(dateKey);
  days.set(dateKey, { appts: existing?.appts ?? [], blocks: existing?.blocks ?? [], scheduleOverrides });
  emit();
}

function setDayAppts(dateKey: string, appts: ApiAppointment[]) {
  const existing = days.get(dateKey);
  days.set(dateKey, { appts, blocks: existing?.blocks ?? [], scheduleOverrides: existing?.scheduleOverrides ?? [] });
  emit();
}
function setDayBlocks(dateKey: string, blocks: ApiTimeBlock[]) {
  const existing = days.get(dateKey);
  days.set(dateKey, { appts: existing?.appts ?? [], blocks, scheduleOverrides: existing?.scheduleOverrides ?? [] });
  emit();
}

function errorMessage(err: unknown) {
  return err instanceof ApiError ? err.message : "Couldn't save that change -- please try again";
}

// ── appointment mutations ────────────────────────────────────────────────

/** Optimistic create: the caller supplies id (crypto.randomUUID(), same
 *  id-up-front convention every Phase 1 table uses) so there's zero id
 *  reconciliation once the request resolves -- the card the client
 *  already rendered IS the row the server persisted. On failure, the
 *  optimistic row is removed and a toast fires. */
export function createAppointment(dateKey: string, draft: Appointment & { clientId?: string | null; status?: string }) {
  const current = days.get(dateKey)?.appts ?? [];
  const patchFields = apptPatchToApi(draft);
  const optimistic: ApiAppointment = {
    id: draft.id,
    techId: draft.techId,
    clientId: draft.clientId ?? null,
    clientName: draft.clientName,
    serviceId: draft.serviceId,
    dateKey,
    startMin: draft.startMin,
    durationMin: draft.durationMin,
    status: draft.status ?? "booked",
    bookingSource: draft.bookingSource ?? "front_desk",
    clientNote: null,
    staffNote: null,
    parallelGroup: draft.parallelGroup ?? null,
    issue: draft.issue ?? false,
    addons: draft.addons ?? [],
    log: draft.log ?? [],
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: null,
    ...patchFields,
  };
  setDayAppts(dateKey, [...current, optimistic]);

  apiCreateAppointment({
    ...patchFields,
    id: draft.id,
    techId: draft.techId,
    clientId: draft.clientId ?? undefined,
    clientName: draft.clientName,
    serviceId: draft.serviceId,
    dateKey,
    startMin: draft.startMin,
    durationMin: draft.durationMin,
    status: draft.status,
  } as never)
    .then((res) => {
      // Merge the server's authoritative version/timestamps onto the row
      // already rendered -- id already matched, no other reconciliation.
      const list = days.get(dateKey)?.appts ?? [];
      setDayAppts(dateKey, list.map((a) => (a.id === draft.id ? res.appointment : a)));
    })
    .catch((err) => {
      const list = days.get(dateKey)?.appts ?? [];
      setDayAppts(dateKey, list.filter((a) => a.id !== draft.id));
      toast.error(errorMessage(err));
    });
}

/** Optimistic single-row field patch. `dateKey` is explicit (not "current
 *  day") since checkout/reopen flows write into a different day's data
 *  than the one on screen -- see AppointmentBook.tsx's reopenPatchLine/
 *  reopenAddExtra call sites.
 *
 *  `patch.dateKey` is allowed too (the server's general PATCH accepts it
 *  as a normal column, see routes/appointments.ts's APPT_COLUMN_KEYS) --
 *  AppointmentBook.tsx's commit() diff-translator uses this single call
 *  for a cross-day edit that also changes content, rather than a separate
 *  PATCH + /move pair racing each other on the same expectedVersion. When
 *  the target day differs from `dateKey`, the row is relocated between
 *  cache slots the same way moveAppointment() does. */
export function patchAppointment(
  dateKey: string,
  id: string,
  patch: Partial<Appointment> & { clientId?: string | null; dateKey?: string },
) {
  const list = days.get(dateKey)?.appts ?? [];
  const before = list.find((a) => a.id === id);
  if (!before) return;
  const apiPatch = apptPatchToApi(patch);
  const targetDateKey = (apiPatch.dateKey as string | undefined) ?? dateKey;
  const optimistic: ApiAppointment = { ...before, ...apiPatch, version: before.version };

  if (targetDateKey === dateKey) {
    setDayAppts(dateKey, list.map((a) => (a.id === id ? optimistic : a)));
  } else {
    setDayAppts(dateKey, list.filter((a) => a.id !== id));
    if (days.has(targetDateKey)) {
      setDayAppts(targetDateKey, [...(days.get(targetDateKey)?.appts ?? []), optimistic]);
    }
  }

  return apiPatchAppointment(id, { ...(apiPatch as object), expectedVersion: before.version } as never)
    .then((res) => {
      const homeKey = res.appointment.dateKey;
      if (days.has(homeKey)) {
        setDayAppts(homeKey, [...(days.get(homeKey)?.appts ?? []).filter((a) => a.id !== id), res.appointment]);
      }
      for (const [key, day] of days) {
        if (key !== homeKey && day.appts.some((a) => a.id === id)) {
          setDayAppts(key, day.appts.filter((a) => a.id !== id));
        }
      }
    })
    .catch((err) => {
      // revert: pull the optimistic row out of wherever it landed, restore
      // its original day/slot (or the server's authoritative row on a 409)
      for (const [key, day] of days) {
        if (key !== dateKey && day.appts.some((a) => a.id === id)) {
          setDayAppts(key, day.appts.filter((a) => a.id !== id));
        }
      }
      const current = (days.get(dateKey)?.appts ?? []).filter((a) => a.id !== id);
      if (err instanceof ApiConflictError && err.status === 409 && err.body && typeof err.body === "object" && "appointment" in err.body) {
        const serverRow = (err.body as { appointment: ApiAppointment }).appointment;
        setDayAppts(serverRow.dateKey, [...(days.get(serverRow.dateKey)?.appts ?? []).filter((a) => a.id !== id), serverRow]);
        if (serverRow.dateKey !== dateKey) setDayAppts(dateKey, current);
        toast.error("That appointment changed elsewhere -- refreshed");
      } else {
        setDayAppts(dateKey, [...current, before]);
        toast.error(errorMessage(err));
      }
    });
}

/** Drag/resize/cross-day reschedule. May relocate the row into a
 *  different day's cache entry -- if the target day isn't loaded yet,
 *  it's simply not inserted there; the next visit to that day fetches it
 *  fresh from the server, which already has the move applied. */
export function moveAppointment(dateKey: string, id: string, move: { techId?: string; dateKey?: string; startMin?: number }) {
  const list = days.get(dateKey)?.appts ?? [];
  const before = list.find((a) => a.id === id);
  if (!before) return;
  const targetDateKey = move.dateKey ?? dateKey;
  const optimistic: ApiAppointment = {
    ...before,
    techId: move.techId ?? before.techId,
    dateKey: targetDateKey,
    startMin: move.startMin ?? before.startMin,
  };

  if (targetDateKey === dateKey) {
    setDayAppts(dateKey, list.map((a) => (a.id === id ? optimistic : a)));
  } else {
    setDayAppts(dateKey, list.filter((a) => a.id !== id));
    if (days.has(targetDateKey)) {
      const targetList = days.get(targetDateKey)?.appts ?? [];
      setDayAppts(targetDateKey, [...targetList, optimistic]);
    }
  }

  apiMoveAppointment(id, { ...move, expectedVersion: before.version })
    .then((res) => {
      const homeKey = res.appointment.dateKey;
      if (days.has(homeKey)) {
        const homeList = (days.get(homeKey)?.appts ?? []).filter((a) => a.id !== id);
        setDayAppts(homeKey, [...homeList, res.appointment]);
      }
      // Clean up the id from every OTHER cached day it might still be
      // sitting in (the optimistic pre-move day, if different from home).
      for (const [key, day] of days) {
        if (key !== homeKey && day.appts.some((a) => a.id === id)) {
          setDayAppts(key, day.appts.filter((a) => a.id !== id));
        }
      }
    })
    .catch((err) => {
      // Revert: remove from wherever it optimistically landed, restore to
      // its original day.
      for (const [key, day] of days) {
        if (key !== dateKey && day.appts.some((a) => a.id === id)) {
          setDayAppts(key, day.appts.filter((a) => a.id !== id));
        }
      }
      const current = (days.get(dateKey)?.appts ?? []).filter((a) => a.id !== id);
      setDayAppts(dateKey, [...current, before]);

      if (err instanceof ApiConflictError && err.body && typeof err.body === "object" && "appointment" in err.body) {
        toast.error((err as ApiError).message || "That slot is taken -- refreshed");
      } else {
        toast.error(errorMessage(err));
      }
    });
}

/** Thin status-transition wrapper -- transition validity is enforced
 *  server-side (routes/appointments.ts's STATUS_TRANSITIONS map); a
 *  rejected transition comes back as the same 409-with-current-row shape
 *  as any other conflict.
 *
 *  `extra` bundles any accompanying content fields (a log entry, a
 *  checkedInMin/startedMin/completedMin stamp, even a techId reassignment
 *  for the approve-and-place flow) into the SAME request as the status
 *  transition -- the dedicated /status route accepts them alongside
 *  `status` for exactly this reason (see routes/appointments.ts). Sending
 *  them as a separate PATCH afterward would race this call on the same
 *  expectedVersion and spuriously 409 against itself. */
export function setStatus(
  dateKey: string,
  id: string,
  status: ApptStatus | "cancelled" | "declined",
  extra?: Partial<Appointment> & { clientId?: string | null },
) {
  const list = days.get(dateKey)?.appts ?? [];
  const before = list.find((a) => a.id === id);
  if (!before) return;
  const extraApi = extra ? apptPatchToApi(extra) : {};
  const optimistic: ApiAppointment = { ...before, ...extraApi, status };
  setDayAppts(dateKey, list.map((a) => (a.id === id ? optimistic : a)));

  return apiSetAppointmentStatus(id, status, before.version, extraApi)
    .then((res) => {
      const current = days.get(dateKey)?.appts ?? [];
      setDayAppts(dateKey, current.map((a) => (a.id === id ? res.appointment : a)));
    })
    .catch((err) => {
      const current = days.get(dateKey)?.appts ?? [];
      if (err instanceof ApiConflictError && err.body && typeof err.body === "object" && "appointment" in err.body) {
        setDayAppts(dateKey, current.map((a) => (a.id === id ? (err.body as { appointment: ApiAppointment }).appointment : a)));
        toast.error((err as ApiError).message || "That appointment changed elsewhere -- refreshed");
      } else {
        setDayAppts(dateKey, current.map((a) => (a.id === id ? before : a)));
        toast.error(errorMessage(err));
      }
    });
}

// ── time block mutations ─────────────────────────────────────────────────

export function createBlock(dateKey: string, draft: TimeBlock) {
  const current = days.get(dateKey)?.blocks ?? [];
  const optimistic: ApiTimeBlock = {
    id: draft.id,
    techId: draft.techId,
    dateKey,
    startMin: draft.startMin,
    durationMin: draft.durationMin,
    reason: draft.reason,
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: null,
  };
  setDayBlocks(dateKey, [...current, optimistic]);

  apiCreateBlock({ id: draft.id, techId: draft.techId, dateKey, startMin: draft.startMin, durationMin: draft.durationMin, reason: draft.reason })
    .then((res) => {
      const list = days.get(dateKey)?.blocks ?? [];
      setDayBlocks(dateKey, list.map((b) => (b.id === draft.id ? res.block : b)));
    })
    .catch((err) => {
      const list = days.get(dateKey)?.blocks ?? [];
      setDayBlocks(dateKey, list.filter((b) => b.id !== draft.id));
      toast.error(errorMessage(err));
    });
}

export function patchBlock(dateKey: string, id: string, patch: Partial<TimeBlock>) {
  const list = days.get(dateKey)?.blocks ?? [];
  const before = list.find((b) => b.id === id);
  if (!before) return;
  const optimistic: ApiTimeBlock = { ...before, ...patch };
  setDayBlocks(dateKey, list.map((b) => (b.id === id ? optimistic : b)));

  apiPatchBlock(id, { ...patch, expectedVersion: before.version })
    .then((res) => {
      const current = days.get(dateKey)?.blocks ?? [];
      setDayBlocks(dateKey, current.map((b) => (b.id === id ? res.block : b)));
    })
    .catch((err) => {
      const current = days.get(dateKey)?.blocks ?? [];
      if (err instanceof ApiConflictError && err.body && typeof err.body === "object" && "block" in err.body) {
        setDayBlocks(dateKey, current.map((b) => (b.id === id ? (err.body as { block: ApiTimeBlock }).block : b)));
        toast.error("That block changed elsewhere -- refreshed");
      } else {
        setDayBlocks(dateKey, current.map((b) => (b.id === id ? before : b)));
        toast.error(errorMessage(err));
      }
    });
}

export function deleteBlock(dateKey: string, id: string) {
  const list = days.get(dateKey)?.blocks ?? [];
  const before = list.find((b) => b.id === id);
  setDayBlocks(dateKey, list.filter((b) => b.id !== id));

  apiDeleteBlock(id).catch((err) => {
    if (before) {
      const current = days.get(dateKey)?.blocks ?? [];
      setDayBlocks(dateKey, [...current, before]);
    }
    toast.error(errorMessage(err));
  });
}
