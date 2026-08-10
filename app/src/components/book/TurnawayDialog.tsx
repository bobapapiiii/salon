// ─── Log a turnaway, a client (or group) who wanted an appointment we
// couldn't offer ─────────────────────────────────────────────────────────
// Nothing else in the app leaves a trace of missed demand: if there's no
// room, the client just never gets booked. Most turnaways are walk-ins we
// never got a name for, sometimes a whole party, sometimes wanting more
// than one service (mani + pedi, etc). This is built to be logged in a
// couple of taps with zero required fields beyond a reason.
import { useState } from "react";
import { PhoneOff, Check, X, Minus, Plus } from "lucide-react";
import { useServicesStore, activeServices } from "@/lib/services-store";
import { useStaffStore, boardTechs } from "@/lib/staff-store";

export interface TurnawayDraft {
  /** most turnaways are walk-ins we never got a name for */
  clientName?: string;
  phone?: string;
  /** how many people, defaults to 1 */
  partySize: number;
  /** everything the party wanted, e.g. mani + pedi; empty/undefined = unspecified */
  serviceIds?: string[];
  requestedTechId?: string;
  reason: "no_availability" | "price" | "didnt_like_options" | "other";
  notes?: string;
}

const REASONS: { id: TurnawayDraft["reason"]; label: string }[] = [
  { id: "no_availability", label: "No availability" },
  { id: "price", label: "Price" },
  { id: "didnt_like_options", label: "Didn't like the options offered" },
  { id: "other", label: "Other" },
];

const field =
  "w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring";

export function TurnawayDialog({ onSave, onClose }: {
  onSave: (d: TurnawayDraft) => void;
  onClose: () => void;
}) {
  const services = activeServices(useServicesStore());
  const staff = useStaffStore();
  const techs = boardTechs(staff.techs);
  const [partySize, setPartySize] = useState(1);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [reason, setReason] = useState<TurnawayDraft["reason"]>("no_availability");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [requestedTechId, setRequestedTechId] = useState("");
  const [notes, setNotes] = useState("");

  const toggleService = (id: string) => {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = () => {
    onSave({
      clientName: clientName.trim() || undefined,
      phone: phone.trim() || undefined,
      partySize,
      serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
      requestedTechId: requestedTechId || undefined,
      reason,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-[380px] rounded-2xl border border-line bg-popover p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <PhoneOff className="h-4 w-4 text-ink-faint" /> Log a turnaway
          </h3>
          <button onClick={onClose} className="text-ink-faint transition-colors hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[11.5px] text-ink-faint">
          Someone we couldn't fit in. No name needed for a walk-in, just tap and log.
        </p>

        <div className="mt-3.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Party size</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPartySize((n) => Math.max(1, n - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-line-strong"
              aria-label="Fewer people"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-5 text-center text-[13px] font-bold tabular-nums text-ink">{partySize}</span>
            <button
              type="button"
              onClick={() => setPartySize((n) => Math.min(20, n + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-line-strong"
              aria-label="More people"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          What they wanted <span className="normal-case text-ink-faint/70">(tap all that apply)</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleService(s.id)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
                serviceIds.includes(s.id) ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Reason</p>
        <div className="flex flex-wrap gap-1">
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setReason(r.id)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
                reason === r.id ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {detailsOpen ? (
          <div className="mt-3.5 space-y-1.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Name / tech / notes, if you have them</p>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Name (optional)" className={field} autoFocus />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={field} />
            <select value={requestedTechId} onChange={(e) => setRequestedTechId(e.target.value)} className={field}>
              <option value="">Any tech</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className={`${field} resize-none`} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="mt-3 text-[11.5px] font-semibold text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink-soft"
          >
            + Add a name, tech, or note
          </button>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-clay text-[13px] font-bold text-white transition-colors hover:bg-clay-deep"
          >
            <Check className="h-3.5 w-3.5" /> Log turnaway
          </button>
        </div>
      </div>
    </div>
  );
}
