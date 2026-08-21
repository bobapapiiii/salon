// ─── Client for the new backend (server/) ─────────────────────────────────
// This is the ONLY file in the frontend that talks to a real server -- every
// other store in src/lib is still localStorage-only (see HANDOFF.md §9 and
// server/README.md for why online booking is a self-contained slice rather
// than a full migration in this pass).
//
// Base URL: set VITE_API_URL in app/.env (or app/.env.production for a
// deployed build) to your API's URL. Defaults to localhost for dev.
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body && (body as { error?: string }).error) || `Request failed (${res.status})`);
  }
  return body as T;
}

// ── public booking ──────────────────────────────────────────────────────

export interface BookingSalon {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  bookingOpenMin: number;
  bookingCloseMin: number;
  slotSizeMin: number;
}
export interface BookingCategory {
  id: string;
  name: string;
  sortOrder: number;
}
export interface BookingService {
  id: string;
  categoryId: string | null;
  name: string;
  durationMin: number;
  priceCents: number;
  tags: string[];
}
export interface BookingTech {
  id: string;
  name: string;
  title: string | null;
  skillServiceIds: string[];
}
export interface BookingInfo {
  salon: BookingSalon;
  categories: BookingCategory[];
  services: BookingService[];
  techs: BookingTech[];
}

export function fetchBookingInfo(slug: string): Promise<BookingInfo> {
  return request(`/api/booking/${encodeURIComponent(slug)}/info`);
}

export interface AvailableSlot {
  startMin: number;
  techIds: string[];
}

export function fetchAvailability(
  slug: string,
  params: { serviceId: string; date: string; techId?: string },
): Promise<{ date: string; slots: AvailableSlot[] }> {
  const q = new URLSearchParams({ serviceId: params.serviceId, date: params.date });
  if (params.techId) q.set("techId", params.techId);
  return request(`/api/booking/${encodeURIComponent(slug)}/availability?${q.toString()}`);
}

export interface CreateBookingInput {
  serviceId: string;
  techId: string;
  date: string;
  startMin: number;
  client: { name: string; phone: string; email?: string };
  note?: string;
}
export interface CreateBookingResult {
  id: string;
  status: string;
  date: string;
  startMin: number;
  durationMin: number;
  service: { id: string; name: string };
  tech: { id: string; name: string };
}

export function createBooking(slug: string, input: CreateBookingInput): Promise<CreateBookingResult> {
  return request(`/api/booking/${encodeURIComponent(slug)}/bookings`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── staff auth + online requests ────────────────────────────────────────

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  title: string;
  salonId: string;
}

export function staffLogin(email: string, password: string): Promise<{ token: string; user: StaffUser }> {
  return request(`/api/auth/login`, { method: "POST", body: JSON.stringify({ email, password }) });
}

export interface OnlineRequest {
  id: string;
  dateKey: string;
  startMin: number;
  durationMin: number;
  status: string;
  clientNote: string | null;
  createdAt: string;
  clientName: string;
  clientPhone: string;
  techName: string;
  serviceName: string;
  servicePriceCents: number;
}

export function fetchOnlineRequests(token: string): Promise<{ requests: OnlineRequest[] }> {
  return request(`/api/staff/online-requests`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Pending requests PLUS anything already confirmed elsewhere (e.g. from
 *  the Settings panel) that hasn't been placed on the calendar yet -- what
 *  AppointmentBook.tsx's sync polls. See online-booking-sync.ts. */
export function fetchBookingFeed(token: string): Promise<{ requests: OnlineRequest[] }> {
  return request(`/api/staff/booking-feed`, { headers: { Authorization: `Bearer ${token}` } });
}

export function approveOnlineRequest(token: string, id: string): Promise<unknown> {
  return request(`/api/staff/online-requests/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function declineOnlineRequest(token: string, id: string): Promise<unknown> {
  return request(`/api/staff/online-requests/${encodeURIComponent(id)}/decline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function fmtMinutes(m: number): string {
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}
