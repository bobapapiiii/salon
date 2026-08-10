import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Inbox, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import {
  CATEGORY_COLORS,
  categoryKeyFromName,
  minToTime,
  prettyDate,
  techConflict,
  timeAgo,
  workWindow,
  type Appointment,
  type BookingRequest,
  type CategoryList,
  type StaffMember,
} from './schedule-utils'

/* ═══════════════════════════════════════════════════════════════════
   RequestsRail — salon-schedule.md §8 (320px, collapsible to 48px)
   ═══════════════════════════════════════════════════════════════════ */

export function RequestsRail({
  open,
  requests,
  staff,
  appointments,
  categories,
  salonId,
  viewDate,
}: {
  open: boolean
  requests: BookingRequest[]
  staff: StaffMember[]
  appointments: Appointment[]
  categories: CategoryList
  salonId: number
  viewDate: string
}) {
  if (!open) return null
  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 350, damping: 34 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-surface"
      aria-label="Booking requests"
    >
      <div className="flex h-12 w-[320px] shrink-0 items-center gap-2 border-b border-line px-3">
        <h3 className="text-[15px] font-bold leading-[22px]">Requests</h3>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-r-pill bg-clay px-1.5 text-[11px] font-extrabold text-white tnum">
          {requests.length}
        </span>
        <Link to="/salon/requests" className="ml-auto text-small font-bold text-clay hover:underline">
          View all →
        </Link>
      </div>
      <div className="flex w-[320px] flex-1 flex-col gap-2 overflow-y-auto p-3 schedule-scroll">
        {requests.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <img src="/empty-calendar.svg" alt="" className="h-[90px] w-[120px] opacity-80" />
            <p className="text-[15px] font-bold">Queue is clear</p>
            <p className="text-small font-medium text-ink-soft">
              New online bookings will appear here.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {requests.map((r) => (
              <RequestCard
                key={r.id}
                req={r}
                staff={staff}
                appointments={appointments}
                categories={categories}
                salonId={salonId}
                viewDate={viewDate}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </motion.aside>
  )
}

const DECLINE_REASONS = ['No availability', 'Fully booked', 'Other'] as const

function RequestCard({
  req,
  staff,
  appointments,
  categories,
  salonId,
  viewDate,
}: {
  req: BookingRequest
  staff: StaffMember[]
  appointments: Appointment[]
  categories: CategoryList
  salonId: number
  viewDate: string
}) {
  const utils = trpc.useUtils()
  const [mode, setMode] = useState<'idle' | 'decline' | 'propose'>('idle')
  const [reason, setReason] = useState<(typeof DECLINE_REASONS)[number]>('No availability')
  const [gone, setGone] = useState(false)

  const accept = trpc.requests.accept.useMutation()
  const decline = trpc.requests.decline.useMutation()
  const counter = trpc.requests.counter.useMutation()

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  // Propose-mode: real availability for the requested services
  const proposeItems = req.items.map((i) => ({ serviceId: i.serviceId, sameTime: i.sameTime }))
  const requestedStaffId = req.items.find((i) => i.requestedStaffId)?.requestedStaffId ?? null
  const slotsQ = trpc.availability.slots.useQuery(
    { salonId, date: req.date, items: proposeItems, staffId: requestedStaffId },
    { enabled: mode === 'propose' },
  )
  const slotOptions = (slotsQ.data ?? []).slice(0, 3)

  const ageMins = Math.floor((Date.now() - new Date(req.createdAt).getTime()) / 60000)
  const stale = ageMins >= 120

  /** First-available qualified tech per item (mirrors availability engine). */
  const computeAssignments = () => {
    let cursor = req.startMin
    const used = new Set<number>()
    return req.items.map((it) => {
      const svc = it.service
      const start = it.sameTime ? req.startMin : cursor
      if (!it.sameTime) cursor = start + svc.durationMin
      const sameDay = req.date === viewDate
      const pick =
        staff.find(
          (t) =>
            t.active &&
            t.serviceIds.includes(it.serviceId) &&
            !used.has(t.id) &&
            (requestedStaffId == null || t.id === requestedStaffId) &&
            (() => {
              const win = workWindow(t, req.date)
              if (!win) return false
              if (start < win.start || start + svc.durationMin > win.end) return false
              if (!sameDay) return true
              return !techConflict(appointments, t.id, {
                startMin: start,
                endMin: start + svc.durationMin,
                processingMin: svc.processingMin,
                bufferMin: svc.bufferMin,
              })
            })(),
        ) ?? null
      if (pick) used.add(pick.id)
      return { staffId: pick?.id ?? null }
    })
  }

  const invalidate = async () => {
    await Promise.all([
      utils.requests.list.invalidate(),
      utils.appointments.byDate.invalidate({ salonId, date: viewDate }),
      req.date !== viewDate
        ? utils.appointments.byDate.invalidate({ salonId, date: req.date })
        : Promise.resolve(),
    ])
  }

  const doAccept = async () => {
    try {
      await accept.mutateAsync({ id: req.id, assignments: computeAssignments() })
      setGone(true)
      await invalidate()
      toast.success(`Booked ${req.client.firstName} — ${minToTime(req.startMin)}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not accept'
      toast.error(msg.includes('conflict') ? 'That time is no longer free' : msg)
    }
  }

  const doDecline = async () => {
    try {
      await decline.mutateAsync({ id: req.id })
      setGone(true)
      await invalidate()
      toast(`Declined ${req.client.firstName}'s request (${reason})`)
    } catch {
      toast.error("Couldn't decline — try again")
    }
  }

  const doPropose = async (startMin: number) => {
    try {
      await counter.mutateAsync({ id: req.id, date: req.date, startMin })
      setGone(true)
      await invalidate()
      toast.success(`Proposal sent for ${minToTime(startMin)}`)
    } catch {
      toast.error("Couldn't send proposal — try again")
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: gone ? 0 : 1, x: 0, height: gone ? 0 : 'auto', marginBottom: gone ? 0 : undefined }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: 'spring', stiffness: 350, damping: 32 }}
      className="overflow-hidden rounded-r-md bg-cream p-3"
    >
      {/* Header: client + age */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-bold leading-5">
          {req.client.firstName} {req.client.lastName}
        </p>
        <span className={cn('shrink-0 text-micro font-bold uppercase tnum', stale ? 'text-amber' : 'text-ink-faint')}>
          {timeAgo(req.createdAt)}
        </span>
      </div>

      {/* Services */}
      <div className="mt-1.5 flex flex-col gap-0.5">
        {req.items.map((it) => {
          const catKey = categoryKeyFromName(catById.get(it.service.categoryId))
          return (
            <div key={it.id} className="flex items-center gap-1.5 text-small font-semibold text-ink-soft">
              <span
                className="h-2 w-2 shrink-0 rounded-r-pill"
                style={{ background: CATEGORY_COLORS[catKey].line }}
              />
              <span className="truncate">{it.service.name}</span>
              <span className="text-ink-faint tnum">{it.service.durationMin}m</span>
            </div>
          )
        })}
      </div>

      {/* Wants + time */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-small font-medium text-ink-soft">
          wants:{' '}
          <strong className="text-ink">
            {req.items.find((i) => i.requestedStaff)?.requestedStaff?.name ??
              (req.items.some((i) => i.anyStaff) ? 'Any available' : 'Any available')}
          </strong>
        </span>
        <span className="rounded-r-pill bg-clay-tint px-2 py-0.5 text-[11.5px] font-bold text-clay tnum">
          {prettyDate(req.date).split(',')[0]} · {minToTime(req.startMin)}
        </span>
      </div>

      {req.noteToSalon && (
        <p className="mt-1.5 text-small font-medium italic text-ink-soft">“{req.noteToSalon}”</p>
      )}

      {/* Actions */}
      {mode === 'idle' && (
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            disabled={accept.isPending}
            onClick={() => void doAccept()}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-r-md bg-clay text-[13px] font-semibold text-white transition-all duration-150 hover:bg-clay-deep disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Accept
          </button>
          <button
            type="button"
            onClick={() => setMode('decline')}
            className="h-8 rounded-r-md px-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => setMode('propose')}
            className="h-8 rounded-r-md px-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface"
          >
            Propose
          </button>
        </div>
      )}

      {mode === 'decline' && (
        <div className="mt-2.5 rounded-r-sm border border-rust/30 bg-rust-tint p-2">
          <div className="flex flex-wrap gap-1">
            {DECLINE_REASONS.map((rsn) => (
              <button
                key={rsn}
                type="button"
                onClick={() => setReason(rsn)}
                className={cn(
                  'rounded-r-pill border px-2 py-1 text-[11px] font-bold transition-colors',
                  reason === rsn
                    ? 'border-rust bg-rust text-white'
                    : 'border-line bg-surface text-ink-soft',
                )}
              >
                {rsn}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              disabled={decline.isPending}
              onClick={() => void doDecline()}
              className="flex h-7 items-center gap-1 rounded-r-md bg-rust px-2.5 text-[12px] font-semibold text-white"
            >
              <X className="h-3 w-3" /> Decline request
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="h-7 rounded-r-md px-2 text-[12px] font-semibold text-ink-soft hover:bg-surface"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {mode === 'propose' && (
        <div className="mt-2.5 rounded-r-sm border border-line bg-surface p-2">
          <p className="text-micro font-bold uppercase text-ink-faint">Nearest bookable times</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {slotsQ.isLoading && <span className="text-small font-medium text-ink-faint">Finding slots…</span>}
            {!slotsQ.isLoading && slotOptions.length === 0 && (
              <span className="text-small font-medium text-ink-faint">No open slots that day</span>
            )}
            {slotOptions.map((s) => (
              <button
                key={s.startMin}
                type="button"
                disabled={counter.isPending}
                onClick={() => void doPropose(s.startMin)}
                className="rounded-r-pill border border-clay/40 bg-clay-tint px-2.5 py-1 text-[12px] font-bold text-clay transition-colors hover:bg-clay hover:text-white tnum"
              >
                {minToTime(s.startMin)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="mt-1.5 flex h-7 items-center gap-1 rounded-r-md px-2 text-[12px] font-semibold text-ink-soft hover:bg-cream"
          >
            <Send className="h-3 w-3 rotate-180" /> Back
          </button>
        </div>
      )}

      {accept.isPending && (
        <p className="mt-1.5 flex items-center gap-1 text-small font-semibold text-ink-faint">
          <Inbox className="h-3 w-3" /> Booking…
        </p>
      )}
    </motion.div>
  )
}
