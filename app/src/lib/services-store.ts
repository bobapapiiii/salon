// ─── Services store, the salon's editable service catalog ───────────────────
// Phase 1 of the localStorage->Postgres migration: same pattern as
// categories-store.ts -- internals fetch from/persist to the server, every
// exported function keeps its old signature, mutations are optimistic with
// rollback + a toast on failure. Money crosses the API boundary as integer
// cents (server) <-> dollars (frontend, matching discount-engine.ts's
// existing convention) -- that conversion happens here, not in staff-api.ts.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Service, ServiceCategory } from "./booking-types";
import { makeLoader } from "./store-loader";
import {
  ApiError,
  createService as apiCreateService,
  deleteService as apiDeleteService,
  fetchServices,
  patchService as apiPatchService,
  reorderServices as apiReorderServices,
  type ApiService,
} from "./staff-api";

function apiToService(s: ApiService): Service {
  return {
    id: s.id,
    name: s.name,
    short: s.short,
    durationMin: s.durationMin,
    price: s.priceCents / 100,
    categoryId: s.categoryId ?? "",
    ...(s.teamAffinity ? { teamAffinity: s.teamAffinity } : {}),
    ...(s.active === false ? { active: false } : {}),
    ...(s.addons.length ? { addons: s.addons } : {}),
    ...(s.onlineExcludedRoleIds.length ? { onlineExcludedRoleIds: s.onlineExcludedRoleIds } : {}),
    ...(s.tags.length ? { tags: s.tags } : {}),
  };
}

let state: Service[] = [];

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
  const { services } = await fetchServices();
  state = services.map(apiToService);
  emit();
});

export function useServicesStore(): Service[] {
  loader.ensureLoaded();
  return useSyncExternalStore(subscribe, () => state);
}

/** for AppBootGate (App.tsx) -- true once the initial fetch has resolved */
export const isServicesLoaded = () => loader.isLoaded();

export function getServices(): Service[] {
  loader.ensureLoaded();
  return state;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Same diff-and-sync approach as categories-store.ts's setCategories --
 *  see its comment for why a single whole-array replace on the caller's
 *  side is still correct even though this fires only the network calls a
 *  change actually needs. */
export function setServices(up: (s: Service[]) => Service[]) {
  const prev = state;
  const next = up(prev);
  state = next;
  emit();

  const prevById = new Map(prev.map((s) => [s.id, s]));
  const nextById = new Map(next.map((s) => [s.id, s]));

  const rollback = (err: unknown) => {
    state = prev;
    emit();
    toast.error(err instanceof ApiError ? err.message : "Couldn't save that change -- please try again");
  };

  const toApiPatch = (s: Service) => ({
    name: s.name,
    short: s.short,
    durationMin: s.durationMin,
    priceCents: Math.round(s.price * 100),
    categoryId: s.categoryId || null,
    teamAffinity: s.teamAffinity ?? null,
    active: s.active ?? true,
    addons: s.addons ?? [],
    onlineExcludedRoleIds: s.onlineExcludedRoleIds ?? [],
    tags: s.tags ?? [],
  });

  for (const id of prevById.keys()) {
    if (!nextById.has(id)) apiDeleteService(id).catch(rollback);
  }
  for (const svc of next) {
    const before = prevById.get(svc.id);
    if (!before) {
      apiCreateService({ id: svc.id, ...toApiPatch(svc) }).catch(rollback);
    } else if (
      before.name !== svc.name ||
      before.short !== svc.short ||
      before.durationMin !== svc.durationMin ||
      before.price !== svc.price ||
      before.categoryId !== svc.categoryId ||
      before.teamAffinity !== svc.teamAffinity ||
      before.active !== svc.active ||
      !same(before.addons, svc.addons) ||
      !same(before.onlineExcludedRoleIds, svc.onlineExcludedRoleIds) ||
      !same(before.tags, svc.tags)
    ) {
      apiPatchService(svc.id, toApiPatch(svc)).catch(rollback);
    }
  }

  const survivingIds = next.map((s) => s.id);
  const prevSurvivingOrder = prev.filter((s) => nextById.has(s.id)).map((s) => s.id);
  const nextSurvivingOrder = next.filter((s) => prevById.has(s.id)).map((s) => s.id);
  if (survivingIds.length > 1 && prevSurvivingOrder.join() !== nextSurvivingOrder.join()) {
    apiReorderServices(survivingIds).catch(rollback);
  }
}

/** live id → service lookup; index it exactly like the old static map */
export const svcById: Record<string, Service> = new Proxy({} as Record<string, Service>, {
  get: (_, id: string) => state.find((s) => s.id === id),
  has: (_, id: string) => state.some((s) => s.id === id),
});

/** active services only, for pickers and the online menu */
export const activeServices = (list: Service[]) => list.filter((s) => (s as Service & { active?: boolean }).active !== false);

/** the group label Settings' own service list would show for this service:
 *  just the top-level category name, or "Category — Subcategory" once it's
 *  nested under one. Every service picker uses this so the same service
 *  always reads the same way no matter where it's chosen from */
export function serviceGroupLabel(svc: Service, categories: ServiceCategory[]): string | undefined {
  const cat = categories.find((c) => c.id === svc.categoryId);
  if (!cat) return undefined;
  if (!cat.parentId) return cat.name;
  const parent = categories.find((c) => c.id === cat.parentId);
  return parent ? `${parent.name} — ${cat.name}` : cat.name;
}

/** whatever services list is passed in, reordered to match Settings' own
 *  service list exactly: each top-level category (in category order), that
 *  category's own services first (in their stored/drag-reordered order),
 *  then each of its subcategories (in category order) with their own
 *  services. Every picker in the app -- the booking form, checkout, POS,
 *  the appointment detail panel, and so on -- uses this ordering instead
 *  of each screen inventing its own, so a client's menu always reads the
 *  same way it's laid out in Settings.
 *
 *  A service whose category is missing or archived (shouldn't normally
 *  happen -- archiving a category also deactivates its services) is still
 *  appended at the end rather than silently dropped, so a picker can never
 *  lose an item just because of stray category state. */
export function orderedServices(services: Service[], categories: ServiceCategory[]): Service[] {
  const byCategory = new Map<string, Service[]>();
  services.forEach((s) => {
    const list = byCategory.get(s.categoryId);
    if (list) list.push(s);
    else byCategory.set(s.categoryId, [s]);
  });
  const topCats = categories.filter((c) => !c.parentId && !c.archived);
  const placed = new Set<string>();
  const ordered: Service[] = [];
  topCats.forEach((cat) => {
    (byCategory.get(cat.id) ?? []).forEach((s) => { ordered.push(s); placed.add(s.id); });
    categories.filter((c) => c.parentId === cat.id && !c.archived).forEach((sub) => {
      (byCategory.get(sub.id) ?? []).forEach((s) => { ordered.push(s); placed.add(s.id); });
    });
  });
  services.forEach((s) => { if (!placed.has(s.id)) ordered.push(s); });
  return ordered;
}
