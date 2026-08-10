/**
 * Shared formatting + category-color helpers for the salon ops pages.
 * Category trios come from design.md §3.2 (tailwind `cat.*` tokens).
 */

export type CatKey = 'nails' | 'hair' | 'lashes' | 'spa'

/** Map a category name (e.g. "Nails") to its color key. */
export function catKey(name: string | null | undefined): CatKey {
  const n = (name ?? '').toLowerCase()
  if (n.includes('nail')) return 'nails'
  if (n.includes('hair')) return 'hair'
  if (n.includes('lash') || n.includes('brow')) return 'lashes'
  return 'spa'
}

/** Explicitly-enumerated trio classes (Tailwind content-scan safe). */
export const CAT: Record<
  CatKey,
  { fill: string; line: string; text: string; dot: string; hex: { fill: string; line: string; text: string } }
> = {
  nails: {
    fill: 'bg-cat-nails-fill',
    line: 'border-cat-nails-line',
    text: 'text-cat-nails-text',
    dot: 'bg-cat-nails-line',
    hex: { fill: '#F3DFDA', line: '#C97F72', text: '#7C3F35' },
  },
  hair: {
    fill: 'bg-cat-hair-fill',
    line: 'border-cat-hair-line',
    text: 'text-cat-hair-text',
    dot: 'bg-cat-hair-line',
    hex: { fill: '#F1E5C9', line: '#BE9334', text: '#6F5313' },
  },
  lashes: {
    fill: 'bg-cat-lashes-fill',
    line: 'border-cat-lashes-line',
    text: 'text-cat-lashes-text',
    dot: 'bg-cat-lashes-line',
    hex: { fill: '#E5E9D8', line: '#87936B', text: '#4B552F' },
  },
  spa: {
    fill: 'bg-cat-spa-fill',
    line: 'border-cat-spa-line',
    text: 'text-cat-spa-text',
    dot: 'bg-cat-spa-line',
    hex: { fill: '#E9E2D6', line: '#9C8E78', text: '#5C5140' },
  },
}

/** 870 → "2:30p" (design's compact salon time format). */
export function fmtMin(min: number): string {
  const h24 = Math.floor(min / 60)
  const m = min % 60
  const p = h24 >= 12 ? 'p' : 'a'
  let h = h24 % 12
  if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, '0')}${p}`
}

/** "2025-05-14" → Date at local noon (avoids TZ day-shift). */
export function parseDay(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00')
}

export function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** cents → "$55" / "$1,240" */
export function fmtPrice(cents: number): string {
  const dollars = Math.round(cents / 100)
  return '$' + dollars.toLocaleString('en-US')
}

/** "26m", "2h", "3d" — request age micro-labels. */
export function fmtAge(createdAt: Date | string): string {
  const t = typeof createdAt === 'string' ? new Date(createdAt) : createdAt
  const mins = Math.max(0, Math.floor((Date.now() - t.getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function ageMinutes(createdAt: Date | string): number {
  const t = typeof createdAt === 'string' ? new Date(createdAt) : createdAt
  return Math.max(0, Math.floor((Date.now() - t.getTime()) / 60000))
}

export function initialsOf(first: string, last?: string): string {
  return ((first[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '·'
}

/** Auto-format a US phone number as (555) 123-4567 while typing. */
export function formatPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}
