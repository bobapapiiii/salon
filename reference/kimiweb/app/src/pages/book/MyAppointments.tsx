import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarPlus, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { trpc } from '@/providers/trpc'
import { useDemoIdentity } from '@/components/booking/identity'
import { useBookingStore } from '@/components/booking/store'
import { itemsFromAppointment } from '@/components/booking/prefill'
import type { ClientAppt, ClientRequest } from '@/components/booking/useCatalog'
import ClientToaster from '@/components/booking/ClientToaster'
import StatusChip from '@/components/booking/StatusChip'
import BottomSheet, { sheetItem } from '@/components/booking/BottomSheet'
import PhoneSheet from '@/components/booking/PhoneSheet'
import {
  CAT_CLASSES,
  EASE_OUT_EXPO,
  catKeyOf,
  fmtMin,
  fmtMoney,
  parseDate,
  shortName,
  todayStr,
} from '@/components/booking/utils'

const REASONS = ['Schedule conflict', 'Found a better time', 'Not feeling well', 'Other']

function apptPrice(a: ClientAppt): number {
  return a.items.reduce((s, i) => s + i.priceCents, 0)
}

function serviceCat(a: ClientAppt): keyof typeof CAT_CLASSES {
  return catKeyOf(a.items[0]?.service?.name ?? '')
}

