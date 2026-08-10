import useLenis from '@/hooks/useLenis'
import Hero from '@/components/home/Hero'
import EntryCards from '@/components/home/EntryCards'
import Features from '@/components/home/Features'
import ConnectionDiagram from '@/components/home/ConnectionDiagram'
import StatsBand from '@/components/home/StatsBand'
import FinalCta from '@/components/home/FinalCta'

/**
 * Home — `/` (home.md). Product entry page routing users to the two sides.
 * Rendered inside HomeShell (Navbar + Footer via Layout).
 */
export default function Home() {
  useLenis()

  return (
    <>
      <Hero />
      <EntryCards />
      <Features />
      <ConnectionDiagram />
      <StatsBand />
      <FinalCta />
    </>
  )
}
