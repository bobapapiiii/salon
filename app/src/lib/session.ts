// ─── Session: salon identity + tech-portal override ─────────────────────────
// Deliberately dependency-free (no imports from lib/auth.ts or
// lib/staff-store.ts): this file is itself imported by lib/persist.ts (for
// SALON_ID's storage namespace), so anything it pulled in here would create
// a module-load cycle back through persist.ts -- that cycle is exactly what
// caused a real "Cannot access before initialization" crash in production
// the first time this was tried. See lib/current-user.ts, one layer up, for
// the auth-aware "who's really acting right now" resolution (tech-portal
// override vs. real signed-in staff) that used to live here.
//
// What's left here is just the tech-portal override: a technician can take
// over this browser via their own PIN (staff-store.ts's
// Tech.loginEnabled/pin) without touching the staff login underneath;
// App.tsx shows TechPortal instead of the main app while an override is
// active, and returning from it just clears the override, no re-login
// needed. Still local-only, not migrated in this pass -- see HANDOFF.md.
import { useSyncExternalStore } from "react";

export const SALON_ID = "gloss-nail-bar";
export const SALON_NAME = "Gloss Nail Bar";

const KEY = "salon-active-tech";

let activeTechId: string = (() => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
})();

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** id of the tech currently overriding this browser via their PIN, or ""
 *  if no override is active (the normal, signed-in-as-staff case) */
export function useSessionUserId(): string {
  return useSyncExternalStore(subscribe, () => activeTechId);
}

export function getSessionUserId(): string {
  return activeTechId;
}

/** switch this browser into a tech's PIN portal, or pass "" to return to
 *  the signed-in staff view */
export function setSessionUser(id: string) {
  activeTechId = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}
