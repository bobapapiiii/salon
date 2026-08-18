// ─── Searchable dropdown, replaces native <select> for tech/service pickers ──
// A small floating combobox: a trigger button showing the current selection,
// a search box that filters as you type, and an optionally-grouped list of
// matches. Every technician and service picker in the app uses this so
// choosing from a long roster or catalog is always searchable and (within
// each group) alphabetized, instead of scrolling a long native <select>.
//
// The open panel renders through a portal into document.body, positioned
// with `fixed` coordinates measured off the trigger. It used to render
// in-place (`absolute`, anchored to the trigger's own wrapper), which
// caused two different flavors of the same problem depending on what kind
// of container it opened inside: a scrollable ancestor (e.g. a details
// panel's narrow section) clips a `position: absolute` child to its own
// box, so the right side of a wide panel silently vanished behind
// whatever sat next to that section; and inside a plain non-scrolling
// container, the panel could still end up layered *under* a later sibling
// that happened to paint on top of it. Escaping to a portal sidesteps
// both: nothing can clip or out-stack it, because it isn't a descendant
// of any of that layout anymore.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

/** the dropdown panel's fixed width (matches the w-60 class below), used to
 *  decide whether it needs to open right-aligned instead of left-aligned */
const PANEL_W = 240
/** rough ceiling on the panel's rendered height (search box + option list),
 *  used only to decide whether it should open above the trigger instead of
 *  below when there isn't room underneath */
const PANEL_MAX_H = 280

export interface SearchSelectOption {
  value: string
  label: string
  /** shown right-aligned, dimmed -- price, duration, role name, a dollar amount, etc. */
  sublabel?: string
  /** small round avatar/initials chip in front of the label, e.g. a tech's initials */
  avatarText?: string
  /** groups render under a header, in first-seen order; ungrouped options render first */
  group?: string
  disabled?: boolean
}

export function SearchSelect({
  options, value, onChange, placeholder = 'Choose…', searchPlaceholder = 'Search…', disabled, className = '',
}: {
  options: SearchSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  // where the portalled panel lands, in viewport coordinates -- measured
  // fresh off the trigger each time it opens
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.find((o) => o.value === value)

  const toggleOpen = () => {
    if (!open) {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (rect) {
        const left = Math.min(
          rect.left + PANEL_W > window.innerWidth - 8 ? rect.right - PANEL_W : rect.left,
          window.innerWidth - PANEL_W - 8,
        )
        const openUp = rect.bottom + PANEL_MAX_H > window.innerHeight - 8 && rect.top > PANEL_MAX_H
        setCoords({ top: openUp ? rect.top - 4 : rect.bottom + 4, left: Math.max(8, left), openUp })
      }
      // focus the search box next tick, but tell the browser not to scroll
      // anything into view for it -- a plain autoFocus makes the browser walk
      // up the DOM scrolling every scrollable ancestor until the input is
      // fully visible, which is its own way of shoving the page sideways
      requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }))
    }
    setOpen((o) => !o)
  }

  // the panel's position is measured once, on open -- rather than tracking
  // the trigger continuously, just close on scroll/resize like most
  // floating menus do, since the trigger may live inside a scrollable
  // ancestor the portal is no longer nested in
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const groups = useMemo(() => {
    const text = q.trim().toLowerCase()
    const filtered = options.filter((o) => !text || o.label.toLowerCase().includes(text))
    const order: (string | undefined)[] = []
    const byGroup = new Map<string | undefined, SearchSelectOption[]>()
    filtered.forEach((o) => {
      if (!byGroup.has(o.group)) {
        order.push(o.group)
        byGroup.set(o.group, [])
      }
      byGroup.get(o.group)!.push(o)
    })
    return { list: order.map((g) => ({ group: g, items: byGroup.get(g)! })), count: filtered.length }
  }, [options, q])

  return (
    <div ref={wrapRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className="flex w-full items-center justify-between gap-1.5 rounded-[8px] border border-input bg-background px-2 py-1.5 text-left text-xs outline-none transition-colors focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${selected ? '' : 'text-muted-foreground'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && !disabled && coords && createPortal(
        <div
          className="fixed z-[200] w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
          style={coords.openUp
            ? { bottom: window.innerHeight - coords.top, left: coords.left }
            : { top: coords.top, left: coords.left }}
        >
          <div className="border-b border-border p-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-input bg-background py-1 pl-7 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {groups.count === 0 && <p className="px-2 py-3 text-center text-[11.5px] text-muted-foreground">No matches</p>}
            {groups.list.map(({ group, items }) => (
              <div key={group ?? '__ungrouped'}>
                {group && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{group}</p>}
                {items.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onMouseDown={() => {
                      if (o.disabled) return
                      onChange(o.value)
                      setOpen(false)
                      setQ('')
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
                      o.value === value && !o.disabled ? 'font-semibold text-sky-600' : ''
                    }`}
                  >
                    {o.avatarText && (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold">
                        {o.avatarText}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.sublabel && <span className="shrink-0 text-[10.5px] text-muted-foreground">{o.sublabel}</span>}
                    {o.value === value && !o.disabled && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
