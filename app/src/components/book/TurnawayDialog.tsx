// ─── Log a turnaway, a client (or group) who wanted an appointment we
// couldn't offer ─────────────────────────────────────────────────────────
// Nothing else in the app leaves a trace of missed demand: if there's no
// room, the client just never gets booked. Most turnaways are walk-ins we
// never got a name for, sometimes a whole party where each person wants
// something different (mani for one, mani + pedi for another). We track
// the general service category, not the exact service — a turned-away
// walk-in was never asked which specific service they wanted, so a
// category (Manicure, Pedicure, etc) is what's actually known, and the
// category list is short enough to just tap through. Built to still be
// loggable in a couple of taps for the common case: one unnamed walk-in,
// nothing else picked, just a reason.
import { useState } from "react";
import { PhoneOff, Check, X, Plus } from "lucide-react";
import { useCategoriesStore } from "@/lib/categories-store";
import { useStaffStore, boardTechs } from "@/lib/staff-store";
import type { ServiceCategory } from "@/lib/booking-types";
import { SearchSelect } from "./SearchSelect";

export interface TurnawayGuest {
  name?: string;
  /** general service category this one person wanted, e.g. Manicure +
   *  Pedicure — not the exact service, since we usually don't know that
   *  for someone we couldn't fit in; empty/undefined = unspecified */
  categoryIds?: string[];
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

/** tap-to-toggle category picker — the category list is short and curated
 *  (unlike the full service menu), so a plain pill row is faster than a
 *  search box here */
function CategoryPicker({ categories, selected, onChange }: {
  categories: ServiceCategory[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="flex flex-wrap gap-1">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => toggle(c.id)}
          className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
            selected.includes(c.id) ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

export function TurnawayDialog({ onSave, onClose }: {
  onSave: (d: TurnawayDraft) => void;
  onClose: () => void;
}) {
  const categories = useCategoriesStore();
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
        categoryIds: g.categoryIds && g.categoryIds.length > 0 ? g.categoryIds : undefined,
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
          list) so a big party just grows the dialog instead of needing a
          nested scroll region */}
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
          Who wanted what <span className="normal-case text-ink-faint/70">(general category, each person can want something different)</span>
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
                <CategoryPicker
                  categories={categories}
                  selected={g.categoryIds ?? []}
                  onChange={(ids) => updateGuest(i, { categoryIds: ids })}
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
            <SearchSelect
              options={[{ value: '', label: 'Any tech' }, ...techs.map((t) => ({ value: t.id, label: t.name, avatarText: t.initials }))]}
              value={requestedTechId}
              onChange={setRequestedTechId}
              searchPlaceholder="Search technicians"
              className="w-full"
            />
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
