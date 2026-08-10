import { cn } from '@/lib/utils'
import { avatarTintClass } from './utils'

/** Monogram avatar (design.md §7.2) — warm tint bg, 30%-darker text. */
export default function Avatar({
  initials,
  tint,
  size = 40,
  className,
}: {
  initials: string
  tint?: string | null
  size?: 28 | 32 | 40 | 48 | 64
  className?: string
}) {
  const sizeClass =
    size === 28
      ? 'h-7 w-7 text-[10px]'
      : size === 32
        ? 'h-8 w-8 text-[11px]'
        : size === 48
          ? 'h-12 w-12 text-[15px]'
          : size === 64
            ? 'h-16 w-16 text-[20px]'
            : 'h-10 w-10 text-[13px]'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-r-pill font-bold tracking-[0.02em]',
        sizeClass,
        avatarTintClass(tint),
        className,
      )}
    >
      {initials}
    </span>
  )
}
