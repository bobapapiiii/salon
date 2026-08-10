// ─── Log a turnaway, a client who wanted an appointment we couldn't offer ────
// Nothing else in the app leaves a trace of missed demand: if there's no room,
// the client just never gets booked. This is a lightweight, quick-entry way to
// capture it anyway so Reports can show what the salon is turning away.
import { useState } from "react";
import { PhoneOff, Check, X } from "lucide-react";
import { useServicesStore, activeServices } from "@/lib/services-store";
import { catById } from "@/lib/categories-store";
import { useStaffStore, boardTechs } from "@/lib/staff-store";

export interface TurnawayDraft {
  clientName: string;
  phone?: string;
  serviceId?: string;
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
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [requestedTechId, setRequestedTechId] = useState("");
  const [reason, setReason] = useState<TurnawayDraft["reason"]>("no_availability");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!clientName.trim()) return;
    onSave({
      clientName: clientName.trim(),
      phone: phone.trim() || undefined,
      serviceId: serviceId || undefined,
      requestedTechId: requestedTechId || undefined,
      reason,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-[360px] rounded-2xl border border-line bg-popover p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <PhoneOff className="h-4 w-4 text-ink-faint" /> Log a turnaway
          </h3>
          <button onClick={onClose} className="text-ink-faint transition-colors hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[11.5px] text-ink-faint">
          A quick note that someone wanted an appointment and we couldn't fit them in, so Reports can show demand we're missing.
        </p>

        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Client</p>
        <input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Name"
          className={field}
          autoFocus
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          className={`${field} mt-1.5`}
        />

        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">What they wanted</p>
        <div className="flex items-center gap-1.5">
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={field}>
            <option value="">Any service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{catById[s.categoryId]?.name ? `${catById[s.categoryId].name}, ` : ""}{s.name}</option>
            ))}
          </select>
          <select value={requestedTechId} onChange={(e) => setRequestedTechId(e.target.value)} className={field}>
            <option value="">Any tech</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Reason</p>
        <div className="flex flex-wrap gap-1">
          {REASONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setReason(r.id)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
                reason === r.id ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className={`${field} mt-2 resize-none`}
        />

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={!clientName.trim()}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-clay text-[13px] font-bold text-white transition-colors hover:bg-clay-deep disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" /> Log turnaway
          </button>
        </div>
      </div>
    </div>
  );
}
