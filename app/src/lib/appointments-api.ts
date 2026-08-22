// ─── Fetch client for the Phase 2 calendar API (server/src/routes/
// appointments.ts) ───────────────────────────────────────────────────────
// Thin and dumb, mirrors staff-api.ts exactly: one function per route, no
// business logic, no optimistic-update/rollback here -- that lives in
// appointments-store.ts (the day-keyed cache) and schedule-store.ts.
//
// ApiAppointment matches routes/appointments.ts's apptRowToApi() output:
// known/queried columns are typed fields, and `profile`'s jsonb catch-all
// (notes, guestOf, priceOverride, requestedTechChoice, techRequested,
// genderMismatchOk, checkedInMin/startedMin/completedMin, customFields,
// walkinOrigin) is spread flat into the response server-side -- same
// "index signature for whatever else is in there" approach ApiTech uses.
import { ApiError, API_BASE } from "./booking-api";
import { getStaffToken } from "./auth";
import type { ServiceAddon } from "./booking-types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStaffToken();
  if (!token) throw new ApiError(401, "Not signed in");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // Only send Content-Type when there's actually a body -- see the
    // matching comment in staff-api.ts's request(). deleteBlockApi and
    // deleteScheduleOverride below send no body, and Fastify's default
    // JSON parser 400s a "Content-Type: application/json" request with no
    // body before the route handler ever runs.
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Conflict responses (409) always carry the current server row
    // (appointment/block) in the body -- ApiConflictError keeps it
    // attached so appointments-store.ts can reconcile without a second
    // round trip instead of just knowing "it failed."
    throw new ApiConflictError(res.status, (body && (body as { error?: string }).error) || `Request failed (${res.status})`, body);
  }
  return body as T;
}

export class ApiConflictError extends ApiError {
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(status, message);
    this.body = body;
  }
}

export { ApiError };

export interface ApiAppointment {
  id: string;
  techId: string;
  clientId: string | null;
  clientName: string;
  serviceId: string;
  dateKey: string;
  startMin: number;
  durationMin: number;
  status: string;
  bookingSource: string;
  clientNote: string | null;
  staffNote: string | null;
  parallelGroup: string | null;
  issue: boolean;
  addons: ServiceAddon[];
  log: { at: number; text: string }[];
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  [key: string]: unknown; // profile catch-all: notes, guestOf, priceOverride, etc.
}

export interface ApiTimeBlock {
  id: string;
  techId: string;
  dateKey: string;
  startMin: number;
  durationMin: number;
  reason: string;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ApiScheduleOverride {
  techId: string;
  dateKey: string;
  status: string;
  startMin: number | null;
  endMin: number | null;
  notes: string | null;
}

export interface DayBundle {
  appointments: ApiAppointment[];
  blocks: ApiTimeBlock[];
  scheduleOverrides: ApiScheduleOverride[];
}

export const fetchDayBundle = (dateKey: string) => request<DayBundle>(`/api/staff/day/${encodeURIComponent(dateKey)}`);

// ── appointments ───────────────────────────────────────────────────────

export type AppointmentCreateInput = Partial<
  Omit<ApiAppointment, "id" | "createdAt" | "decidedAt" | "decidedBy" | "version" | "updatedAt" | "updatedBy">
> & {
  id?: string;
  techId: string;
  clientName: string;
  serviceId: string;
  dateKey: string;
  startMin: number;
  durationMin: number;
};

export const createAppointment = (input: AppointmentCreateInput) =>
  request<{ appointment: ApiAppointment }>("/api/staff/appointments", { method: "POST", body: JSON.stringify(input) });

export type AppointmentPatchInput = Partial<
  Omit<ApiAppointment, "id" | "status" | "createdAt" | "decidedAt" | "decidedBy" | "version" | "updatedAt" | "updatedBy">
> & { expectedVersion: number };

export const patchAppointmentApi = (id: string, patch: AppointmentPatchInput) =>
  request<{ appointment: ApiAppointment }>(`/api/staff/appointments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const setAppointmentStatusApi = (id: string, status: string, expectedVersion: number, extra?: Record<string, unknown>) =>
  request<{ appointment: ApiAppointment }>(`/api/staff/appointments/${encodeURIComponent(id)}/status`, {
    method: "POST",
    body: JSON.stringify({ ...extra, status, expectedVersion }),
  });

export const moveAppointmentApi = (id: string, move: { techId?: string; dateKey?: string; startMin?: number; expectedVersion: number }) =>
  request<{ appointment: ApiAppointment }>(`/api/staff/appointments/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify(move),
  });

// ── time blocks ───────────────────────────────────────────────────────

export const fetchBlocks = (params?: { dateKey?: string; techId?: string }) => {
  const q = new URLSearchParams();
  if (params?.dateKey) q.set("dateKey", params.dateKey);
  if (params?.techId) q.set("techId", params.techId);
  const qs = q.toString();
  return request<{ blocks: ApiTimeBlock[] }>(`/api/staff/blocks${qs ? `?${qs}` : ""}`);
};

export const createBlock = (input: { id?: string; techId: string; dateKey: string; startMin: number; durationMin: number; reason?: string }) =>
  request<{ block: ApiTimeBlock }>("/api/staff/blocks", { method: "POST", body: JSON.stringify(input) });

export const patchBlockApi = (
  id: string,
  patch: Partial<Pick<ApiTimeBlock, "techId" | "dateKey" | "startMin" | "durationMin" | "reason">> & { expectedVersion: number },
) => request<{ block: ApiTimeBlock }>(`/api/staff/blocks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

export const deleteBlockApi = (id: string) => request<{ ok: true }>(`/api/staff/blocks/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── tech daily schedule overrides ────────────────────────────────────────

export const fetchScheduleOverrides = (params?: { dateKey?: string; from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (params?.dateKey) q.set("dateKey", params.dateKey);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return request<{ scheduleOverrides: ApiScheduleOverride[] }>(`/api/staff/schedule-overrides${qs ? `?${qs}` : ""}`);
};

export const putScheduleOverride = (
  techId: string,
  dateKey: string,
  patch: { status: string; startMin?: number | null; endMin?: number | null; notes?: string | null },
) =>
  request<{ scheduleOverride: ApiScheduleOverride }>(
    `/api/staff/schedule-overrides/${encodeURIComponent(techId)}/${encodeURIComponent(dateKey)}`,
    { method: "PUT", body: JSON.stringify(patch) },
  );

export const deleteScheduleOverride = (techId: string, dateKey: string) =>
  request<{ ok: true }>(`/api/staff/schedule-overrides/${encodeURIComponent(techId)}/${encodeURIComponent(dateKey)}`, { method: "DELETE" });
