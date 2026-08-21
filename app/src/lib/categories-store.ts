// ─── Categories store, service categories the salon can manage ──────────────
// Phase 1 of the localStorage->Postgres migration: internals now fetch from
// and persist to the server (see lib/staff-api.ts) instead of localStorage,
// but every exported function keeps its exact old signature so the ~dozen
// call sites across SettingsPage.tsx and friends don't change. Mutations are
// optimistic: state updates and listeners fire immediately, the API call
// goes out in the background, and a failure rolls the in-memory state back
// and shows a toast rather than leaving the UI stuck on a stale prediction.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ServiceCategory } from "./booking-types";
import { makeLoader } from "./store-loader";
import {
  ApiError,
  createCategory as apiCreateCategory,
  deleteCategory as apiDeleteCategory,
  fetchCategories,
  patchCategory as apiPatchCategory,
  reorderCategories as apiReorderCategories,
  type ApiServiceCategory,
} from "./staff-api";

/** extra colors for categories missing a color (freshly created, or -- for
 *  data imported before this table had color columns -- legacy rows that
 *  predate them). Color assignment is deliberately client-side/boundary-only
 *  (see the Phase 1 migration plan), so a category with no stored color
 *  still gets a stable one instead of rendering blank. */
const EXTRA_HUES = ["210 90% 56%", "150 70% 42%", "25 85% 55%", "280 65% 58%", "190 80% 40%"];

function colorFor(hue: string) {
  return { hue, fill: `hsl(${hue} / 0.16)`, line: `hsl(${hue})`, text: `hsl(${hue} / 0.7)` };
}

function fallbackColorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return colorFor(EXTRA_HUES[hash % EXTRA_HUES.length]);
}

function apiToCategory(c: ApiServiceCategory): ServiceCategory {
  const color = c.hue && c.fill && c.line && c.textColor ? { hue: c.hue, fill: c.fill, line: c.line, text: c.textColor } : fallbackColorFor(c.id);
  return {
    id: c.id,
    name: c.name,
    ...color,
    ...(c.parentId ? { parentId: c.parentId } : {}),
    ...(c.archived ? { archived: true } : {}),
    ...(c.onlineExcludedRoleIds.length ? { onlineExcludedRoleIds: c.onlineExcludedRoleIds } : {}),
  };
}

let state: ServiceCategory[] = [];

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
  const { categories } = await fetchCategories();
  state = categories.map(apiToCategory);
  emit();
});

export function useCategoriesStore(): ServiceCategory[] {
  loader.ensureLoaded();
  return useSyncExternalStore(subscribe, () => state);
}

/** for AppBootGate (App.tsx) -- true once the initial fetch has resolved */
export const isCategoriesLoaded = () => loader.isLoaded();

export function getCategories(): ServiceCategory[] {
  loader.ensureLoaded();
  return state;
}

export function addCategory(name: string, parentId?: string): ServiceCategory {
  const i = state.length;
  const hue = EXTRA_HUES[i % EXTRA_HUES.length];
  const cat: ServiceCategory = {
    id: crypto.randomUUID(),
    name,
    ...colorFor(hue),
    ...(parentId ? { parentId } : {}),
  };
  setCategories((c) => [...c, cat]);
  return cat;
}

export function removeCategory(id: string) {
  setCategories((c) => c.filter((x) => x.id !== id));
}

/** Diff the previous and next lists into the minimal set of API calls: new
 *  ids create, removed ids delete, changed fields patch, and a changed
 *  overall order (relative to what's left after adds/removes) reorders --
 *  this is what lets `setCategories(list => ...)` stay a single whole-array
 *  replace on the caller's side (matching the drag/bulk-edit call sites in
 *  SettingsPage.tsx) while only sending the network calls a change actually
 *  needs. */
export function setCategories(up: (c: ServiceCategory[]) => ServiceCategory[]) {
  const prev = state;
  const next = up(prev);
  state = next;
  emit();

  const prevById = new Map(prev.map((c) => [c.id, c]));
  const nextById = new Map(next.map((c) => [c.id, c]));

  const rollback = (err: unknown) => {
    state = prev;
    emit();
    toast.error(err instanceof ApiError ? err.message : "Couldn't save that change -- please try again");
  };

  for (const id of prevById.keys()) {
    if (!nextById.has(id)) apiDeleteCategory(id).catch(rollback);
  }
  for (const cat of next) {
    const before = prevById.get(cat.id);
    if (!before) {
      apiCreateCategory({ id: cat.id, name: cat.name, hue: cat.hue, fill: cat.fill, line: cat.line, textColor: cat.text, parentId: cat.parentId }).catch(
        rollback,
      );
    } else if (
      before.name !== cat.name ||
      before.hue !== cat.hue ||
      before.fill !== cat.fill ||
      before.line !== cat.line ||
      before.text !== cat.text ||
      before.parentId !== cat.parentId ||
      before.archived !== cat.archived ||
      JSON.stringify(before.onlineExcludedRoleIds ?? []) !== JSON.stringify(cat.onlineExcludedRoleIds ?? [])
    ) {
      apiPatchCategory(cat.id, {
        name: cat.name,
        hue: cat.hue,
        fill: cat.fill,
        line: cat.line,
        textColor: cat.text,
        parentId: cat.parentId ?? null,
        archived: cat.archived ?? false,
        onlineExcludedRoleIds: cat.onlineExcludedRoleIds ?? [],
      }).catch(rollback);
    }
  }

  const survivingIds = next.map((c) => c.id);
  const prevSurvivingOrder = prev.filter((c) => nextById.has(c.id)).map((c) => c.id);
  const nextSurvivingOrder = next.filter((c) => prevById.has(c.id)).map((c) => c.id);
  if (survivingIds.length > 1 && prevSurvivingOrder.join() !== nextSurvivingOrder.join()) {
    apiReorderCategories(survivingIds).catch(rollback);
  }
}

/** live id → category lookup; index it exactly like the old static map */
export const catById: Record<string, ServiceCategory> = new Proxy({} as Record<string, ServiceCategory>, {
  get: (_, id: string) => state.find((c) => c.id === id),
  has: (_, id: string) => state.some((c) => c.id === id),
});
