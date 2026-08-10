import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trpc } from '@/providers/trpc'
import { apiItemsOf, useBookingStore } from '../store'
import {
  qualifiedForAll,
  qualifiedForService,
  useCatalog,
  type StaffRow,
} from '../useCatalog'
import Avatar from '../Avatar'
import BookingFooter from '../BookingFooter'
import { useDemoIdentity } from '../identity'
import { CAT_CLASSES, EASE_OUT_EXPO, catKeyOf, fmtMinShort, todayStr } from '../utils'

const PREFERRED_KEY = 'lumina.preferredStaffId'

type TodayInfo = { count: number | null; next: number | null; off: boolean }

/** Fetch today's opening counts for the given techs (batched). */
function useTodayCounts(techs: StaffRow[], apiItems: { serviceId: number; sameTime: boolean }[]) {
  const utils = trpc.useUtils()
  const salon = trpc.salon.get.useQuery()
  const salonId = salon.data?.id
  const [info, setInfo] = useState<Record<number, TodayInfo>>({})
  const itemsKey = JSON.stringify(apiItems)
  const techKey = techs.map((t) => t.id).join(',')

  useEffect(() => {
    if (salonId == null || techs.length === 0 || apiItems.length === 0) return
    let cancelled = false
    const date = todayStr()
    const dow = new Date(date + 'T12:00:00').getDay()
    Promise.all(
      techs.map(async (t) => {
        const sched = t.schedules.find((s) => s.dayOfWeek === dow)
        if (!sched) return [t.id, { count: null, next: null, off: true }] as const
        try {
          const slots = await utils.availability.slots.fetch({
            salonId,
            date,
            items: apiItems,
            staffId: t.id,
            stepMin: 15,
          })
          return [t.id, { count: slots.length, next: slots[0]?.startMin ?? null, off: false }] as const
        } catch {
          return [t.id, { count: null, next: null, off: false }] as const
        }
      }),
    ).then((rows) => {
      if (!cancelled) setInfo(Object.fromEntries(rows))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId, techKey, itemsKey])

  return info
}

function AnyAvailableCard({
  selected,
  onSelect,
  index,
}: {
  selected: boolean
  onSelect: () => void
  index: number
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: EASE_OUT_EXPO, delay: index * 0.04 }}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'relative flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-r-lg border-2 border-dashed p-4 text-center transition-colors duration-150',
        selected ? 'border-clay bg-clay-tint' : 'border-clay/60 bg-clay-tint/50 hover:bg-clay-tint',
      )}
    >
      <span className="absolute -top-2 right-2 rounded-r-pill bg-clay px-2 py-0.5 text-micro font-bold uppercase tracking-[0.08em] text-white">
        Recommended
      </span>
      <span className="flex h-12 w-12 items-center justify-center rounded-r-pill bg-surface shadow-sh-1">
        <Sparkles className="h-5 w-5 text-clay" />
      </span>
      <span className="text-[14px] font-bold text-ink">Any available</span>
      <span className="text-micro font-bold uppercase tracking-[0.08em] text-clay-deep">
        Fastest option — we match you
      </span>
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-r-pill bg-clay"
        >
          <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
        </motion.span>
      )}
    </motion.button>
  )
}

function TechCard({
  tech,
  selected,
  onSelect,
  index,
  today,
  bookedCount,
}: {
  tech: StaffRow
  selected: boolean
  onSelect: () => void
  index: number
  today: TodayInfo | undefined
  bookedCount: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: EASE_OUT_EXPO, delay: index * 0.04 }}
      className="group relative"
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'relative flex min-h-[132px] w-full flex-col items-start gap-1 rounded-r-lg border-2 bg-surface p-4 text-left transition-colors duration-150',
          selected ? 'border-clay bg-clay-tint/40 shadow-sh-1' : 'border-line hover:border-line-strong',
        )}
      >
        <Avatar initials={tech.initials} tint={tech.avatarTint} size={48} />
        <span className="mt-1 text-[14px] font-bold leading-tight text-ink">{tech.name}</span>
        <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
          {tech.title ?? tech.roleGroup}
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-1">
          {today?.off ? (
            <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Off today</span>
          ) : today?.count != null ? (
            <>
              <span
                className={cn(
                  'text-micro font-bold uppercase tracking-[0.08em]',
                  today.count > 0 ? 'text-olive' : 'text-ink-faint',
                )}
              >
                {today.count > 0 ? `${today.count} openings today` : 'Fully booked today'}
              </span>
              {today.next != null && (
                <span className="tnum rounded-r-pill bg-olive-tint px-1.5 py-0.5 text-micro font-bold text-[#4B552F]">
                  next: {fmtMinShort(today.next)}
                </span>
              )}
            </>
          ) : (
            <span className="h-3.5 w-20 animate-pulse rounded-r-pill bg-cream" />
          )}
        </span>
        {selected && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-r-pill bg-clay"
          >
            <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
          </motion.span>
        )}
      </button>

      {/* hover mini popover */}
      <div className="pointer-events-none absolute inset-x-0 -top-2 z-20 hidden -translate-y-full group-hover:block">
        <div className="rounded-r-lg border border-line bg-surface p-3 shadow-sh-2">
          <p className="text-small font-semibold text-ink">
            {tech.name} — {tech.title ?? 'Technician'}
          </p>
          {bookedCount > 0 && (
            <p className="mt-0.5 text-micro font-bold uppercase tracking-[0.08em] text-clay">
              You've booked {tech.name.split(' ')[0]} {bookedCount} time{bookedCount > 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function TechGrid({
  techs,
  selectedStaffId,
  onPick,
  bookedCounts,
  multiServiceItems,
}: {
  techs: StaffRow[]
  selectedStaffId: number | null
  onPick: (staffId: number | null) => void
  bookedCounts: Record<number, number>
  multiServiceItems: { serviceId: number; sameTime: boolean }[]
}) {
  const todayInfo = useTodayCounts(techs, multiServiceItems)
  return (
    <div className="grid grid-cols-2 gap-3">
      <AnyAvailableCard selected={selectedStaffId == null} onSelect={() => onPick(null)} index={0} />
      {techs.map((t, i) => (
        <TechCard
          key={t.id}
          tech={t}
          index={i + 1}
          selected={selectedStaffId === t.id}
          onSelect={() => onPick(t.id)}
          today={todayInfo[t.id]}
          bookedCount={bookedCounts[t.id] ?? 0}
        />
      ))}
      {techs.length === 0 && (
        <p className="col-span-2 rounded-r-lg border border-line bg-cream p-4 text-small text-ink-soft">
          No single technician covers all of these services — “Any available” will match you with the
          right pair.
        </p>
      )}
    </div>
  )
}

