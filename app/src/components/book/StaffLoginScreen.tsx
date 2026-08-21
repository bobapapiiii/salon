// ─── Real staff sign-in, the app's front door ───────────────────────────────
// Shown by App.tsx whenever nobody's authenticated and no tech-portal
// override is active. Replaces the old DEMO_USERS click-a-name switcher --
// see lib/auth.ts for the "why" and HANDOFF.md for the migration this is
// Phase 0 of.
//
// Also offers the tech-portal PIN switch (unchanged mechanism, see
// staff-store.ts/session.ts) right here, not just from NavRail's user menu
// -- NavRail only renders once the main app is showing, which now requires
// a real staff sign-in first. Without this, a technician clocking in via
// their own PIN would need someone else to already be signed in on this
// browser, which defeats the point of a walk-up PIN portal.
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { ApiError, staffSignIn } from "@/lib/auth";
import { SALON_NAME, setSessionUser } from "@/lib/session";
import { boardTechs, useStaffStore } from "@/lib/staff-store";

export function StaffLoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { techs } = useStaffStore();
  const loginTechs = boardTechs(techs).filter((t) => t.loginEnabled);

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await staffSignIn(email.trim(), password);
      // setStaffAuth (inside staffSignIn) notifies subscribers -- App.tsx
      // re-renders into the signed-in app on its own, nothing else to do here.
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-cream">
      <div className="w-full max-w-[380px] rounded-[18px] border border-line bg-surface p-8 shadow-sh-2">
        <div className="mb-6 flex flex-col items-center text-center">
          <svg viewBox="0 0 40 40" className="mb-3 h-10 w-10 shrink-0" aria-hidden>
            <g fill="none" stroke="#2B2724" strokeWidth="2.4" strokeLinecap="round">
              <path d="M7 34 L7 21 A13 13 0 0 1 33 21 L33 34" />
              <path d="M4 34 L36 34" />
            </g>
            <circle cx="20" cy="25" r="6.2" fill="#B07D74" />
          </svg>
          <h1 className="font-display text-[19px] font-semibold text-ink">{SALON_NAME}</h1>
          <p className="mt-1 text-[12.5px] text-ink-faint">Sign in with your staff account</p>
        </div>

        <div className="space-y-2.5">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Email"
            autoFocus
            className="w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-clay"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            type="password"
            placeholder="Password"
            className="w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-clay"
          />
        </div>

        {error && <p className="mt-3 text-[12px] font-semibold text-rust">{error}</p>}

        <button
          onClick={submit}
          disabled={busy || !email.trim() || !password}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-[10px] bg-clay py-2.5 text-[13.5px] font-bold text-white transition hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
        </button>

        {loginTechs.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-micro font-bold uppercase tracking-wide text-ink-faint">
              <KeyRound className="h-3 w-3" /> Or, team portal
            </p>
            <div className="space-y-1">
              {loginTechs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSessionUser(t.id)}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-cream"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[10px] font-extrabold text-clay">
                    {t.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{t.name}</span>
                    <span className="block text-[11px] text-ink-faint">PIN {t.pin}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
