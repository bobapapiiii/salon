import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Flag, X } from 'lucide-react'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'

/* ── Toggle — design.md §7.2: 36×20 pill, 16px knob, clay when on ──────── */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  small = false,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  small?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'relative shrink-0 cursor-pointer rounded-r-pill transition-colors duration-150',
        small ? 'h-[18px] w-8' : 'h-5 w-9',
        checked ? 'bg-clay' : 'bg-line-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 -translate-y-1/2 rounded-r-pill bg-surface shadow-[0_1px_2px_rgba(42,33,26,.25)] transition-[left] duration-150 ease-out-expo',
          small ? 'h-3.5 w-3.5' : 'h-4 w-4',
          checked
            ? small
              ? 'left-[calc(100%-16px)]'
              : 'left-[calc(100%-18px)]'
            : 'left-[2px]',
        )}
      />
    </button>
  )
}

/* ── Note flag pill — design.md §3.4 ───────────────────────────────────── */
export type NoteKind = 'allergy' | 'alert' | 'preference' | 'general'

const KIND_STYLE: Record<NoteKind, { cls: string; label: string; flag: boolean }> = {
  allergy: { cls: 'bg-rust-tint text-rust', label: 'Allergy', flag: true },
  alert: { cls: 'bg-amber-tint text-amber', label: 'Alert', flag: true },
  preference: { cls: 'bg-cream text-ink-soft', label: 'Preference', flag: true },
  general: { cls: 'bg-cream text-ink-soft', label: 'Note', flag: false },
}

export function NoteFlag({ kind, text, className }: { kind: string; text: string; className?: string }) {
  const k = (KIND_STYLE[kind as NoteKind] ? kind : 'general') as NoteKind
  const s = KIND_STYLE[k]
  return (
    <span
      title={`${s.label}: ${text}`}
      className={cn(
        'inline-flex h-5 max-w-[180px] items-center gap-1 truncate rounded-r-pill px-2 text-[10.5px] font-bold leading-[14px]',
        s.cls,
        className,
      )}
    >
      {s.flag && <Flag className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />}
      <span className="truncate">{text}</span>
    </span>
  )
}

/* ── Modal — design.md §7.2: centered, r-xl, sh-3, blurred backdrop ────── */
export function Modal({
  open,
  onClose,
  children,
  maxWidth = 600,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: number
  labelledBy?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18, ease: [0.64, 0, 0.78, 0] } }}
        >
          <motion.button
            aria-label="Close dialog"
            className="absolute inset-0 cursor-default bg-[rgba(42,33,26,.45)] backdrop-blur-[4px]"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className="relative flex max-h-[calc(100dvh-48px)] w-full flex-col overflow-hidden rounded-r-xl bg-surface shadow-sh-3"
            style={{ maxWidth }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.18, ease: [0.64, 0, 0.78, 0] } }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ModalHeader({ title, onClose, sub }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
      <div>
        <h2 className="font-display text-[22px] font-semibold leading-7">{title}</h2>
        {sub && <p className="mt-0.5 text-small font-medium text-ink-faint">{sub}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-cream hover:text-ink"
      >
        <X className="h-[18px] w-[18px]" />
      </button>
    </div>
  )
}

/* ── Ops toaster — design.md §7.2: night bg, bottom-center (salon) ─────── */
export function OpsToaster() {
  return (
    <Toaster
      position="bottom-center"
      gap={8}
      toastOptions={{
        style: {
          background: '#241C15',
          color: '#FFFEFB',
          border: '1px solid rgba(255,254,251,.08)',
          borderRadius: '10px',
          fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif',
          fontSize: '13px',
        },
        classNames: {
          actionButton: '!bg-transparent !text-[#E8916D] !font-bold',
          cancelButton: '!bg-transparent !text-[#A3937F]',
        },
      }}
    />
  )
}

/* ── EmptyState — design.md §7.2 ───────────────────────────────────────── */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <img src="/empty-calendar.svg" alt="" className="h-[120px] w-[160px] opacity-90" />
      <h3 className="mt-4 text-[15px] font-bold leading-[22px]">{title}</h3>
      {body && <p className="mt-1 max-w-[320px] text-small font-medium text-ink-soft">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── Count-up numeral for stat chips (800ms once) ──────────────────────── */
export function CountUp({ value, className }: { value: number; className?: string }) {
  return (
    <motion.span
      key={value}
      className={cn('tnum', className)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {value}
    </motion.span>
  )
}