export default function StepTechnician() {
  const { staff, serviceById, categoryOfService, isLoading } = useCatalog()
  const items = useBookingStore((s) => s.items)
  const setAllStaff = useBookingStore((s) => s.setAllStaff)
  const setItemStaff = useBookingStore((s) => s.setItemStaff)
  const setStep = useBookingStore((s) => s.setStep)
  const { clientId } = useDemoIdentity()

  const hasSameTime = items.some((i) => i.mode === 'same-time')
  const serviceIds = items.map((i) => i.serviceId)

  // How many times the demo client has booked each tech (hover popover).
  const history = trpc.appointments.forClient.useQuery(
    { clientId: clientId ?? 0 },
    { enabled: clientId != null },
  )
  const bookedCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const a of history.data ?? []) {
      for (const it of a.items) {
        if (it.staffId != null) counts[it.staffId] = (counts[it.staffId] ?? 0) + 1
      }
    }
    return counts
  }, [history.data])

  // Preferred technician from Account → pre-select once (single-grid flow).
  const preferredApplied = useRef(false)
  useEffect(() => {
    if (preferredApplied.current || hasSameTime || isLoading) return
    preferredApplied.current = true
    const pref = Number(localStorage.getItem(PREFERRED_KEY) ?? 0)
    if (!pref) return
    if (items.every((i) => i.staffId == null)) {
      const qualified = qualifiedForAll(staff, serviceIds)
      if (qualified.some((t) => t.id === pref)) setAllStaff(pref)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasSameTime])

  const allQualified = useMemo(
    () => qualifiedForAll(staff, serviceIds),
    [staff, serviceIds.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const firstService = serviceById.get(serviceIds[0] ?? -1)
  const pickedName =
    !hasSameTime && items[0]?.staffId != null
      ? staff.find((t) => t.id === items[0]!.staffId)?.name ?? null
      : null

  if (items.length === 0) {
    return (
      <div className="rounded-r-lg border border-line bg-cream p-4 text-small text-ink-soft">
        Pick a service first — then choose your technician.
      </div>
    )
  }

  return (
    <div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-r-lg bg-cream" />
          ))}
        </div>
      ) : hasSameTime ? (
        /* Per-service sections for same-time pairings */
        <div className="flex flex-col gap-7">
          {items.map((item) => {
            const svc = serviceById.get(item.serviceId)
            if (!svc) return null
            const catName = categoryOfService.get(item.serviceId)?.name ?? ''
            const cat = CAT_CLASSES[catKeyOf(catName)]
            const techs = qualifiedForService(staff, item.serviceId)
            return (
              <section key={item.serviceId}>
                <div className="mb-3 flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-r-pill', cat.dot)} />
                  <h3 className="text-[15px] font-bold leading-[22px] text-ink">{svc.name}</h3>
                  {item.mode === 'same-time' && (
                    <span className="rounded-r-pill bg-clay-tint px-1.5 py-0.5 text-micro font-bold uppercase tracking-[0.08em] text-clay-deep">
                      Same time
                    </span>
                  )}
                </div>
                <TechGrid
                  techs={techs}
                  selectedStaffId={item.staffId}
                  onPick={(id) => setItemStaff(item.serviceId, id)}
                  bookedCounts={bookedCounts}
                  multiServiceItems={[{ serviceId: item.serviceId, sameTime: false }]}
                />
              </section>
            )
          })}
        </div>
      ) : (
        <TechGrid
          techs={allQualified}
          selectedStaffId={items[0]?.staffId ?? null}
          onPick={(id) => setAllStaff(id)}
          bookedCounts={bookedCounts}
          multiServiceItems={apiItemsOf(items)}
        />
      )}

      <BookingFooter
        summary={
          <span className="tnum block truncate">
            {hasSameTime
              ? `${items.length} services · paired techs`
              : `${pickedName ?? 'Any available'}${firstService ? ` · ${firstService.name}` : ''}`}
          </span>
        }
        cta="Pick a time"
        onCta={() => setStep(3)}
      />
    </div>
  )
}
