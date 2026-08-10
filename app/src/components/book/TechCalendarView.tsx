// ─── Technician week / month calendar views ─────────────────────────────────
// Takes over the appointment book: columns become days (week) or a month grid,
// all for one technician. Exit returns to the normal multi-tech calendar.
import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Appointment, Tech, TimeBlock } from '../../lib/booking-types'
import { CLOSE_MIN, OPEN_MIN, SLOT_MIN, fmtTime, overlaps } from '../../lib/booking-types'
import { svcById } from '../../lib/services-store'

const DAY_MIN = CLOSE_MIN - OPEN_MIN
const VIEW_PAD = 60
const MIN_GAP = 15
const GUTTER_W = 56

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const OFF_LABEL: Record<string, string> = {
  vacation: 'Vacation',
  off: 'Day off',
  emergency: 'Emergency',
}

/** the tech's working window for a calendar day (permanent schedule + temp time off) */
function dayWindow(tech: Tech, d: Date): { start: number; end: number; offLabel?: string; detail?: string } {
  const key = dayKey(d)
  const weekly = tech.weeklySchedule?.[d.getDay()]
  let start = weekly?.startMin ?? 0
  let end = weekly?.endMin ?? DAY_MIN
  let detail: string | undefined
  const to = (tech.timeOff ?? []).find((x) => x.from <= key && key <= x.to)
  if (to) {
    if (to.status === 'late') { start = to.timeMin ?? start; detail = `In at ${fmtTime(start)}${to.notes ? `, ${to.notes}` : ''}` }
    else if (to.status === 'early') { end = to.timeMin ?? end; detail = `Out at ${fmtTime(end)}${to.notes ? `, ${to.notes}` : ''}` }
    else return { start, end, offLabel: OFF_LABEL[to.status] ?? 'Off', detail: to.notes }
  } else if (weekly?.off) {
    return { start, end, offLabel: 'Off' }
  }
  return { start, end, detail }
}

function openGaps(start: number, end: number, appts: Appointment[], blocks: TimeBlock[]): { from: number; to: number }[] {
  const busy = [
    ...appts.map((a) => ({ from: a.startMin, to: a.startMin + a.durationMin })),
    ...blocks.map((b) => ({ from: b.startMin, to: b.startMin + b.durationMin })),
  ]
    .filter((x) => overlaps(start, end, x.from, x.to))
    .sort((a, b) => a.from - b.from)
  const gaps: { from: number; to: number }[] = []
  let cursor = start
  for (const b of busy) {
    if (b.from - cursor >= MIN_GAP) gaps.push({ from: cursor, to: b.from })
    cursor = Math.max(cursor, b.to)
  }
  if (end - cursor >= MIN_GAP) gaps.push({ from: cursor, to: end })
  return gaps
}

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay())
  return x
}

function shiftFocus(d: Date, view: 'week' | 'month', dir: 1 | -1) {
  return view === 'week'
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7)
    : new Date(d.getFullYear(), d.getMonth() + dir, 1)
}

function fmtGap(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
}

const HATCH = 'repeating-linear-gradient(45deg, rgba(100,116,139,0.08) 0 8px, rgba(100,116,139,0.03) 8px 16px)'

