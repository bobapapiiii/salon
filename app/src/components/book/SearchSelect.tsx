// ─── Searchable dropdown, replaces native <select> for tech/service pickers ──
// A small floating combobox: a trigger button showing the current selection,
// a search box that filters as you type, and an optionally-grouped list of
// matches. Every technician and service picker in the app uses this so
// choosing from a long roster or catalog is always searchable and (within
// each group) alphabetized, instead of scrolling a long native <select>.
import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

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
  const selected = options.find((o) => o.value === value)

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
    <div className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1.5 rounded-[8px] border border-input bg-background px-2 py-1.5 text-left text-xs outline-none transition-colors focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${selected ? '' : 'text-muted-foreground'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl">
          <div className="border-b border-border p-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
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
        </div>
      )}
    </div>
  )
}
