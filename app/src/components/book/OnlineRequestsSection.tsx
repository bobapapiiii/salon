// ─── Online requests, staff-side view of the new public booking API ────────
// Settings → Online requests. This is the ONLY place in the frontend besides
// BookingPage.tsx that talks to the new backend (server/) -- see
// booking-api.ts and server/README.md. Sign-in here is a SEPARATE login
// system from the local demo-user session switcher (NavRail): the backend
// has its own users table with its own email/password, seeded by
// `npm run db:seed` in server/ (see server/README.md for the demo
// credentials). That's intentional for this pass rather than unifying the
// two auth systems -- flagged as follow-up work in HANDOFF.md.
import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, Clock, Loader2, LogOut, RefreshCw, User, XCircle } from "lucide-react";
import {
  ApiError,
  approveOnlineRequest,
  declineOnlineRequest,
  fetchOnlineRequests,
  fmtMinutes,
  staffLogin,
  type OnlineRequest,
  type StaffUser,
} from "@/lib/booking-api";
import { sdata, usePersistentState } from "@/lib/persist";

interface AuthState {
  token: string;
  user: StaffUser;
}

export function OnlineRequestsSection() {
  const [auth, setAuth] = usePersistentState<AuthState | null>(sdata("online-requests-auth-v1"), null);

  if (!auth) return <LoginForm onLoggedIn={setAuth} />;
  return <RequestsList auth={auth} onSignOut={() => setAuth(null)} />;
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (a: AuthState) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await staffLogin(email.trim(), password);
      onLoggedIn({ token, user });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't reach the booking server. Make sure it's running and VITE_API_URL is set (see server/README.md).",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[360px] py-10 text-center">
      <h2 className="mb-1 text-[17px] font-bold text-slate-900">Online requests</h2>
      <p className="mb-5 text-[12px] text-slate-400">
        Sign in with your backend staff account to review and approve online booking requests.
      </p>
      <div className="space-y-2.5 text-left">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Email"
          className="w-full rounded-lg border border-[#E3DDE3] px-3 py-2 text-[13px] outline-none focus:border-[#5B54D6]"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          type="password"
          placeholder="Password"
          className="w-full rounded-lg border border-[#E3DDE3] px-3 py-2 text-[13px] outline-none focus:border-[#5B54D6]"
        />
      </div>
      {error && <p className="mt-2.5 text-[12px] font-semibold text-rose-500">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !email.trim() || !password}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#5B54D6] py-2.5 text-[13px] font-bold text-white transition hover:bg-[#4B45BE] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </button>
    </div>
  );
}

function RequestsList({ auth, onSignOut }: { auth: AuthState; onSignOut: () => void }) {
  const [requests, setRequests] = useState<OnlineRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { requests } = await fetchOnlineRequests(auth.token);
      setRequests(requests);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("Your session expired -- sign in again.");
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't load requests.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(id: string, action: "approve" | "decline") {
    setActingOn(id);
    try {
      if (action === "approve") await approveOnlineRequest(auth.token, id);
      else await declineOnlineRequest(auth.token, id);
      setRequests((r) => r?.filter((x) => x.id !== id) ?? r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That request couldn't be updated -- try refreshing.");
    } finally {
      setActingOn(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900">Online requests</h2>
          <p className="text-[12px] text-slate-400">
            Signed in as {auth.user.name} ({auth.user.title})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-[#EDE7EE] px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 rounded-lg border border-[#EDE7EE] px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}

      {loading && !requests && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {requests && requests.length === 0 && !loading && (
        <p className="rounded-xl border border-[#EDE7EE] bg-white px-4 py-8 text-center text-[12.5px] text-slate-400">
          No pending online requests.
        </p>
      )}

      <div className="space-y-2">
        {(requests ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border border-[#EDE7EE] bg-white p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-slate-900">{r.serviceName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" /> {r.dateKey}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {fmtMinutes(r.startMin)} · {r.durationMin}m
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3.5 w-3.5" /> {r.techName}
                  </span>
                </p>
                <p className="mt-1 text-[12px] text-slate-600">
                  {r.clientName} · {r.clientPhone}
                </p>
                {r.clientNote && <p className="mt-1 text-[11.5px] italic text-slate-400">"{r.clientNote}"</p>}
              </div>
              <span className="tnum shrink-0 text-[13px] font-bold text-slate-700">
                ${(r.servicePriceCents / 100).toFixed(2)}
              </span>
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => decide(r.id, "approve")}
                disabled={actingOn === r.id}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 py-1.5 text-[12px] font-bold text-white transition hover:bg-emerald-600 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
              </button>
              <button
                onClick={() => decide(r.id, "decline")}
                disabled={actingOn === r.id}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#EDE7EE] py-1.5 text-[12px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
