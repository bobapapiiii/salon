import { useRef, useState, type ReactNode } from 'react'
import {
  CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Eye, ListFilter, PanelRight, PhoneOff, Plus, Search, Store,
} from 'lucide-react'
import { useCategoriesStore } from '@/lib/categories-store'

export type Density = 15 | 30 | 60
export type ColorMode = 'category' | 'status'
export type Chip = { id: string; name: string; fill: string; text: string }

interface Props {
  subtitle: string
  dateLabel: string
  isToday: boolean
  onPrevDay: () => void
  onNextDay: () => void
  onToday: () => void
  onPickDate: (anchor: DOMRect) => void
  density: Density | null
  onDensity: (d: Density) => void
  colorMode: ColorMode
  onColorMode: (m: ColorMode) => void
  onPickLegend: (anchor: DOMRect) => void
  teamChips: Chip[]
  hiddenTeams: Set<string>
  onToggleTeamChip: (id: string) => void
  /** drag a chip sideways to reorder the role groups on the calendar */
  onReorderChip: (id: string, toIndex: number) => void
  techQuery: string
  onTechQuery: (q: string) => void
  catFilter: string
  onCatFilter: (c: string) => void
  onBook: () => void
  onPos: () => void
  requestCount: number
  onToggleRail: () => void
  onTurnaway: () => void
}

function IconBtn({ children, title, badge, onClick, active }: {
  children: ReactNode; title: string; badge?: number; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`relative flex h-9 w-9 items-center justify-center rounded-[10px] border transition-colors ${
        active ? 'border-clay/40 bg-clay-tint text-clay' : 'border-line bg-surface text-ink-soft hover:bg-cream'
      }`}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-extrabold text-white">
          {badge}
        </span>
      )}
    </button>
  )
}

