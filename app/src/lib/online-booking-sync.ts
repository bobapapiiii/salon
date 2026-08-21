// ─── Bridges the new backend's online bookings onto the existing calendar ──
// The calendar (AppointmentBook.tsx) is the only thing that ever writes to
// `apptDays`/`appts` for this feature -- these are plain functions it calls
// on a poll interval, not a React store, so there is exactly one writer and
// no risk of two components racing to persist the same day's appointments.
// See HANDOFF.md #10 for the fuller "why."
import type { Appointment, Service, Tech } from "./booking-types";
import { logEntry } from "./booking-types";
import { sdata } from "./persist";
import type { OnlineRequest } from "./booking-api";

/** Same storage key OnlineRequestsSection.tsx signs in to -- read directly
 *  from localStorage (not usePersistentState) so a poll running in a
 *  different component always sees the latest sign-in, not whatever was
 *  true when that component mounted. */
export function getStoredStaffToken(): string | null {
  try {
    const raw = localStorage.getItem(sdata("online-requests-auth-v1"));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string } | null;
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

/** Best-effort exact-then-loose name match. The backend and the frontend
 *  keep separate catalogs (see server/README.md); this is the join between
 *  them until there's one shared source of truth. Case/whitespace-insensitive
 *  exact match first, then a substring fallback for small drift (e.g. a
 *  trailing initial). Returns undefined rather than guessing wrong. */
function matchByName<T extends { name: string }>(name: string, pool: T[]): T | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(name);
  return (
    pool.find((x) => norm(x.name) === target) ??
    pool.find((x) => norm(x.name).startsWith(target) || target.startsWith(norm(x.name)))
  );
}

export function resolveTechForRow(row: OnlineRequest, techs: Tech[]): Tech | undefined {
  return matchByName(row.techName, techs);
}

export function resolveServiceForRow(row: OnlineRequest, services: Service[]): Service | undefined {
  return matchByName(row.serviceName, services);
}

/** Every onlineRequestId already materialized anywhere on the calendar, so
 *  the poller never double-inserts the same backend row twice. Scans the
 *  full persisted map plus the live (possibly not-yet-mirrored) current day. */
export function collectKnownOnlineRequestIds(
  apptDays: Record<string, Appointment[]>,
  currentDateKey: string,
  currentAppts: Appointment[],
): Set<string> {
  const ids = new Set<string>();
  for (const [day, list] of Object.entries(apptDays)) {
    const dayList = day === currentDateKey ? currentAppts : list;
    for (const a of dayList) if (a.onlineRequestId) ids.add(a.onlineRequestId);
  }
  for (const a of currentAppts) if (a.onlineRequestId) ids.add(a.onlineRequestId);
  return ids;
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

/** true if placing this tech/time on this day's existing appointments would
 *  double-book -- used only for the "already confirmed elsewhere" path,
 *  since a still-`requested` row goes through the calendar's own Approve
 *  flow (AppointmentBook.tsx's approveRequest), which already does real
 *  placement/relocation. This is a much simpler "would this collide"
 *  check, not a placement algorithm. */
export function hasTimeConflict(dayAppts: Appointment[], techId: string, startMin: number, durationMin: number): boolean {
  return dayAppts.some(
    (a) => a.techId === techId && a.status !== "no_show" && overlaps(startMin, durationMin, a.startMin, a.durationMin),
  );
}

/** Build the local Appointment for a backend row that's still awaiting
 *  approval -- lands in the existing Requests rail exactly like any other
 *  online request, so staff approve/decline it the same way they always
 *  have (AppointmentBook.tsx's approveRequest/declineRequest). */
export function buildRequestedAppointment(row: OnlineRequest, techId: string, serviceId: string): Appointment {
  return {
    id: `online-${row.id}`,
    techId,
    clientName: row.clientName,
    serviceId,
    startMin: row.startMin,
    durationMin: row.durationMin,
    status: "requested",
    notes: row.clientNote ?? undefined,
    bookingSource: "online",
    onlineRequestId: row.id,
    log: [logEntry(`Online booking request received (${row.clientPhone})`)],
  };
}

/** Build the local Appointment for a backend row a manager already
 *  confirmed from Settings → Online requests, before this calendar ever
 *  saw it as a request. Placed directly rather than re-run through the
 *  approve flow (that decision is already made); flagged with `issue` if
 *  it collides with something already on the board, so staff notice via
 *  the existing amber-heart marker instead of it silently double-booking. */
export function buildConfirmedAppointment(row: OnlineRequest, techId: string, serviceId: string, dayAppts: Appointment[]): Appointment {
  const conflict = hasTimeConflict(dayAppts, techId, row.startMin, row.durationMin);
  return {
    id: `online-${row.id}`,
    techId,
    clientName: row.clientName,
    serviceId,
    startMin: row.startMin,
    durationMin: row.durationMin,
    status: "confirmed",
    notes: row.clientNote ?? undefined,
    bookingSource: "online",
    onlineRequestId: row.id,
    issue: conflict || undefined,
    log: [
      logEntry("Confirmed online via Settings → Online requests"),
      ...(conflict ? [logEntry("Time conflicts with another booking, needs a look")] : []),
    ],
  };
}
