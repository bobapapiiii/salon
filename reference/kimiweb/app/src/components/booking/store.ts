import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ItemMode = 'same-time' | 'back-to-back'

export interface BookingItem {
  serviceId: number
  /** Only meaningful for items after the first — how they pair with the group. */
  mode: ItemMode
  /** null = "Any available" */
  staffId: number | null
}

export interface SlotItemPicked {
  serviceId: number
  staffId: number | null
  staffName: string | null
}

export interface SlotPick {
  date: string
  startMin: number
  endMin: number
  items: SlotItemPicked[]
}

export interface BookingDetails {
  firstName: string
  lastName: string
  phone: string
  email: string
  note: string
}

export interface RescheduleTarget {
  id: number
  date: string
  startMin: number
}

interface BookingState {
  step: 1 | 2 | 3 | 4
  items: BookingItem[]
  slot: SlotPick | null
  details: BookingDetails
  rescheduleOf: RescheduleTarget | null

  setStep: (step: 1 | 2 | 3 | 4) => void
  toggleService: (serviceId: number) => void
  setItemMode: (serviceId: number, mode: ItemMode) => void
  /** Set the same tech on every item (single-grid flow). */
  setAllStaff: (staffId: number | null) => void
  /** Set tech for one item (per-service same-time sections). */
  setItemStaff: (serviceId: number, staffId: number | null) => void
  setSlot: (slot: SlotPick | null) => void
  setDetails: (patch: Partial<BookingDetails>) => void
  /** "Book again" / "Reschedule" entry — prefills everything, lands on step 3. */
  prefill: (args: {
    items: BookingItem[]
    rescheduleOf?: RescheduleTarget | null
    step?: 1 | 2 | 3 | 4
  }) => void
  reset: () => void
}

const emptyDetails: BookingDetails = { firstName: '', lastName: '', phone: '', email: '', note: '' }

export const useBookingStore = create<BookingState>()(
  persist(
    (set) => ({
      step: 1,
      items: [],
      slot: null,
      details: emptyDetails,
      rescheduleOf: null,

      setStep: (step) => set({ step }),

      toggleService: (serviceId) =>
        set((s) => {
          const exists = s.items.some((i) => i.serviceId === serviceId)
          const items = exists
            ? s.items.filter((i) => i.serviceId !== serviceId)
            : [...s.items, { serviceId, mode: 'back-to-back' as ItemMode, staffId: null }]
          // Any service change invalidates a chosen slot
          return { items, slot: null }
        }),

      setItemMode: (serviceId, mode) =>
        set((s) => ({
          items: s.items.map((i) => (i.serviceId === serviceId ? { ...i, mode } : i)),
          slot: null,
        })),

      setAllStaff: (staffId) =>
        set((s) => ({
          items: s.items.map((i) => ({ ...i, staffId })),
          slot: null,
        })),

      setItemStaff: (serviceId, staffId) =>
        set((s) => ({
          items: s.items.map((i) => (i.serviceId === serviceId ? { ...i, staffId } : i)),
          slot: null,
        })),

      setSlot: (slot) => set({ slot }),

      setDetails: (patch) => set((s) => ({ details: { ...s.details, ...patch } })),

      prefill: ({ items, rescheduleOf = null, step = 3 }) =>
        set({ items, rescheduleOf, step, slot: null }),

      reset: () =>
        set({ step: 1, items: [], slot: null, details: emptyDetails, rescheduleOf: null }),
    }),
    {
      name: 'lumina.booking',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)

/** API-shaped items for availability / requests. */
export function apiItemsOf(items: BookingItem[]): { serviceId: number; sameTime: boolean }[] {
  return items.map((i) => ({ serviceId: i.serviceId, sameTime: i.mode === 'same-time' }))
}

/**
 * The single staffId the availability API accepts: the common pick when all
 * items name the same tech, otherwise null (any) + client-side filtering.
 */
export function commonStaffIdOf(items: BookingItem[]): number | null {
  const ids = new Set(items.map((i) => i.staffId))
  if (ids.size === 1) return items[0]?.staffId ?? null
  return null
}

/** Whether per-item client-side filtering is needed (mixed tech picks). */
export function needsPerItemFilter(items: BookingItem[]): boolean {
  const ids = new Set(items.map((i) => i.staffId))
  return ids.size > 1
}

export interface RawSlot {
  startMin: number
  endMin: number
  items: SlotItemPicked[]
}

/** Keep only slots whose per-item staff assignments match the user's picks. */
export function filterSlotsForPicks<T extends RawSlot>(slots: T[], items: BookingItem[]): T[] {
  if (!needsPerItemFilter(items)) return slots
  return slots.filter((slot) =>
    items.every((it, idx) => {
      if (it.staffId == null) return true
      const assigned = slot.items[idx]
      return assigned != null && assigned.serviceId === it.serviceId && assigned.staffId === it.staffId
    }),
  )
}

/** Per-item start minutes for a picked slot (same-time share start, others chain). */
export function itemStartsOf(
  items: BookingItem[],
  durations: Map<number, number>,
  groupStart: number,
): Map<number, number> {
  const starts = new Map<number, number>()
  let cursor = groupStart
  for (const it of items) {
    const dur = durations.get(it.serviceId) ?? 0
    const start = it.mode === 'same-time' ? groupStart : cursor
    starts.set(it.serviceId, start)
    if (it.mode !== 'same-time') cursor = start + dur
  }
  return starts
}
