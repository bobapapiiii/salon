// ─── Staff store, job roles + technicians ────────────────────────────────────
// Job roles are salon-configurable: a role has a name and the set of services
// its members can perform. Each tech is assigned one role; a tech's skills are
// derived from that role. Role order here drives the calendar column groups.
import { useSyncExternalStore } from "react";
import { TECHS } from "./mock-data";
import type { Service, Tech } from "./booking-types";
import { sdata } from "./persist";

export interface JobRole {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface StaffState {
  roles: JobRole[];
  techs: Tech[];
}

const BASE = ["m-classic", "m-gel", "p-classic", "p-gel", "r-soak", "r-fix", "a-french"];

const seedRoles: JobRole[] = [
  { id: "nail", name: "Nail Artists", serviceIds: [...BASE, "e-dip", "e-fill"] },
  { id: "pedi", name: "Pedi Specialists", serviceIds: [...BASE, "p-spa", "a-custom"] },
  { id: "gelx", name: "Gel-X & Acrylic", serviceIds: [...BASE, "e-acrylic", "e-gelx", "e-dip", "e-fill"] },
  { id: "art", name: "Nail Art Studio", serviceIds: [...BASE, "a-custom", "e-dip"] },
];

// staff/roles are salon-shared, every login at this salon sees the same team
const STORAGE_KEY = sdata("staff-v1");
const LEGACY_KEY = "salon-staff-v1";

/** Keep every tech's skills in sync with their role's service list. */
function syncSkills(s: StaffState): StaffState {
  const byId = new Map(s.roles.map((r) => [r.id, r]));
  return {
    ...s,
    techs: s.techs.map((t) => {
      const r = byId.get(t.teamId);
      if (!r) return t;
      const merged = [...new Set([...r.serviceIds, ...(t.extraSkills ?? [])])];
      const same = t.skills.length === merged.length && t.skills.every((x, i) => x === merged[i]);
      return same ? t : { ...t, skills: merged };
    }),
  };
}

const seedState = (): StaffState => ({
  roles: seedRoles.map((r) => ({ ...r, serviceIds: [...r.serviceIds] })),
  techs: TECHS.map((t, i) =>
    i === 0
      ? { ...t, loginEnabled: true, pin: "1234", commissionPct: 60, hireDate: "2021-03-15", phone: "(555) 010-2030", email: "amy@glossnailbar.com" }
      : { ...t },
  ),
});

/** Load persisted staff (role order, renames, services, tech assignments). */
function loadInitial(): StaffState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as StaffState;
    if (!Array.isArray(parsed.roles) || !Array.isArray(parsed.techs) || parsed.roles.length === 0) return seedState();
    if (!parsed.roles.every((r) => r && typeof r.id === "string" && typeof r.name === "string" && Array.isArray(r.serviceIds))) return seedState();
    if (!parsed.techs.every((t) => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.teamId === "string")) return seedState();
    // repair: techs pointing at a deleted role fall back to the first role
    const roleIds = new Set(parsed.roles.map((r) => r.id));
    const techs = parsed.techs.map((t) => ({
      ...t,
      initials: t.initials || t.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
      teamId: roleIds.has(t.teamId) ? t.teamId : parsed.roles[0].id,
      skills: Array.isArray(t.skills) ? t.skills : [],
    }));
    // one-time migration: seed a demo portal login if nobody has one yet
    if (techs.length > 0 && !techs.some((t) => t.loginEnabled)) {
      techs[0] = { ...techs[0], loginEnabled: true, pin: "1234", commissionPct: techs[0].commissionPct ?? 60 };
    }
    return syncSkills({ roles: parsed.roles, techs });
  } catch {
    return seedState();
  }
}

let state: StaffState = loadInitial();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked/full, keep serving the in-memory state */
  }
}

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

export function useStaffStore(): StaffState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Imperative read for non-reactive spots (drag math, module helpers). */
export function getStaff(): StaffState {
  return state;
}

export function setStaff(up: (s: StaffState) => StaffState) {
  state = syncSkills(up(state));
  persist();
  emit();
}

/** Move a role to a new index, reorders the calendar's column groups. */
export function moveRole(id: string, toIndex: number) {
  setStaff((s) => {
    const from = s.roles.findIndex((r) => r.id === id);
    if (from < 0) return s;
    const roles = [...s.roles];
    const [r] = roles.splice(from, 1);
    roles.splice(Math.max(0, Math.min(toIndex, roles.length)), 0, r);
    return { ...s, roles };
  });
}

export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** archived manually, or their employment end date has passed */
export const isArchived = (t: Tech): boolean =>
  t.archived === true || (t.endDate != null && t.endDate !== "" && t.endDate <= todayKey());

/** techs who work the board right now, not archived, not inactive */
export const boardTechs = (techs: Tech[]): Tech[] => techs.filter((t) => !isArchived(t) && t.active !== false);

/** Stable role accent colors by index (band chips, avatars). */
export const ROLE_PALETTE = ["#E0517E", "#2FA883", "#D99B26", "#8A6AE0", "#5E83CE", "#C2633F", "#3E9FC4"];
export const roleColor = (roles: JobRole[], roleId: string) =>
  ROLE_PALETTE[Math.max(0, roles.findIndex((r) => r.id === roleId)) % ROLE_PALETTE.length];

/** Whether a tech should be offered for `service` on the client-facing online
 *  booking page. This never affects in-salon/front-desk booking -- a tech
 *  who's excluded here can still be booked for the service by staff, this
 *  only controls what clients see online. Precedence, most to least
 *  specific: a per-tech override (set in that tech's own service table)
 *  always wins; otherwise the service's own list of online-excluded job
 *  roles sets the default for everyone in that role; otherwise bookable. */
export function isOnlineBookable(tech: Tech, service: Service): boolean {
  if (tech.bookableOnline === false) return false;
  const override = tech.serviceOverrides?.[service.id]?.online;
  if (override !== undefined) return override;
  return !service.onlineExcludedRoleIds?.includes(tech.teamId);
}
