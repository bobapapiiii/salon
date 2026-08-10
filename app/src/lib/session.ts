// ─── Session, who's signed in, and at which salon ───────────────────────────
// Prototype login. The real platform authenticates against the backend; this
// store takes the place of the auth token so every preference can be scoped to
// the logged-in user and every salon datum to the salon account.
import { useSyncExternalStore } from "react";

export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  title: string;
}

export const SALON_ID = "gloss-nail-bar";
export const SALON_NAME = "Gloss Nail Bar";

export const DEMO_USERS: SessionUser[] = [
  { id: "u-frontdesk", name: "Front Desk", initials: "FD", title: "Reception" },
  { id: "u-mia", name: "Mia Nguyen", initials: "MN", title: "Manager" },
  { id: "u-anna", name: "Anna Le", initials: "AL", title: "Owner" },
];

const KEY = "salon-session-user";

let current: string = (() => {
  try {
    return localStorage.getItem(KEY) ?? DEMO_USERS[0].id;
  } catch {
    return DEMO_USERS[0].id;
  }
})();

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSessionUser(): SessionUser {
  const id = useSyncExternalStore(subscribe, () => current);
  return DEMO_USERS.find((u) => u.id === id) ?? DEMO_USERS[0];
}

/** raw session id, may be a demo account id or a technician id */
export function useSessionUserId(): string {
  return useSyncExternalStore(subscribe, () => current);
}

export function getSessionUserId(): string {
  return current;
}

export function setSessionUser(id: string) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}
