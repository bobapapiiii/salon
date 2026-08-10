import type { ReactNode } from 'react'
import Navbar from './Navbar'
import Footer from './Footer'

/**
 * Layout for the home route ONLY (home.md §1, §8).
 * The salon/client shells use Outlet-based nested routes and do NOT use this.
 * The nav is a fixed overlay over the full-bleed hero, so the hero owns its
 * own top spacing — no offset bookkeeping here (react-dev.md nav contract).
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-paper text-ink">
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
