// ─── Session: who's signed in, and to which salon ───────────────────────────
// Two independent things live here, deliberately kept separate:
//   1. Real staff identity -- who's actually authenticated against the
//      backend (server/'s `users` table, bcrypt + JWT). See lib/auth.ts.
//      This used to be a fake DEMO_USERS switcher; as of the auth-unification
//      pass it's the one real login for every staff surface in the app.
//   2. A tech-portal override -- a technician can take over this browser via
//      their own PIN (staff-store.ts's Tech.loginEnabled/pin) without
//      touching the staff login underneath; App.tsx shows TechPortal instead
//      of the main app while an override is active, and returning from it
//      just clears the override, no re-login needed. This is a separate,
//      still-local-only mechanism -- not migrated in this pass, see
//      HANDOFF.md.
// `useSessionUser()`/`getCurrentUser()` resolve "whoever is acting right
// now" from these two in one place, so the rest of the app (stamping who
// created a discount, who took a refund, etc.) doesn't need to know which
// of the two is in play.
import { useSyncExternalStore } from "react";
import { getStaffAuth, useStaffAuth, type StaffUser } from "./auth";
import { getStaff } from "./staff-store";

export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  title: string;
}

export const SALON_ID = "gloss-nail-bar";
export const SALON_NAME = "Gloss Nail Bar";

function initialsOf(name: string): string {
  const letters = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "?";
}

// ── tech-portal override ─────────────────────────────────────────────────

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

// ── resolved "current actor" ─────────────────────────────────────────────

function resolveUser(techId: string, staffUser: StaffUser | null): SessionUser {
  if (techId) {
    const staff = getStaff();
    const tech = staff.techs.find((t) => t.id === techId);
    if (tech) {
      const role = staff.roles.find((r) => r.id === tech.teamId);
      return { id: tech.id, name: tech.name, initials: tech.initials, title: role?.name ?? "Technician" };
    }
  }
  if (staffUser) {
    return { id: staffUser.id, name: staffUser.name, initials: initialsOf(staffUser.name), title: staffUser.title };
  }
  return { id: "", name: "Unknown", initials: "?", title: "" };
}

/** the tech override if one's active, otherwise the signed-in staff user */
export function useSessionUser(): SessionUser {
  const techId = useSessionUserId();
  const auth = useStaffAuth();
  return resolveUser(techId, auth?.user ?? null);
}

/** imperative read for non-component code (discounts-store.ts's audit
 *  stamping, etc.) -- same resolution as useSessionUser() above. */
export function getCurrentUser(): SessionUser {
  return resolveUser(getSessionUserId(), getStaffAuth()?.user ?? null);
}
