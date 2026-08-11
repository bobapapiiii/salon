import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CalendarX, Check, CheckCircle2, ClipboardCopy, CreditCard, Link2, Pencil, Play, Receipt, ScrollText, Undo2, UserCheck, X,
} from 'lucide-react'
import type { Appointment } from '@/lib/booking-types'
import { CLOSE_MIN, OPEN_MIN, SLOT_MIN, fmtTime } from '@/lib/booking-types'
import { SERVICES } from '@/lib/mock-data'
import { boardTechs, useStaffStore } from '@/lib/staff-store'

// ── right-click context menu ───────────────────────────────────────────────

export type MenuAction =
  | 'edit' | 'confirm' | 'checkin' | 'start' | 'complete' | 'checkout' | 'invoice'
  | 'backtocheckin' | 'backtoconfirmed'
  | 'copy' | 'noshow' | 'cancel' | 'log'

interface MenuProps {
  x: number
  y: number
  appt: Appointment
  pairCount: number
  onAction: (a: MenuAction) => void
  onClose: () => void
}

export function ApptContextMenu({ x, y, appt, pairCount, onAction, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  // start with a rough estimate so it renders somewhere sane, then re-measure
  // the actual menu once it's in the DOM — the row count varies a lot by
  // status (checked-in alone can run 8 rows deep), so a fixed height guess
  // isn't enough to keep the bottom options from running off-screen
  const [pos, setPos] = useState({ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 340) })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y])

  const item = (
    action: MenuAction, label: string, icon: React.ReactNode, danger = false,
  ) => (
    <button
      key={action}
      onClick={() => onAction(action)}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'hover:bg-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[90]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={menuRef}
        className="absolute w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-2xl"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-1.5">
          <div className="truncate text-[13px] font-semibold">{appt.clientName}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {fmtTime(appt.startMin)} · {appt.durationMin}m
            {pairCount > 1 && (
              <span className="flex items-center gap-0.5 text-sky-400">
                <Link2 className="h-3 w-3" /> group of {pairCount}
              </span>
            )}
          </div>
        </div>

        {item('edit', 'Edit appointment', <Pencil className="h-3.5 w-3.5" />)}
        {item('copy', pairCount > 1 ? `Copy group to clipboard` : 'Copy to clipboard', <ClipboardCopy className="h-3.5 w-3.5" />)}
        <div className="my-1 border-t border-border" />

        {appt.status === 'requested' && item('confirm', 'Confirm request', <Check className="h-3.5 w-3.5" />)}
        {appt.status === 'booked' && item('confirm', 'Confirm appointment', <Check className="h-3.5 w-3.5" />)}
        {(appt.status === 'confirmed' || appt.status === 'requested' || appt.status === 'booked') &&
          item('checkin', 'Check in', <UserCheck className="h-3.5 w-3.5" />)}
        {appt.status === 'checked_in' && item('start', 'Start service', <Play className="h-3.5 w-3.5" />)}
        {appt.status === 'in_service' && item('complete', 'Mark completed', <CheckCircle2 className="h-3.5 w-3.5" />)}
        {appt.status === 'in_service' && item('backtocheckin', 'Back to checked in', <Undo2 className="h-3.5 w-3.5" />)}
        {appt.status === 'checked_in' && item('backtoconfirmed', 'Back to confirmed', <Undo2 className="h-3.5 w-3.5" />)}
        {appt.status === 'completed' && item('invoice', 'View invoice / Print', <Receipt className="h-3.5 w-3.5" />)}
        {(appt.status === 'booked' || appt.status === 'confirmed' || appt.status === 'checked_in' || appt.status === 'completed' || appt.status === 'in_service') &&
          item('checkout', 'Check out', <CreditCard className="h-3.5 w-3.5" />)}
        {(appt.status === 'booked' || appt.status === 'confirmed' || appt.status === 'checked_in') && (
          <>
            <div className="my-1 border-t border-border" />
            {item('noshow', 'Mark no-show', <CalendarX className="h-3.5 w-3.5" />, true)}
            {item('cancel', 'Cancel appointment', <X className="h-3.5 w-3.5" />, true)}
          </>
        )}
        {appt.status === 'requested' && (
          <>
            <div className="my-1 border-t border-border" />
            {item('cancel', 'Decline request', <X className="h-3.5 w-3.5" />, true)}
          </>
        )}
        <div className="my-1 border-t border-border" />
        {item('log', 'Show log', <ScrollText className="h-3.5 w-3.5" />)}
      </div>
    </div>
  )
}

