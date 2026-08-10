import { format, parse } from 'date-fns'

/** YYYY-MM-DD in local time (mirrors api todayStr). */
export function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysStr(dateStr: string, n: number): string {
  const d = parse(dateStr, 'yyyy-MM-dd', new Date())
  d.setDate(d.getDate() + n)
  return todayStr(d)
}

export function parseDate(dateStr: string): Date {
  return parse(dateStr, 'yyyy-MM-dd', new Date())
}

/** 870 -> "2:30 PM" */
export function fmtMin(min: number): string {
  const h24 = Math.floor(min / 60)
  const m = min % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Compact variant: 870 -> "2:30p" */
export function fmtMinShort(min: number): string {
  const h24 = Math.floor(min / 60)
  const m = min % 60
  const ampm = h24 >= 12 ? 'p' : 'a'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`
}

/** 8500 -> "$85" · 123400 -> "$1,234" */
export function fmtMoney(cents: number): string {
  const dollars = cents / 100
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })}`
}

/** "Wed, May 14" */
export function fmtDateShort(dateStr: string): string {
  return format(parseDate(dateStr), 'EEE, MMM d')
}

/** Relative day label: Today / Tomorrow / "Wed, May 14" */
export function fmtDayLabel(dateStr: string): string {
  const t = todayStr()
  if (dateStr === t) return 'Today'
  if (dateStr === addDaysStr(t, 1)) return 'Tomorrow'
  return fmtDateShort(dateStr)
}

/** Auto-format US phone: 4155550182 -> "(415) 555-0182" */
export function fmtPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10)
  if (d.length === 0) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

export function initialsOf(first: string, last?: string): string {
  return `${first.charAt(0)}${(last ?? '').charAt(0)}`.toUpperCase()
}

/** First name + last initial: "Maya Tran" -> "Maya T." */
export function shortName(full: string | null | undefined): string {
  if (!full) return 'Any available'
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
}

/* ---------- Service category styling (design.md §3.2) ---------- */
export type CatKey = 'nails' | 'hair' | 'lashes' | 'spa'

export function catKeyOf(categoryName: string | undefined): CatKey {
  const n = (categoryName ?? '').toLowerCase()
  if (n.includes('nail')) return 'nails'
  if (n.includes('hair')) return 'hair'
  if (n.includes('lash')) return 'lashes'
  return 'spa'
}

/** Literal class strings so Tailwind picks them up. */
export const CAT_CLASSES: Record<
  CatKey,
  { fill: string; line: string; text: string; dot: string; bar: string }
> = {
  nails: {
    fill: 'bg-cat-nails-fill',
    line: 'border-cat-nails-line',
    text: 'text-cat-nails-text',
    dot: 'bg-cat-nails-line',
    bar: 'bg-cat-nails-line',
  },
  hair: {
    fill: 'bg-cat-hair-fill',
    line: 'border-cat-hair-line',
    text: 'text-cat-hair-text',
    dot: 'bg-cat-hair-line',
    bar: 'bg-cat-hair-line',
  },
  lashes: {
    fill: 'bg-cat-lashes-fill',
    line: 'border-cat-lashes-line',
    text: 'text-cat-lashes-text',
    dot: 'bg-cat-lashes-line',
    bar: 'bg-cat-lashes-line',
  },
  spa: {
    fill: 'bg-cat-spa-fill',
    line: 'border-cat-spa-line',
    text: 'text-cat-spa-text',
    dot: 'bg-cat-spa-line',
    bar: 'bg-cat-spa-line',
  },
}

/* ---------- Avatar tints (design.md §7.2) ---------- */
export const AVATAR_TINTS: Record<string, string> = {
  clay: 'bg-clay-tint text-clay-deep',
  olive: 'bg-olive-tint text-[#4B552F]',
  honey: 'bg-cat-hair-fill text-cat-hair-text',
  rose: 'bg-cat-nails-fill text-cat-nails-text',
}

export function avatarTintClass(tint: string | null | undefined): string {
  return AVATAR_TINTS[tint ?? ''] ?? AVATAR_TINTS.clay!
}

export const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number]
