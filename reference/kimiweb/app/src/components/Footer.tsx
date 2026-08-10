import { Link } from 'react-router-dom'

/**
 * Home footer — home.md §8. Night bg, faint arch band across the top edge,
 * 3 columns (brand / Salon / Client) + bottom micro row.
 */

const SALON_LINKS = [
  { label: 'Dashboard', to: '/salon/schedule' },
  { label: 'Requests', to: '/salon/requests' },
  { label: 'Services', to: '/salon/services' },
  { label: 'Clients', to: '/salon/clients' },
]

const CLIENT_LINKS = [
  { label: 'Book', to: '/book' },
  { label: 'My appointments', to: '/book/appointments' },
  { label: 'Account', to: '/book/account' },
]

export default function Footer() {
  return (
    <footer className="relative bg-night">
      {/* faint arch band across the top edge */}
      <div className="arch-pattern h-10 w-full opacity-[0.10] invert" aria-hidden />
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 pb-10 pt-6 md:grid-cols-[1.4fr_1fr_1fr] md:px-8">
        <div>
          {/* logo inverted to cream */}
          <img
            src="/logo.svg"
            alt="Lumina"
            className="h-7 w-auto brightness-0 invert-[0.92] sepia-[0.15]"
          />
          <p className="mt-4 max-w-[30ch] text-sm leading-6 text-white/60">
            Two-sided booking for salons that run on time.
          </p>
        </div>
        <nav aria-label="Salon">
          <p className="text-micro font-bold uppercase text-white/40">Salon</p>
          <ul className="mt-4 space-y-2.5">
            {SALON_LINKS.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className="group relative text-sm font-medium text-white/75 transition-colors hover:text-white"
                >
                  {l.label}
                  <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-clay transition-all duration-[180ms] group-hover:w-full" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Client">
          <p className="text-micro font-bold uppercase text-white/40">Client</p>
          <ul className="mt-4 space-y-2.5">
            {CLIENT_LINKS.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className="group relative text-sm font-medium text-white/75 transition-colors hover:text-white"
                >
                  {l.label}
                  <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-clay transition-all duration-[180ms] group-hover:w-full" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-1 px-5 py-5 text-micro font-bold uppercase text-white/40 md:flex-row md:items-center md:justify-between md:px-8">
          <span>© Lumina Salon — demo platform</span>
          <span>Made for the front desk</span>
        </div>
      </div>
    </footer>
  )
}
