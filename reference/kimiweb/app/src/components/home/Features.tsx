import { Flag, SlidersHorizontal } from 'lucide-react'
import Reveal from './Reveal'
import { cn } from '@/lib/utils'

/**
 * Section 4 — Feature highlights ("Built for the busy ones"). home.md §4.
 * Each card carries a 160px live mini-illustration built in CSS/SVG with an
 * idle micro-loop (CSS keyframes); loops speed up on card hover.
 */

/* ── 1 · Mini calendar strip (50+ techs) ─────────────────────────── */
const COL_BLOCKS: { top: string; h: string; cls: string }[][] = [
  [{ top: '12%', h: '26%', cls: 'bg-cat-nails-fill' }, { top: '56%', h: '18%', cls: 'bg-cat-hair-fill' }],
  [{ top: '30%', h: '34%', cls: 'bg-cat-lashes-fill' }],
  [{ top: '8%', h: '22%', cls: 'bg-cat-hair-fill' }, { top: '48%', h: '26%', cls: 'bg-cat-nails-fill' }],
  [{ top: '40%', h: '30%', cls: 'bg-cat-nails-fill' }],
  [{ top: '16%', h: '38%', cls: 'bg-cat-lashes-fill' }, { top: '66%', h: '16%', cls: 'bg-cat-hair-fill' }],
  [{ top: '24%', h: '24%', cls: 'bg-cat-nails-fill' }],
  [{ top: '10%', h: '30%', cls: 'bg-cat-hair-fill' }, { top: '58%', h: '22%', cls: 'bg-cat-lashes-fill' }],
  [{ top: '36%', h: '28%', cls: 'bg-cat-nails-fill' }],
  [{ top: '18%', h: '20%', cls: 'bg-cat-lashes-fill' }, { top: '52%', h: '30%', cls: 'bg-cat-nails-fill' }],
  [{ top: '28%', h: '36%', cls: 'bg-cat-hair-fill' }],
  [{ top: '6%', h: '24%', cls: 'bg-cat-nails-fill' }, { top: '44%', h: '20%', cls: 'bg-cat-lashes-fill' }],
  [{ top: '34%', h: '26%', cls: 'bg-cat-hair-fill' }],
]

