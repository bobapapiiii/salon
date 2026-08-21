// ─── Real staff auth, backend-verified (Phase 0 of the localStorage→Postgres
// migration, see HANDOFF.md) ─────────────────────────────────────────────
// This is now the ONE login for every staff-facing surface in the app --
// it replaces two things that used to be separate:
//   1. session.ts's old DEMO_USERS switcher (no real password, click a name
//      to "become" them).
//   2. OnlineRequestsSection.tsx's own sign-in form, which talked to this
//      same backend but was scoped only to the online-requests panel.
// Same external-store shape as the other lib/*-store.ts files (module-level
// state + useSyncExternalStore) so it composes the same way everywhere else
// in the app; token storage otherwise works like any other sdata() value.
import { useSyncExternalStore } from "react";
import { ApiError, staffLogin, type StaffUser } from "./booking-api";
import { sdata } from "./persist";

export interface StaffAuth {
  token: string;
  user: StaffUser;
}

const KEY = sdata("staff-auth-v1");
/** the key OnlineRequestsSection.tsx used to sign in to, before the two
 *  logins were unified -- adopt it once so nobody who was already signed in
 *  there gets unexpectedly signed out by this change */
const LEGACY_KEY = sdata("online-requests-auth-v1");

function load(): StaffAuth | null {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffAuth | null;
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

let state: StaffAuth | null = load();

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

export function useStaffAuth(): StaffAuth | null {
  return useSyncExternalStore(subscribe, () => state);
}

/** imperative read for non-component code -- the online-booking poll effect
 *  (needs the latest token outside React's render cycle) and store modules
 *  like discounts-store.ts that stamp "who did this" outside a component. */
export function getStaffAuth(): StaffAuth | null {
  return state;
}

export function getStaffToken(): string | null {
  return state?.token ?? null;
}

function persist() {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage blocked */
  }
}

export function setStaffAuth(auth: StaffAuth | null) {
  state = auth;
  persist();
  emit();
}

export async function staffSignIn(email: string, password: string): Promise<StaffAuth> {
  const { token, user } = await staffLogin(email, password);
  const auth: StaffAuth = { token, user };
  setStaffAuth(auth);
  return auth;
}

export function staffSignOut() {
  setStaffAuth(null);
}

export { ApiError };
export type { StaffUser };
