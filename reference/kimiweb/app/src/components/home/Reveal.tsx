import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * Scroll-triggered reveal (GSAP-only component — no Framer Motion inside).
 * - variant "rise": children marked [data-reveal] slide up + fade, staggered.
 * - variant "words": children marked [data-reveal-word] (each inside an
 *   overflow-hidden mask) reveal y 100%→0, staggered.
 * Fires once when the wrapper crosses `start` (default 80% viewport).
 */
interface RevealProps {
  children: ReactNode
  className?: string
  variant?: 'rise' | 'words'
  y?: number
  duration?: number
  stagger?: number
  delay?: number
  start?: string
}

export default function Reveal({
  children,
  className,
  variant = 'rise',
  y = 32,
  duration = 0.7,
  stagger = 0.09,
  delay = 0,
  start = 'top 80%',
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      if (variant === 'words') {
        const words = el.querySelectorAll('[data-reveal-word]')
        gsap.fromTo(
          words,
          { yPercent: 100 },
          {
            yPercent: 0,
            duration: 0.6,
            ease: 'expo.out',
            stagger,
            delay,
            scrollTrigger: { trigger: el, start, once: true },
          },
        )
      } else {
        const targets = el.querySelectorAll('[data-reveal]')
        gsap.fromTo(
          targets.length ? targets : el,
          { y, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration,
            ease: 'expo.out',
            stagger,
            delay,
            scrollTrigger: { trigger: el, start, once: true },
          },
        )
      }
    }, el)
    return () => ctx.revert()
  }, [variant, y, duration, stagger, delay, start])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
