// ─── Categories store, service categories the salon can manage ──────────────
// Add or remove categories (removal is blocked while services live in them).
// `catById` is a live lookup so colors/labels update everywhere instantly.
import { useSyncExternalStore } from "react";
import { CATEGORIES } from "./mock-data";
import type { ServiceCategory } from "./booking-types";
import { sdata } from "./persist";

const KEY = sdata("categories-v1");

/** extra colors for categories the salon creates */
const EXTRA_HUES = ["210 90% 56%", "150 70% 42%", "25 85% 55%", "280 65% 58%", "190 80% 40%"];

function load(): ServiceCategory[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return CATEGORIES.map((c) => ({ ...c }));
    const parsed = JSON.parse(raw) as ServiceCategory[];
    if (!Array.isArray(parsed) || parsed.length === 0) return CATEGORIES.map((c) => ({ ...c }));
    return parsed.filter((c) => c && typeof c.id === "string" && typeof c.name === "string");
  } catch {
    return CATEGORIES.map((c) => ({ ...c }));
  }
}

let state: ServiceCategory[] = load();

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useCategoriesStore(): ServiceCategory[] {
  return useSyncExternalStore(subscribe, () => state);
}

export function getCategories(): ServiceCategory[] {
  return state;
}

export function addCategory(name: string): ServiceCategory {
  const i = state.length;
  const hue = EXTRA_HUES[i % EXTRA_HUES.length];
  const cat: ServiceCategory = {
    id: `cat-${Math.random().toString(36).slice(2, 8)}`,
    name,
    hue,
    fill: `hsl(${hue} / 0.16)`,
    line: `hsl(${hue})`,
    text: `hsl(${hue} / 0.7)`,
  };
  setCategories((c) => [...c, cat]);
  return cat;
}

export function removeCategory(id: string) {
  setCategories((c) => c.filter((x) => x.id !== id));
}

export function setCategories(up: (c: ServiceCategory[]) => ServiceCategory[]) {
  state = up(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

/** live id → category lookup; index it exactly like the old static map */
export const catById: Record<string, ServiceCategory> = new Proxy({} as Record<string, ServiceCategory>, {
  get: (_, id: string) => state.find((c) => c.id === id),
  has: (_, id: string) => state.some((c) => c.id === id),
});
