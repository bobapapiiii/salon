// ─── Shared destructive-action confirmation ──────────────────────────────────
// Any delete or cancel on the platform passes through a prompt like this.
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({ title, body, confirmLabel = "Delete", onConfirm, onClose }: {
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div className="relative w-[380px] rounded-2xl border border-line bg-popover p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rust-tint text-rust">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold leading-5 text-ink">{title}</h3>
            {body && <p className="mt-1 text-[12.5px] leading-5 text-ink-soft">{body}</p>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className="rounded-[10px] bg-rust px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
