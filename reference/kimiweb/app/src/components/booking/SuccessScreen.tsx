import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { useBookingStore, itemStartsOf } from './store'
import { useCatalog } from './useCatalog'
import StatusChip from './StatusChip'
import { EASE_OUT_EXPO, fmtDayLabel, fmtMin, fmtMoney, parseDate, shortName } from './utils'
import type { BookingOutcome } from './steps/StepDetails'

function Leaf({ delay, x }: { delay: number; x: string }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="pointer-events-none fixed top-0 z-0 h-6 w-6 text-olive/60"
      style={{ left: x }}
      initial={{ y: -40, rotate: -20, opacity: 0 }}
      animate={{ y: '120vh', rotate: 20, opacity: [0, 1, 1, 0.8] }}
      transition={{ duration: 3, delay, ease: 'easeIn', times: [0, 0.05, 0.9, 1] }}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2C7 7 4 11 4 15a8 8 0 0 0 16 0c0-4-3-8-8-13zm0 18a1 1 0 0 1-1-1c0-3 1-6 4-9 .5 4-1 8-3 10z" />
    </motion.svg>
  )
}

function DrawnCircle({ kind }: { kind: 'confirmed' | 'requested' }) {
  const isConf = kind === 'confirmed'
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: [0.8, 1.15, 1], opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`flex h-[72px] w-[72px] items-center justify-center rounded-r-pill ${
        isConf ? 'bg-olive-tint' : 'bg-amber-tint'
      }`}
    >
      <svg viewBox="0 0 48 48" className={`h-10 w-10 ${isConf ? 'text-olive' : 'text-amber'}`} fill="none">
        <motion.circle
          cx="24"
          cy="24"
          r="20"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
        {isConf ? (
          <motion.path
            d="M15 24.5l6.5 6.5L33 18"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
          />
        ) : (
          <motion.path
            d="M24 14v10l7 5"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
          />
        )}
      </svg>
    </motion.span>
  )
}

export default function SuccessScreen({ outcome }: { outcome: BookingOutcome }) {
  const navigate = useNavigate()
  const { serviceById } = useCatalog()
  const items = useBookingStore((s) => s.items)
  const slot = useBookingStore((s) => s.slot)
  const reset = useBookingStore((s) => s.reset)
  const isConf = outcome.kind === 'confirmed'

  const durations = new Map(items.map((i) => [i.serviceId, serviceById.get(i.serviceId)?.durationMin ?? 0]))
  const starts = slot ? itemStartsOf(items, durations, slot.startMin) : new Map<number, number>()
  const total = items.reduce((sum, i) => sum + (serviceById.get(i.serviceId)?.priceCents ?? 0), 0)

  const downloadIcs = () => {
    if (!slot) return
    const d = parseDate(slot.date)
    const stamp = (min: number) => {
      const dt = new Date(d)
      dt.setHours(Math.floor(min / 60), min % 60, 0, 0)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`
    }
    const names = items.map((i) => serviceById.get(i.serviceId)?.name ?? 'Service').join(' + ')
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `SUMMARY:Lumina Salon — ${names}`,
      `DTSTART:${stamp(slot.startMin)}`,
      `DTEND:${stamp(slot.endMin)}`,
      'LOCATION:Lumina Salon',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'lumina-appointment.ics'
    a.click()
    URL.revokeObjectURL(url)
  }

  const goAppointments = () => {
    reset()
    navigate('/book/appointments')
  }
  const bookAnother = () => reset()

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
      className="relative flex min-h-[60dvh] flex-col items-center px-1 pt-10"
    >
      {isConf && (
        <>
          <Leaf delay={0.1} x="18%" />
          <Leaf delay={0.6} x="72%" />
        </>
      )}

      <DrawnCircle kind={outcome.kind} />
      <h1 className="mt-4 text-center font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
        {isConf ? 'You’re booked!' : 'Request sent'}
      </h1>
      {!isConf && (
        <p className="mt-2 max-w-[320px] text-center text-[14px] leading-[21px] text-ink-soft">
          Lumina Salon will confirm within a few hours — we’ll text{' '}
          <span className="tnum font-semibold text-ink">
            {outcome.kind === 'requested' ? outcome.phone : ''}
          </span>
          .
        </p>
      )}

      {slot && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT_EXPO, delay: 0.15 }}
          className="mt-6 w-full rounded-r-lg border border-line bg-cream p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="tnum text-small font-bold text-ink-soft">
              {fmtDayLabel(slot.date)} · {fmtMin(slot.startMin)}
            </p>
            <StatusChip status={isConf ? 'confirmed' : 'requested'} />
          </div>
          <div className="flex flex-col gap-2">
            {items.map((i) => {
              const svc = serviceById.get(i.serviceId)
              if (!svc) return null
              const staffName = slot.items.find((si) => si.serviceId === i.serviceId)?.staffName
              return (
                <div key={i.serviceId} className="flex items-baseline gap-2 text-[14px]">
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{svc.name}</span>
                    <span className="text-ink-soft">
                      {' '}
                      · with {staffName ? shortName(staffName) : 'Any available'} ·{' '}
                      {fmtMin(starts.get(i.serviceId) ?? slot.startMin)}
                    </span>
                  </div>
                  <span className="tnum font-extrabold text-ink">{fmtMoney(svc.priceCents)}</span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-line-strong pt-2.5">
            <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Total</span>
            <span className="tnum text-[16px] font-extrabold text-ink">{fmtMoney(total)}</span>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT_EXPO, delay: 0.25 }}
        className="mt-5 flex w-full flex-col gap-2"
      >
        {isConf && (
          <button
            type="button"
            onClick={downloadIcs}
            className="flex h-11 items-center justify-center gap-2 rounded-r-md border border-line bg-surface text-[14px] font-semibold text-ink transition-colors hover:bg-cream"
          >
            <CalendarPlus className="h-4 w-4" />
            Add to calendar
          </button>
        )}
        <button
          type="button"
          onClick={goAppointments}
          className="flex h-12 items-center justify-center rounded-r-md bg-clay text-[15px] font-semibold text-white shadow-sh-1 transition-all hover:-translate-y-px hover:bg-clay-deep"
        >
          View my appointments
        </button>
        <button
          type="button"
          onClick={bookAnother}
          className="h-11 text-[14px] font-semibold text-clay hover:underline"
        >
          Book another
        </button>
      </motion.div>
    </motion.div>
  )
}
