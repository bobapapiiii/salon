import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { MouseEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Page-scoped keyframes (index.css is owned by another agent — inject the few
 * schedule-specific animations here instead).
 */
export function ScheduleStyles() {
  return (
    <style>{`
      @keyframes sched-shake {
        0%,100% { transform: translateX(0); }
        20% { transform: translateX(-5px); }
        40% { transform: translateX(5px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(3px); }
      }
      .sched-shake { animation: sched-shake 0.2s linear 2; }
      @keyframes sched-sheen {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(320%); }
      }
      .sched-sheen { animation: sched-sheen 3s linear infinite; }
      @keyframes sched-now-pulse {
        0% { box-shadow: 0 0 0 0 rgba(180,85,43,.45); }
        100% { box-shadow: 0 0 0 14px rgba(180,85,43,0); }
      }
      .sched-now-pulse { animation: sched-now-pulse 0.9s ease-out 2; }
      .sched-hatch {
        background-image: repeating-linear-gradient(
          45deg, rgba(42,33,26,.08) 0 4px, transparent 4px 9px);
      }
      .sched-stripe-bg {
        background-image: repeating-linear-gradient(
          -45deg, rgba(216,204,185,.35) 0 6px, transparent 6px 14px);
      }
      .sched-skeleton {
        background: linear-gradient(90deg, #F2EBE0 25%, #FAF6EF 50%, #F2EBE0 75%);
        background-size: 800px 100%;
        animation: shimmer 1.4s linear infinite;
      }
    `}</style>
  )
}

/* ── SegmentedControl (design.md §7.2) ─────────────────────────────── */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  ariaLabel?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center rounded-r-pill bg-cream p-0.5',
        size === 'sm' ? 'h-8' : 'h-9',
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'relative rounded-r-pill px-3 text-[12.5px] font-bold transition-colors duration-150',
              size === 'sm' ? 'h-7' : 'h-8',
              active ? 'text-ink' : 'text-ink-soft hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={ariaLabel ? `seg-${ariaLabel}` : undefined}
                className="absolute inset-0 rounded-r-pill bg-surface shadow-sh-1"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Icon button ───────────────────────────────────────────────────── */
export function IconBtn({
  title,
  onClick,
  children,
  className,
  badge,
  disabled,
}: {
  title: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
  className?: string
  badge?: number
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-r-md text-ink-soft transition-colors duration-150 hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-r-pill bg-clay px-1 text-[10px] font-extrabold text-white tnum">
          {badge}
        </span>
      )}
    </button>
  )
}

/* ── Modal shell (design.md §7.2) ──────────────────────────────────── */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 560,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  width?: number
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.button
            aria-label="Close dialog"
            className="absolute inset-0 cursor-default"
            style={{ background: 'rgba(42,33,26,.45)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative z-10 max-h-[88dvh] w-full overflow-y-auto rounded-r-xl bg-surface shadow-sh-3 schedule-scroll"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between border-b border-line px-5 pb-3 pt-4">
              <div>
                <h2 className="font-display text-[22px] font-semibold leading-7">{title}</h2>
                {subtitle && <p className="mt-0.5 text-small font-medium text-ink-soft">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-cream hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ── Form field label ──────────────────────────────────────────────── */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
      {children}
    </label>
  )
}

export const inputCls =
  'h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] font-medium text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30'
