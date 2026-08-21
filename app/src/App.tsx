import { useEffect } from 'react'
import { AppointmentBook } from '@/components/book/AppointmentBook'
import { TechPortal } from '@/components/book/TechPortal'
import { BookingPage } from '@/components/public/BookingPage'
import { DEMO_USERS, setSessionUser, useSessionUserId } from '@/lib/session'
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
  const { techs } = useStaffStore()
  const clock = useSettingsStore().general.clockFormat
  useEffect(() => setClockFormat(clock), [clock])

  const bookingSlug = publicBookingSlug()
  if (bookingSlug) {
    return <BookingPage slug={bookingSlug} />
  }

  const techUser = techs.find((t) => t.id === userId && t.loginEnabled && t.active !== false && !isArchived(t))
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      {techUser ? (
        <TechPortal key={techUser.id} tech={techUser} onSignOut={() => setSessionUser(DEMO_USERS[0].id)} />
      ) : (
        <AppointmentBook key={userId} />
      )}
    </div>
  )
}
