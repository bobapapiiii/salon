import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Clock, Sparkles, ArrowRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBookingStore, type ItemMode } from '../store'
import { useCatalog, type ServiceRow } from '../useCatalog'
import { CAT_CLASSES, EASE_OUT_EXPO, catKeyOf, fmtMoney } from '../utils'
import BookingFooter from '../BookingFooter'

/** Total wall-clock minutes for the picked items (same-time overlaps). */
function totalDuration(items: { serviceId: number; mode: ItemMode }[], dur: (id: number) => number) {
  let cursor = 0
  let maxEnd = 0
  for (const it of items) {
    const d = dur(it.serviceId)
    const start = it.mode === 'same-time' ? 0 : cursor
    const end = start + d
    if (it.mode !== 'same-time') cursor = end
    maxEnd = Math.max(maxEnd, end)
  }
  return maxEnd
}

function ServiceCard({
  service,
  categoryName,
  selected,
  isExtra,
  mode,
  index,
  onToggle,
  onMode,
  onApprovalSelect,
}: {
  service: ServiceRow
  categoryName: string
  selected: boolean
  /** Selected and not the first pick → show same-time/back-to-back mini segmented. */
  isExtra: boolean
  mode: ItemMode
  index: number
  onToggle: () => void
  onMode: (m: ItemMode) => void
  onApprovalSelect: () => void
}) {
  const cat = CAT_CLASSES[catKeyOf(categoryName)]
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
      transition={{ duration: 0.32, ease: EASE_OUT_EXPO, delay: index * 0.05 }}
      className={cn(
        'relative flex overflow-hidden rounded-r-lg border bg-surface p-4 pl-5 transition-colors duration-150',
        selected ? 'border-clay shadow-sh-1' : 'border-line',
      )}
    >
      {/* category swatch bar */}
      <span className={cn('absolute inset-y-0 left-0 w-2', cat.bar)} aria-hidden />
      <button
        type="button"
        onClick={() => {
          onToggle()
          if (!selected && service.requiresApproval) onApprovalSelect()
        }}
        className="flex min-h-11 flex-1 items-start gap-3 text-left"
        aria-pressed={selected}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-[22px] text-ink">{service.name}</span>
          {service.description && (
            <span className="mt-0.5 line-clamp-2 block text-small text-ink-soft">
              {service.description}
            </span>
          )}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small font-medium text-ink-soft">
            <span className="tnum font-extrabold text-ink">
              {service.durationMin} min · {fmtMoney(service.priceCents)}
            </span>
            {service.processingMin > 0 && (
              <span className="inline-flex items-center gap-1 rounded-r-pill bg-cream px-1.5 py-0.5 text-micro font-bold uppercase tracking-[0.08em] text-ink-soft [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(42,33,26,.06)_3px,rgba(42,33,26,.06)_5px)]">
                {service.processingMin} min processing
              </span>
            )}
            {service.requiresApproval && (
              <span className="inline-flex items-center gap-1 rounded-r-pill bg-amber-tint px-1.5 py-0.5 text-micro font-bold uppercase tracking-[0.08em] text-amber">
                <Clock className="h-2.5 w-2.5" /> Requires approval
              </span>
            )}
          </span>
        </span>
        {/* circular select toggle */}
        <motion.span
          animate={selected ? { scale: [1, 1.2, 1] } : { scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-r-pill border-2 transition-colors duration-150',
            selected ? 'border-clay bg-clay' : 'border-line-strong bg-surface',
          )}
        >
          {selected && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
        </motion.span>
      </button>

      {/* per-extra-service pairing choice */}
      <AnimatePresence>
        {selected && isExtra && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
            className="w-full overflow-hidden"
          >
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                Pairing
              </span>
              <div className="flex flex-1 justify-end gap-1 rounded-r-pill bg-cream p-1">
                {(
                  [
                    { m: 'same-time' as ItemMode, label: 'Same time', icon: Sparkles },
                    { m: 'back-to-back' as ItemMode, label: 'Back-to-back', icon: ArrowRight },
                  ] as const
                ).map(({ m, label, icon: Icon }) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onMode(m)}
                    className={cn(
                      'relative flex h-9 flex-1 items-center justify-center gap-1 rounded-r-pill px-2 text-[12px] font-bold transition-colors duration-150',
                      mode === m ? 'text-clay' : 'text-ink-soft',
                    )}
                  >
                    {mode === m && (
                      <motion.span
                        layoutId={undefined}
                        className="absolute inset-0 rounded-r-pill bg-surface shadow-sh-1"
                      />
                    )}
                    <Icon className="relative h-3.5 w-3.5" />
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function StepServices() {
  const { categories, serviceById, isLoading } = useCatalog()
  const items = useBookingStore((s) => s.items)
  const toggleService = useBookingStore((s) => s.toggleService)
  const setItemMode = useBookingStore((s) => s.setItemMode)
  const setStep = useBookingStore((s) => s.setStep)

  const [tab, setTab] = useState<string>('all')
  const [approvalInfoFor, setApprovalInfoFor] = useState<number | null>(null)
  const [lastAdded, setLastAdded] = useState<number | null>(null)
  const approvalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showApprovalInfo = (serviceId: number) => {
    setApprovalInfoFor(serviceId)
    if (approvalTimer.current) clearTimeout(approvalTimer.current)
    approvalTimer.current = setTimeout(() => setApprovalInfoFor(null), 4000)
  }
  useEffect(() => () => {
    if (approvalTimer.current) clearTimeout(approvalTimer.current)
  }, [])

  const visible = useMemo(
    () =>
      tab === 'all'
        ? categories
        : categories.filter((c) => String(c.id) === tab),
    [categories, tab],
  )

  const selectedIds = new Set(items.map((i) => i.serviceId))
  const durOf = (id: number) => serviceById.get(id)?.durationMin ?? 0
  const mins = totalDuration(items, durOf)
  const price = items.reduce((sum, i) => sum + (serviceById.get(i.serviceId)?.priceCents ?? 0), 0)

  const handleToggle = (serviceId: number) => {
    const wasSelected = selectedIds.has(serviceId)
    toggleService(serviceId)
    setLastAdded(!wasSelected && items.length >= 1 ? serviceId : null)
  }

  const lastAddedItem = lastAdded != null ? items.find((i) => i.serviceId === lastAdded) : null
  const lastAddedIsExtra = lastAddedItem != null && items[0]?.serviceId !== lastAdded

  return (
    <div className="relative">
      {/* Category tabs */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-surface px-4 pb-3 pt-1">
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Service categories">
          {[{ id: 'all', name: 'All' }, ...categories.map((c) => ({ id: String(c.id), name: c.name }))].map(
            (t) => {
              const active = tab === t.id
              const catCls =
                t.id === 'all' ? null : CAT_CLASSES[catKeyOf(categories.find((c) => String(c.id) === t.id)?.name ?? '')]
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'h-11 shrink-0 rounded-r-pill border px-4 text-[13px] font-bold transition-colors duration-150',
                    active
                      ? cn('border-transparent', catCls ? cn(catCls.fill, catCls.text) : 'bg-ink text-surface')
                      : 'border-line bg-surface text-ink-soft hover:bg-cream',
                  )}
                >
                  {t.name}
                </button>
              )
            },
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 pb-2">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-r-lg bg-cream" />
          ))}
        <AnimatePresence mode="popLayout">
          {visible.map((c) => (
            <div key={c.id} className="flex flex-col gap-3">
              <h3 className="text-[15px] font-bold leading-[22px] text-ink">{c.name}</h3>
              {c.services.map((s, i) => {
                const selIdx = items.findIndex((it) => it.serviceId === s.id)
                return (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    categoryName={c.name}
                    index={i}
                    selected={selIdx >= 0}
                    isExtra={selIdx > 0}
                    mode={selIdx >= 0 ? items[selIdx]!.mode : 'back-to-back'}
                    onToggle={() => handleToggle(s.id)}
                    onMode={(m) => setItemMode(s.id, m)}
                    onApprovalSelect={() => showApprovalInfo(s.id)}
                  />
                )
              })}
              {c.services.length === 0 && (
                <p className="text-small text-ink-faint">No online-bookable services here yet.</p>
              )}
            </div>
          ))}
        </AnimatePresence>
      </div>

      {/* Approval info expander */}
      <AnimatePresence>
        {approvalInfoFor != null && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
            className="fixed inset-x-0 bottom-24 z-30 mx-auto w-[calc(100%-32px)] max-w-[448px]"
          >
            <div className="flex items-center gap-2 rounded-r-md border border-amber/30 bg-amber-tint px-3 py-2.5 text-small font-semibold text-amber shadow-sh-2">
              <Info className="h-4 w-4 shrink-0" />
              The salon confirms these — you'll get a text.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pairing bar (slides up when a 2nd service is added) */}
      <AnimatePresence>
        {lastAddedIsExtra && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="sticky bottom-[76px] z-10 mb-3 flex items-center gap-3 rounded-r-md bg-clay-tint p-3"
          >
            <span className="flex-1 text-[13px] font-bold text-clay-deep">
              Add “{serviceById.get(lastAdded!)?.name}” at the same time?
            </span>
            {(
              [
                { m: 'same-time' as ItemMode, label: 'Same time', icon: Sparkles, helper: 'two techs at once' },
                { m: 'back-to-back' as ItemMode, label: 'Back-to-back', icon: ArrowRight, helper: null },
              ] as const
            ).map(({ m, label, icon: Icon, helper }) => (
              <button
                key={m}
                type="button"
                title={helper ?? label}
                onClick={() => {
                  setItemMode(lastAdded!, m)
                  setLastAdded(null)
                }}
                className={cn(
                  'flex h-11 items-center gap-1.5 rounded-r-md border px-3 text-[12.5px] font-bold transition-colors duration-150',
                  lastAddedItem.mode === m
                    ? 'border-clay bg-clay text-white'
                    : 'border-clay/40 bg-surface text-clay-deep hover:bg-clay-tint',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <BookingFooter
        summary={
          items.length > 0 ? (
            <motion.span
              key={`${items.length}-${mins}-${price}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="tnum block"
            >
              {items.length} service{items.length > 1 ? 's' : ''} · {mins} min · {fmtMoney(price)}
            </motion.span>
          ) : (
            <span className="text-ink-faint">Pick one or more services</span>
          )
        }
        cta="Choose technician"
        disabledLabel="Select a service"
        disabled={items.length === 0}
        onCta={() => setStep(2)}
      />
    </div>
  )
}