export function TechCalendarView({ tech, anchor, mode, pxPerMin, density, getAppts, getBlocks, onBook, onApptMenu, onExit }: {
  tech: Tech
  anchor: Date
  mode: 'week' | 'month'
  pxPerMin: number
  density: 15 | 30 | 60 | null
  onApptMenu: (e: React.MouseEvent, apptId: string) => void
  getAppts: (day: string) => Appointment[]
  getBlocks: (day: string) => TimeBlock[]
  onBook: (d: Date, startMin: number) => void
  onExit: () => void
}) {
  const [view, setView] = useState(mode)
  const [focus, setFocus] = useState(anchor)
  return (
    <div className="absolute inset-0 z-[55] flex flex-col bg-background">
      {/* header bar */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All technicians
        </button>
        <div className="min-w-0">
          <span className="block truncate text-[13.5px] font-bold leading-tight">{tech.name}</span>
          <span className="block text-[10.5px] leading-tight text-muted-foreground">
            {view === 'week'
              ? `Week of ${startOfWeek(focus).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, double-click an open spot to book`
              : focus.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
            onClick={() => setFocus((f) => shiftFocus(f, view, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-line text-ink-soft hover:bg-cream"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setFocus(new Date())}
            className="h-7 rounded-[8px] border border-line px-2.5 text-[11px] font-bold text-ink-soft hover:bg-cream"
          >
            {view === 'week' ? 'This week' : 'This month'}
          </button>
          <button
            type="button"
            aria-label={view === 'week' ? 'Next week' : 'Next month'}
            onClick={() => setFocus((f) => shiftFocus(f, view, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-line text-ink-soft hover:bg-cream"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex h-7 items-center rounded-[8px] border border-line bg-cream p-0.5">
          {(['week', 'month'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={`h-6 rounded-[6px] px-2.5 text-[11px] font-bold capitalize transition-all ${
                view === m ? 'bg-surface text-ink shadow-sh-1' : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <button onClick={onExit} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" aria-label="Back to calendar">
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'week'
          ? <WeekGrid tech={tech} anchor={focus} pxPerMin={pxPerMin} density={density} getAppts={getAppts} getBlocks={getBlocks} onBook={onBook} onApptMenu={onApptMenu} />
          : <MonthGrid tech={tech} anchor={focus} getAppts={getAppts} getBlocks={getBlocks} onPickDay={(d) => { setFocus(d); setView('week') }} />}
      </div>
    </div>
  )
}

function WeekGrid({ tech, anchor, pxPerMin, density, getAppts, getBlocks, onBook, onApptMenu }: {
  tech: Tech
  anchor: Date
  pxPerMin: number
  density: 15 | 30 | 60 | null
  getAppts: (day: string) => Appointment[]
  getBlocks: (day: string) => TimeBlock[]
  onBook: (d: Date, startMin: number) => void
  onApptMenu: (e: React.MouseEvent, apptId: string) => void
}) {
  const days = useMemo(() => {
    const s = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i))
  }, [anchor])
  const ppm = Math.max(0.6, pxPerMin)
  const yAt = (m: number) => (m + VIEW_PAD) * ppm
  const dayH = (DAY_MIN + 2 * VIEW_PAD) * ppm
  const todayK = dayKey(new Date())
  const hours = Array.from({ length: DAY_MIN / 60 + 3 }, (_, i) => (i - 1) * 60)
  const step = density ?? 60
  // thin zooms can't fit every 15m label, fall back to 30m then hourly
  let labelStep = step
  while (labelStep < 60 && labelStep * ppm < 13) labelStep *= 2
  const ticks = Array.from({ length: (DAY_MIN + 2 * VIEW_PAD) / labelStep + 1 }, (_, i) => -VIEW_PAD + i * labelStep)
  return (
    <div className="relative" style={{ minWidth: 720 }}>
      {/* day header row */}
      <div className="sticky top-0 z-30 flex border-b border-border bg-card/95 backdrop-blur" style={{ marginLeft: GUTTER_W }}>
        {days.map((d) => {
          const win = dayWindow(tech, d)
          const isToday = dayKey(d) === todayK
          return (
            <div key={dayKey(d)} className={`flex-1 border-r border-border/60 px-2 py-1.5 ${isToday ? 'bg-clay-tint/50' : ''}`}>
              <span className={`block text-[12.5px] font-bold ${isToday ? 'text-clay' : ''}`}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
                <span className="ml-1.5 font-medium text-muted-foreground">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </span>
              <span className="block text-[10px] font-semibold text-muted-foreground">
                {win.offLabel ?? `${fmtTime(win.start)} to ${fmtTime(win.end)}${win.detail ? `, ${win.detail}` : ''}`}
              </span>
            </div>
          )
        })}
      </div>
      <div className="relative flex">
        {/* time gutter, labels at the calendar's density like the main board */}
        <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-cream/85" style={{ width: GUTTER_W, height: dayH }}>
          {ticks.map((m) => {
            const isHour = m % 60 === 0
            const offHours = m < 0 || m > DAY_MIN
            return (
              <span
                key={m}
                className={`tnum absolute right-1.5 whitespace-nowrap uppercase ${
                  isHour ? 'text-[11px] font-extrabold' : 'text-micro font-bold'
                } ${offHours ? 'text-ink-faint/50' : isHour ? 'text-ink-soft' : 'text-ink-faint'}`}
                style={{ top: yAt(m), transform: 'translateY(-50%)' }}
              >
                {fmtTime(m)}
              </span>
            )
          })}
        </div>
        {/* day columns */}
        <div className="relative flex-1" style={{ height: dayH }}>
          {hours.map((m) => (
            <div key={m} className="absolute w-full border-t border-line" style={{ top: yAt(m) }} />
          ))}
          {density === 15 && Array.from({ length: (DAY_MIN / SLOT_MIN) - 1 }, (_, i) => (i + 1) * SLOT_MIN).filter((m) => m % 60 !== 0).map((m) => (
            <div key={m} className={`absolute w-full border-t ${m % 30 === 0 ? 'border-line/80' : 'border-line/55'}`} style={{ top: yAt(m) }} />
          ))}
          {density === 30 && Array.from({ length: DAY_MIN / 30 }, (_, i) => (i + 1) * 30).filter((m) => m % 60 !== 0).map((m) => (
            <div key={m} className="absolute w-full border-t border-line/70" style={{ top: yAt(m) }} />
          ))}
          {days.map((d, di) => {
            const win = dayWindow(tech, d)
            const mine = getAppts(dayKey(d)).filter((a) => a.techId === tech.id)
            const blocks = getBlocks(dayKey(d)).filter((b) => b.techId === tech.id)
            const colW = `${100 / 7}%`
            const left = `${(di * 100) / 7}%`
            return (
              <div
                key={dayKey(d)}
                className="absolute top-0 h-full border-r border-border/60"
                style={{ left, width: colW }}
                onDoubleClick={(e) => {
                  if (win.offLabel) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const raw = (e.clientY - rect.top) / ppm - VIEW_PAD
                  const snapped = Math.round(raw / SLOT_MIN) * SLOT_MIN
                  const clamped = Math.max(win.start, Math.min(snapped, win.end - SLOT_MIN))
                  onBook(d, clamped)
                }}
              >
                {/* outside work window, hatched */}
                <div className="absolute w-full" style={{ top: 0, height: yAt(win.start), background: HATCH }} />
                <div className="absolute w-full" style={{ top: yAt(win.end), height: dayH - yAt(win.end), background: HATCH }} />
                {win.offLabel && (
                  <div className="absolute w-full" style={{ top: 0, height: dayH, background: HATCH }} />
                )}
                {blocks.map((b) => (
                  <div
                    key={b.id}
                    className="absolute mx-0.5 overflow-hidden rounded-md border border-slate-300 bg-slate-200/80 px-1.5 py-1"
                    style={{ left: 2, right: 2, top: yAt(b.startMin), height: b.durationMin * ppm }}
                  >
                    <span className="block truncate text-[10px] font-bold text-slate-600">{b.reason}</span>
                    <span className="tnum block text-[9px] font-semibold text-slate-500">{fmtTime(b.startMin)}</span>
                  </div>
                ))}
                {mine.map((a) => (
                  <div
                    key={a.id}
                    title={`${fmtTime(a.startMin)} to ${fmtTime(a.startMin + a.durationMin)}, ${a.clientName}, right-click for actions`}
                    onContextMenu={(e) => { e.stopPropagation(); onApptMenu(e, a.id) }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1"
                    style={{
                      left: 2, right: 2,
                      top: yAt(a.startMin), height: a.durationMin * ppm,
                      background: '#FDE8C8', borderColor: '#D97706', color: '#7C4A03',
                    }}
                  >
                    <span className="block truncate text-[11px] font-bold leading-tight">{a.clientName}</span>
                    <span className="block truncate text-[10px] font-semibold leading-tight">{svcById[a.serviceId]?.name ?? ''}</span>
                    <span className="tnum block text-[9.5px] font-semibold leading-tight opacity-80">
                      {fmtTime(a.startMin)} to {fmtTime(a.startMin + a.durationMin)}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthGrid({ tech, anchor, getAppts, getBlocks, onPickDay }: {
  tech: Tech
  anchor: Date
  getAppts: (day: string) => Appointment[]
  getBlocks: (day: string) => TimeBlock[]
  onPickDay: (d: Date) => void
}) {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  const todayK = dayKey(new Date())
  return (
    <div className="p-3">
      <div className="mb-1 grid grid-cols-7 gap-1.5 text-center">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <span key={d} className="py-1 text-[10.5px] font-bold uppercase text-muted-foreground">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const key = dayKey(d)
          const win = dayWindow(tech, d)
          const mine = getAppts(key).filter((a) => a.techId === tech.id).sort((a, b) => a.startMin - b.startMin)
          const blocks = getBlocks(key).filter((b) => b.techId === tech.id)
          const gaps = win.offLabel ? [] : openGaps(win.start, win.end, mine, blocks)
          const openMin = gaps.reduce((m, g) => m + g.to - g.from, 0)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPickDay(d)}
              className={`flex min-h-28 flex-col rounded-lg border p-1.5 text-left transition-colors ${
                key === todayK ? 'border-clay bg-clay-tint/40' : 'border-border/70 hover:border-clay/50'
              } ${win.offLabel ? 'bg-muted/40' : 'bg-card'}`}
            >
              <span className="flex items-baseline gap-1.5">
                <span className={`text-[11px] font-bold ${key === todayK ? 'text-clay' : ''}`}>{d.getDate()}</span>
                {win.offLabel
                  ? <span className="text-[8.5px] font-bold uppercase text-muted-foreground">{win.offLabel}</span>
                  : <span className={`text-[8.5px] font-bold ${openMin > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                      {openMin > 0 ? `${fmtGap(openMin)} open` : 'Full'}
                    </span>}
              </span>
              {!win.offLabel && (
                <span className="mt-1 flex flex-col gap-0.5 overflow-hidden">
                  {mine.slice(0, 3).map((a) => (
                    <span key={a.id} className="tnum truncate rounded bg-[#FDE8C8] px-1 py-px text-[9px] font-semibold text-[#7C4A03]">
                      {fmtTime(a.startMin)} {a.clientName.split(' ')[0]}
                    </span>
                  ))}
                  {mine.length > 3 && (
                    <span className="px-1 text-[9px] font-semibold text-muted-foreground">+{mine.length - 3} more</span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
