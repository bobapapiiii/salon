import type { BookingItem } from './store'
import type { ClientAppt } from './useCatalog'

/**
 * Build booking-store items from an existing appointment ("Book again" /
 * "Reschedule" prefills). Same-time groups keep their pairing.
 */
export function itemsFromAppointment(appt: ClientAppt): BookingItem[] {
  const sorted = [...appt.items].sort((a, b) => a.startMin - b.startMin)
  const groupStart = sorted[0]?.startMin ?? 0
  return sorted.map((it, idx) => ({
    serviceId: it.serviceId,
    mode:
      idx > 0 && appt.sameTimeGroupId && it.startMin === groupStart
        ? ('same-time' as const)
        : ('back-to-back' as const),
    staffId: it.staffId ?? it.requestedStaffId ?? null,
  }))
}
