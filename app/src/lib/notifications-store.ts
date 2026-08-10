// ─── Notifications store, a running feed of things the salon should know ────
// A global, cross-appointment activity log, distinct from a single
// appointment's own `log` (booking-types.ts). Anything that happens on the
// board that an owner/manager would want visibility into — a new booking,
// a move, a checkout, a cancellation, a no-show, a waitlist join, a
// turnaway — gets pushed here from wherever it happens via `addNotification`,
// a plain function callable from anywhere (not just inside a component),
// same pattern as `setSettings`/`setServices` elsewhere in this codebase.
import { useSyncExternalStore } from "react";
import { sdata } from "./persist";

export type NotificationKind =
  | "booked"
  | "moved"
  | "checked_out"
  | "cancelled"
  | "no_show"
  | "waitlist_joined"
  | "online_approved"
  | "online_declined"
  | "turnaway";

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  /** short headline, e.g. "New appointment booked" */
  text: string;
  /** the specifics, e.g. "Jamie Lee · Gel Manicure with Mia, 2:30 PM" */
  detail?: string;
  at: number;
  /** the calendar day this pertains to, so clicking it can jump there */
  dateKey: string;
  apptId?: string;
  read: boolean;
}

const KEY = sdata("notifications-v1");
/** keep the feed from growing forever; older entries are still in Reports
 *  where relevant (cancellations, turnaways, payments all have their own logs) */
const MAX_STORED = 300;

function load(): NotificationRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n): n is NotificationRecord => n != null && typeof n === "object" && typeof n.id === "string")
      : [];
  } catch {
    return [];
  }
}

let state: NotificationRecord[] = load();

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked/full, keep serving in-memory state */
  }
  listeners.forEach((l) => l());
}

/** newest first */
export function useNotifications(): NotificationRecord[] {
  return useSyncExternalStore(subscribe, () => state);
}

let seq = 0;
export function addNotification(n: { kind: NotificationKind; text: string; detail?: string; dateKey: string; apptId?: string }) {
  seq++;
  const rec: NotificationRecord = { id: `note${Date.now()}-${seq}`, at: Date.now(), read: false, ...n };
  state = [rec, ...state].slice(0, MAX_STORED);
  emit();
}

export function markNotificationRead(id: string) {
  const next = state.map((n) => (n.id === id ? { ...n, read: true } : n));
  if (next === state) return;
  state = next;
  emit();
}

export function markAllNotificationsRead() {
  if (state.every((n) => n.read)) return;
  state = state.map((n) => (n.read ? n : { ...n, read: true }));
  emit();
}

export function clearNotifications() {
  state = [];
  emit();
}
