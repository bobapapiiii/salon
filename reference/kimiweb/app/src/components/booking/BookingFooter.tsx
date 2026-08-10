import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * Sticky footer CTA (book.md): surface, line top border, safe-area padding.
 * Summary text left + clay primary button right.
 */
export default function BookingFooter({
  summary,
  cta,
  onCta,
  disabled,
  disabledLabel,
  loading,
}: {
  summary: ReactNode
  cta: string
  onCta: () => void
  disabled?: boolean
  disabledLabel?: string
  loading?: boolean
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-surface px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-small font-semibold text-ink-soft">{summary}</div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={disabled || loading}
          onClick={onCta}
          className={cn(
            'flex h-11 shrink-0 items-center gap-1.5 rounded-r-md px-4 text-[14px] font-semibold text-white transition-all duration-150',
            disabled
              ? 'cursor-not-allowed bg-ink-faint/60'
              : 'bg-clay shadow-sh-1 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0',
          )}
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-r-pill border-2 border-white/40 border-t-white" />
          ) : (
            <>
              {disabled && disabledLabel ? disabledLabel : cta}
              {!disabled && <ArrowRight className="h-4 w-4" />}
            </>
          )}
        </motion.button>
      </div>
    </div>
  )
}
