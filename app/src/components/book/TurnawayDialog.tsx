// ─── Log a turnaway, a client (or group) who wanted an appointment we
// couldn't offer ─────────────────────────────────────────────────────────
// Nothing else in the app leaves a trace of missed demand: if there's no
// room, the client just never gets booked. Most turnaways are walk-ins we
// never got a name for, sometimes a whole party where each person wants
// something different (mani for one, mani + pedi for another), and salons
// can have a long service menu — too long to show as a wall of buttons —
// so each person gets their own type-to-search picker instead of a fixed
// list. Built to still be loggable in a couple of taps for the common
// case: one unnamed walk-in, no services picked, just a reason.
//
// The search dropdown is rendered through a Radix Popover (portaled to
// document.body) rather than a plain absolutely-positioned div, so it can
// never get visually clipped by this dialog's own scroll container — that
// was the bug where the 2nd/3rd person's results looked "broken" but were
// actually just clipped off-screen underneath.
import { useState } from "react";
import { PhoneOff, Check, X, Plus } from "lucide-react";
import { useServicesStore, activeServices } from "@/lib/services-store";
import { catById } from "@/lib/categories-store";
import { useStaffStore, boardTechs } from "@/lib/staff-store";
import type { Service } from "@/lib/booking-types";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export interface TurnawayGuest {
  name?: string;
  /** what this one person wanted; empty/undefined = unspecified */
  serviceIds?: string[];
}

export interface TurnawayDraft {
  /** one entry per person; length is the party size. Most turnaways are a
   *  single unnamed walk-in, so this defaults to one empty guest */
  guests: TurnawayGuest[];
  phone?: string;
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

/** type-to-search, multi-select service picker — scales to a long menu
 *  without listing every service on screen at once, and its results
 *  dropdown is portaled so it's never clipped by a scrolling ancestor */
function ServicePicker({ services, selected, onChange }: {
  services: Service[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = q
    ? services.filter((s) => !selected.includes(s.id) && s.name.toLowerCase().includes(q)).slice(0, 7)
    : [];
  const showPopover = open && q.length > 0;

  const add = (id: string) => {
    onChange([...selected, id]);
    setQuery("");
  };
  const remove = (id: string) => onChange(selected.filter((x) => x !== id));

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((id) => {
            const s = services.find((x) => x.id === id);
            return (
              <span key={id} className="flex items-center gap-1 rounded-full border border-clay bg-clay-tint py-0.5 pl-2.5 pr-1.5 text-[11px] font-bold text-clay">
                {s?.name ?? "Service"}
                <button type="button" onClick={() => remove(id)} className="text-clay/70 transition-colors hover:text-clay" aria-label={`Remove ${s?.name ?? "service"}`}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <Popover open={showPopover} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <PopoverAnchor asChild>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            placeholder="Search services to add…"
            className={field}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[95] w-[var(--radix-popover-trigger-width)] max-h-44 overflow-y-auto rounded-[8px] border-line p-1 shadow-lg"
        >
          {matches.length > 0 ? (
            matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(s.id)}
                className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] text-ink-soft hover:bg-cream"
              >
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-[10px] text-ink-faint">{catById[s.categoryId]?.name ?? ""}</span>
              </button>
            ))
          ) : (
            <p className="px-2 py-1.5 text-[11.5px] text-ink-faint">No matching services</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function TurnawayDialog({ onSave, onClose }: {
  onSave: (d: TurnawayDraft) => void;
  onClose: () => void;
}) {
  const services = activeServices(useServicesStore());
  const staff = useStaffStore();
  const techs = boardTechs(staff.techs);
  const [guests, setGuests] = useState<TurnawayGuest[]>([{}]);
  const [reason, setReason] = useState<TurnawayDraft["reason"]>("no_availability");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [requestedTechId, setRequestedTechId] = useState("");
  const [notes, setNotes] = useState("");

  const addGuest = () => setGuests((g) => [...g, {}]);
  const removeGuest = (i: number) => setGuests((g) => g.filter((_, idx) => idx !== i));
  const updateGuest = (i: number, patch: Partial<TurnawayGuest>) =>
    setGuests((g) => g.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const submit = () => {
    onSave({
      guests: guests.map((g) => ({
        name: g.name?.trim() || undefined,
        serviceIds: g.serviceIds && g.serviceIds.length > 0 ? g.serviceIds : undefined,
      })),
      phone: phone.trim() || undefined,
      requestedTechId: requestedTechId || undefined,
      reason,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      {/* max-h + overflow-y-auto lives on this outer card (not the guest
          list) so a big party just grows the dialog instead of nesting a
          nested scroll region that would clip the search popovers */}
      <div className="relative flex max-h-[90vh] w-[400px] flex-col overflow-y-auto rounded-2xl border border-line bg-popover p-4 shadow-2xl">
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

        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Who wanted what <span className="normal-case text-ink-faint/70">(each person can want something different)</span>
        </p>
        <div className="space-y-2">
          {guests.map((g, i) => (
            <div key={i} className="rounded-[10px] border border-line bg-cream/60 p-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  value={g.name ?? ""}
                  onChange={(e) => updateGuest(i, { name: e.target.value })}
                  placeholder={guests.length > 1 ? `Person ${i + 1} name (optional)` : "Name (optional)"}
                  className={`${field} flex-1`}
                />
                {guests.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeGuest(i)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface hover:text-[#B3402F]"
                    aria-label="Remove this person"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-1.5">
                <ServicePicker
                  services={services}
                  selected={g.serviceIds ?? []}
                  onChange={(ids) => updateGuest(i, { serviceIds: ids })}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addGuest}
          className="mt-2 flex items-center gap-1 text-[11.5px] font-semibold text-clay hover:text-clay-deep"
        >
          <Plus className="h-3 w-3" /> Add another person
        </button>

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
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Phone / tech / notes, if you have them</p>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={field} autoFocus />
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
            + Add a phone, tech, or note
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
