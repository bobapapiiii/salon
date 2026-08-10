import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SegmentedControl } from './shared'
import { CATEGORY_COLORS, STATUS_CHIP, STATUS_LABEL, type ApptStatus, type ColorMode } from './schedule-utils'

/* ── Generic anchored popover (fixed, click-away, Esc) ─────────────── */
export function AnchoredPopover({
  anchor,
  width,
  onClose,
  children,
  label,
}: {
  anchor: DOMRect
  width: number
  onClose: () => void
  children: ReactNode
  label: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - width - 8))
  const top = anchor.bottom + 6
  return (
    <>
      <button aria-label="Close" className="fixed inset-0 z-[60] cursor-default" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-label={label}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="fixed z-[61] rounded-r-lg border border-line bg-surface p-3 shadow-sh-2"
        style={{ left, top, width, transformOrigin: 'top center' }}
      >
        {children}
      </motion.div>
    </>
  )
}

/* ── Legend popover — salon-schedule.md §3 ─────────────────────────── */
const LEGEND_STATUSES: ApptStatus[] = [
  'requested',
  'confirmed',
  'checked-in',
  'in-progress',
  'completed',
  'no-show',
  'cancelled',
]

export function LegendPopover({
  anchor,
  colorMode,
  onColorMode,
  onClose,
}: {
  anchor: DOMRect
  colorMode: ColorMode
  onColorMode: (m: ColorMode) => void
  onClose: () => void
}) {
  return (
    <AnchoredPopover anchor={anchor} width={300} onClose={onClose} label="Legend">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Color by</span>
        <SegmentedControl
          ariaLabel="legend-color-by"
          size="sm"
          options={[
            { value: 'category' as const, label: 'Category' },
            { value: 'status' as const, label: 'Status' },
          ]}
          value={colorMode}
          onChange={onColorMode}
        />
      </div>

      <p className="mb-1.5 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Categories</p>
      <div className="mb-3 flex flex-col gap-1">
        {(Object.keys(CATEGORY_COLORS) as (keyof typeof CATEGORY_COLORS)[]).map((k) => {
          const c = CATEGORY_COLORS[k]
          return (
            <div key={k} className="flex items-center gap-2">
              <span
                className="h-4 w-4 rounded-r-sm border"
                style={{ background: c.fill, borderColor: c.line, borderLeftWidth: 4, borderLeftColor: c.line }}
              />
              <span className="text-[13px] font-semibold capitalize">{k === 'spa' ? 'Other / Spa' : k}</span>
            </div>
          )
        })}
      </div>

      <p className="mb-1.5 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Statuses</p>
      <div className="flex flex-col gap-1.5">
        {LEGEND_STATUSES.map((s) => (
          <StatusLegendRow key={s} status={s} />
        ))}
      </div>
    </AnchoredPopover>
  )
}

function StatusLegendRow({ status }: { status: ApptStatus }) {
  const chip = STATUS_CHIP[status]
  return (
    <div className="flex items-center gap-2.5">
      {/* Mini 40×24 block replica of the non-color treatment */}
      <span
        className={cn(
          'relative flex h-6 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[4px]',
          status === 'completed' && 'opacity-55',
          status === 'cancelled' && 'opacity-40',
        )}
        style={{
          background: chip.bg,
          border:
            status === 'requested'
              ? '1.5px dashed #C97F72'
              : status === 'no-show'
                ? '1.5px solid #B3402F'
                : status === 'cancelled'
                  ? '1.5px dashed #A3937F'
                  : '1px solid #D8CCB9',
        }}
      >
        {status === 'checked-in' && (
          <span className="flex h-3 w-3 items-center justify-center rounded-r-pill bg-white text-[8px] font-black text-olive">
            ✓
          </span>
        )}
        {status === 'in-progress' && <span className="sched-hatch absolute inset-y-0 left-0 w-1/2" />}
        {status === 'requested' && <Clock className="h-3 w-3 text-[#C97F72]" />}
      </span>
      <span className="text-[13px] font-semibold">{STATUS_LABEL[status]}</span>
    </div>
  )
}

/* ── Date mini-popover (month grid) — salon-schedule.md §1 ─────────── */
export function DatePickerPopover({
  anchor,
  selected,
  today,
  appointmentDates,
  onSelect,
  onClose,
}: {
  anchor: DOMRect
  selected: string
  today: string
  appointmentDates: Set<string>
  onSelect: (date: string) => void
  onClose: () => void
}) {
  const [cursor, setCursor] = useState(() => new Date(selected + 'T12:00:00'))

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }

  return (
    <AnchoredPopover anchor={anchor} width={272} onClose={onClose} label="Choose date">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-r-md text-ink-soft hover:bg-cream"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[14px] font-bold">
          {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-r-md text-ink-soft hover:bg-cream"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="py-1 text-micro font-bold uppercase text-ink-faint">
            {d}
          </span>
        ))}
        {cells.map((ds, i) =>
          ds == null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={ds}
              type="button"
              onClick={() => onSelect(ds)}
              className={cn(
                'relative flex h-8 items-center justify-center rounded-r-sm text-[12.5px] font-semibold transition-colors tnum',
                ds === selected
                  ? 'bg-clay text-white'
                  : ds === today
                    ? 'bg-clay-tint text-clay'
                    : 'text-ink hover:bg-cream',
              )}
            >
              {Number(ds.slice(-2))}
              {appointmentDates.has(ds) && ds !== selected && (
                <span className="absolute bottom-0.5 h-[3px] w-[3px] rounded-r-pill bg-clay" />
              )}
            </button>
          ),
        )}
      </div>
    </AnchoredPopover>
  )
}
