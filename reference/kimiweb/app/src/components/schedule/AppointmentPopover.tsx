import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Copy,
  Flag,
  TriangleAlert,
  Quote,
  Pencil,
  Move,
  Ban,
  X,
  MessageSquare,
  Check,
  Play,
  ClipboardCheck,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  CATEGORY_COLORS,
  STATUS_CHIP,
  STATUS_LABEL,
  fmtDur,
  fmtRange,
  initialsOf,
  type Appointment,
  type ApptStatus,
  type CatKey,
} from './schedule-utils'

/* ═══════════════════════════════════════════════════════════════════
   AppointmentPopover — salon-schedule.md §5 (320px, anchored, flips)
   ═══════════════════════════════════════════════════════════════════ */

export interface PopoverAnchor {
  apptId: number
  rect: DOMRect
}

const CANCEL_REASONS = ['Client request', 'Salon', 'No-show fee'] as const

export function AppointmentPopover({
  appt,
  anchor,
  catKeyOf,
  onClose,
  onStatus,
  onEdit,
  onRescheduleHint,
}: {
  appt: Appointment
  anchor: PopoverAnchor
  catKeyOf: (item: Appointment['items'][number]) => CatKey
  onClose: () => void
  onStatus: (appt: Appointment, status: ApptStatus) => void
  onEdit: (appt: Appointment) => void
  onRescheduleHint: (appt: Appointment) => void
}) {
  const [confirming, setConfirming] = useState<'no-show' | 'cancel' | null>(null)
  const [cancelReason, setCancelReason] = useState<(typeof CANCEL_REASONS)[number]>('Client request')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Flip near viewport edges
  const W = 320
  const r = anchor.rect
  const left = r.right + W + 16 > window.innerWidth ? Math.max(8, r.left - W - 8) : r.right + 8
  const top = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - 460))

  const chip = STATUS_CHIP[appt.status]
  const client = appt.client
  const flags = client.notes.filter((n) => n.kind === 'allergy' || n.kind === 'alert' || n.kind === 'preference')
  const sameTime = !!appt.sameTimeGroupId && appt.items.length > 1

  const primaryAction = (): { label: string; icon: ReactNode; next: ApptStatus } | null => {
    switch (appt.status) {
      case 'requested':
        return { label: 'Confirm', icon: <Check className="h-4 w-4" />, next: 'confirmed' }
      case 'confirmed':
        return { label: 'Check in', icon: <ClipboardCheck className="h-4 w-4" />, next: 'checked-in' }
      case 'checked-in':
        return { label: 'Start', icon: <Play className="h-4 w-4" />, next: 'in-progress' }
      case 'in-progress':
        return { label: 'Complete', icon: <Check className="h-4 w-4" />, next: 'completed' }
      default:
        return null
    }
  }
  const primary = primaryAction()

  return (
    <>
      <button aria-label="Close details" className="fixed inset-0 z-[60] cursor-default" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-label="Appointment details"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="fixed z-[61] w-[320px] rounded-r-lg border border-line bg-surface p-3 shadow-sh-2"
        style={{ left, top, transformOrigin: 'left top' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <span
            className="rounded-r-pill px-2 py-0.5 text-micro font-bold uppercase"
            style={{ background: chip.bg, color: chip.fg }}
          >
            {STATUS_LABEL[appt.status]}
          </span>
          <span className="text-micro font-bold uppercase text-ink-faint">
            {appt.source === 'online' ? 'Online' : appt.source === 'walk-in' ? 'Walk-in' : 'Front desk'}
          </span>
          <span className="ml-auto text-small font-semibold text-ink-soft tnum">
            {fmtRange(appt.startMin, appt.endMin)} · {fmtDur(appt.endMin - appt.startMin)}
          </span>
        </div>

        {/* Client row */}
        <div className="mt-3 flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-r-pill bg-clay-tint text-[11px] font-extrabold text-clay-deep">
            {initialsOf(client.firstName, client.lastName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold leading-5">
              {client.firstName} {client.lastName}
            </p>
            {client.phone && (
              <button
                type="button"
                className="group flex items-center gap-1 text-small font-medium text-ink-soft hover:text-clay"
                title="Copy phone"
                onClick={() => {
                  navigator.clipboard?.writeText(client.phone ?? '')
                  toast.success('Phone copied')
                }}
              >
                <span className="tnum">{client.phone}</span>
                <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}
          </div>
        </div>
        {flags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {flags.map((n) => (
              <span
                key={n.id}
                className={cn(
                  'flex items-center gap-1 rounded-r-pill px-2 py-0.5 text-[11px] font-bold',
                  n.kind === 'allergy' && 'bg-rust-tint text-rust',
                  n.kind === 'alert' && 'bg-amber-tint text-amber',
                  n.kind === 'preference' && 'bg-cream text-ink-soft',
                )}
              >
                {n.kind === 'allergy' ? (
                  <Flag className="h-3 w-3" fill="currentColor" />
                ) : n.kind === 'alert' ? (
                  <TriangleAlert className="h-3 w-3" />
                ) : null}
                {n.text}
              </span>
            ))}
          </div>
        )}

        {/* Services list */}
        <div className="mt-3 border-t border-line pt-2.5">
          {sameTime && (
            <p className="mb-1 text-micro font-bold uppercase text-ink-faint">At the same time</p>
          )}
          {appt.items.map((it) => {
            const cat = CATEGORY_COLORS[catKeyOf(it)]
            return (
              <div key={it.id} className="flex items-center gap-2 py-1">
                <span className="h-2.5 w-2.5 shrink-0 rounded-r-pill" style={{ background: cat.line }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{it.service.name}</span>
                <span className="shrink-0 text-small font-medium text-ink-soft">
                  {it.staff?.name ?? (it.anyStaff ? 'Any tech' : 'Unassigned')}
                </span>
                <span className="shrink-0 text-small font-semibold text-ink-faint tnum">
                  {fmtDur(it.durationMin)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Note to salon */}
        {appt.noteToSalon && (
          <div className="mt-2 flex gap-2 rounded-r-sm bg-cream p-2.5">
            <Quote className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            <p className="text-small font-medium italic text-ink-soft">{appt.noteToSalon}</p>
          </div>
        )}

        {/* Inline confirms */}
        {confirming === 'cancel' && (
          <div className="mt-3 rounded-r-sm border border-rust/30 bg-rust-tint p-2.5">
            <p className="text-[13px] font-bold text-rust">Cancel this appointment?</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CANCEL_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setCancelReason(reason)}
                  className={cn(
                    'rounded-r-pill border px-2 py-1 text-[11px] font-bold transition-colors',
                    cancelReason === reason
                      ? 'border-rust bg-rust text-white'
                      : 'border-line bg-surface text-ink-soft hover:border-rust/50',
                  )}
                >
                  {reason}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onStatus(appt, 'cancelled')}
                className="h-8 rounded-r-md bg-rust px-3 text-[13px] font-semibold text-white transition-colors hover:brightness-110"
              >
                Cancel appointment
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="flex h-8 items-center gap-1 rounded-r-md px-2 text-[13px] font-semibold text-ink-soft hover:bg-cream"
              >
                <Undo2 className="h-3.5 w-3.5" /> Keep
              </button>
            </div>
          </div>
        )}
        {confirming === 'no-show' && (
          <div className="mt-3 rounded-r-sm border border-rust/30 bg-rust-tint p-2.5">
            <p className="text-[13px] font-bold text-rust">Mark as no-show? This adds to the client's record.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onStatus(appt, 'no-show')}
                className="h-8 rounded-r-md bg-rust px-3 text-[13px] font-semibold text-white transition-colors hover:brightness-110"
              >
                Yes, no-show
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-8 rounded-r-md px-2 text-[13px] font-semibold text-ink-soft hover:bg-cream"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!confirming && (
          <div className="mt-3 border-t border-line pt-2.5">
            {primary && (
              <button
                type="button"
                onClick={() => onStatus(appt, primary.next)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-r-md bg-clay text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0"
              >
                {primary.icon}
                {primary.label}
              </button>
            )}
            <div className="mt-2 grid grid-cols-5 gap-1">
              <GhostAction title="Edit" onClick={() => onEdit(appt)} icon={<Pencil className="h-4 w-4" />} />
              <GhostAction
                title="Reschedule"
                onClick={() => onRescheduleHint(appt)}
                icon={<Move className="h-4 w-4" />}
              />
              <GhostAction
                title="No-show"
                danger
                disabled={appt.status === 'cancelled' || appt.status === 'no-show'}
                onClick={() => setConfirming('no-show')}
                icon={<Ban className="h-4 w-4" />}
              />
              <GhostAction
                title="Cancel"
                danger
                disabled={appt.status === 'cancelled'}
                onClick={() => setConfirming('cancel')}
                icon={<X className="h-4 w-4" />}
              />
              <GhostAction
                title="Message — Phase 2"
                onClick={() => toast('Messaging arrives in Phase 2')}
                icon={<MessageSquare className="h-4 w-4" />}
              />
            </div>
          </div>
        )}
      </motion.div>
    </>
  )
}

function GhostAction({
  title,
  icon,
  onClick,
  danger,
  disabled,
}: {
  title: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center justify-center rounded-r-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35',
        danger ? 'text-rust hover:bg-rust-tint' : 'text-ink-soft hover:bg-cream hover:text-ink',
      )}
    >
      {icon}
    </button>
  )
}
