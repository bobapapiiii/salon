// ─── Time-block editor, blocked time on a tech's column ─────────────────────
// Suggested reasons + free text, start/end in 15-minute steps. Used for both
// creating (right-click an empty spot) and editing an existing block.
import { useState } from "react";
import { Ban, Check, Trash2, X } from "lucide-react";
import { DAY_SLOTS, SLOT_MIN, fmtTime } from "@/lib/booking-types";

const DAY_MIN = DAY_SLOTS * SLOT_MIN;


export const BLOCK_REASONS = ["Running late", "Leaving early", "Lunch", "Block", "Internal use"];

export interface BlockDraft {
  startMin: number;
  endMin: number;
  reason: string;
}

const field =
  "w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring";

import { useSettingsStore } from "@/lib/settings-store";

export function BlockEditor({ techName, isNew, initial, onSave, onDelete, onClose }: {
  techName: string;
  isNew: boolean;
  initial: BlockDraft;
  onSave: (d: BlockDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [startMin, setStartMin] = useState(initial.startMin);
  const [endMin, setEndMin] = useState(initial.endMin);
  const [reason, setReason] = useState(initial.reason);
  const increment = useSettingsStore().booking.increment;
  const TIME_OPTS = Array.from({ length: DAY_SLOTS + 1 }, (_, i) => i * increment);

  const custom = reason !== "" && !BLOCK_REASONS.includes(reason);

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-[340px] rounded-2xl border border-line bg-popover p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <Ban className="h-4 w-4 text-ink-faint" /> {isNew ? "Block time" : "Edit block"}, {techName}
          </h3>
          <button onClick={onClose} className="text-ink-faint transition-colors hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* reason suggestions */}
        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Reason</p>
        <div className="flex flex-wrap gap-1">
          {BLOCK_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
                reason === r ? "border-clay bg-clay-tint text-clay" : "border-line bg-surface text-ink-soft hover:border-line-strong"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          value={custom || reason === "" ? reason : ""}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Or type your own reason"
          className={`${field} mt-2`}
        />

        {/* time range */}
        <p className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Time</p>
        <div className="flex items-center gap-1.5">
          <select
            value={startMin}
            onChange={(e) => {
              const v = Number(e.target.value);
              setStartMin(v);
              if (v >= endMin) setEndMin(Math.min(DAY_MIN, v + SLOT_MIN * 2));
            }}
            className={field}
          >
            {TIME_OPTS.slice(0, -1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
          </select>
          <span className="shrink-0 text-[11px] font-bold text-ink-faint">to</span>
          <select
            value={endMin}
            onChange={(e) => {
              const v = Number(e.target.value);
              setEndMin(v);
              if (v <= startMin) setStartMin(Math.max(0, v - SLOT_MIN * 2));
            }}
            className={field}
          >
            {TIME_OPTS.slice(1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
          </select>
        </div>

        <div className="mt-4 flex gap-2">
          {!isNew && onDelete && (
            <button
              onClick={onDelete}
              className="flex h-9 items-center gap-1.5 rounded-[10px] border border-rust/40 px-3 text-[12.5px] font-semibold text-rust transition-colors hover:bg-rust-tint"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
          <button
            onClick={() => reason.trim() && onSave({ startMin, endMin, reason: reason.trim() })}
            disabled={!reason.trim()}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-clay text-[13px] font-bold text-white transition-colors hover:bg-clay-deep disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" /> {isNew ? "Add block" : "Save block"}
          </button>
        </div>
      </div>
    </div>
  );
}
