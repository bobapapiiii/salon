import { useEffect, useMemo, useState } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import { FieldLabel, Modal, inputCls } from './shared'
import {
  STATUS_CHIP,
  STATUS_LABEL,
  fmtDur,
  minToTime,
  type Appointment,
  type ApptStatus,
  type StaffMember,
} from './schedule-utils'

/* ═══════════════════════════════════════════════════════════════════
   EditAppointmentModal — salon-schedule.md §7
   ═══════════════════════════════════════════════════════════════════ */

const ALL_STATUSES: ApptStatus[] = [
  'requested',
  'confirmed',
  'checked-in',
  'in-progress',
  'completed',
  'no-show',
  'cancelled',
]

interface ItemDraft {
  itemId: number
  staffId: number | null
  startMin: number
}

export function EditAppointmentModal({
  appt,
  salonId,
  staff,
  onClose,
  onSaved,
}: {
  appt: Appointment | null
  salonId: number
  staff: StaffMember[]
  onClose: () => void
  onSaved: (undo: { startMin: number; staffId: number | null; status: ApptStatus; date: string }) => void
}) {
  const utils = trpc.useUtils()
  const [status, setStatus] = useState<ApptStatus>('confirmed')
  const [date, setDate] = useState('')
  const [drafts, setDrafts] = useState<ItemDraft[]>([])
  const [dirtyFlash, setDirtyFlash] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    if (!appt) return
    setStatus(appt.status)
    setDate(appt.date)
    setDrafts(
      [...appt.items]
        .sort((a, b) => a.startMin - b.startMin)
        .map((it) => ({ itemId: it.id, staffId: it.staffId, startMin: it.startMin })),
    )
    setPhase('idle')
  }, [appt])

  const reschedule = trpc.appointments.reschedule.useMutation()
  const updateStatus = trpc.appointments.updateStatus.useMutation()

  const original = useMemo(() => {
    if (!appt) return null
    const sorted = [...appt.items].sort((a, b) => a.startMin - b.startMin)
    return {
      startMin: appt.startMin,
      staffId: sorted[0]?.staffId ?? null,
      status: appt.status,
      date: appt.date,
    }
  }, [appt])

  if (!appt || !original) return null

  const firstDraft = drafts[0]
  const scheduleChanged =
    firstDraft != null &&
    (firstDraft.startMin !== original.startMin ||
      firstDraft.staffId !== original.staffId ||
      date !== original.date)
  const statusChanged = status !== original.status
  const dirty = scheduleChanged || statusChanged
  const multiTechWarn = appt.items.length > 1 && drafts.some((d) => d.staffId !== firstDraft?.staffId)

  const flash = (key: string) => {
    setDirtyFlash(key)
    setTimeout(() => setDirtyFlash((cur) => (cur === key ? null : cur)), 1000)
  }

  const save = async () => {
    if (!dirty || !firstDraft) return
    setPhase('saving')
    try {
      if (scheduleChanged) {
        await reschedule.mutateAsync({
          id: appt.id,
          date: date !== original.date ? date : undefined,
          startMin: firstDraft.startMin !== original.startMin ? firstDraft.startMin : undefined,
          staffId: firstDraft.staffId !== original.staffId ? firstDraft.staffId : undefined,
        })
      }
      if (statusChanged) {
        await updateStatus.mutateAsync({ id: appt.id, status })
      }
      await utils.appointments.byDate.invalidate({ salonId, date: original.date })
      if (date !== original.date) await utils.appointments.byDate.invalidate({ salonId, date })
      setPhase('saved')
      onSaved(original)
      setTimeout(onClose, 500)
    } catch (e) {
      setPhase('idle')
      const msg = e instanceof Error ? e.message : 'Could not save'
      toast.error(msg.includes('conflict') ? 'Overlaps an existing appointment' : msg)
    }
  }

  return (
    <Modal
      open={appt != null}
      onClose={onClose}
      title="Edit appointment"
      subtitle={`${appt.client.firstName} ${appt.client.lastName}`}
      width={560}
    >
      <div className="flex flex-col gap-4">
        {/* Status select with non-color preview chips */}
        <div>
          <FieldLabel>Status</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => {
              const chip = STATUS_CHIP[s]
              const active = status === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatus(s)
                    flash('status')
                  }}
                  className={cn(
                    'rounded-r-pill border px-2.5 py-1.5 text-[11.5px] font-bold transition-all duration-150',
                    active ? 'border-ink/30 ring-2 ring-clay/30' : 'border-line hover:border-line-strong',
                  )}
                  style={{ background: chip.bg, color: chip.fg }}
                >
                  {STATUS_LABEL[s]}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Date</FieldLabel>
          <input
            type="date"
            className={cn(inputCls, 'tnum', dirtyFlash === 'date' && 'bg-clay-tint')}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              flash('date')
            }}
          />
        </div>

        {/* Per-item editing */}
        <div>
          <FieldLabel>Services</FieldLabel>
          <div className="flex flex-col gap-2">
            {appt.items.map((it) => {
              const draft = drafts.find((d) => d.itemId === it.id)
              if (!draft) return null
              return (
                <div key={it.id} className="grid grid-cols-[1fr_110px_80px] items-center gap-2 rounded-r-sm border border-line p-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold">{it.service.name}</p>
                    <select
                      className="mt-1 h-8 w-full rounded-r-sm border border-line bg-surface px-2 text-[12.5px] font-medium focus:border-clay focus:outline-none"
                      value={draft.staffId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null
                        setDrafts((ds) => ds.map((d) => (d.itemId === it.id ? { ...d, staffId: v } : d)))
                        flash(`staff-${it.id}`)
                      }}
                    >
                      <option value="">Unassigned</option>
                      {staff.map((t) => {
                        const ok = t.serviceIds.includes(it.serviceId)
                        return (
                          <option key={t.id} value={t.id} disabled={!ok}>
                            {t.name}
                            {!ok ? ' (not qualified)' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Start</FieldLabel>
                    <input
                      className={cn(
                        'h-8 w-full rounded-r-sm border border-line bg-surface px-2 text-center text-[12.5px] font-semibold tnum focus:border-clay focus:outline-none',
                        dirtyFlash === `start-${it.id}` && 'bg-clay-tint',
                      )}
                      value={minToTime(draft.startMin)}
                      onChange={(e) => {
                        const m = /^(\d{1,2}):(\d{2})$/.exec(e.target.value)
                        if (m) {
                          setDrafts((ds) =>
                            ds.map((d) =>
                              d.itemId === it.id
                                ? { ...d, startMin: Math.min(1439, Number(m[1]) * 60 + Number(m[2])) }
                                : d,
                            ),
                          )
                          flash(`start-${it.id}`)
                        }
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel>Duration</FieldLabel>
                    <p className="flex h-8 items-center justify-center text-[12.5px] font-bold text-ink-soft tnum">
                      {fmtDur(it.durationMin)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          {appt.items.length > 1 && (
            <p className="mt-2 flex items-center gap-1.5 text-small font-semibold text-amber">
              <TriangleAlert className="h-3.5 w-3.5" />
              {multiTechWarn
                ? 'Saving applies one technician to all services — this breaks the same-time pair.'
                : 'Same-time pair: time changes move both services together.'}
            </p>
          )}
        </div>

        {/* History footer (read-only) */}
        <p className="border-t border-line pt-3 text-micro font-bold uppercase tracking-[0.06em] text-ink-faint">
          Created {appt.source === 'online' ? 'online' : appt.source === 'walk-in' ? 'as walk-in' : 'at front desk'} ·{' '}
          {new Date(appt.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
          {new Date(appt.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </p>

        {/* Footer actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-r-md px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty || phase !== 'idle'}
            onClick={() => void save()}
            className={cn(
              'flex h-10 items-center gap-2 rounded-r-md px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150',
              phase === 'saved' ? 'bg-olive' : 'bg-clay hover:-translate-y-px hover:bg-clay-deep',
              (!dirty || phase === 'saving') && 'cursor-not-allowed opacity-45 hover:translate-y-0',
            )}
          >
            {phase === 'saved' ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : phase === 'saving' ? (
              'Saving…'
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
