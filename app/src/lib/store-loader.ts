// ─── Shared "ensureLoaded" helper for the Phase 1 API-backed stores ───────
// Every store that swapped from synchronous localStorage to an async fetch
// (categories-store.ts, services-store.ts, staff-store.ts, clients-store.ts)
// needs the same thing: kick off the initial load exactly once no matter
// how many components call useXStore() before it resolves, and allow a
// retry (with a small cooldown, not a hammer-the-API-every-render loop) if
// that load failed. Called unconditionally at the top of each useXStore()
// hook body -- cheap after the first successful load, since it's then just
// a `loaded` boolean check.
const RETRY_COOLDOWN_MS = 5000;

export interface Loader {
  /** call on every render of the store's hook; no-ops once loaded or while
   *  a load is already in flight, retries after a short cooldown if the
   *  last attempt failed */
  ensureLoaded: () => void;
  /** true once the initial fetch has resolved at least once */
  isLoaded: () => boolean;
}

export function makeLoader(fetcher: () => Promise<void>): Loader {
  let loaded = false;
  let inFlight: Promise<void> | null = null;
  let lastFailureAt = 0;

  function ensureLoaded() {
    if (loaded || inFlight) return;
    if (lastFailureAt && Date.now() - lastFailureAt < RETRY_COOLDOWN_MS) return;
    inFlight = fetcher()
      .then(() => {
        loaded = true;
      })
      .catch((err) => {
        lastFailureAt = Date.now();
        console.error("Initial store load failed, will retry", err);
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return { ensureLoaded, isLoaded: () => loaded };
}
