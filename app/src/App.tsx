import { useEffect, useState, type ReactNode } from 'react'
import { AppointmentBook } from '@/components/book/AppointmentBook'
import { TechPortal } from '@/components/book/TechPortal'
import { StaffLoginScreen } from '@/components/book/StaffLoginScreen'
import { BookingPage } from '@/components/public/BookingPage'
import { Toaster } from '@/components/ui/sonner'
import { setSessionUser, useSessionUserId } from '@/lib/session'
import { useStaffAuth } from '@/lib/auth'
import { isArchived, isStaffLoaded, useStaffStore } from '@/lib/staff-store'
import { isCategoriesLoaded, useCategoriesStore } from '@/lib/categories-store'
import { isServicesLoaded, useServicesStore } from '@/lib/services-store'
import { isClientsLoaded, useClientsStore } from '@/lib/clients-store'
import { useSettingsStore } from '@/lib/settings-store'
import { setClockFormat } from '@/lib/booking-types'

// The only route this app has: a public online-booking page served at
// /book/:slug, backed by the new server/ API (see booking-api.ts). Everything
// else is the existing session-based single-page app below, unchanged --
// intentionally not pulling in a router just for this one static path.
function publicBookingSlug(): string | null {
  const m = window.location.pathname.match(/^\/book\/([^/]+)\/?$/)
  return m ? decodeURIComponent(m[1]) : null
}

// Phase 1 of the localStorage->Postgres migration moved categories,
// services, staff (job roles + techs), and clients onto the new backend --
// first render now sees empty arrays until those four fetches resolve,
// where before (synchronous localStorage) data was always present
// immediately. Rather than let four stores independently pop in empty ->
// populated (a flash of "no services" then "no techs" etc), wait for all
// four here and show one splash, closer to the old felt experience. Only
// gates the main calendar -- the tech portal and the public booking page
// have their own, much smaller, data needs and don't wait on this.
function AppBootGate({ children }: { children: ReactNode }) {
  useCategoriesStore()
  useServicesStore()
  useStaffStore()
  useClientsStore()
  const ready = isCategoriesLoaded() && isServicesLoaded() && isStaffLoaded() && isClientsLoaded()

  // A failed fetch doesn't itself trigger a re-render (state didn't
  // change), so nothing would otherwise re-invoke the stores' ensureLoaded()
  // retry -- poll a few times a minute while not ready so a transient
  // failure (the API waking from a free-tier cold start, a dropped
  // request) recovers on its own instead of stranding the app on the splash.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (ready) return
    const id = setInterval(() => forceTick((n) => n + 1), 2000)
    return () => clearInterval(id)
  }, [ready])

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Loading your salon…</div>
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  const userId = useSessionUserId()
  const auth = useStaffAuth()
  const { techs } = useStaffStore()
  const clock = useSettingsStore().general.clockFormat
  useEffect(() => setClockFormat(clock), [clock])

  const bookingSlug = publicBookingSlug()
  if (bookingSlug) {
    return (
      <>
        <BookingPage slug={bookingSlug} />
        <Toaster />
      </>
    )
  }

  // a tech-portal override wins regardless of staff sign-in state -- it's a
  // separate, still-local-only mechanism (see session.ts). `techs` starts
  // empty until the staff fetch resolves, so hold on the splash rather than
  // momentarily falling through to the sign-in screen for a session that's
  // actually mid-way into the tech portal.
  if (userId && !isStaffLoaded()) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Loading your salon…</div>
      </div>
    )
  }
  const techUser = techs.find((t) => t.id === userId && t.loginEnabled && t.active !== false && !isArchived(t))
  if (techUser) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <TechPortal key={techUser.id} tech={techUser} onSignOut={() => setSessionUser('')} />
        <Toaster />
      </div>
    )
  }

  if (!auth) {
    return (
      <>
        <StaffLoginScreen />
        <Toaster />
      </>
    )
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppBootGate>
        <AppointmentBook key={auth.user.id} />
      </AppBootGate>
      <Toaster />
    </div>
  )
}
