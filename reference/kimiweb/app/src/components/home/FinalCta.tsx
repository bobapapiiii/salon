import { Link } from 'react-router-dom'
import Reveal from './Reveal'

/**
 * Section 7 — Final CTA. home.md §7. The clay primary idles with a soft 2.8s
 * pulse ring that pauses on hover.
 */
export default function FinalCta() {
  return (
    <section className="bg-paper py-24">
      <Reveal className="mx-auto max-w-[640px] px-5 text-center" y={20} stagger={0.09} start="top 75%">
        <h2
          data-reveal
          className="font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink"
        >
          See both sides.
        </h2>
        <div data-reveal className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/salon/schedule"
            className="flex h-11 animate-pulse-ring items-center rounded-r-md bg-clay px-5 text-sm font-semibold text-white transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep hover:[animation-play-state:paused] active:translate-y-0"
          >
            Open the salon dashboard
          </Link>
          <Link
            to="/book"
            className="flex h-11 items-center rounded-r-md border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-cream"
          >
            Book as a client
          </Link>
        </div>
        <p data-reveal className="mt-6 text-micro font-bold uppercase text-ink-faint">
          Demo environment · Lumina Salon · all data resets nightly
        </p>
      </Reveal>
    </section>
  )
}
