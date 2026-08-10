import { useEffect } from 'react'
import { AppointmentBook } from '@/components/book/AppointmentBook'
import { TechPortal } from '@/components/book/TechPortal'
import { DEMO_USERS, setSessionUser, useSessionUserId } from '@/lib/session'
import { isArchived, useStaffStore } from '@/lib/staff-store'
import { useSettingsStore } from '@/lib/settings-store'
import { setClockFormat } from '@/lib/booking-types'

export default function App() {
  const userId = useSessionUserId()
  const { techs } = useStaffStore()
  const clock = useSettingsStore().general.clockFormat
  useEffect(() => setClockFormat(clock), [clock])
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
