import { Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const STEPS = ['Services', 'Technician', 'Time', 'Details'] as const

/**
 * ProgressSteps (design.md §7.2): 4 numbered nodes + connecting line.
 * Completed = clay fill + check; current = clay ring pulse; upcoming = line border.
 * Completed nodes are tappable to jump back.
 */
export default function ProgressSteps({
  step,
  onJump,
}: {
  step: 1 | 2 | 3 | 4
  onJump?: (step: 1 | 2 | 3 | 4) => void
}) {
  return (
    <div className="flex items-center" role="list" aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4
        const done = n < step
        const current = n === step
        return (
          <div key={label} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
            <button
              type="button"
              disabled={!done}
              onClick={() => done && onJump?.(n)}
              className={cn(
                'relative flex h-11 min-w-11 items-center justify-center gap-1.5',
                done ? 'cursor-pointer' : current ? 'cursor-default' : 'cursor-not-allowed',
              )}
              aria-current={current ? 'step' : undefined}
              title={label}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-r-pill text-[11px] font-extrabold transition-colors duration-200',
                  done && 'bg-clay text-white',
                  current && 'bg-surface text-clay ring-2 ring-clay',
                  !done && !current && 'bg-surface text-ink-faint ring-1 ring-line-strong',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
              </span>
              {current && (
                <motion.span
                  className="absolute inset-x-2 inset-y-2 rounded-r-pill ring-2 ring-clay"
                  initial={{ opacity: 0.7, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.35 }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <span
                className={cn(
                  'hidden text-micro font-bold uppercase tracking-[0.08em] min-[400px]:block',
                  current ? 'text-clay' : done ? 'text-ink-soft' : 'text-ink-faint',
                )}
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className="relative mx-1 h-0.5 flex-1 overflow-hidden rounded-r-pill bg-line">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-r-pill bg-clay"
                  initial={false}
                  animate={{ width: n < step ? '100%' : '0%' }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
