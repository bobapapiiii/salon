import { useEffect, useRef, useState } from 'react'
import Reveal from './Reveal'

/**
 * Section 6 — Stats band. home.md §6. Quiet confidence: numerals count up
 * once at 30% viewport (1200ms ease-out); "3 taps" / "2 sides" fade in only.
 */

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (to === 0) return // already renders 0
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const id = requestAnimationFrame(() => setValue(to))
      return () => cancelAnimationFrame(id)
    }
    let raf = 0
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        io.disconnect()
        const start = performance.now()
        const step = (now: number) => {
          const p = Math.min((now - start) / 1200, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          setValue(Math.round(eased * to))
          if (p < 1) raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [to])

  return (
    <span ref={ref} className="tnum">
      {value}
      {suffix}
    </span>
  )
}

interface Stat {
  countTo?: number
  suffix?: string
  text?: string
  label: string
}

const STATS: Stat[] = [
  { countTo: 50, suffix: '+', label: 'technicians per schedule, no slowdown' },
  { text: '3 taps', label: 'to rebook a favorite service' },
  { countTo: 0, suffix: '', label: 'per-seat fees — bring the whole team' },
  { text: '2 sides', label: 'one source of truth' },
]

export default function StatsBand() {
  return (
    <section
      className="grain-overlay grain-overlay-dark bg-night py-16 md:py-20"
      style={{ ['--grain-opacity' as string]: 0.06 }}
    >
      <Reveal
        className="mx-auto grid max-w-[1280px] grid-cols-2 gap-x-6 gap-y-10 px-5 md:grid-cols-4 md:px-8"
        y={12}
        stagger={0.08}
        start="top 70%"
      >
        {STATS.map((s) => (
          <div key={s.label} data-reveal>
            <p className="text-[40px] font-extrabold leading-none text-white md:text-[48px]">
              {s.text ? s.text : <CountUp to={s.countTo ?? 0} suffix={s.suffix ?? ''} />}
            </p>
            <p className="mt-2.5 max-w-[24ch] text-small font-medium leading-[18px] text-white/60">
              {s.label}
            </p>
          </div>
        ))}
      </Reveal>
    </section>
  )
}
