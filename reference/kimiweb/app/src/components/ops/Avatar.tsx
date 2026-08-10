import { cn } from '@/lib/utils'

/**
 * Monogram avatar — design.md §7.2. No photos; initials on a per-person
 * warm tint (clay / olive / honey / rose), text 30% darker.
 */

export type AvatarTint = 'clay' | 'olive' | 'honey' | 'rose'

const TINTS: Record<AvatarTint, string> = {
  clay: 'bg-clay-tint text-clay-deep',
  olive: 'bg-olive-tint text-[#5A5F3C]',
  honey: 'bg-amber-tint text-[#8A5E17]',
  rose: 'bg-rust-tint text-[#7C3F35]',
}

const SIZES = {
  28: 'h-7 w-7 text-[10px]',
  32: 'h-8 w-8 text-[11px]',
  36: 'h-9 w-9 text-[11px]',
  40: 'h-10 w-10 text-[12px]',
  56: 'h-14 w-14 text-[16px]',
} as const

/** Deterministic tint from a name when no explicit tint exists. */
export function tintForName(name: string): AvatarTint {
  const order: AvatarTint[] = ['clay', 'olive', 'honey', 'rose']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return order[Math.abs(h) % order.length]
}

export function normalizeTint(t: string | null | undefined, fallbackName = ''): AvatarTint {
  if (t === 'clay' || t === 'olive' || t === 'honey' || t === 'rose') return t
  return tintForName(fallbackName || 'lumina')
}

export default function Avatar({
  initials,
  tint = 'clay',
  size = 32,
  ring = false,
  className,
}: {
  initials: string
  tint?: AvatarTint
  size?: keyof typeof SIZES
  ring?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-r-pill font-extrabold',
        TINTS[tint],
        SIZES[size],
        ring && 'ring-2 ring-clay',
        className,
      )}
    >
      {initials}
    </span>
  )
}
