// ─── Services store, the salon's editable service catalog ───────────────────
// Services are salon-configurable: name, short label, duration, price, active.
// `svcById` is a live lookup, reads always see the current catalog, so the
// calendar, booking, and checkout update the moment a service changes.
import { useSyncExternalStore } from "react";
import { SERVICES } from "./mock-data";
import type { Service } from "./booking-types";
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
