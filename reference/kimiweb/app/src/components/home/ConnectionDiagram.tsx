import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Smartphone, Inbox, Check, CalendarDays } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

/**
 * Section 5 — Connection diagram ("One booking, both sides"). home.md §5.
 * GSAP-only component. Desktop (≥768px, no reduced motion): the cream band
 * pins for 160vh and scroll progress draws the clay connector through the
 * four nodes, activating each in sequence. Fallback (mobile / reduced
 * motion): static fully-drawn diagram, nodes fade in staggered.
 */

interface NodeSpec {
  icon: LucideIcon
  title: string
  art: React.ReactNode
}

function SlotGrid() {
  const slots = ['9:00', '9:30', '10:00', '10:30', '11:00', '11:30']
  return (
    <div className="mt-3 grid grid-cols-3 gap-1">
      {slots.map((s) => (
        <span
          key={s}
          className={
            s === '10:30'
              ? 'rounded-sm bg-clay px-1 py-1 text-[9.5px] font-bold text-white tnum'
              : 'rounded-sm border border-line px-1 py-1 text-[9.5px] font-semibold text-ink-soft tnum'
          }
        >
          {s}
        </span>
      ))}
    </div>
  )
}

function MiniRequestCard() {
  return (
    <div className="mt-3 rounded-r-sm border border-line bg-paper px-2.5 py-2 text-left">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-amber">New request</p>
      <p className="mt-0.5 text-[10.5px] font-bold text-ink">Balayage · Any</p>
    </div>
  )
}

function AcceptPropose() {
  return (
    <div className="mt-3 flex justify-center gap-1.5">
      <span className="rounded-sm bg-clay px-2.5 py-1 text-[9.5px] font-bold text-white">Accept</span>
      <span className="rounded-sm border border-line px-2.5 py-1 text-[9.5px] font-bold text-ink-soft">
        Propose
      </span>
    </div>
  )
}

function MiniColumn() {
  return (
    <div className="mx-auto mt-3 h-14 w-16 rounded-sm border border-line bg-paper p-1">
      <div className="flex h-full flex-col justify-center rounded-[3px] border-l-2 border-cat-nails-line bg-cat-nails-fill px-1.5">
        <p className="text-[9px] font-bold text-cat-nails-text">Gel-X</p>
        <p className="text-[8.5px] font-semibold text-cat-nails-text/70 tnum">Maya P.</p>
      </div>
    </div>
  )
}

const NODES: NodeSpec[] = [
  { icon: Smartphone, title: 'Client picks services + time', art: <SlotGrid /> },
  { icon: Inbox, title: 'Request lands in the salon queue', art: <MiniRequestCard /> },
  { icon: Check, title: 'Front desk accepts (or proposes)', art: <AcceptPropose /> },
  { icon: CalendarDays, title: "It's on the schedule, tech assigned", art: <MiniColumn /> },
]

export default function ConnectionDiagram() {
  const sectionRef = useRef<HTMLElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const path = pathRef.current
    const section = sectionRef.current
    if (!path || !section) return
    const nodes = nodeRefs.current.filter((n): n is HTMLDivElement => n !== null)
    const len = path.getTotalLength()

    const mm = gsap.matchMedia()
    mm.add(
      {
        desktop: '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
        fallback: '(max-width: 767px), (prefers-reduced-motion: reduce)',
      },
      (ctx) => {
        if (ctx.conditions?.desktop) {
          gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })
          gsap.set(nodes, { scale: 0.8, opacity: 0.3 })
          gsap.fromTo(
            headerRef.current,
            { y: 24, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.5,
              ease: 'expo.out',
              scrollTrigger: { trigger: section, start: 'top 65%', once: true },
            },
          )
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: section,
              start: 'top top',
              end: '+=160%',
              scrub: 0.5,
              pin: true,
              anticipatePin: 1,
            },
          })
          tl.to(path, { strokeDashoffset: 0, ease: 'none', duration: 1 }, 0)
          nodes.forEach((n, i) => {
            tl.to(
              n,
              { scale: 1, opacity: 1, ease: 'back.out(1.15)', duration: 0.14 },
              0.06 + i * 0.24,
            )
          })
        } else {
          // Fallback: fully drawn, nodes fade-in staggered
          gsap.fromTo(
            nodes,
            { y: 16, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              stagger: 0.1,
              duration: 0.5,
              ease: 'expo.out',
              scrollTrigger: { trigger: section, start: 'top 80%', once: true },
            },
          )
        }
      },
    )
    return () => mm.revert()
  }, [])

  return (
    <section
      id="for-clients"
      ref={sectionRef}
      className="flex min-h-[100dvh] scroll-mt-0 flex-col justify-center bg-cream py-20 md:py-0"
    >
      <div ref={headerRef} className="mx-auto max-w-[1080px] px-5 text-center md:px-8">
        <p className="text-micro font-bold uppercase text-clay">One booking, both sides</p>
        <h2 className="mt-3 font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
          From tap to chair in four steps.
        </h2>
      </div>

      <div className="relative mx-auto mt-12 w-full max-w-[1080px] px-5 md:mt-16 md:px-8">
        {/* clay connector snaking through the nodes (desktop) */}
        <svg
          viewBox="0 0 1000 160"
          className="pointer-events-none absolute inset-x-8 top-1/2 hidden h-40 -translate-y-1/2 md:block"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            ref={pathRef}
            d="M60 80 C 150 10, 220 150, 315 80 C 400 15, 465 145, 545 80 C 625 15, 690 145, 780 80 C 850 28, 905 60, 945 78"
            stroke="#B4552B"
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* vertical connector (mobile fallback) */}
        <div
          className="pointer-events-none absolute bottom-8 left-1/2 top-8 w-px bg-clay/40 md:hidden"
          aria-hidden
        />

        <ol className="relative grid gap-10 md:grid-cols-4 md:gap-5">
          {NODES.map((node, i) => (
            <li key={node.title}>
              <div
                ref={(el) => {
                  nodeRefs.current[i] = el
                }}
                className="mx-auto w-full max-w-[240px] rounded-r-lg border border-line bg-surface p-4 text-center shadow-sh-1"
              >
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-r-pill bg-clay-tint text-clay">
                  <node.icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <p className="mt-2.5 text-[13px] font-bold leading-[18px] text-ink">
                  <span className="mr-1.5 text-clay tnum">{i + 1}.</span>
                  {node.title}
                </p>
                {node.art}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
