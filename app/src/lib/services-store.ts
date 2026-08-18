// ─── Services store, the salon's editable service catalog ───────────────────
// Services are salon-configurable: name, short label, duration, price, active.
// `svcById` is a live lookup, reads always see the current catalog, so the
// calendar, booking, and checkout update the moment a service changes.
import { useSyncExternalStore } from "react";
import { SERVICES } from "./mock-data";
import type { Service, ServiceCategory } from "./booking-types";
import { sdata } from "./persist";

const KEY = sdata("services-v1");

function load(): Service[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SERVICES.map((s) => ({ ...s }));
    const parsed = JSON.parse(raw) as Service[];
    if (!Array.isArray(parsed) || parsed.length === 0) return SERVICES.map((s) => ({ ...s }));
    return parsed.filter((s) => s && typeof s.id === "string" && typeof s.name === "string");
  } catch {
    return SERVICES.map((s) => ({ ...s }));
  }
}

let state: Service[] = load();

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useServicesStore(): Service[] {
  return useSyncExternalStore(subscribe, () => state);
}

export function getServices(): Service[] {
  return state;
}

export function setServices(up: (s: Service[]) => Service[]) {
  state = up(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
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
