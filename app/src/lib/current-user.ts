// ─── Resolves "whoever is acting right now" ──────────────────────────────
// Combines session.ts's tech-portal override with lib/auth.ts's real staff
// login: the tech override wins if active, otherwise whoever's really
// signed in. Kept out of session.ts itself deliberately -- session.ts is
// imported by lib/persist.ts (for SALON_ID), so pulling lib/auth.ts and
// lib/staff-store.ts in there would create a module-load cycle
// (session -> auth -> persist -> session). See session.ts's own header.
import { getStaffAuth, useStaffAuth, type StaffUser } from "./auth";
import { getSessionUserId, useSessionUserId } from "./session";
import { getStaff } from "./staff-store";

export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  title: string;
}

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
