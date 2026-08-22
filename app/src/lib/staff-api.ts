// ─── Fetch client for the Phase 1 staff-admin API (server/src/routes/
// catalog.ts, staff-admin.ts, clients.ts) ───────────────────────────────
// This is the "single API swap point" persist.ts's own comment anticipated:
// categories-store.ts / services-store.ts / staff-store.ts / the future
// clients-store.ts each swap their localStorage read/write internals for
// the functions here, keeping their exported shapes unchanged. Every call
// carries the signed-in staff token automatically (see lib/auth.ts) --
// callers never pass it by hand, unlike booking-api.ts's public/staff split
// where the token comes from whichever component happens to hold it.
//
// Money and color-token conversion stay client-side (see the Phase 1
// migration plan): this file passes dollars/cents and color strings through
// exactly as given, it never converts anything.
import { ApiError, API_BASE } from "./booking-api";
import { getStaffToken } from "./auth";
import type { ServiceAddon } from "./booking-types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStaffToken();
  if (!token) throw new ApiError(401, "Not signed in");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // Only send Content-Type when there's actually a body -- Fastify's
    // default JSON body parser treats "Content-Type: application/json"
    // with an empty/absent body as an error (FST_ERR_CTP_EMPTY_JSON_BODY),
    // replying 400 with `error: "Bad Request"` before the route handler
    // ever runs. Every DELETE call through this file (deleteCategory,
    // deleteService, deleteJobRole) sends no body, so it always hit this
    // -- looked exactly like the category having something still in it,
    // when the request never got far enough to check that.
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body && (body as { error?: string }).error) || `Request failed (${res.status})`);
  }
  return body as T;
}

export { ApiError };

// ── categories ─────────────────────────────────────────────────────────

export interface ApiServiceCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number;
  hue: string | null;
  fill: string | null;
  line: string | null;
  textColor: string | null;
  parentId: string | null;
  archived: boolean;
  onlineExcludedRoleIds: string[];
}

export type CategoryInput = Partial<
  Pick<ApiServiceCategory, "name" | "hue" | "fill" | "line" | "textColor" | "parentId" | "archived" | "onlineExcludedRoleIds" | "sortOrder">
>;

export const fetchCategories = () => request<{ categories: ApiServiceCategory[] }>("/api/staff/categories");
export const createCategory = (input: CategoryInput & { name: string; id?: string }) =>
  request<{ category: ApiServiceCategory }>("/api/staff/categories", { method: "POST", body: JSON.stringify(input) });
export const patchCategory = (id: string, patch: CategoryInput) =>
  request<{ category: ApiServiceCategory }>(`/api/staff/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const reorderCategories = (ids: string[]) =>
  request<{ ok: true }>("/api/staff/categories/reorder", { method: "POST", body: JSON.stringify({ ids }) });
export const deleteCategory = (id: string) => request<{ ok: true }>(`/api/staff/categories/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── services ───────────────────────────────────────────────────────────

export interface ApiService {
  id: string;
  salonId: string;
  categoryId: string | null;
  name: string;
  durationMin: number;
  priceCents: number;
  active: boolean;
  bookableOnline: boolean;
  tags: string[];
  sortOrder: number;
  short: string;
  teamAffinity: string | null;
  addons: ServiceAddon[];
  onlineExcludedRoleIds: string[];
}

export type ServiceInput = Partial<
  Pick<
    ApiService,
    | "name"
    | "short"
    | "durationMin"
    | "priceCents"
    | "categoryId"
    | "active"
    | "bookableOnline"
    | "tags"
    | "teamAffinity"
    | "addons"
    | "onlineExcludedRoleIds"
    | "sortOrder"
  >
>;

export const fetchServices = () => request<{ services: ApiService[] }>("/api/staff/services");
export const createService = (input: ServiceInput & { name: string; durationMin: number; priceCents: number; id?: string }) =>
  request<{ service: ApiService }>("/api/staff/services", { method: "POST", body: JSON.stringify(input) });
export const patchService = (id: string, patch: ServiceInput) =>
  request<{ service: ApiService }>(`/api/staff/services/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const reorderServices = (ids: string[]) =>
  request<{ ok: true }>("/api/staff/services/reorder", { method: "POST", body: JSON.stringify({ ids }) });
export const deleteService = (id: string) => request<{ ok: true }>(`/api/staff/services/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── job roles ──────────────────────────────────────────────────────────

export interface ApiJobRole {
  id: string;
  name: string;
  sortOrder: number;
  serviceIds: string[];
}

export type JobRoleInput = Partial<Pick<ApiJobRole, "name" | "serviceIds" | "sortOrder">>;

export const fetchJobRoles = () => request<{ roles: ApiJobRole[] }>("/api/staff/job-roles");
export const createJobRole = (input: JobRoleInput & { name: string; id?: string }) =>
  request<{ role: ApiJobRole }>("/api/staff/job-roles", { method: "POST", body: JSON.stringify(input) });
export const patchJobRole = (id: string, patch: JobRoleInput) =>
  request<{ role: ApiJobRole }>(`/api/staff/job-roles/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const reorderJobRoles = (ids: string[]) =>
  request<{ ok: true }>("/api/staff/job-roles/reorder", { method: "POST", body: JSON.stringify({ ids }) });
export const deleteJobRole = (id: string) => request<{ ok: true }>(`/api/staff/job-roles/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── techs ──────────────────────────────────────────────────────────────
// The server (routes/staff-admin.ts) reassembles a flat Tech-shaped object
// on every read -- known columns (name/teamId/skills/active/archived/
// bookableOnline/phone/email/commissionPct) plus whatever the rest of the
// frontend's Tech type needs, merged in from its jsonb catch-all. This
// client stays agnostic of exactly which keys those are: `ApiTech` types
// the columns it knows are always present and allows anything else through.
export interface ApiTech {
  id: string;
  name: string;
  teamId: string | null;
  skills: string[];
  active: boolean;
  archived: boolean;
  bookableOnline: boolean;
  phone: string | null;
  email: string | null;
  commissionPct: number | null;
  [key: string]: unknown;
}

export type TechInput = Partial<Omit<ApiTech, "id">>;

export const fetchTechs = () => request<{ techs: ApiTech[] }>("/api/staff/techs");
export const createTech = (input: TechInput & { name: string; teamId: string; id?: string }) =>
  request<{ tech: ApiTech }>("/api/staff/techs", { method: "POST", body: JSON.stringify(input) });
export const patchTech = (id: string, patch: TechInput) =>
  request<{ tech: ApiTech }>(`/api/staff/techs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

// ── clients ────────────────────────────────────────────────────────────

export interface ApiClient {
  id: string;
  salonId: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  createdAt: string;
  visits: number;
  preferredTechs: { id: string; techId: string; categoryIds: string[] }[];
  guests: { id: string; name: string }[];
}

export type ClientInput = Partial<
  Pick<ApiClient, "name" | "phone" | "email" | "tags" | "visits" | "preferredTechs" | "guests">
>;

export const fetchClients = () => request<{ clients: ApiClient[] }>("/api/staff/clients");
export const createClient = (input: ClientInput & { name: string; phone: string; id?: string }) =>
  request<{ client: ApiClient }>("/api/staff/clients", { method: "POST", body: JSON.stringify(input) });
export const patchClient = (id: string, patch: ClientInput) =>
  request<{ client: ApiClient }>(`/api/staff/clients/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
