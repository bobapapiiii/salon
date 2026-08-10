// ─── Persistent state, useState mirrored to scoped storage ──────────────────
// Anything the user changes on the platform should survive a refresh, and
// follow the right account:
//   upref()  per-login view preferences (zoom, filters, theme, layout)
//   sdata()  salon-shared data (appointments, clients, staff, queues)
// Today both map to localStorage namespaces; when the backend lands, upref maps
// to GET/PUT /me/preferences and sdata to the salon's API, this file is the
// single swap point.
import { useEffect, useState } from "react";
import { getSessionUserId, SALON_ID } from "./session";

/** per-login preference key, follows whoever is signed in */
export const upref = (key: string) => `u:${getSessionUserId()}:${key}`;
/** salon-shared data key, identical for every login at this salon */
export const sdata = (key: string) => `s:${SALON_ID}:${key}`;

interface Codec<T> {
  serialize?: (v: T) => unknown;
  deserialize?: (raw: unknown) => T;
}

function readStored<T>(key: string, codec?: Codec<T>): T | undefined {
  try {
    let raw = localStorage.getItem(key);
    if (raw == null) {
      // one-time upgrade path: adopt pre-namespace keys ("salon-*")
      const rest = key.split(":").slice(2).join(":");
      if (rest) raw = localStorage.getItem(`salon-${rest}`);
    }
    if (raw == null) return undefined;
    const parsed = JSON.parse(raw);
    return codec?.deserialize ? codec.deserialize(parsed) : (parsed as T);
  } catch {
    return undefined;
  }
}

export function usePersistentState<T>(key: string, initial: T | (() => T), codec?: Codec<T>) {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key, codec);
    if (stored !== undefined) return stored;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(codec?.serialize ? codec.serialize(value) : value));
    } catch {
      /* storage blocked/full, keep serving in-memory state */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue] as const;
}

/** Codec for Set<T>, stored as a plain array. */
export function setCodec<T>(): Codec<Set<T>> {
  return {
    serialize: (s) => [...s],
    deserialize: (raw) => new Set(Array.isArray(raw) ? (raw as T[]) : []),
  };
}
