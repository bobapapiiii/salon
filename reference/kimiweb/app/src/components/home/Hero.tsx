import { memo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { PlayCircle, CheckCircle2 } from 'lucide-react'
import HeroImage from './HeroImage'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

const HEADLINE_BEFORE = ['The', 'front', 'desk', 'that', 'keeps', 'up', 'with']
const HEADLINE_ACCENT = ['fifty', 'chairs.']

/** Floating UI chip — perpetual float loop isolated + memoized (react-dev.md). */
const FloatingChip = memo(function FloatingChip({
  children,
  className,
  delay,
}: {
  children: ReactNode
  className?: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20, delay }}
      className={cn('absolute z-10', className)}
    >
      <div className="animate-float-y" style={{ animationDelay: `${delay}s` }}>
        {children}
      </div>
    </motion.div>
  )
})

function Word({
  word,
  index,
  accent,
}: {
  word: string
  index: number
  accent?: boolean
}) {
  return (
    <span className="inline-block overflow-hidden pb-2 -mb-2 align-top">
      <motion.span
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.7, ease: EASE, delay: 0.15 + index * 0.045 }}
        className={cn('inline-block', accent && 'font-medium italic')}
      >
        {word}
      </motion.span>
    </span>
  )
}

export default function Hero() {
  const words = [...HEADLINE_BEFORE, ...HEADLINE_ACCENT]

  return (
    <section className="grain-overlay relative overflow-hidden bg-paper" style={{ ['--grain-opacity' as string]: 0.05 }}>
      <div className="mx-auto grid min-h-[92dvh] max-w-[1280px] items-center gap-12 px-5 pb-20 pt-32 md:px-8 lg:grid-cols-[55fr_45fr] lg:pt-24">
        {/* ── Left: copy ─────────────────────────────────────────── */}
        <div>
          <motion.span
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="inline-flex items-center rounded-r-pill bg-clay-tint px-3.5 py-1.5 text-micro font-bold uppercase text-clay"
          >
            Two-sided booking · Built for big teams
          </motion.span>

          <h1 className="mt-6 font-display text-[40px] font-semibold leading-[1.08] tracking-[-0.02em] text-ink md:text-[56px] md:leading-[60px]">
            {words.map((w, i) => {
              const isAccent = i >= HEADLINE_BEFORE.length
              const isLastAccent = i === words.length - 1
              return (
                <span key={i} className="inline">
                  <Word word={w} index={i} accent={isAccent} />
                  {isLastAccent ? (
                    /* hand-drawn clay underline flourish, draws in at t=900ms */
                    <span className="relative -mt-3 block h-3 w-[9ch] md:w-[10ch]">
                      <svg viewBox="0 0 240 12" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
                        <motion.path
                          d="M6 8 C 60 2, 170 2, 234 7"
                          stroke="#B4552B"
                          strokeWidth="3"
                          strokeLinecap="round"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.9 }}
                        />
                      </svg>
                    </span>
                  ) : (
                    ' '
                  )}
                </span>
              )
            })}
          </h1>

          <motion.p
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.75 }}
            className="mt-6 max-w-[46ch] text-base leading-6 text-ink-soft"
          >
            Lumina pairs a schedule your front desk can actually read at 50+
            technicians with a booking flow clients finish in under a minute.
            One platform, both sides of the chair.
          </motion.p>

          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.85 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Link
              to="/salon/schedule"
              className="flex h-11 items-center rounded-r-md bg-clay px-5 text-sm font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0"
            >
              Open the salon dashboard
            </Link>
            <Link
              to="/book"
              className="flex h-11 items-center gap-2 rounded-r-md border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-cream"
            >
              <PlayCircle className="h-[18px] w-[18px] text-clay" />
              Book as a client
            </Link>
          </motion.div>

          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.95 }}
            className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-micro font-bold uppercase text-ink-faint"
          >
            <span>No per-seat pricing</span>
            <span className="h-1 w-1 rounded-full bg-ink-faint" aria-hidden />
            <span>Request approvals built in</span>
            <span className="h-1 w-1 rounded-full bg-ink-faint" aria-hidden />
            <span>Same-time services</span>
          </motion.div>
        </div>

        {/* ── Right: arch image + floating chips ─────────────────── */}
        <div className="relative mx-auto w-full max-w-[440px] lg:max-w-none">
          <HeroImage />

          {/* Chip A — mini appointment block (Nails) */}
          <FloatingChip delay={0.9} className="-left-[8%] top-[16%] md:-left-[12%]">
            <div className="flex overflow-hidden rounded-r-md border border-cat-nails-line/40 bg-surface shadow-sh-2">
              <span className="w-1 bg-cat-nails-line" aria-hidden />
              <div className="bg-cat-nails-fill/90 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-cat-nails-text">
                  Gel-X · Maya P.
                  <CheckCircle2 className="h-3.5 w-3.5 text-cat-nails-text/70" />
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-cat-nails-text/75 tnum">
                  10:30 – 11:30
                </p>
              </div>
            </div>
          </FloatingChip>

          {/* Chip B — mini request card */}
          <FloatingChip delay={1.1} className="-right-[4%] bottom-[10%] md:-right-[10%]">
            <div className="w-[210px] rounded-r-md border border-line bg-surface p-3 shadow-sh-2">
              <p className="text-micro font-bold uppercase text-amber">New request</p>
              <p className="mt-1 text-[12.5px] font-bold text-ink">
                Balayage · Any available
              </p>
              <div className="mt-2.5 flex gap-2">
                <Link
                  to="/salon/requests"
                  className="flex h-7 flex-1 items-center justify-center rounded-r-sm bg-clay text-[11px] font-bold text-white transition-colors hover:bg-clay-deep"
                >
                  Accept
                </Link>
                <span className="flex h-7 flex-1 items-center justify-center rounded-r-sm border border-line text-[11px] font-bold text-ink-soft">
                  Decline
                </span>
              </div>
            </div>
          </FloatingChip>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="pointer-events-none absolute bottom-7 left-5 hidden items-center gap-3 md:left-8 lg:flex">
        <span className="text-micro font-bold uppercase text-ink-faint [writing-mode:vertical-rl]">
          Scroll
        </span>
        <span className="h-6 w-px bg-ink-faint/60 animate-scroll-cue" aria-hidden />
      </div>
    </section>
  )
}
