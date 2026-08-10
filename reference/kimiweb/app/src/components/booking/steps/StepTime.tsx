import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { trpc } from '@/providers/trpc'
import {
  apiItemsOf,
  commonStaffIdOf,
  filterSlotsForPicks,
  useBookingStore,
  type RawSlot,
} from '../store'
import { useCatalog } from '../useCatalog'
import Avatar from '../Avatar'
import BookingFooter from '../BookingFooter'
import {
  EASE_OUT_EXPO,
  fmtDayLabel,
  fmtMin,
  initialsOf,
  parseDate,
  shortName,
  todayStr,
} from '../utils'

const DAYS = 14

type Daypart = 'Morning' | 'Afternoon' | 'Evening'
function daypartOf(startMin: number): Daypart {
  if (startMin < 720) return 'Morning'
  if (startMin < 1020) return 'Afternoon'
  return 'Evening'
}

export default function StepTime() {
  const utils = trpc.useUtils()
  const { salonId, staff, serviceById } = useCatalog()
  const items = useBookingStore((s) => s.items)
  const slot = useBookingStore((s) => s.slot)
  const setSlot = useBookingStore((s) => s.setSlot)
  const setStep = useBookingStore((s) => s.setStep)

  const dates = useMemo(() => {
    const t = todayStr()
    return Array.from({ length: DAYS }, (_, i) => {
      const d = parseDate(t)
      d.setDate(d.getDate() + i)
      return format(d, 'yyyy-MM-dd')
    })
  }, [])

  const [selectedDate, setSelectedDate] = useState(dates[0]!)
  const [scan, setScan] = useState<Record<string, RawSlot[] | null>>({})
  const [flashMin, setFlashMin] = useState<number | null>(null)
  const slotRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const gridRef = useRef<HTMLDivElement | null>(null)

  const itemsKey = JSON.stringify(items)
  const hasSameTime = items.some((i) => i.mode === 'same-time')

  // Days of week where nobody works → "Closed"
  const closedDows = useMemo(() => {
    const worked = new Set<number>()
    for (const t of staff) for (const s of t.schedules) worked.add(s.dayOfWeek)
    return new Set([0, 1, 2, 3, 4, 5, 6].filter((d) => !worked.has(d)))
  }, [staff])

  // Scan all 14 days for genuinely bookable slots (batched via httpBatchLink).
  useEffect(() => {
    if (salonId == null || items.length === 0) return
    let cancelled = false
    setScan({})
    const apiItems = apiItemsOf(items)
    const staffId = commonStaffIdOf(items)
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const t = todayStr()
    setScan(Object.fromEntries(dates.map((d) => [d, null])))
    Promise.all(
      dates.map(async (date) => {
        try {
          const raw = await utils.availability.slots.fetch({
            salonId,
            date,
            items: apiItems,
            staffId,
            stepMin: 15,
          })
          let slots: RawSlot[] = filterSlotsForPicks(raw, items)
          if (date === t) slots = slots.filter((s) => s.startMin > nowMin + 15)
          return [date, slots] as const
        } catch {
          return [date, [] as RawSlot[]] as const
        }
      }),
    ).then((rows) => {
      if (!cancelled) setScan(Object.fromEntries(rows))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId, itemsKey, dates])

  // "Next available" hero: first day with slots, first slot.
  const nextAvailable = useMemo(() => {
    for (const d of dates) {
      const slots = scan[d]
      if (slots && slots.length > 0) return { date: d, slot: slots[0]! }
    }
    return null
  }, [scan, dates])

  const daySlots = scan[selectedDate]
  const grouped = useMemo(() => {
    const g: { part: Daypart; slots: RawSlot[] }[] = []
    for (const part of ['Morning', 'Afternoon', 'Evening'] as Daypart[]) {
      const s = (daySlots ?? []).filter((x) => daypartOf(x.startMin) === part)
      if (s.length) g.push({ part, slots: s })
    }
    return g
  }, [daySlots])

  const grabNext = () => {
    if (!nextAvailable) return
    const { date, slot: s } = nextAvailable
    setSelectedDate(date)
    setSlot({ date, startMin: s.startMin, endMin: s.endMin, items: s.items })
    setFlashMin(s.startMin)
    setTimeout(() => {
      slotRefs.current[s.startMin]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    setTimeout(() => setFlashMin(null), 1800)
  }

  const pickSlot = (date: string, s: RawSlot) => {
    setSlot({ date, startMin: s.startMin, endMin: s.endMin, items: s.items })
  }

  const summaryFor = (d: string, startMin: number) => `${fmtDayLabel(d)} · ${fmtMin(startMin)}`
  const heroStaffName =
    nextAvailable?.slot.items[0]?.staffName ??
    (items[0]?.staffId != null ? staff.find((t) => t.id === items[0]!.staffId)?.name : null)

  return (
    <div className="flex flex-col gap-5">
      {/* Next available hero */}
      <div className="rounded-r-lg bg-night p-4 text-white">
        <p className="text-micro font-bold uppercase tracking-[0.08em] text-clay-tint">
          Next available
        </p>
        {nextAvailable ? (
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="text-[20px] font-extrabold leading-tight">
              {fmtDayLabel(nextAvailable.date)} · {fmtMin(nextAvailable.slot.startMin)}
              {heroStaffName ? ` with ${shortName(heroStaffName)}` : ''}
            </p>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={grabNext}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-r-md border border-white/40 px-4 text-[13px] font-bold text-white transition-colors hover:bg-white/10"
            >
              <Sparkles className="h-4 w-4" />
              Grab it
            </motion.button>
          </div>
        ) : (
          <p className="mt-1.5 text-[15px] font-semibold text-white/70">
            {Object.values(scan).some((v) => v === null)
              ? 'Finding the earliest opening…'
              : 'No openings in the next 14 days — please call the salon.'}
          </p>
        )}
      </div>

      {/* 14-day strip */}
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1"
        role="listbox"
        aria-label="Pick a day"
      >
        {dates.map((d) => {
          const date = parseDate(d)
          const dow = date.getDay()
          const closed = closedDows.has(dow)
          const slots = scan[d]
          const empty = slots != null && slots.length === 0
          const disabled = closed || empty
          const selected = d === selectedDate
          const dots = slots == null || slots.length === 0 ? 0 : slots.length <= 2 ? 1 : slots.length <= 6 ? 2 : 3
          return (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              title={closed ? 'Closed' : empty ? 'Fully booked' : undefined}
              onClick={() => setSelectedDate(d)}
              className={cn(
                'relative flex h-[72px] w-14 shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-r-md border transition-colors duration-150',
                selected
                  ? 'border-clay bg-clay text-white'
                  : disabled
                    ? 'cursor-not-allowed border-line bg-surface opacity-40'
                    : 'border-line bg-surface hover:bg-cream',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="day-pill"
                  className="absolute inset-0 rounded-r-md bg-clay"
                  transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                />
              )}
              <span
                className={cn(
                  'relative text-micro font-bold uppercase tracking-[0.08em]',
                  selected ? 'text-clay-tint' : 'text-ink-faint',
                )}
              >
                {format(date, 'EEE')}
              </span>
              <span
                className={cn(
                  'tnum relative text-[18px] font-extrabold leading-none',
                  selected ? 'text-white' : 'text-ink',
                  empty && !closed && 'line-through',
                )}
              >
                {format(date, 'd')}
              </span>
              <span className="relative flex h-2 items-center gap-0.5">
                {closed ? (
                  <span className={cn('text-[8px] font-bold uppercase', selected ? 'text-clay-tint' : 'text-ink-faint')}>
                    Closed
                  </span>
                ) : (
                  Array.from({ length: dots }).map((_, i) => (
                    <span
                      key={i}
                      className={cn('h-1 w-1 rounded-r-pill', selected ? 'bg-clay-tint' : 'bg-olive')}
                    />
                  ))
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* Slot grid */}
      <div ref={gridRef}>
        {daySlots == null ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-r-pill bg-cream" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-r-lg border border-line bg-cream p-4 text-center text-small text-ink-soft">
            {closedDows.has(parseDate(selectedDate).getDay())
              ? 'The salon is closed this day.'
              : 'Fully booked — try another day or "Grab it" up top.'}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(({ part, slots }) => (
              <section key={part}>
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                    {part}
                  </h4>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((s, i) => {
                    const selected = slot?.date === selectedDate && slot.startMin === s.startMin
                    return (
                      <motion.button
                        key={s.startMin}
                        ref={(el) => {
                          slotRefs.current[s.startMin] = el
                        }}
                        type="button"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.6) }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => pickSlot(selectedDate, s)}
                        className={cn(
                          'tnum flex h-11 items-center justify-center rounded-r-pill border text-[13.5px] font-bold transition-colors duration-150',
                          selected
                            ? 'border-clay bg-clay text-white'
                            : 'border-line bg-surface text-ink hover:border-line-strong',
                          flashMin === s.startMin && 'ring-2 ring-clay ring-offset-2 ring-offset-surface',
                        )}
                      >
                        {fmtMin(s.startMin)}
                      </motion.button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Same-time pair confirmation chips */}
      <AnimatePresence>
        {slot && hasSameTime && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
            className="flex flex-wrap items-center gap-2 rounded-r-md bg-clay-tint p-3"
          >
            {slot.items.map((si, i) => {
              const svc = serviceById.get(si.serviceId)
              return (
                <span
                  key={`${si.serviceId}-${i}`}
                  className="flex items-center gap-1.5 rounded-r-pill bg-surface py-1 pl-1 pr-2.5 text-small font-semibold text-ink shadow-sh-1"
                >
                  <Avatar
                    initials={initialsOf((si.staffName ?? 'A').split(' ')[0] ?? 'A', (si.staffName ?? '').split(' ')[1] ?? '')}
                    tint={['clay', 'olive', 'honey', 'rose'][i % 4]}
                    size={28}
                  />
                  {svc?.name} with {si.staffName ? shortName(si.staffName) : 'Any available'}
                </span>
              )
            })}
            <span className="tnum text-small font-bold text-clay-deep">
              — both at {fmtMin(slot.startMin)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <BookingFooter
        summary={
          slot ? (
            <span className="tnum block">{summaryFor(slot.date, slot.startMin)}</span>
          ) : (
            <span className="text-ink-faint">Pick a day and time</span>
          )
        }
        cta="Your details"
        disabledLabel="Pick a time"
        disabled={!slot}
        onCta={() => setStep(4)}
      />
    </div>
  )
}
