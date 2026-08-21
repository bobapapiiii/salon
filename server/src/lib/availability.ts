// ─── Online-booking availability ──────────────────────────────────────────
// Deliberately simple for a first pass: fixed salon-wide open/close window,
// fixed slot grid, "does any qualified, bookable-online tech have a free
// slot" -- no per-tech custom hours, no lunch breaks, no buffer time between
// services. All of that is real salon-scheduling depth that the existing
// localStorage calendar (AppointmentBook.tsx) already has for staff-side
// booking; this module intentionally does NOT try to reproduce it, since
// the two aren't unified yet (see server/README.md).
//
// Split into a pure function (`computeAvailableSlots`, easy to unit-test
// without a database) and a thin DB-fetching wrapper the route calls.

export interface BusyWindow {
  techId: string;
  startMin: number;
  durationMin: number;
}

export interface AvailabilityInput {
  openMin: number;
  closeMin: number;
  slotSizeMin: number;
  serviceDurationMin: number;
  eligibleTechIds: string[];
  busy: BusyWindow[];
  /** if the request is "book with a specific tech", narrow to just them */
  requestedTechId?: string;
  /** minutes-from-now floor for "today" (e.g. don't offer a slot 10 minutes
   *  from now); pass 0 for a future date where nothing is in the past yet */
  nowFloorMin?: number;
}

export interface AvailableSlot {
  startMin: number;
  /** tech ids free at this slot, among the eligible/requested set */
  techIds: string[];
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

export function computeAvailableSlots(input: AvailabilityInput): AvailableSlot[] {
  const {
    openMin,
    closeMin,
    slotSizeMin,
    serviceDurationMin,
    eligibleTechIds,
    busy,
    requestedTechId,
    nowFloorMin = 0,
  } = input;

  const techPool = requestedTechId
    ? eligibleTechIds.filter((id) => id === requestedTechId)
    : eligibleTechIds;
  if (techPool.length === 0 || serviceDurationMin <= 0) return [];

  const busyByTech = new Map<string, BusyWindow[]>();
  for (const b of busy) {
    if (!busyByTech.has(b.techId)) busyByTech.set(b.techId, []);
    busyByTech.get(b.techId)!.push(b);
  }

  const slots: AvailableSlot[] = [];
  for (let start = openMin; start + serviceDurationMin <= closeMin; start += slotSizeMin) {
    if (start < nowFloorMin) continue;
    const freeTechs: string[] = [];
    for (const techId of techPool) {
      const techBusy = busyByTech.get(techId) ?? [];
      const clash = techBusy.some((b) => overlaps(start, serviceDurationMin, b.startMin, b.durationMin));
      if (!clash) freeTechs.push(techId);
    }
    if (freeTechs.length > 0) slots.push({ startMin: start, techIds: freeTechs });
  }
  return slots;
}
