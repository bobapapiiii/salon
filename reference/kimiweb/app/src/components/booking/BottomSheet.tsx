import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE_OUT_EXPO } from './utils'

/**
 * Bottom sheet (mobile) / centered modal (desktop) — my-appointments.md §4.
 * Slide y 100%→0 spring, 45% ink backdrop, drag handle; ≥640px → centered 440px card.
 */
export default function BottomSheet({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  labelledBy?: string
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-[rgba(42,33,26,.45)] backdrop-blur-[4px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            onClick={onClose}
          />
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center sm:items-center">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              className="pointer-events-auto w-full max-w-[480px] rounded-t-r-xl bg-surface shadow-sh-3 sm:w-[440px] sm:max-w-[440px] sm:rounded-r-xl"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '110%', transition: { duration: 0.22, ease: [0.64, 0, 0.78, 0] } }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_e, info) => {
                if (info.offset.y > 90 || info.velocity.y > 500) onClose()
              }}
            >
              <div className="flex justify-center pt-2.5 sm:hidden">
                <span className="h-1 w-8 rounded-r-pill bg-line-strong" />
              </div>
              <motion.div
                className="max-h-[80dvh] overflow-y-auto p-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
                initial="hidden"
                animate="show"
                variants={{
                  show: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
                }}
              >
                {children}
              </motion.div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** Stagger child variant for sheet content. */
export const sheetItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT_EXPO } },
}