// ── edit appointment dialog ────────────────────────────────────────────────

interface EditProps {
  appt: Appointment
  error?: string | null
  onSave: (updated: Appointment) => void
  onClose: () => void
}

const TIME_OPTIONS = Array.from(
  { length: (CLOSE_MIN - OPEN_MIN) / SLOT_MIN },
  (_, i) => i * SLOT_MIN,
)
const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

export function EditAppointmentDialog({ appt, error, onSave, onClose }: EditProps) {
  const { roles, techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  const [draft, setDraft] = useState<Appointment>(appt)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const set = <K extends keyof Appointment>(k: K, v: Appointment[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        className="w-[26rem] rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">Edit appointment</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Client</label>
            <input
              value={draft.clientName}
              onChange={(e) => set('clientName', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Service</label>
              <select
                value={draft.serviceId}
                onChange={(e) => {
                  const svc = SERVICES.find((s) => s.id === e.target.value)!
                  setDraft((d) => ({ ...d, serviceId: svc.id, durationMin: svc.durationMin }))
                }}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              >
                {SERVICES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Technician</label>
              <select
                value={draft.techId}
                onChange={(e) => set('techId', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              >
                {roles.map((role) => (
                  <optgroup key={role.id} label={role.name}>
                    {techs.filter((t) => t.teamId === role.id).sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Start</label>
              <select
                value={draft.startMin}
                onChange={(e) => set('startMin', Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              >
                {TIME_OPTIONS.map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Duration</label>
              <select
                value={draft.durationMin}
                onChange={(e) => set('durationMin', Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              >
                {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Status</label>
              <select
                value={draft.status}
                onChange={(e) => set('status', e.target.value as Appointment['status'])}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              >
                <option value="booked">Booked</option>
                <option value="requested">Requested</option>
                <option value="confirmed">Confirmed</option>
                <option value="checked_in">Checked in</option>
                <option value="in_service">In service</option>
                <option value="completed">Completed</option>
                <option value="no_show">No-show</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Notes</label>
            <textarea
              value={draft.notes ?? ''}
              onChange={(e) => set('notes', e.target.value || undefined)}
              rows={2}
              placeholder="Allergies, design references, client preferences"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {draft.parallelGroup && (
            <p className="flex items-center gap-1 text-[11px] text-sky-400">
              <Link2 className="h-3 w-3" /> Part of a same-time group, edits apply to this service only.
            </p>
          )}
          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onClose()}
              className="flex-1 rounded-md border border-border py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="flex-1 rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── cancel confirmation dialog ───────────────────────────────────────────────

interface ConfirmCancelProps {
  clientName: string
  serviceName: string
  timeLabel: string
  groupCount: number
  onCancelOne: () => void
  onCancelGroup: () => void
  onClose: () => void
}

export function ConfirmCancelDialog({ clientName, serviceName, timeLabel, groupCount, onCancelOne, onCancelGroup, onClose }: ConfirmCancelProps) {
  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="w-96 rounded-xl border border-border bg-popover p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-bold">Cancel appointment?</div>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          <b className="text-foreground">{clientName}</b>, {serviceName} at {timeLabel}
          {groupCount > 1 && (
            <>
              {' '}is part of a <b className="text-foreground">linked group of {groupCount} services</b>.
            </>
          )}
          {' '}The client will be notified by SMS.
        </p>

        <div className="mt-4 space-y-2">
          {groupCount > 1 && (
            <button
              onClick={onCancelGroup}
              className="w-full rounded-md bg-red-600 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Cancel group ({groupCount} services)
            </button>
          )}
          <button
            onClick={onCancelOne}
            className={`w-full rounded-md py-2 text-sm font-semibold transition-opacity hover:opacity-90 ${
              groupCount > 1 ? 'border border-red-500/50 text-red-500 hover:bg-red-500/10' : 'bg-red-600 text-white'
            }`}
          >
            {groupCount > 1 ? 'Cancel this service only' : 'Cancel appointment'}
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Keep appointment
          </button>
        </div>
      </div>
    </div>
  )
}
