import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Reveal from './Reveal'

/**
 * Section 3 — Entry cards ("Choose your side"). home.md §3.
 * Whole card clickable via stretched-link over the primary CTA; the secondary
 * link sits above it (z-10).
 */

interface CardSpec {
  badge: string
  image: string
  alt: string
  title: string
  body: string
  micro: string[]
  cta: { label: string; to: string }
  link: { label: string; to: string }
}

const CARDS: CardSpec[] = [
  {
    badge: 'Salon side',
    image: '/entry-salon.jpg',
    alt: 'Front-desk still life — appointment book, espresso and dried flowers',
    title: 'Run the floor.',
    body: 'Day schedule for the whole team, drag-and-drop rebooking, request approvals, client flags — readable at 50+ techs.',
    micro: ['Grouped tech columns', 'Same-time services', 'Undo on everything'],
    cta: { label: 'Open dashboard', to: '/salon/schedule' },
    link: { label: 'See requests', to: '/salon/requests' },
  },
  {
    badge: 'Client side',
    image: '/entry-client.jpg',
    alt: 'Fresh manicured hands resting beside a coffee',
    title: 'Book in a minute.',
    body: 'Pick services, choose a favorite technician or any available, grab a real-time slot. No account required.',
    micro: ['Same-time mani + pedi', 'Real availability', 'Rebook in 3 taps'],
    cta: { label: 'Book an appointment', to: '/book' },
    link: { label: 'My appointments', to: '/book/appointments' },
  },
]

function EntryCard({ card }: { card: CardSpec }) {
  return (
    <article
      data-reveal
      className="group relative h-[480px] overflow-hidden rounded-r-xl shadow-sh-1 transition-all duration-[250ms] ease-out-expo hover:-translate-y-1 hover:shadow-sh-3"
    >
      {/* bg image + scrim */}
      <img
        src={card.image}
        alt={card.alt}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out-expo group-hover:scale-[1.04]"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(36,28,21,0) 30%, rgba(36,28,21,.82))',
        }}
        aria-hidden
      />

      {/* badge */}
      <span
        data-reveal
        className="absolute right-5 top-5 rounded-r-pill bg-surface/90 px-3 py-1.5 text-micro font-bold uppercase text-ink backdrop-blur-sm"
      >
        {card.badge}
      </span>

      {/* bottom content */}
      <div className="absolute inset-x-0 bottom-0 p-7">
        <h2 className="font-display text-[28px] font-semibold leading-8 text-white">
          {card.title}
        </h2>
        <p className="mt-2.5 max-w-[42ch] text-small font-medium leading-[18px] text-white/80">
          {card.body}
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-micro font-bold uppercase text-white/60">
          {card.micro.map((m, i) => (
            <span key={m} className="flex items-center gap-2.5">
              {i > 0 && <span className="h-1 w-1 rounded-full bg-white/40" aria-hidden />}
              {m}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-4">
          <span className="flex h-10 items-center rounded-r-md bg-white px-4 text-sm font-semibold text-clay transition-colors duration-150 group-hover:bg-clay-tint">
            {card.cta.label}
            <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </span>
          <Link
            to={card.link.to}
            className="relative z-10 text-sm font-semibold text-white/85 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            {card.link.label} →
          </Link>
        </div>
      </div>

      {/* stretched link over the whole card (primary CTA) */}
      <Link to={card.cta.to} aria-label={card.cta.label} className="absolute inset-0" />
    </article>
  )
}

export default function EntryCards() {
  return (
    <section id="platform" className="scroll-mt-20 bg-paper py-20 md:py-24">
      <Reveal
        className="mx-auto grid max-w-[1280px] gap-6 px-5 md:grid-cols-2 md:px-8"
        y={48}
        stagger={0.12}
        start="top 80%"
      >
        {CARDS.map((c) => (
          <EntryCard key={c.badge} card={c} />
        ))}
      </Reveal>
    </section>
  )
}