function SegmentedControl<T extends string | number>({ options, value, onChange, ariaLabel }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; ariaLabel: string
}) {
  return (
    <div aria-label={ariaLabel} className="flex h-9 items-center rounded-[10px] border border-line bg-cream p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-[8px] px-3 text-[12px] font-bold transition-all duration-150 ${
            value === o.value ? 'bg-surface text-ink shadow-sh-1' : 'text-ink-faint hover:text-ink-soft'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toolbar(p: Props) {
  const cats = useCategoriesStore()
  // ── chip drag-to-reorder (click still toggles hide/show; >6px drag reorders) ──
  const [chipDrag, setChipDrag] = useState<{ id: string; dx: number; overIdx: number } | null>(null)
  const chipDragRef = useRef<{ id: string; startX: number; moved: boolean } | null>(null)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const suppressChipClick = useRef(false)

  const onChipPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    chipDragRef.current = { id, startX: e.clientX, moved: false }
    const chips = p.teamChips
    const move = (ev: PointerEvent) => {
      const d = chipDragRef.current
      if (!d) return
      const dx = ev.clientX - d.startX
      if (!d.moved && Math.abs(dx) < 6) return
      if (!d.moved) {
        // lock the cursor + text selection for a glide-smooth drag
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      d.moved = true
      let over = chips.length
      for (let i = 0; i < chips.length; i++) {
        const el = chipRefs.current.get(chips[i].id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (ev.clientX < r.left + r.width / 2) { over = i; break }
      }
      setChipDrag({ id: d.id, dx, overIdx: over })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const d = chipDragRef.current
      chipDragRef.current = null
      if (d?.moved) {
        suppressChipClick.current = true
        window.setTimeout(() => { suppressChipClick.current = false }, 0)
        setChipDrag((prev) => {
          if (prev) {
            const from = chips.findIndex((c) => c.id === prev.id)
            let to = prev.overIdx > from ? prev.overIdx - 1 : prev.overIdx
            to = Math.max(0, Math.min(to, chips.length - 1))
            if (from >= 0 && to !== from) p.onReorderChip(prev.id, to)
          }
          return null
        })
      } else {
        setChipDrag(null)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      {/* ══ Section 1, page header ══ */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <p className="min-w-0 flex-1 truncate text-small font-medium text-ink-soft">{p.subtitle}</p>

        {/* date pager */}
        <div className="flex items-center gap-1">
          <IconBtn title="Previous day" onClick={p.onPrevDay}><ChevronLeft className="h-4 w-4" /></IconBtn>
          <button
            type="button"
            onClick={p.onToday}
            className={`h-9 rounded-[10px] border px-3 text-[13px] font-bold transition-colors ${
              p.isToday ? 'border-clay/40 bg-clay-tint text-clay' : 'border-line text-ink-soft hover:bg-cream'
            }`}
          >
            {p.dateLabel}
          </button>
          <IconBtn title="Next day" onClick={p.onNextDay}><ChevronRight className="h-4 w-4" /></IconBtn>
          <IconBtn title="Pick a date" onClick={(e) => p.onPickDate((e.currentTarget as HTMLElement).getBoundingClientRect())}>
            <CalendarDays className="h-4 w-4" />
          </IconBtn>
        </div>

        <span className="h-6 w-px bg-line" />

        <SegmentedControl
          ariaLabel="density"
          options={[{ value: 15 as const, label: '15m' }, { value: 30 as const, label: '30m' }, { value: 60 as const, label: '60m' }]}
          value={p.density}
          onChange={p.onDensity}
        />

        <span className="h-6 w-px bg-line" />

        <SegmentedControl
          ariaLabel="color-by"
          options={[{ value: 'category' as const, label: 'Category' }, { value: 'status' as const, label: 'Status' }]}
          value={p.colorMode}
          onChange={p.onColorMode}
        />

        <IconBtn title="Legend" onClick={(e) => p.onPickLegend((e.currentTarget as HTMLElement).getBoundingClientRect())}>
          <ListFilter className="h-4 w-4" />
        </IconBtn>

        <span className="h-6 w-px bg-line" />

        <button
          type="button"
          onClick={p.onBook}
          className="flex h-10 items-center gap-1.5 rounded-[10px] bg-clay px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0"
        >
          <Plus className="h-4 w-4" />
          Appointment
        </button>

        <button
          type="button"
          onClick={p.onPos}
          title="Point of sale, ring up a sale without an appointment"
          className="flex h-10 items-center gap-1.5 rounded-[10px] border border-clay/40 bg-clay-tint px-3.5 text-[14px] font-semibold text-clay transition-all duration-150 hover:-translate-y-px hover:bg-clay hover:text-white active:translate-y-0"
        >
          <Store className="h-4 w-4" />
          POS
        </button>

        <IconBtn title="Requests panel" badge={p.requestCount} onClick={p.onToggleRail}>
          <PanelRight className="h-4 w-4" />
        </IconBtn>

        <IconBtn title="Log a turnaway, a client we couldn't fit in" onClick={p.onTurnaway}>
          <PhoneOff className="h-4 w-4" />
        </IconBtn>
      </div>

      {/* ══ Section 2, filter bar ══ */}
      <div className="flex h-12 shrink-0 flex-wrap items-center gap-3 border-b border-line bg-cream px-4">
        {/* tech filter */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={p.techQuery}
            onChange={(e) => p.onTechQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && p.onTechQuery('')}
            placeholder="Filter techs"
            className="h-9 w-[180px] rounded-[6px] border border-line bg-surface pl-8 pr-3 text-[13px] font-medium transition-colors placeholder:text-ink-faint focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30"
          />
        </div>

        {/* role chips, click to hide/show, drag sideways to reorder the groups */}
        <div className="flex items-center gap-1.5">
          {p.teamChips.map((c, i) => {
            const hidden = p.hiddenTeams.has(c.id)
            const isDragged = chipDrag?.id === c.id
            const markerHere = chipDrag && chipDrag.overIdx === i
            const markerAtEnd = chipDrag && chipDrag.overIdx === p.teamChips.length && i === p.teamChips.length - 1
            return (
              <button
                key={c.id}
                type="button"
                ref={(el) => {
                  if (el) chipRefs.current.set(c.id, el)
                  else chipRefs.current.delete(c.id)
                }}
                onPointerDown={(e) => onChipPointerDown(e, c.id)}
                onClick={() => {
                  if (suppressChipClick.current) return
                  p.onToggleTeamChip(c.id)
                }}
                title={`${c.name}, click to ${hidden ? 'show' : 'hide'} · drag to reorder`}
                className={`relative flex h-8 touch-none select-none items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-bold ${
                  isDragged
                    ? 'z-30 cursor-grabbing shadow-sh-2 ring-1 ring-line transition-none'
                    : 'cursor-grab transition-all duration-150'
                } ${hidden ? 'border-line opacity-40' : 'border-transparent'}`}
                style={{
                  background: c.fill,
                  color: c.text,
                  transform: isDragged ? `translateX(${chipDrag.dx}px)` : undefined,
                  willChange: isDragged ? 'transform' : undefined,
                }}
              >
                {markerHere && <span aria-hidden className="absolute -left-[5px] inset-y-1 w-[3px] rounded-full bg-clay" />}
                {markerAtEnd && <span aria-hidden className="absolute -right-[5px] inset-y-1 w-[3px] rounded-full bg-clay" />}
                <Eye className="h-3.5 w-3.5" />
                {c.name}
              </button>
            )
          })}
        </div>

        {/* category filter */}
        <div className="relative ml-auto">
          <select
            value={p.catFilter}
            onChange={(e) => p.onCatFilter(e.target.value)}
            className="h-9 appearance-none rounded-[6px] border border-line bg-surface py-0 pl-2.5 pr-7 text-[12px] font-medium text-ink-soft"
          >
            <option value="all">All services</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        </div>
      </div>
    </>
  )
}
