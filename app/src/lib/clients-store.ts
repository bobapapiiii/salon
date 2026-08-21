// ─── Clients store, extracted out of AppointmentBook.tsx's inline
// `clients-v1` localStorage state (Phase 1 of the localStorage->Postgres
// migration) ────────────────────────────────────────────────────────────
// Same pattern as categories-store.ts/services-store.ts/staff-store.ts:
// fetch-backed, optimistic mutations with rollback + a toast on failure.
// `setClients(up)` keeps the exact `(cs) => cs.map(...)`-style functional
// updater every call site in AppointmentBook.tsx already uses, so swapping
// this in only changes the import, not ~13 existing mutation call sites.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ClientRecord } from "./booking-types";
import { makeLoader } from "./store-loader";
import {
  ApiError,
  createClient as apiCreateClient,
  fetchClients,
  patchClient as apiPatchClient,
  type ApiClient,
} from "./staff-api";

function apiToClient(c: ApiClient): ClientRecord {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    visits: c.visits,
    ...(c.email ? { email: c.email } : {}),
    ...(c.preferredTechs.length ? { preferredTechs: c.preferredTechs } : {}),
    ...(c.guests.length ? { guests: c.guests } : {}),
    ...(c.tags.length ? { tags: c.tags } : {}),
  };
}

let state: ClientRecord[] = [];

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
  const { clients } = await fetchClients();
  state = clients.map(apiToClient);
  emit();
});

export function useClientsStore(): ClientRecord[] {
  loader.ensureLoaded();
  return useSyncExternalStore(subscribe, () => state);
}

/** for AppBootGate (App.tsx) -- true once the initial fetch has resolved */
export const isClientsLoaded = () => loader.isLoaded();

export function getClients(): ClientRecord[] {
  loader.ensureLoaded();
  return state;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** No delete -- clients are never removed through this store (matches the
 *  Phase 1 migration plan: "no DELETE, no atomic-increment endpoint"), only
 *  created and patched. */
export function setClients(up: (c: ClientRecord[]) => ClientRecord[]) {
  const prev = state;
  const next = up(prev);
  state = next;
  emit();

  const prevById = new Map(prev.map((c) => [c.id, c]));

  const rollback = (err: unknown) => {
    state = prev;
    emit();
    toast.error(err instanceof ApiError ? err.message : "Couldn't save that change -- please try again");
  };

  for (const client of next) {
    const before = prevById.get(client.id);
    const patch = {
      name: client.name,
      phone: client.phone,
      email: client.email ?? null,
      visits: client.visits,
      preferredTechs: client.preferredTechs ?? [],
      guests: client.guests ?? [],
      tags: client.tags ?? [],
    };
    if (!before) {
      apiCreateClient({ id: client.id, ...patch }).catch(rollback);
    } else if (!same(before, client)) {
      apiPatchClient(client.id, patch).catch(rollback);
    }
  }
}
