import type { ReactNode } from 'react'
import { Check, Clock, X, Ban, Play, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status =
  | 'confirmed'
  | 'requested'
  | 'pending'
  | 'countered'
  | 'checked-in'
  | 'in-progress'
  | 'completed'
  | 'no-show'
  | 'cancelled'

const STYLES: Record<Status, { cls: string; icon: ReactNode; label: string }> = {
  confirmed: {
    cls: 'bg-olive-tint text-[#4B552F]',
    icon: <Check className="h-3 w-3" strokeWidth={3} />,
    label: 'Confirmed',
  },
  requested: {
    cls: 'bg-amber-tint text-amber border border-dashed border-amber',
    icon: <Clock className="h-3 w-3" />,
    label: 'Requested',
  },
  pending: {
    cls: 'bg-amber-tint text-amber border border-dashed border-amber',
    icon: <Clock className="h-3 w-3" />,
    label: 'Requested — awaiting salon',
  },
  countered: {
    cls: 'bg-clay-tint text-clay-deep',
    icon: <CalendarClock className="h-3 w-3" />,
    label: 'Countered — new time proposed',
  },
  'checked-in': {
    cls: 'bg-clay-tint text-clay-deep',
    icon: <Check className="h-3 w-3" strokeWidth={3} />,
    label: 'Checked in',
  },
  'in-progress': {
    cls: 'bg-clay-tint text-clay-deep',
    icon: <Play className="h-3 w-3" />,
    label: 'In progress',
  },
  completed: {
    cls: 'bg-cream text-ink-soft',
    icon: <Check className="h-3 w-3" />,
    label: 'Completed',
  },
  'no-show': {
    cls: 'bg-rust-tint text-rust',
    icon: <Ban className="h-3 w-3" />,
    label: 'No-show',
  },
  cancelled: {
    cls: 'bg-cream text-ink-faint',
    icon: <X className="h-3 w-3" />,
    label: 'Cancelled',
  },
}

/** Pill status chip (design.md §7.2) — tint bg + darker text + icon. */
export default function StatusChip({
  status,
  label,
  className,
  pulse,
}: {
  status: Status
  label?: string
  className?: string
  pulse?: boolean
}) {
  const s = STYLES[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-r-pill px-2 py-0.5 text-micro font-bold uppercase tracking-[0.08em]',
        s.cls,
        pulse && 'animate-pulse',
        className,
      )}
    >
      {s.icon}
      {label ?? s.label}
    </span>
  )
}