/* ---------------- Upcoming appointment card ---------------- */
function UpcomingCard({
  appt,
  index,
  onCancel,
  salonAddress,
}: {
  appt: ClientAppt
  index: number
  onCancel: (a: ClientAppt) => void
  salonAddress?: string | null
}) {
  const navigate = useNavigate()
  const prefill = useBookingStore((s) => s.prefill)
  const date = parseDate(appt.date)
  const cat = CAT_CLASSES[serviceCat(appt)]
  const sameTime = !!appt.sameTimeGroupId
  const status =
    appt.status === 'checked-in' ? 'checked-in' : appt.status === 'in-progress' ? 'in-progress' : appt.status === 'requested' ? 'requested' : 'confirmed'

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_EXPO, delay: index * 0.06 }}
      className="overflow-hidden rounded-r-lg border border-line bg-surface"
    >
      <div className="flex gap-3 p-4">
        {/* date tile */}
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-r-md bg-cream py-2">
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
            {format(date, 'EEE')}
          </span>
          <span className="tnum text-[22px] font-extrabold leading-none text-ink">
            {format(date, 'd')}
          </span>
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
            {format(date, 'MMM')}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="tnum text-small font-bold text-ink-soft">{fmtMin(appt.startMin)}</p>
            <StatusChip status={status} label={appt.status === 'requested' ? 'Requested' : undefined} />
          </div>
          {sameTime && (
            <p className="mt-1 text-micro font-bold uppercase tracking-[0.08em] text-clay-deep">
              At the same time
            </p>
          )}
          <div className="mt-1 flex flex-col gap-1">
            {[...appt.items]
              .sort((a, b) => a.startMin - b.startMin)
              .map((it) => (
                <div key={it.id} className="flex items-baseline gap-1.5 text-[14px]">
                  <span className={cn('h-2 w-2 shrink-0 translate-y-[-1px] self-center rounded-r-pill', cat.dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{it.service?.name ?? 'Service'}</span>
                    <span className="text-ink-soft">
                      {' '}
                      with {it.staff?.name ? shortName(it.staff.name) : 'Any available'}
                      {sameTime ? ` · ${fmtMin(it.startMin)}` : ''}
                    </span>
                  </span>
                </div>
              ))}
          </div>
        </div>
        <span className="tnum shrink-0 text-[14px] font-extrabold text-ink">{fmtMoney(apptPrice(appt))}</span>
      </div>

      {/* actions */}
      <div className="flex items-center divide-x divide-line border-t border-line">
        <button
          type="button"
          onClick={() => {
            prefill({
              items: itemsFromAppointment(appt),
              rescheduleOf: { id: appt.id, date: appt.date, startMin: appt.startMin },
              step: 3,
            })
            navigate('/book')
          }}
          className="h-11 flex-1 text-[13px] font-bold text-ink transition-colors hover:bg-cream"
        >
          Reschedule
        </button>
        <button
          type="button"
          onClick={() => onCancel(appt)}
          className="h-11 flex-1 text-[13px] font-bold text-rust transition-colors hover:bg-rust-tint"
        >
          Cancel
        </button>
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(salonAddress ?? 'Lumina Salon')}`}
          target="_blank"
          rel="noreferrer"
          title="Directions"
          className="flex h-11 w-12 items-center justify-center text-ink-soft transition-colors hover:bg-cream hover:text-clay"
        >
          <MapPin className="h-4 w-4" />
        </a>
      </div>
    </motion.article>
  )
}

/* ---------------- Booking request card ---------------- */
function RequestCard({ req, index }: { req: ClientRequest; index: number }) {
  const utils = trpc.useUtils()
  const prefill = useBookingStore((s) => s.prefill)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const accept = trpc.requests.accept.useMutation()
  const declineCounter = trpc.requests.clientDeclineCounter.useMutation()
  const withdraw = trpc.requests.decline.useMutation()

  const invalidate = async () => {
    await Promise.all([
      utils.requests.forClient.invalidate(),
      utils.requests.list.invalidate(),
      utils.appointments.forClient.invalidate(),
      utils.appointments.byDate.invalidate(),
      utils.availability.slots.invalidate(),
    ])
  }

  const countered = req.status === 'countered'
  const price = req.items.reduce((s, i) => s + (i.service?.priceCents ?? 0), 0)
  const date = parseDate(countered && req.counterDate ? req.counterDate : req.date)

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_EXPO, delay: index * 0.06 }}
      className={cn(
        'overflow-hidden rounded-r-lg border bg-surface',
        countered ? 'border-clay/50' : 'border-line',
      )}
    >
      <button
        type="button"
        className="flex w-full gap-3 p-4 text-left"
        onClick={() => countered && setOpen((o) => !o)}
      >
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-r-md bg-cream py-2">
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
            {format(date, 'EEE')}
          </span>
          <span className="tnum text-[22px] font-extrabold leading-none text-ink">{format(date, 'd')}</span>
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
            {format(date, 'MMM')}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="tnum text-small font-bold text-ink-soft">
              {fmtMin(countered && req.counterStartMin != null ? req.counterStartMin : req.startMin)}
            </p>
            <StatusChip status={countered ? 'countered' : 'pending'} pulse={countered && !open} />
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {req.items.map((it) => (
              <div key={it.id} className="flex items-baseline gap-1.5 text-[14px]">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 self-center rounded-r-pill',
                    CAT_CLASSES[catKeyOf(it.service?.name ?? '')].dot,
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{it.service?.name ?? 'Service'}</span>
                  <span className="text-ink-soft">
                    {' '}
                    · {it.requestedStaff?.name ? `with ${shortName(it.requestedStaff.name)}` : 'any tech'}
                    {it.sameTime ? ' · same time' : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <span className="tnum shrink-0 text-[14px] font-extrabold text-ink">{fmtMoney(price)}</span>
      </button>

      {/* Counter-offer panel */}
      <AnimatePresence>
        {countered && open && req.counterDate && req.counterStartMin != null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
            className="overflow-hidden"
          >
            <div className="border-t border-line bg-clay-tint/50 p-4">
              <p className="text-[14px] font-semibold text-ink">
                The salon proposed{' '}
                <span className="tnum font-extrabold text-clay-deep">
                  {format(parseDate(req.counterDate), 'EEE, MMM d')} · {fmtMin(req.counterStartMin)}
                </span>
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={accept.isPending}
                  onClick={async () => {
                    await accept.mutateAsync({ id: req.id })
                    await invalidate()
                    toast('You’re booked!', { description: 'The proposed time is confirmed.' })
                  }}
                  className="h-11 flex-1 rounded-r-md bg-clay text-[13.5px] font-bold text-white transition-colors hover:bg-clay-deep disabled:opacity-60"
                >
                  Accept new time
                </button>
                <button
                  type="button"
                  disabled={declineCounter.isPending}
                  onClick={async () => {
                    await declineCounter.mutateAsync({ id: req.id })
                    await invalidate()
                    toast('Counter-offer declined')
                  }}
                  className="h-11 flex-1 rounded-r-md border border-line bg-surface text-[13.5px] font-bold text-rust transition-colors hover:bg-rust-tint disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Request actions */}
      {!countered && (
        <div className="flex items-center divide-x divide-line border-t border-line">
          <button
            type="button"
            onClick={() => {
              prefill({
                items: req.items.map((it, idx) => ({
                  serviceId: it.serviceId,
                  mode: idx > 0 && it.sameTime ? ('same-time' as const) : ('back-to-back' as const),
                  staffId: it.requestedStaffId ?? null,
                })),
                step: 1,
              })
              void withdraw.mutateAsync({ id: req.id }).then(invalidate)
              toast('Request withdrawn — adjust and re-send')
              navigate('/book')
            }}
            className="h-11 flex-1 text-[13px] font-bold text-ink transition-colors hover:bg-cream"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={withdraw.isPending}
            onClick={async () => {
              if (!withdrawing) {
                setWithdrawing(true)
                setTimeout(() => setWithdrawing(false), 3000)
                return
              }
              await withdraw.mutateAsync({ id: req.id })
              await invalidate()
              toast('Request withdrawn')
            }}
            className={cn(
              'h-11 flex-1 text-[13px] font-bold transition-colors',
              withdrawing ? 'bg-rust text-white' : 'text-rust hover:bg-rust-tint',
            )}
          >
            {withdrawing ? 'Tap again to confirm' : 'Withdraw request'}
          </button>
        </div>
      )}
    </motion.article>
  )
}

/* ---------------- Past row ---------------- */
function PastRow({
  appt,
  index,
  onBookAgain,
}: {
  appt: ClientAppt
  index: number
  onBookAgain: (a: ClientAppt) => void
}) {
  const names = appt.items.map((i) => i.service?.name ?? 'Service').join(' + ')
  const tech = appt.items.find((i) => i.staff?.name)?.staff?.name
  const status = appt.status === 'no-show' ? 'no-show' : appt.status === 'cancelled' ? 'cancelled' : 'completed'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT_EXPO, delay: index * 0.025 }}
      className="flex items-center gap-2.5 rounded-r-md border border-line bg-surface p-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
          {format(parseDate(appt.date), 'EEE, MMM d')}
        </p>
        <p className="truncate text-[14px] font-semibold text-ink">{names}</p>
        <p className="text-small text-ink-faint">{tech ? `with ${shortName(tech)}` : 'Any available'}</p>
      </div>
      <StatusChip status={status} />
      <span className="tnum w-14 text-right text-[13.5px] font-extrabold text-ink">
        {fmtMoney(apptPrice(appt))}
      </span>
      <button
        type="button"
        onClick={() => onBookAgain(appt)}
        className="group flex h-11 items-center gap-0.5 whitespace-nowrap rounded-r-md px-2 text-[13px] font-bold text-clay hover:bg-clay-tint"
      >
        Book again
        <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
      </button>
    </motion.div>
  )
}

/* ---------------- Page ---------------- */
export default function MyAppointments() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { salon, salonId, clientId, client, isLoading, signedOut } = useDemoIdentity()
  const prefill = useBookingStore((s) => s.prefill)

  const [phoneSheet, setPhoneSheet] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<ClientAppt | null>(null)
  const [cancelArm, setCancelArm] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [pastFilter, setPastFilter] = useState<'all' | 'completed' | 'noshow'>('all')

  const apptsQ = trpc.appointments.forClient.useQuery(
    { clientId: clientId ?? 0 },
    { enabled: clientId != null },
  )
  const reqsQ = trpc.requests.forClient.useQuery(
    { clientId: clientId ?? 0 },
    { enabled: clientId != null },
  )
  const updateStatus = trpc.appointments.updateStatus.useMutation()

  const today = todayStr()
  const { upcoming, past } = useMemo(() => {
    const all = apptsQ.data ?? []
    const up = all
      .filter((a) => a.date >= today && ['confirmed', 'checked-in', 'in-progress', 'requested'].includes(a.status))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
    const pa = all
      .filter((a) => !up.includes(a))
      .sort((a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin)
    return { upcoming: up, past: pa }
  }, [apptsQ.data, today])

  const activeRequests = useMemo(
    () => (reqsQ.data ?? []).filter((r) => r.status === 'pending' || r.status === 'countered'),
    [reqsQ.data],
  )

  const filteredPast = useMemo(() => {
    if (pastFilter === 'completed') return past.filter((a) => a.status === 'completed')
    if (pastFilter === 'noshow') return past.filter((a) => a.status === 'no-show' || a.status === 'cancelled')
    return past
  }, [past, pastFilter])

  const pastByMonth = useMemo(() => {
    const groups: { month: string; visits: number; cents: number; rows: ClientAppt[] }[] = []
    for (const a of filteredPast) {
      const key = format(parseDate(a.date), 'MMMM yyyy')
      let g = groups.find((x) => x.month === key)
      if (!g) {
        g = { month: key, visits: 0, cents: 0, rows: [] }
        groups.push(g)
      }
      g.visits += 1
      g.cents += apptPrice(a)
      g.rows.push(a)
    }
    return groups
  }, [filteredPast])

  const bookAgain = (a: ClientAppt) => {
    prefill({ items: itemsFromAppointment(a), step: 3 })
    navigate('/book')
  }

  const doCancel = async () => {
    if (!cancelTarget) return
    const target = cancelTarget
    const prevStatus = target.status
    await updateStatus.mutateAsync({ id: target.id, status: 'cancelled' })
    await Promise.all([
      utils.appointments.forClient.invalidate(),
      utils.appointments.byDate.invalidate(),
      utils.availability.slots.invalidate(),
    ])
    setCancelTarget(null)
    setCancelArm(false)
    setReason(null)
    toast('Cancelled', {
      duration: 10000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await updateStatus.mutateAsync({ id: target.id, status: prevStatus })
          await utils.appointments.forClient.invalidate()
          await utils.appointments.byDate.invalidate()
          toast('Appointment restored')
        },
      },
    })
  }

  const firstInitial = client ? `${client.firstName} ${client.lastName.charAt(0)}.` : null

  return (
    <div className="px-4 pb-8 pt-5">
      <ClientToaster />

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      >
        <h1 className="font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
          My appointments
        </h1>
        <p className="mt-1 text-small text-ink-soft">
          Lumina Salon{firstInitial ? ` · booked as ${firstInitial}` : ''}
          {client && (
            <button
              type="button"
              onClick={() => setPhoneSheet(true)}
              className="ml-2 text-micro font-bold uppercase tracking-[0.08em] text-clay hover:underline"
            >
              Not {client.firstName}?
            </button>
          )}
        </p>
      </motion.header>

      {/* Signed-out / loading */}
      {!client && !isLoading && (
        <div className="mt-8 flex flex-col items-center rounded-r-xl border border-line bg-surface p-8 text-center">
          <img src="/empty-calendar.svg" alt="" className="h-[120px] w-[160px] opacity-80" />
          <h3 className="mt-3 text-[15px] font-bold text-ink">
            {signedOut ? 'You’re signed out' : 'Find your bookings'}
          </h3>
          <p className="mt-1 text-small text-ink-soft">Your appointments live behind your phone number.</p>
          <button
            type="button"
            onClick={() => setPhoneSheet(true)}
            className="mt-4 flex h-11 items-center rounded-r-md bg-clay px-5 text-[14px] font-semibold text-white hover:bg-clay-deep"
          >
            Find my bookings
          </button>
        </div>
      )}

      {(isLoading || (clientId != null && (apptsQ.isLoading || reqsQ.isLoading))) && (
        <div className="mt-6 flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[120px] animate-pulse rounded-r-lg bg-cream" />
          ))}
        </div>
      )}

      {client && !apptsQ.isLoading && (
        <>
          {/* Requests */}
          {activeRequests.length > 0 && (
            <section className="mt-6">
              <h3 className="mb-2.5 text-[15px] font-bold leading-[22px] text-ink">Booking requests</h3>
              <div className="flex flex-col gap-3">
                {activeRequests.map((r, i) => (
                  <RequestCard key={r.id} req={r} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* Upcoming */}
          <section className="mt-6">
            <h3 className="mb-2.5 text-[15px] font-bold leading-[22px] text-ink">Upcoming</h3>
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center rounded-r-xl border border-line bg-surface p-8 text-center">
                <img src="/empty-calendar.svg" alt="" className="h-[120px] w-[160px] opacity-80" />
                <h3 className="mt-3 text-[15px] font-bold text-ink">Nothing booked yet</h3>
                <p className="mt-1 text-small text-ink-soft">Your next appointment is a minute away.</p>
                <button
                  type="button"
                  onClick={() => navigate('/book')}
                  className="mt-4 flex h-11 items-center gap-2 rounded-r-md bg-clay px-5 text-[14px] font-semibold text-white hover:bg-clay-deep"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Book an appointment
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {upcoming.map((a, i) => (
                  <UpcomingCard key={a.id} appt={a} index={i} onCancel={setCancelTarget} salonAddress={salon?.address} />
                ))}
              </div>
            )}
          </section>

          {/* Past */}
          <section className="mt-8">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[15px] font-bold leading-[22px] text-ink">Past visits</h3>
              <div className="flex rounded-r-pill bg-cream p-0.5">
                {(
                  [
                    ['all', 'All'],
                    ['completed', 'Completed'],
                    ['noshow', 'No-show & cancelled'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPastFilter(key)}
                    className={cn(
                      'relative h-8 rounded-r-pill px-2.5 text-[11.5px] font-bold transition-colors duration-150',
                      pastFilter === key ? 'text-ink' : 'text-ink-faint',
                    )}
                  >
                    {pastFilter === key && (
                      <motion.span
                        layoutId="past-seg"
                        className="absolute inset-0 rounded-r-pill bg-surface shadow-sh-1"
                        transition={{ duration: 0.2 }}
                      />
                    )}
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {pastByMonth.length === 0 ? (
              <p className="rounded-r-lg border border-line bg-surface p-4 text-center text-small text-ink-faint">
                No past visits yet — your history will live here.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {pastByMonth.map((g) => (
                  <div key={g.month}>
                    <div className="mb-2 flex items-baseline justify-between border-b border-line pb-1">
                      <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                        {g.month}
                      </span>
                      <span className="tnum text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                        {g.visits} visit{g.visits > 1 ? 's' : ''} · {fmtMoney(g.cents)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {g.rows.map((a, i) => (
                        <PastRow key={a.id} appt={a} index={i} onBookAgain={bookAgain} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Phone lookup sheet */}
      <PhoneSheet open={phoneSheet} onClose={() => setPhoneSheet(false)} salonId={salonId} />

      {/* Cancel confirm sheet */}
      <BottomSheet
        open={cancelTarget != null}
        onClose={() => {
          setCancelTarget(null)
          setCancelArm(false)
        }}
        labelledBy="cancel-title"
      >
        {cancelTarget && (
          <>
            <motion.h2
              variants={sheetItem}
              id="cancel-title"
              className="font-display text-[22px] font-semibold leading-[28px] text-ink"
            >
              Cancel this appointment?
            </motion.h2>
            <motion.p variants={sheetItem} className="mt-1 text-[14px] leading-[21px] text-ink-soft">
              {cancelTarget.items.map((i) => i.service?.name ?? 'Service').join(' + ')} ·{' '}
              {format(parseDate(cancelTarget.date), 'EEE, MMM d')} · {fmtMin(cancelTarget.startMin)}
            </motion.p>
            <motion.p variants={sheetItem} className="mt-2 text-small font-semibold text-olive">
              Free cancellation up to 4h before
            </motion.p>
            <motion.div variants={sheetItem} className="mt-3 flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(reason === r ? null : r)}
                  className={cn(
                    'h-9 rounded-r-pill border px-3 text-[12.5px] font-bold transition-colors duration-150',
                    reason === r
                      ? 'border-clay bg-clay-tint text-clay-deep'
                      : 'border-line bg-surface text-ink-soft hover:bg-cream',
                  )}
                >
                  {r}
                </button>
              ))}
            </motion.div>
            <motion.button
              variants={sheetItem}
              type="button"
              disabled={updateStatus.isPending}
              onClick={() => {
                if (!cancelArm) {
                  setCancelArm(true)
                  return
                }
                void doCancel()
              }}
              className={cn(
                'mt-5 flex h-12 w-full items-center justify-center rounded-r-md text-[14.5px] font-bold text-white transition-colors duration-200',
                cancelArm ? 'bg-[#8F2F20]' : 'bg-rust hover:bg-[#8F2F20]',
              )}
            >
              {updateStatus.isPending
                ? 'Cancelling…'
                : cancelArm
                  ? 'Tap again to confirm'
                  : 'Cancel appointment'}
            </motion.button>
            <motion.button
              variants={sheetItem}
              type="button"
              onClick={() => {
                setCancelTarget(null)
                setCancelArm(false)
              }}
              className="mt-2 h-11 w-full rounded-r-md text-[14px] font-semibold text-ink-soft hover:bg-cream"
            >
              Keep it
            </motion.button>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