function MiniCalendar() {
  const cols = [...COL_BLOCKS, ...COL_BLOCKS] // duplicated for the seamless loop
  return (
    <div className="relative h-40 overflow-hidden rounded-r-md border border-line bg-cream/70">
      <img
        src="/avatar-tex.jpg"
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover opacity-[0.08]"
        aria-hidden
      />
      <div className="absolute inset-0 overflow-hidden py-3 pl-3">
        <div className="flex h-full w-max animate-col-drift gap-1.5 group-hover:[animation-duration:9s]">
          {cols.map((blocks, i) => (
            <div
              key={i}
              className={cn(
                'relative h-full w-[26px] shrink-0 rounded-sm border',
                i % COL_BLOCKS.length === 4
                  ? 'border-clay/50 bg-clay-tint'
                  : 'border-line bg-surface',
              )}
            >
              {blocks.map((b, j) => (
                <span
                  key={j}
                  className={cn('absolute inset-x-0.5 rounded-[3px]', b.cls)}
                  style={{ top: b.top, height: b.h }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* horizontal scroll shadow fading at the right edge */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-12"
        style={{ background: 'linear-gradient(90deg, rgba(242,235,224,0), rgba(242,235,224,.95))' }}
        aria-hidden
      />
    </div>
  )
}

/* ── 2 · Same-time services ──────────────────────────────────────── */
function MiniSameTime() {
  return (
    <div className="relative flex h-40 items-center justify-center rounded-r-md border border-line bg-cream/70">
      <div className="relative">
        {/* curved bracket linking the pair */}
        <svg
          viewBox="0 0 120 28"
          className="absolute -top-8 left-1/2 h-7 w-[120px] -translate-x-1/2 animate-bracket-bob"
          fill="none"
          aria-hidden
        >
          <path
            d="M8 26 C 8 10, 30 6, 60 6 C 90 6, 112 10, 112 26"
            stroke="#B4552B"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="1 4"
          />
        </svg>
        <div className="relative flex items-end">
          <div className="relative z-10 -mr-4 h-20 w-24 rounded-r-sm border border-cat-nails-line/50 bg-cat-nails-fill p-2 shadow-sh-1">
            <p className="text-[11px] font-bold text-cat-nails-text">Gel mani</p>
            <p className="text-[10px] font-semibold text-cat-nails-text/70 tnum">10:30</p>
          </div>
          <div className="h-16 w-24 rounded-r-sm border border-cat-hair-line/50 bg-cat-hair-fill p-2 shadow-sh-1">
            <p className="text-[11px] font-bold text-cat-hair-text">Pedi</p>
            <p className="text-[10px] font-semibold text-cat-hair-text/70 tnum">10:30</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── 3 · Request approvals ───────────────────────────────────────── */
function MiniRequest() {
  return (
    <div className="relative flex h-40 items-center justify-center rounded-r-md border border-line bg-cream/70">
      <div className="w-[210px] rounded-r-md border border-line bg-surface p-3.5 shadow-sh-1">
        <div className="flex items-center justify-between">
          <p className="text-micro font-bold uppercase text-amber">New request</p>
          <span className="rounded-r-pill bg-amber-tint px-2 py-0.5 text-[10px] font-bold text-amber">
            Pending
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] font-bold text-ink">Balayage · Any available</p>
        <p className="text-[11px] font-medium text-ink-faint">Tomorrow · prefers afternoon</p>
        <div className="mt-3 flex gap-2">
          <span className="flex h-8 flex-1 animate-accept-pulse items-center justify-center rounded-r-sm bg-clay text-[11.5px] font-bold text-white">
            Accept
          </span>
          <span className="flex h-8 flex-1 items-center justify-center rounded-r-sm border border-line text-[11.5px] font-bold text-ink-soft">
            Propose
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── 4 · Client memory ───────────────────────────────────────────── */
function MiniClientMemory() {
  return (
    <div className="relative flex h-40 items-center justify-center rounded-r-md border border-line bg-cream/70">
      <div className="w-[240px] rounded-r-md border border-line bg-surface p-3.5 shadow-sh-1">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-r-pill bg-cat-nails-fill text-[11px] font-extrabold text-cat-nails-text">
            MP
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-bold text-ink">Maya Patel</p>
            <div className="mt-1 flex gap-1.5">
              <span className="flex items-center gap-1 rounded-r-pill bg-rust-tint px-1.5 py-0.5 text-[9.5px] font-bold text-rust">
                <Flag className="h-2.5 w-2.5" /> Allergy
              </span>
              <span className="flex items-center gap-1 rounded-r-pill bg-cream px-1.5 py-0.5 text-[9.5px] font-bold text-ink-soft">
                <SlidersHorizontal className="h-2.5 w-2.5" /> Prefers quiet
              </span>
            </div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 border-t border-line pt-2.5 text-[10.5px] font-medium text-ink-soft tnum">
          <p className="flex justify-between"><span>Gel-X · full set</span><span className="text-ink-faint">Nov 28</span></p>
          <p className="flex justify-between"><span>Structure fill</span><span className="text-ink-faint">Nov 07</span></p>
          <p className="flex justify-between"><span>Pedi + mani</span><span className="text-ink-faint">Oct 12</span></p>
        </div>
      </div>
    </div>
  )
}

/* ── Section ─────────────────────────────────────────────────────── */
const FEATURES = [
  {
    title: 'A schedule that fits 50+ techs',
    caption: "Columns never shrink below 112px — the calendar scrolls, your eyes don't squint.",
    art: <MiniCalendar />,
  },
  {
    title: 'Same-time services',
    caption: 'Mani and pedi at once, two techs, one checkout.',
    art: <MiniSameTime />,
  },
  {
    title: 'Request approvals',
    caption: 'Online bookings land as requests. Accept, decline, or propose a new time — clients see it instantly.',
    art: <MiniRequest />,
  },
  {
    title: 'Client memory',
    caption: 'Allergies, formulas, no-shows — pinned to every appointment, visible before you book.',
    art: <MiniClientMemory />,
  },
]

const HEADER_WORDS = 'Four things every big salon asked for.'.split(' ')

export default function Features() {
  return (
    <section id="for-salons" className="scroll-mt-20 bg-paper py-20 md:py-24">
      <div className="mx-auto max-w-[1280px] px-5 md:px-8">
        <Reveal variant="words" stagger={0.04} start="top 75%">
          <p className="text-micro font-bold uppercase text-clay">Why Lumina</p>
          <h2 className="mt-3 font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
            {HEADER_WORDS.map((w) => (
              <span key={w} className="inline-block overflow-hidden pb-1 -mb-1 align-top">
                <span data-reveal-word className="inline-block">
                  {w}
                </span>
                <span className="inline-block">&nbsp;</span>
              </span>
            ))}
          </h2>
        </Reveal>

        <Reveal
          className="mt-10 grid gap-5 md:grid-cols-2"
          y={32}
          stagger={0.09}
          start="top 80%"
        >
          {FEATURES.map((f) => (
            <article
              key={f.title}
              data-reveal
              className="group rounded-r-lg border border-line bg-surface p-8 transition-all duration-[250ms] ease-out-expo hover:border-line-strong hover:shadow-sh-2"
            >
              {f.art}
              <h3 className="mt-6 text-[15px] font-bold leading-[22px] text-ink">
                {f.title}
              </h3>
              <p className="mt-1.5 text-small font-medium leading-[18px] text-ink-soft">
                {f.caption}
              </p>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
