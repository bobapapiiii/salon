// ─── Staff store, job roles + technicians ────────────────────────────────────
// Phase 1 of the localStorage->Postgres migration: internals fetch from/
// persist to the server (server/src/routes/staff-admin.ts) instead of
// localStorage. Every exported function keeps its old signature -- SettingsPage
// still calls setStaff/moveRole/uid exactly as before. Mutations are
// optimistic (state updates immediately, the API call goes out in the
// background, a failure rolls back + shows a toast) and syncSkills() stays a
// pure client-side computation, same as always -- the server never
// reimplements "a tech's skills = their role's services + their extras",
// it just persists whatever `skills` array this file sends it.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Service, ServiceCategory, Tech } from "./booking-types";
import { makeLoader } from "./store-loader";
import {
  ApiError,
  createJobRole as apiCreateJobRole,
  createTech as apiCreateTech,
  deleteJobRole as apiDeleteJobRole,
  fetchJobRoles,
  fetchTechs,
  patchJobRole as apiPatchJobRole,
  patchTech as apiPatchTech,
  reorderJobRoles as apiReorderJobRoles,
  type ApiJobRole,
  type ApiTech,
} from "./staff-api";

export interface JobRole {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface StaffState {
  roles: JobRole[];
  techs: Tech[];
}

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

function apiToRole(r: ApiJobRole): JobRole {
  return { id: r.id, name: r.name, serviceIds: r.serviceIds };
}

/** The server (routes/staff-admin.ts) already reassembled a flat
 *  Tech-shaped object -- known columns plus whatever the jsonb `profile`
 *  catch-all held (initials, firstName, weeklySchedule, pin, etc). This is
 *  just a null->undefined normalization so it matches Tech's optional-field
 *  convention exactly. */
function apiToTech(t: ApiTech): Tech {
  const { id, name, teamId, skills, active, archived, bookableOnline, phone, email, commissionPct, ...profile } = t;
  return {
    ...(profile as Partial<Tech>),
    id,
    name,
    teamId: teamId ?? "",
    skills,
    active,
    archived,
    bookableOnline,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(commissionPct != null ? { commissionPct } : {}),
  } as Tech;
}

let state: StaffState = { roles: [], techs: [] };

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

const loader = makeLoader(async () => {
  const [{ roles }, { techs }] = await Promise.all([fetchJobRoles(), fetchTechs()]);
  state = syncSkills({ roles: roles.map(apiToRole), techs: techs.map(apiToTech) });
  emit();
});

export function useStaffStore(): StaffState {
  loader.ensureLoaded();
  return useSyncExternalStore(subscribe, () => state);
}

/** for AppBootGate (App.tsx) -- true once the initial fetch has resolved */
export const isStaffLoaded = () => loader.isLoaded();

/** Imperative read for non-reactive spots (drag math, module helpers). */
export function getStaff(): StaffState {
  loader.ensureLoaded();
  return state;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// `rest` still carries `id` -- harmless, the server ignores an `id` key on
// PATCH (see staff-admin.ts's splitTechPatch) and POST passes it separately.
const techToApiPatch = (t: Tech) => {
  const { skills, teamId, ...rest } = t;
  return { ...rest, teamId, skills };
};

/** Diffs the previous and next {roles, techs} into the minimal set of API
 *  calls, same approach as categories-store.ts/services-store.ts. Techs are
 *  synced first and awaited before role deletes fire, so a role delete that
 *  depends on its techs having just been reassigned elsewhere (see
 *  SettingsPage.tsx's confirmDeleteRole) never races the server's "still in
 *  use" 409 check. */
export function setStaff(up: (s: StaffState) => StaffState) {
  const prev = state;
  const next = syncSkills(up(prev));
  state = next;
  emit();

  const rollback = (err: unknown) => {
    state = prev;
    emit();
    toast.error(err instanceof ApiError ? err.message : "Couldn't save that change -- please try again");
  };

  const prevTechById = new Map(prev.techs.map((t) => [t.id, t]));
  const techWrites: Promise<unknown>[] = [];
  for (const tech of next.techs) {
    const before = prevTechById.get(tech.id);
    if (!before) {
      // techToApiPatch(tech) already carries `id` (see its comment) --
      // createTech only needs id? to be present somewhere in the payload.
      techWrites.push(apiCreateTech(techToApiPatch(tech)).catch(rollback));
    } else if (!same(before, tech)) {
      techWrites.push(apiPatchTech(tech.id, techToApiPatch(tech)).catch(rollback));
    }
  }
  // Techs are never deleted through this store (archived only, via a normal
  // patch) -- see the Phase 1 migration plan.

  void Promise.all(techWrites).then(() => {
    const prevRoleById = new Map(prev.roles.map((r) => [r.id, r]));
    const nextRoleById = new Map(next.roles.map((r) => [r.id, r]));

    for (const id of prevRoleById.keys()) {
      if (!nextRoleById.has(id)) apiDeleteJobRole(id).catch(rollback);
    }
    for (const role of next.roles) {
      const before = prevRoleById.get(role.id);
      if (!before) {
        apiCreateJobRole({ id: role.id, name: role.name, serviceIds: role.serviceIds }).catch(rollback);
      } else if (before.name !== role.name || !same(before.serviceIds, role.serviceIds)) {
        apiPatchJobRole(role.id, { name: role.name, serviceIds: role.serviceIds }).catch(rollback);
      }
    }

    const survivingIds = next.roles.map((r) => r.id);
    const prevSurvivingOrder = prev.roles.filter((r) => nextRoleById.has(r.id)).map((r) => r.id);
    const nextSurvivingOrder = next.roles.filter((r) => prevRoleById.has(r.id)).map((r) => r.id);
    if (survivingIds.length > 1 && prevSurvivingOrder.join() !== nextSurvivingOrder.join()) {
      apiReorderJobRoles(survivingIds).catch(rollback);
    }
  });
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
 *  always wins over everything below; short of that, the tech's role just
 *  needs to be excluded on the service itself, its category, or (for a
 *  service in a subcategory) that subcategory's parent category, for it to
 *  be hidden online -- otherwise it's bookable. */
export function isOnlineBookable(tech: Tech, service: Service, categories: ServiceCategory[]): boolean {
  if (tech.bookableOnline === false) return false;
  const override = tech.serviceOverrides?.[service.id]?.online;
  if (override !== undefined) return override;
  if (service.onlineExcludedRoleIds?.includes(tech.teamId)) return false;
  const cat = categories.find((c) => c.id === service.categoryId);
  if (cat?.onlineExcludedRoleIds?.includes(tech.teamId)) return false;
  if (cat?.parentId) {
    const parent = categories.find((c) => c.id === cat.parentId);
    if (parent?.onlineExcludedRoleIds?.includes(tech.teamId)) return false;
  }
  return true;
}
