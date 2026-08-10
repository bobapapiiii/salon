import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Link2,
  Mail,
  Phone,
  X,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import Avatar, { normalizeTint } from '@/components/ops/Avatar'
import { NoteFlag } from '@/components/ops/primitives'
import { CAT, catKey, fmtMin, fmtPrice, parseDay } from '@/components/ops/format'
import type { RequestRow, Slot, StaffRow } from '@/components/ops/types'

type Done =
  | { kind: 'accepted'; date: string; startMin: number; appointmentId: number | null; techName: string | null }
  | { kind: 'declined' }
  | { kind: 'countered'; date: string; startMin: number }

function toTimeInput(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
function fromTimeInput(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Request detail pane — salon-requests.md §4. Client summary, requested
 * services, time options + availability mini-strip, note, decision bar,
 * after-decision confirmation state.
 */
export default function RequestDetail({
  request: req,
  salonId,
  staff,
  catNameById,
  readOnly = false,
  onOpenClient,
  onDecision,
}: {
  request: RequestRow
  salonId: number
  staff: StaffRow[]
  catNameById: Map<number, string>
  readOnly?: boolean
  onOpenClient: (clientId: number) => void
  onDecision: () => void
}) {
  const utils = trpc.useUtils()
  const clientQ = trpc.clients.get.useQuery({ id: req.clientId })

  const effDate = req.status === 'countered' && req.counterDate ? req.counterDate : req.date
  const effStart =
    req.status === 'countered' && req.counterStartMin != null ? req.counterStartMin : req.startMin

  // Requested tech applied to every item (engine takes a single staffId)
  const requestedStaffId = useMemo(() => {
    const ids = req.items.map((i) => (i.anyStaff ? null : (i.requestedStaffId ?? null)))
    const first = ids[0] ?? null
    return ids.every((x) => x === first) ? first : null
  }, [req.items])

  const slotItems = useMemo(
    () => req.items.map((i) => ({ serviceId: i.serviceId, sameTime: i.sameTime })),
    [req.items],
  )

  const availQ = trpc.availability.slots.useQuery(
    { salonId, date: effDate, items: slotItems, staffId: requestedStaffId, stepMin: 15 },
    { enabled: !readOnly && salonId > 0 },
  )

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [mode, setMode] = useState<'idle' | 'propose' | 'decline'>('idle')
  const [done, setDone] = useState<Done | null>(null)
  const [proposeDate, setProposeDate] = useState(effDate)
  const [proposeTime, setProposeTime] = useState('')

  useEffect(() => {
    setSelectedSlot(null)
    setMode('idle')
    setDone(null)
    setProposeDate(req.status === 'countered' && req.counterDate ? req.counterDate : req.date)
    setProposeTime('')
  }, [req.id, req.date, req.status, req.counterDate])

  const proposeAvailQ = trpc.availability.slots.useQuery(
    { salonId, date: proposeDate, items: slotItems, staffId: requestedStaffId, stepMin: 15 },
    { enabled: !readOnly && mode === 'propose' && salonId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(proposeDate) },
  )

  // 3 bookable slots nearest the requested time
  const nearSlots = useMemo(() => {
    const slots = availQ.data ?? []
    return [...slots]
      .sort((a, b) => Math.abs(a.startMin - effStart) - Math.abs(b.startMin - effStart))
      .slice(0, 3)
      .sort((a, b) => a.startMin - b.startMin)
  }, [availQ.data, effStart])

  const invalidateAll = () => {
    utils.requests.list.invalidate()
    utils.appointments.byDate.invalidate()
    utils.clients.get.invalidate({ id: req.clientId })
  }

  const acceptMut = trpc.requests.accept.useMutation()
  const counterMut = trpc.requests.counter.useMutation()
  const declineMut = trpc.requests.decline.useMutation()
  const busy = acceptMut.isPending || counterMut.isPending || declineMut.isPending

  async function handleAccept() {
    try {
      let assignments = req.items.map((i) => ({ staffId: i.requestedStaffId ?? null }))
      let date = effDate
      let startMin = effStart
      if (selectedSlot) {
        assignments = selectedSlot.items.map((i) => ({ staffId: i.staffId }))
        startMin = selectedSlot.startMin
        if (selectedSlot.startMin !== effStart) {
          // Accept at a different time: route through a counter so the
          // accepted appointment lands on the chosen slot.
          await counterMut.mutateAsync({ id: req.id, date, startMin })
        }
      }
      const res = await acceptMut.mutateAsync({ id: req.id, assignments })
      const techName = selectedSlot?.items[0]?.staffName ?? req.items[0]?.requestedStaff?.name ?? null
      invalidateAll()
      setDone({ kind: 'accepted', date, startMin, appointmentId: res.appointmentId ?? null, techName })
      toast.success(`Accepted — added to the schedule at ${fmtMin(startMin)}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept request')
    }
  }

  async function handleDecline() {
    try {
      await declineMut.mutateAsync({ id: req.id })
      invalidateAll()
      setDone({ kind: 'declined' })
      toast.success('Request declined')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not decline request')
    }
  }

  async function handleCounter() {
    const startMin = proposeTime ? fromTimeInput(proposeTime) : null
    if (!proposeDate || startMin == null) return
    try {
      await counterMut.mutateAsync({ id: req.id, date: proposeDate, startMin })
      invalidateAll()
      setDone({ kind: 'countered', date: proposeDate, startMin })
      toast.success(`Counter offer sent — ${format(parseDay(proposeDate), 'EEE MMM d')} at ${fmtMin(startMin)}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send counter offer')
    }
  }

  const client = req.client
  const detail = clientQ.data
  const flags = (detail?.notes ?? []).filter((n) => n.kind !== 'general')
  const visits = detail?.appointments.filter((a) => a.status === 'completed').length
  const sameTime = req.items.some((i) => i.sameTime)
  const proposeStartMin = proposeTime ? fromTimeInput(proposeTime) : null

  /* ── After-decision confirmation state (§4.6) ────────────────────────── */
  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-r-pill',
            done.kind === 'accepted' && 'bg-olive-tint text-olive',
            done.kind === 'declined' && 'bg-rust-tint text-rust',
            done.kind === 'countered' && 'bg-amber-tint text-amber',
          )}
        >
          {done.kind === 'accepted' && <Check className="h-7 w-7" strokeWidth={2.5} />}
          {done.kind === 'declined' && <X className="h-7 w-7" strokeWidth={2.5} />}
          {done.kind === 'countered' && <Clock className="h-7 w-7" strokeWidth={2.5} />}
        </motion.span>
        <h3 className="mt-4 font-display text-[22px] font-semibold leading-7">
          {done.kind === 'accepted' &&
            `Accepted — added at ${fmtMin(done.startMin)}${done.techName ? ` · ${done.techName}'s column` : ''}`}
          {done.kind === 'declined' && 'Request declined'}
          {done.kind === 'countered' &&
            `Counter sent — ${format(parseDay(done.date), 'EEE MMM d')} at ${fmtMin(done.startMin)}`}
        </h3>
        <p className="mt-1 text-small font-medium text-ink-soft">
          {done.kind === 'accepted' && 'The appointment is confirmed on the schedule.'}
          {done.kind === 'declined' && 'The client will be notified.'}
          {done.kind === 'countered' && 'Awaiting the client — the request moves to the Countered tab.'}
        </p>
        <div className="mt-5 flex items-center gap-2">
          {done.kind === 'accepted' && done.appointmentId != null && (
            <Link
              to={`/salon/schedule?date=${done.date}&focus=${done.appointmentId}`}
              className="inline-flex h-10 items-center gap-2 rounded-r-md bg-clay px-4 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep hover:shadow-sh-1"
            >
              View on schedule <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={onDecision}
            className="inline-flex h-10 cursor-pointer items-center rounded-r-md border border-line bg-surface px-4 text-[14px] font-semibold text-ink transition-colors hover:bg-cream"
          >
            Next request
          </button>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      key={req.id}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {/* 1 — Client summary */}
        <section>
          <div className="flex items-start gap-3">
            <Avatar
              initials={`${client.firstName[0] ?? ''}${client.lastName[0] ?? ''}`.toUpperCase()}
              tint={normalizeTint(null, `${client.firstName} ${client.lastName}`)}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-[22px]">
                {client.firstName} {client.lastName}
              </p>
              {client.phone && (
                <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink tnum">
                  <Phone className="h-3.5 w-3.5 text-ink-faint" /> {client.phone}
                  <button
                    type="button"
                    aria-label="Copy phone"
                    className="cursor-pointer text-ink-faint transition-colors hover:text-clay"
                    onClick={() => {
                      navigator.clipboard?.writeText(client.phone!).catch(() => {})
                      toast.success('Phone copied')
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </p>
              )}
              {client.email && (
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] font-medium text-ink-soft">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-ink-faint" /> {client.email}
                </p>
              )}
            </div>
          </div>
          {flags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {flags.map((n) => (
                <NoteFlag key={n.id} kind={n.kind} text={n.text} />
              ))}
            </div>
          )}
          <p className="mt-2 text-small font-medium text-ink-faint tnum">
            Client since {detail ? format(new Date(detail.createdAt), 'yyyy') : '—'} · {visits ?? '…'} visits ·{' '}
            {client.noShowCount} no-show{client.noShowCount === 1 ? '' : 's'}
            <button
              type="button"
              onClick={() => onOpenClient(client.id)}
              className="ml-2 cursor-pointer font-bold text-clay hover:text-clay-deep"
            >
              Open client →
            </button>
          </p>
        </section>

        {/* 2 — Requested services */}
        <section>
          <h3 className="mb-2 text-micro font-bold uppercase text-ink-faint">Requested services</h3>
          <div className="space-y-2">
            {req.items.map((item, idx) => {
              const key = catKey(catNameById.get(item.serviceId))
              const c = CAT[key]
              const tech = item.requestedStaff
              return (
                <div key={idx} className="flex items-center gap-3 rounded-r-md border border-line bg-paper p-3">
                  <span className={cn('h-9 w-1.5 shrink-0 rounded-r-pill', c.dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">{item.service.name}</p>
                    <p className="text-small font-medium text-ink-faint tnum">
                      {item.service.durationMin} min · {fmtPrice(item.service.priceCents)}
                    </p>
                  </div>
                  {item.anyStaff || !tech ? (
                    <span className="shrink-0 rounded-r-pill bg-cream px-2.5 py-1 text-[11px] font-bold text-ink-soft">
                      Any available
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-r-pill bg-cream py-1 pl-1 pr-2.5 text-[11px] font-bold text-ink-soft">
                      <Avatar
                        initials={tech.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                        tint={normalizeTint(staff.find((s) => s.id === tech.id)?.avatarTint, tech.name)}
                        size={28}
                        className="!h-5 !w-5 !text-[8px]"
                      />
                      wants {tech.name.split(' ')[0]}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* 3 — Time options */}
        <section>
          <h3 className="mb-2 text-micro font-bold uppercase text-ink-faint">Requested time</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-r-pill bg-clay-tint px-3 text-[12.5px] font-bold text-clay tnum">
              <CalendarDays className="h-3.5 w-3.5" />
              {format(parseDay(req.date), 'EEE d MMM')} · {fmtMin(req.startMin)}
            </span>
            {sameTime && (
              <span
                className="inline-flex h-8 items-center gap-1 rounded-r-pill bg-cream px-2.5 text-[11px] font-bold text-ink-soft"
                title="Services booked to run at the same time"
              >
                <Link2 className="h-3.5 w-3.5" /> same time
              </span>
            )}
            {req.status === 'countered' && req.counterDate && req.counterStartMin != null && (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-r-pill bg-amber-tint px-3 text-[12.5px] font-bold text-amber tnum">
                <Clock className="h-3.5 w-3.5" />
                countered: {format(parseDay(req.counterDate), 'EEE d MMM')} · {fmtMin(req.counterStartMin)}
              </span>
            )}
          </div>

          {!readOnly && (
            <div className="mt-3">
              <h4 className="mb-1.5 text-micro font-bold uppercase text-ink-faint">
                Next bookable {format(parseDay(effDate), 'EEE d MMM')}
              </h4>
              {availQ.isLoading ? (
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-8 w-20 animate-pulse rounded-r-pill bg-cream" />
                  ))}
                </div>
              ) : nearSlots.length === 0 ? (
                <p className="text-small font-medium text-ink-faint">
                  No open slots that day — propose a new time below.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {nearSlots.map((slot) => {
                    const active = selectedSlot?.startMin === slot.startMin
                    return (
                      <button
                        key={slot.startMin}
                        type="button"
                        onClick={() => setSelectedSlot(active ? null : slot)}
                        className={cn(
                          'h-8 cursor-pointer rounded-r-pill border px-3 text-[12.5px] font-bold tnum transition-colors',
                          active
                            ? 'border-olive bg-olive text-white'
                            : 'border-transparent bg-olive-tint text-olive hover:border-olive',
                        )}
                        title={slot.items.map((i) => i.staffName).filter(Boolean).join(', ') || undefined}
                      >
                        {fmtMin(slot.startMin)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 4 — Note to salon */}
        {req.noteToSalon && (
          <section>
            <h3 className="mb-2 text-micro font-bold uppercase text-ink-faint">Note to salon</h3>
            <blockquote className="rounded-r-md bg-cream px-4 py-3 text-[13.5px] font-medium italic leading-[20px] text-ink-soft">
              “{req.noteToSalon}”
            </blockquote>
          </section>
        )}
      </div>

      {/* 5 — Decision bar (sticky bottom) */}
      {!readOnly && (
        <div className="shrink-0 border-t border-line bg-surface p-4">
          <AnimatePresence mode="wait" initial={false}>
            {mode === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleAccept}
                  className="h-10 flex-1 cursor-pointer rounded-r-md bg-clay px-4 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep hover:shadow-sh-1 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {acceptMut.isPending
                    ? 'Accepting…'
                    : selectedSlot
                      ? `Accept ${format(parseDay(effDate), 'EEE')} ${fmtMin(selectedSlot.startMin)}`
                      : 'Accept'}
                </button>
                <button
                  type="button"
                  disabled={busy || req.status === 'countered'}
                  onClick={() => setMode('propose')}
                  className="h-10 cursor-pointer rounded-r-md border border-line bg-surface px-4 text-[14px] font-semibold text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Propose time
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode('decline')}
                  className="h-10 cursor-pointer rounded-r-md px-3 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-rust"
                >
                  Decline
                </button>
              </motion.div>
            )}

            {mode === 'propose' && (
              <motion.div
                key="propose"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <p className="mb-2 text-[13px] font-bold text-ink">Propose a new time</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={proposeDate}
                    min={format(new Date(), 'yyyy-MM-dd')}
                    onChange={(e) => {
                      setProposeDate(e.target.value)
                      setProposeTime('')
                    }}
                    className="h-10 rounded-r-sm border border-line bg-surface px-3 text-[13px] font-semibold text-ink outline-none tnum focus:border-clay focus:ring-2 focus:ring-clay/30"
                  />
                  <input
                    type="time"
                    value={proposeTime}
                    step={900}
                    onChange={(e) => setProposeTime(e.target.value)}
                    className="h-10 rounded-r-sm border border-line bg-surface px-3 text-[13px] font-semibold text-ink outline-none tnum focus:border-clay focus:ring-2 focus:ring-clay/30"
                  />
                </div>
                {proposeAvailQ.data && proposeAvailQ.data.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {proposeAvailQ.data.slice(0, 6).map((slot) => (
                      <button
                        key={slot.startMin}
                        type="button"
                        onClick={() => setProposeTime(toTimeInput(slot.startMin))}
                        className={cn(
                          'h-7 cursor-pointer rounded-r-pill border px-2.5 text-[11.5px] font-bold tnum transition-colors',
                          proposeStartMin === slot.startMin
                            ? 'border-olive bg-olive text-white'
                            : 'border-transparent bg-olive-tint text-olive hover:border-olive',
                        )}
                      >
                        {fmtMin(slot.startMin)}
                      </button>
                    ))}
                  </div>
                )}
                {proposeAvailQ.data && proposeAvailQ.data.length === 0 && (
                  <p className="mt-2 text-small font-medium text-amber">
                    No genuinely bookable slots that day — you can still send a time manually.
                  </p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || proposeStartMin == null || !proposeDate}
                    onClick={handleCounter}
                    className="h-10 flex-1 cursor-pointer rounded-r-md bg-amber px-4 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {counterMut.isPending ? 'Sending…' : 'Send counter offer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('idle')}
                    className="h-10 cursor-pointer rounded-r-md px-3 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}

            {mode === 'decline' && (
              <motion.div
                key="decline"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <p className="text-[13px] font-bold text-ink">
                  Decline this request? The client will be notified.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDecline}
                    className="h-10 flex-1 cursor-pointer rounded-r-md bg-rust px-4 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {declineMut.isPending ? 'Declining…' : 'Confirm decline'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('idle')}
                    className="h-10 cursor-pointer rounded-r-md px-3 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}
