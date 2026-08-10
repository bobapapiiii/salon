import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Home top nav — home.md §1 / design.md §7.1 HomeShell.
 * Fixed 64px, transparent over hero → surface + sh-1 + line border after 24px
 * of scroll (200ms cross-fade). Mobile: hamburger → full-screen overlay menu.
 */

const LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'For Salons', href: '#for-salons' },
  { label: 'For Clients', href: '#for-clients' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <motion.header
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'fixed inset-x-0 top-0 z-50 h-16 transition-all duration-200',
          scrolled
            ? 'border-b border-line bg-surface shadow-sh-1'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between px-5 md:px-8">
          <Link to="/" aria-label="Lumina — home">
            <img src="/logo.svg" alt="Lumina" className="h-7 w-auto" />
          </Link>

          {/* Center links (desktop) */}
          <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="group relative text-[13px] font-semibold text-ink-soft transition-colors duration-200 hover:text-ink"
              >
                {l.label}
                <span className="absolute -bottom-1.5 left-0 h-0.5 w-0 bg-clay transition-all duration-200 group-hover:w-full" />
              </a>
            ))}
          </nav>

          {/* Right actions */}
          <div className="hidden items-center gap-3 md:flex">
            <Link
              to="/salon/schedule"
              className="flex h-10 items-center rounded-r-md px-4 text-sm font-semibold text-ink-soft transition-colors duration-150 hover:bg-cream hover:text-ink"
            >
              Salon sign in
            </Link>
            <Link
              to="/book"
              className="flex h-10 items-center rounded-r-md bg-clay px-4 text-sm font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0"
            >
              Book an appointment
            </Link>
          </div>

          {/* Hamburger (mobile) */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-r-md text-ink transition-colors hover:bg-cream md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </motion.header>

      {/* Mobile full-screen overlay menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex flex-col bg-paper md:hidden"
          >
            <div className="flex h-16 items-center justify-between px-5">
              <img src="/logo.svg" alt="Lumina" className="h-7 w-auto" />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-r-md text-ink hover:bg-cream"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col justify-center gap-2 px-8" aria-label="Mobile">
              {LINKS.map((l, i) => (
                <motion.a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  initial={{ y: 16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="border-b border-line py-4 font-display text-[28px] font-semibold text-ink"
                >
                  {l.label}
                </motion.a>
              ))}
              <motion.div
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.28, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="mt-8 flex flex-col gap-3"
              >
                <Link
                  to="/book"
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center justify-center rounded-r-md bg-clay text-[15px] font-semibold text-white"
                >
                  Book an appointment
                </Link>
                <Link
                  to="/salon/schedule"
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center justify-center rounded-r-md border border-line bg-surface text-[15px] font-semibold text-ink"
                >
                  Salon sign in
                </Link>
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
