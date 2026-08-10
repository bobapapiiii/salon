import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Clock, Link2, StickyNote } from 'lucide-react'
import { useCategoriesStore } from '@/lib/categories-store'

/* ── Generic anchored popover (fixed, click-away, Esc) ─────────────── */
export function AnchoredPopover({ anchor, width, onClose, children, label }: {
  anchor: DOMRect; width: number; onClose: () => void; children: ReactNode; label: string
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
      <div
        role="dialog"
        aria-label={label}
        className="fixed z-[61] rounded-[14px] border border-line bg-surface p-3 shadow-sh-2"
        style={{ left, top, width }}
      >
        {children}
      </div>
    </>
  )
}

/* ── Legend popover ─────────────────────────────────────────────────── */
const STATUS_ROWS: { id: string; label: string; bg: string; border: string; icon?: 'check' | 'hatch' | 'clock' }[] = [
  { id: 'booked', label: 'Booked', bg: '#FDE8C8', border: '1px solid #D97706', icon: 'clock' },
  { id: 'requested', label: 'Requested online, awaiting approval', bg: '#FDE8C8', border: '1px dashed #D97706' },
  { id: 'confirmed', label: 'Confirmed', bg: '#D5F0DA', border: '1px solid #3E9B4F' },
  { id: 'checked_in', label: 'Checked in', bg: '#FCF3C5', border: '1px solid #D9A50B', icon: 'check' },
  { id: 'in_service', label: 'In progress', bg: '#FCF3C5', border: '1px solid #D9A50B', icon: 'hatch' },
  { id: 'completed', label: 'Checked out', bg: '#FBD5D5', border: '1px solid #DC4444' },
  { id: 'late', label: 'Time elapsed, not checked in', bg: '#E6DEFB', border: '1px solid #8B5CF6' },
  { id: 'no_show', label: 'No-show', bg: '#F5DFDB', border: '1.5px solid #B3402F' },
]

export function LegendPopover({ anchor, colorMode, onColorMode, onClose }: {
  anchor: DOMRect
  colorMode: 'category' | 'status'
  onColorMode: (m: 'category' | 'status') => void
  onClose: () => void
}) {
  const cats = useCategoriesStore()
  return (
    <AnchoredPopover anchor={anchor} width={300} onClose={onClose} label="Legend">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Color by</span>
        <div className="flex h-8 items-center rounded-[8px] border border-line bg-cream p-0.5">
          {(['category', 'status'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onColorMode(m)}
              className={`h-7 rounded-[6px] px-2.5 text-[11px] font-bold capitalize transition-all ${
                colorMode === m ? 'bg-surface text-ink shadow-sh-1' : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-1.5 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Categories</p>
      <div className="mb-3 flex flex-col gap-1">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <span
              className="h-4 w-4 rounded-[4px] border"
              style={{ background: c.fill, borderColor: c.line, borderLeftWidth: 4, borderLeftColor: c.line }}
            />
            <span className="text-[13px] font-semibold">{c.name}</span>
          </div>
        ))}
      </div>

      <p className="mb-1.5 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Statuses</p>
      <div className="flex flex-col gap-1.5">
        {STATUS_ROWS.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5">
            <span
              className={`relative flex h-6 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[4px] ${s.id === 'completed' ? 'opacity-55' : ''}`}
              style={{ background: s.bg, border: s.border }}
            >
              {s.icon === 'check' && (
                <span className="flex h-3 w-3 items-center justify-center rounded-full bg-white text-[8px] font-black text-olive">✓</span>
              )}
              {s.icon === 'hatch' && <span className="sched-hatch absolute inset-y-0 left-0 w-1/2" />}
              {s.icon === 'clock' && <Clock className="h-3 w-3 text-[#E0517E]" />}
            </span>
            <span className="text-[13px] font-semibold">{s.label}</span>
          </div>
        ))}
      </div>

      <p className="mb-1.5 mt-3 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Marks</p>
      <div className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-soft">
        <span className="flex items-center gap-2"><Link2 className="h-3.5 w-3.5" /> Same-time linked group</span>
        <span className="flex items-center gap-2"><StickyNote className="h-3.5 w-3.5 text-amber-500" /> Has notes</span>
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-8 overflow-hidden rounded-[3px] border border-line">
            <span className="h-full w-1/2 bg-[#F9DBE3]" /><span className="h-full w-1/2 bg-[#D8EEE4]" />
          </span>
          Overlap lanes (double-booking on)
        </span>
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-8 overflow-hidden rounded-[3px] border border-line">
            <span className="h-full w-1/2 border-b-[3px] border-b-[#EC6BA8] bg-surface" /><span className="h-full w-1/2 border-b-[3px] border-b-[#4C8DED] bg-surface" />
          </span>
          Tech gender strip, female / male
        </span>
      </div>
    </AnchoredPopover>
  )
}

/* ── Date mini-popover (month grid) ─────────────────────────────────── */
export function DatePickerPopover({ anchor, selected, today, appointmentDates, onSelect, onClose }: {
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
          type="button" aria-label="Previous month"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-soft hover:bg-cream"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[14px] font-bold">
          {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button" aria-label="Next month"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-ink-soft hover:bg-cream"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="py-1 text-micro font-bold uppercase text-ink-faint">{d}</span>
        ))}
        {cells.map((ds, i) =>
          ds == null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={ds}
              type="button"
              onClick={() => onSelect(ds)}
              className={`tnum relative flex h-8 items-center justify-center rounded-[6px] text-[12.5px] font-semibold transition-colors ${
                ds === selected ? 'bg-clay text-white' : ds === today ? 'bg-clay-tint text-clay' : 'text-ink hover:bg-cream'
              }`}
            >
              {Number(ds.slice(-2))}
              {appointmentDates.has(ds) && ds !== selected && (
                <span className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-clay" />
              )}
            </button>
          ),
        )}
      </div>
    </AnchoredPopover>
  )
}
