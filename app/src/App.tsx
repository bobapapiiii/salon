import { useEffect } from 'react'
import { AppointmentBook } from '@/components/book/AppointmentBook'
import { TechPortal } from '@/components/book/TechPortal'
import { StaffLoginScreen } from '@/components/book/StaffLoginScreen'
import { BookingPage } from '@/components/public/BookingPage'
import { setSessionUser, useSessionUserId } from '@/lib/session'
import { useStaffAuth } from '@/lib/auth'
import { isArchived, useStaffStore } from '@/lib/staff-store'
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

export default function App() {
  const userId = useSessionUserId()
  const auth = useStaffAuth()
  const { techs } = useStaffStore()
  const clock = useSettingsStore().general.clockFormat
  useEffect(() => setClockFormat(clock), [clock])

  const bookingSlug = publicBookingSlug()
  if (bookingSlug) {
    return <BookingPage slug={bookingSlug} />
  }

  // a tech-portal override wins regardless of staff sign-in state -- it's a
  // separate, still-local-only mechanism (see session.ts)
  const techUser = techs.find((t) => t.id === userId && t.loginEnabled && t.active !== false && !isArchived(t))
  if (techUser) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <TechPortal key={techUser.id} tech={techUser} onSignOut={() => setSessionUser('')} />
      </div>
    )
  }

  if (!auth) {
    return <StaffLoginScreen />
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppointmentBook key={auth.user.id} />
    </div>
  )
}
