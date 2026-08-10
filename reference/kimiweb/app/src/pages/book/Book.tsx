import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useBookingStore } from '@/components/booking/store'
import { useCatalog } from '@/components/booking/useCatalog'
import ProgressSteps from '@/components/booking/ProgressSteps'
import ClientToaster from '@/components/booking/ClientToaster'
import StepServices from '@/components/booking/steps/StepServices'
import StepTechnician from '@/components/booking/steps/StepTechnician'
import StepTime from '@/components/booking/steps/StepTime'
import StepDetails, { type BookingOutcome } from '@/components/booking/steps/StepDetails'
import SuccessScreen from '@/components/booking/SuccessScreen'
import { EASE_OUT_EXPO } from '@/components/booking/utils'

/**
 * /book — 4-step client booking flow (book.md):
 * Services → Technician → Date & Time → Details → confirm / request.
 */
export default function Book() {
  const step = useBookingStore((s) => s.step)
  const setStep = useBookingStore((s) => s.setStep)
  const toggleService = useBookingStore((s) => s.toggleService)
  const items = useBookingStore((s) => s.items)
  const { categories, isLoading } = useCatalog()
  const [params, setParams] = useSearchParams()
  const [outcome, setOutcome] = useState<BookingOutcome | null>(null)
  const direction = useRef<1 | -1>(1)
  const prevStep = useRef(step)

  if (prevStep.current !== step) {
    direction.current = step > prevStep.current ? 1 : -1
    prevStep.current = step
  }

  // Deep link: /book?service=gel-x (slug or id) pre-selects a service.
  useEffect(() => {
    const wanted = params.get('service')
    if (!wanted || isLoading) return
    for (const c of categories) {
      for (const s of c.services) {
        const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        if (slug === wanted.toLowerCase() || String(s.id) === wanted) {
          if (!items.some((i) => i.serviceId === s.id)) toggleService(s.id)
          params.delete('service')
          setParams(params, { replace: true })
          return
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, params])

  const goTo = (n: 1 | 2 | 3 | 4) => {
    if (n < step) setStep(n)
  }

  return (
    <div className="px-4 pb-6">
      <ClientToaster />

      {outcome ? (
        <SuccessScreen outcome={outcome} />
      ) : (
        <>
          {/* Booking header — sticky under shell top bar */}
          <div className="sticky top-0 z-30 -mx-4 border-b border-line bg-surface px-4 pb-2 pt-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={step === 1}
                onClick={() => goTo((step - 1) as 1 | 2 | 3 | 4)}
                className="flex h-11 w-11 items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-cream hover:text-clay disabled:opacity-0"
                aria-label="Back a step"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                {step === 1 && (
                  <h1 className="font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
                    Book an appointment
                  </h1>
                )}
                <ProgressSteps step={step} onJump={(n) => n < step && setStep(n)} />
              </div>
              <span className="shrink-0 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                Step {step} of 4
              </span>
            </div>
          </div>

          <div className="pt-4">
            <AnimatePresence mode="wait" custom={direction.current}>
              <motion.div
                key={step}
                custom={direction.current}
                initial={{ opacity: 0, x: 40 * direction.current }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 * direction.current, transition: { duration: 0.18 } }}
                transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
              >
                {step === 1 && <StepServices />}
                {step === 2 && <StepTechnician />}
                {step === 3 && <StepTime />}
                {step === 4 && <StepDetails onOutcome={setOutcome} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  )
}
