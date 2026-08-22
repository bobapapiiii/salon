// ─── Online requests, staff-side view of the new public booking API ────────
// Settings → Online requests. Sign-in used to be a separate login just for
// this panel (server/ has its own users table, distinct from the app's old
// demo-user switcher) -- as of the auth-unification pass, the whole app now
// requires the same real sign-in (see lib/auth.ts, App.tsx), so this panel
// just consumes whoever's already signed in rather than asking again.
import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, Clock, Loader2, RefreshCw, User, XCircle } from "lucide-react";
import {
  ApiError,
  fetchOnlineRequests,
  fmtMinutes,
  setOnlineRequestStatus,
  type OnlineRequest,
} from "@/lib/booking-api";
import { useStaffAuth, type StaffAuth } from "@/lib/auth";

export function OnlineRequestsSection() {
  const auth = useStaffAuth();
  // App.tsx only ever renders this deep in the signed-in app, so this is
  // just a defensive fallback (e.g. a token that expired mid-session).
  if (!auth) {
    return (
      <p className="rounded-xl border border-[#EDE7EE] bg-white px-4 py-8 text-center text-[12.5px] text-slate-400">
        Sign in again to see online requests.
      </p>
    );
  }
  return <RequestsList auth={auth} />;
}

function RequestsList({ auth }: { auth: StaffAuth }) {
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
        setError("Your session expired -- sign out and sign in again.");
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
    const row = requests?.find((r) => r.id === id);
    if (!row) return;
    setActingOn(id);
    try {
      await setOnlineRequestStatus(auth.token, id, action === "approve" ? "confirmed" : "declined", row.version);
      setRequests((r) => r?.filter((x) => x.id !== id) ?? r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("Someone else already updated this request -- refreshing.");
        load();
      } else {
        setError(e instanceof ApiError ? e.message : "That request couldn't be updated -- try refreshing.");
      }
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
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-[#EDE7EE] px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
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
