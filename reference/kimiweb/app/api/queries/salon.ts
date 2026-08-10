import { getDb } from "./connection";
import {
  staff,
  serviceCategories,
  services,
  staffServices,
  clients,
  clientNotes,
  appointments,
  appointmentServices,
  bookingRequests,
  bookingRequestItems,
  type Appointment,
} from "@db/schema";
import { and, asc, desc, eq, like, ne, or, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export async function getSalon() {
  const db = getDb();
  const salon = await db.query.salons.findFirst();
  if (!salon) throw new TRPCError({ code: "NOT_FOUND", message: "No salon seeded" });
  return salon;
}

// ---------- Staff ----------
export async function listStaff(salonId: number) {
  const db = getDb();
  const rows = await db.query.staff.findMany({
    where: eq(staff.salonId, salonId),
    with: { schedules: true, staffServices: true },
    orderBy: [asc(staff.roleGroup), asc(staff.name)],
  });
  return rows.map((s) => ({
    ...s,
    serviceIds: s.staffServices.map((x) => x.serviceId),
    schedules: s.schedules.map((x) => ({
      dayOfWeek: x.dayOfWeek,
      startMin: x.startMin,
      endMin: x.endMin,
    })),
    staffServices: undefined,
  }));
}

// ---------- Services ----------
export async function listServices(salonId: number) {
  const db = getDb();
  const cats = await db.query.serviceCategories.findMany({
    where: eq(serviceCategories.salonId, salonId),
    orderBy: [asc(serviceCategories.sortOrder)],
    with: { services: { with: { staffServices: true } } },
  });
  return cats.map((c) => ({
    ...c,
    services: c.services.map((s) => ({
      ...s,
      staffIds: s.staffServices.map((x) => x.staffId),
      staffServices: undefined,
    })),
  }));
}

export async function createService(
  salonId: number,
  data: {
    categoryId: number;
    name: string;
    description?: string;
    durationMin: number;
    processingMin?: number;
    bufferMin?: number;
    priceCents: number;
    onlineBookable?: boolean;
    requiresApproval?: boolean;
    staffIds?: number[];
  },
) {
  const db = getDb();
  const { staffIds, ...svcData } = data;
  const [{ id }] = await db
    .insert(services)
    .values({ salonId, ...svcData })
    .$returningId();
  if (staffIds?.length) {
    await db
      .insert(staffServices)
      .values(staffIds.map((staffId) => ({ staffId, serviceId: id })));
  }
  return { id };
}

export async function updateService(
  id: number,
  data: Partial<{
    name: string;
    description: string;
    durationMin: number;
    processingMin: number;
    bufferMin: number;
    priceCents: number;
    onlineBookable: boolean;
    requiresApproval: boolean;
    active: boolean;
  }>,
  staffIds?: number[],
) {
  const db = getDb();
  await db.update(services).set(data).where(eq(services.id, id));
  if (staffIds) {
    await db.delete(staffServices).where(eq(staffServices.serviceId, id));
    if (staffIds.length) {
      await db
        .insert(staffServices)
        .values(staffIds.map((staffId) => ({ staffId, serviceId: id })));
    }
  }
}

// ---------- Clients ----------
export async function listClients(salonId: number, search?: string) {
  const db = getDb();
  const where = search
    ? and(
        eq(clients.salonId, salonId),
        or(
          like(clients.firstName, `%${search}%`),
          like(clients.lastName, `%${search}%`),
          like(clients.phone, `%${search}%`),
        ),
      )
    : eq(clients.salonId, salonId);
  return db.query.clients.findMany({
    where,
    with: { notes: true },
    orderBy: [asc(clients.firstName)],
    limit: 200,
  });
}

export async function getClient(id: number) {
  const db = getDb();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, id),
    with: {
      notes: true,
      appointments: {
        with: { items: { with: { service: true, staff: true } } },
        orderBy: [desc(appointments.date)],
        limit: 50,
      },
    },
  });
  if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  return client;
}

export async function createClient(
  salonId: number,
  data: { firstName: string; lastName: string; phone?: string; email?: string; notes?: string },
) {
  const db = getDb();
  const [{ id }] = await db.insert(clients).values({ salonId, ...data }).$returningId();
  return { id };
}

export async function updateClient(
  id: number,
  data: Partial<{ firstName: string; lastName: string; phone: string; email: string; notes: string; blocked: boolean }>,
) {
  await getDb().update(clients).set(data).where(eq(clients.id, id));
}

export async function addClientNote(
  clientId: number,
  note: { kind: "allergy" | "alert" | "preference" | "general"; text: string; pinned?: boolean },
) {
  const db = getDb();
  const [{ id }] = await db.insert(clientNotes).values({ clientId, ...note }).$returningId();
  return { id };
}

// ---------- Appointments ----------
export async function listAppointmentsByDate(salonId: number, date: string) {
  const db = getDb();
  return db.query.appointments.findMany({
    where: and(eq(appointments.salonId, salonId), eq(appointments.date, date)),
    with: {
      client: { with: { notes: true } },
      items: { with: { service: true, staff: true, requestedStaff: true } },
    },
    orderBy: [asc(appointments.startMin)],
  });
}

export async function listClientAppointments(clientId: number) {
  const db = getDb();
  return db.query.appointments.findMany({
    where: and(eq(appointments.clientId, clientId), ne(appointments.status, "cancelled")),
    with: { items: { with: { service: true, staff: true } } },
    orderBy: [desc(appointments.date), desc(appointments.startMin)],
    limit: 100,
  });
}

type ItemInput = {
  serviceId: number;
  staffId?: number | null;
  requestedStaffId?: number | null;
  anyStaff?: boolean;
  startMin: number;
};

async function loadServices(ids: number[]) {
  const db = getDb();
  return db.query.services.findMany({ where: inArray(services.id, ids) });
}

export async function createAppointment(
  salonId: number,
  data: {
    clientId: number;
    date: string;
    items: ItemInput[];
    source?: "front-desk" | "online" | "walk-in";
    status?: Appointment["status"];
    noteToSalon?: string;
    internalNote?: string;
    sameTimeGroupId?: string;
  },
) {
  const db = getDb();
  const svcRows = await loadServices(data.items.map((i) => i.serviceId));
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));
  const segments = data.items.map((i) => {
    const svc = svcMap.get(i.serviceId);
    if (!svc) throw new TRPCError({ code: "BAD_REQUEST", message: `Service ${i.serviceId} not found` });
    return {
      serviceId: i.serviceId,
      staffId: i.staffId ?? null,
      requestedStaffId: i.requestedStaffId ?? null,
      anyStaff: i.anyStaff ?? false,
      startMin: i.startMin,
      endMin: i.startMin + svc.durationMin,
      durationMin: svc.durationMin,
      processingMin: svc.processingMin,
      bufferMin: svc.bufferMin,
      priceCents: svc.priceCents,
    };
  });
  const startMin = Math.min(...segments.map((s) => s.startMin));
  const endMin = Math.max(...segments.map((s) => s.endMin));

  await assertNoConflicts(data.date, segments);

  return db.transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(appointments)
      .values({
        salonId,
        clientId: data.clientId,
        date: data.date,
        startMin,
        endMin,
        status: data.status ?? "confirmed",
        source: data.source ?? "front-desk",
        noteToSalon: data.noteToSalon,
        internalNote: data.internalNote,
        sameTimeGroupId: data.sameTimeGroupId,
      })
      .$returningId();
    await tx
      .insert(appointmentServices)
      .values(segments.map((s) => ({ ...s, appointmentId: id })));
    return { id };
  });
}

/** Busy intervals for a staff member on a date: [start, end) pairs the tech is NOT free. */
function staffBusyIntervals(apptSegments: { startMin: number; endMin: number; processingMin: number; bufferMin: number }[]) {
  const busy: [number, number][] = [];
  for (const s of apptSegments) {
    const workEnd = s.endMin - s.processingMin; // tech free during processing
    busy.push([s.startMin, workEnd]);
    if (s.bufferMin > 0) busy.push([s.endMin, s.endMin + s.bufferMin]);
  }
  return busy;
}

function isFree(busy: [number, number][], start: number, end: number) {
  return !busy.some(([bs, be]) => start < be && end > bs);
}

/** Throw if any segment overlaps another appointment for the same tech (ignoring processing gaps). */
export async function assertNoConflicts(
  date: string,
  segments: { staffId: number | null; startMin: number; endMin: number; processingMin: number; bufferMin: number }[],
  ignoreAppointmentId?: number,
) {
  const db = getDb();
  for (const seg of segments) {
    if (!seg.staffId) continue;
    const existing = await db
      .select({
        startMin: appointmentServices.startMin,
        endMin: appointmentServices.endMin,
        processingMin: appointmentServices.processingMin,
        bufferMin: appointmentServices.bufferMin,
        apptId: appointmentServices.appointmentId,
        status: appointments.status,
        date: appointments.date,
      })
      .from(appointmentServices)
      .innerJoin(appointments, eq(appointmentServices.appointmentId, appointments.id))
      .where(and(eq(appointmentServices.staffId, seg.staffId), eq(appointments.date, date)));
    const busy = staffBusyIntervals(
      existing.filter(
        (e) =>
          e.apptId !== ignoreAppointmentId &&
          e.status !== "cancelled" &&
          e.status !== "no-show",
      ),
    );
    const workEnd = seg.endMin - seg.processingMin;
    const intervals: [number, number][] = [[seg.startMin, workEnd]];
    if (seg.bufferMin > 0) intervals.push([seg.endMin, seg.endMin + seg.bufferMin]);
    for (const [s, e] of intervals) {
      if (!isFree(busy, s, e)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Time conflict: technician already has an appointment in that window.",
        });
      }
    }
  }
}

export async function rescheduleAppointment(
  appointmentId: number,
  data: { date?: string; startMin?: number; staffId?: number | null },
) {
  const db = getDb();
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
    with: { items: true },
  });
  if (!appt) throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });

  const newDate = data.date ?? appt.date;
  const delta = data.startMin !== undefined ? data.startMin - appt.startMin : 0;
  const newItems = appt.items.map((it) => ({
    ...it,
    staffId: data.staffId !== undefined ? data.staffId : it.staffId,
    startMin: it.startMin + delta,
    endMin: it.endMin + delta,
  }));
  await assertNoConflicts(newDate, newItems, appointmentId);

  await db.transaction(async (tx) => {
    for (const it of newItems) {
      await tx
        .update(appointmentServices)
        .set({ startMin: it.startMin, endMin: it.endMin, staffId: it.staffId })
        .where(eq(appointmentServices.id, it.id));
    }
    await tx
      .update(appointments)
      .set({
        date: newDate,
        startMin: Math.min(...newItems.map((i) => i.startMin)),
        endMin: Math.max(...newItems.map((i) => i.endMin)),
      })
      .where(eq(appointments.id, appointmentId));
  });
}

export async function updateAppointmentStatus(
  appointmentId: number,
  status: Appointment["status"],
) {
  const db = getDb();
  await db.update(appointments).set({ status }).where(eq(appointments.id, appointmentId));
  if (status === "no-show") {
    const appt = await db.query.appointments.findFirst({
      where: eq(appointments.id, appointmentId),
    });
    if (appt) {
      const c = await db.query.clients.findFirst({ where: eq(clients.id, appt.clientId) });
      if (c) {
        await db
          .update(clients)
          .set({ noShowCount: c.noShowCount + 1 })
          .where(eq(clients.id, c.id));
      }
    }
  }
}

// ---------- Booking requests ----------
export async function listBookingRequests(salonId: number, status?: "pending" | "accepted" | "declined" | "countered") {
  const db = getDb();
  const where = status
    ? and(eq(bookingRequests.salonId, salonId), eq(bookingRequests.status, status))
    : eq(bookingRequests.salonId, salonId);
  return db.query.bookingRequests.findMany({
    where,
    with: { client: true, items: { with: { service: true, requestedStaff: true } } },
    orderBy: [desc(bookingRequests.createdAt)],
    limit: 100,
  });
}

export async function listClientRequests(clientId: number) {
  const db = getDb();
  return db.query.bookingRequests.findMany({
    where: eq(bookingRequests.clientId, clientId),
    with: { items: { with: { service: true, requestedStaff: true } } },
    orderBy: [desc(bookingRequests.createdAt)],
    limit: 50,
  });
}

export async function createBookingRequest(
  salonId: number,
  data: {
    clientId: number;
    date: string;
    startMin: number;
    noteToSalon?: string;
    items: { serviceId: number; requestedStaffId?: number | null; anyStaff?: boolean; sameTime?: boolean }[];
  },
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(bookingRequests)
      .values({
        salonId,
        clientId: data.clientId,
        date: data.date,
        startMin: data.startMin,
        noteToSalon: data.noteToSalon,
      })
      .$returningId();
    await tx.insert(bookingRequestItems).values(
      data.items.map((i) => ({
        requestId: id,
        serviceId: i.serviceId,
        requestedStaffId: i.requestedStaffId ?? null,
        anyStaff: i.anyStaff ?? false,
        sameTime: i.sameTime ?? false,
      })),
    );
    return { id };
  });
}

/** Accept a request (optionally with assigned staff) → creates a confirmed appointment. */
export async function acceptBookingRequest(
  requestId: number,
  assignments?: { staffId: number | null }[],
) {
  const db = getDb();
  const req = await db.query.bookingRequests.findFirst({
    where: eq(bookingRequests.id, requestId),
    with: { items: true },
  });
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
  if (req.status !== "pending" && req.status !== "countered") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Request already resolved" });
  }
  const date = req.status === "countered" && req.counterDate ? req.counterDate : req.date;
  const startMin = req.status === "countered" && req.counterStartMin != null ? req.counterStartMin : req.startMin;

  const svcRows = await loadServices(req.items.map((i) => i.serviceId));
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));

  // Chain items back-to-back unless marked same-time
  let cursor = startMin;
  const segs = req.items.map((it, idx) => {
    const svc = svcMap.get(it.serviceId)!;
    const segStart = it.sameTime ? startMin : cursor;
    cursor = it.sameTime ? cursor : segStart + svc.durationMin;
    return {
      serviceId: it.serviceId,
      staffId: assignments?.[idx]?.staffId ?? it.requestedStaffId ?? null,
      requestedStaffId: it.requestedStaffId,
      anyStaff: it.anyStaff,
      startMin: segStart,
      endMin: segStart + svc.durationMin,
      durationMin: svc.durationMin,
      processingMin: svc.processingMin,
      bufferMin: svc.bufferMin,
      priceCents: svc.priceCents,
    };
  });

  await assertNoConflicts(date, segs);

  const result = await db.transaction(async (tx) => {
    const [{ id: apptId }] = await tx
      .insert(appointments)
      .values({
        salonId: req.salonId,
        clientId: req.clientId,
        date,
        startMin: Math.min(...segs.map((s) => s.startMin)),
        endMin: Math.max(...segs.map((s) => s.endMin)),
        status: "confirmed",
        source: "online",
        noteToSalon: req.noteToSalon,
        sameTimeGroupId: segs.some((_, i) => req.items[i].sameTime) ? `st-${requestId}` : null,
      })
      .$returningId();
    await tx.insert(appointmentServices).values(segs.map((s) => ({ ...s, appointmentId: apptId })));
    await tx
      .update(bookingRequests)
      .set({ status: "accepted", appointmentId: apptId })
      .where(eq(bookingRequests.id, requestId));
    return { appointmentId: apptId };
  });
  return result;
}

export async function declineBookingRequest(requestId: number) {
  await getDb()
    .update(bookingRequests)
    .set({ status: "declined" })
    .where(eq(bookingRequests.id, requestId));
}

export async function counterBookingRequest(
  requestId: number,
  counter: { date: string; startMin: number },
) {
  await getDb()
    .update(bookingRequests)
    .set({
      status: "countered",
      counterDate: counter.date,
      counterStartMin: counter.startMin,
    })
    .where(eq(bookingRequests.id, requestId));
}

/** Client declines a counter-offer → request dies. */
export async function clientDeclineCounter(requestId: number) {
  await getDb()
    .update(bookingRequests)
    .set({ status: "declined" })
    .where(eq(bookingRequests.id, requestId));
}

// ---------- Availability engine ----------
export type SlotItem = { serviceId: number; staffId: number | null; staffName: string | null };
export type Slot = { startMin: number; endMin: number; items: SlotItem[] };

/**
 * Compute genuinely-bookable start times for a date.
 * items: ordered services; sameTime items share the group start, others chain back-to-back.
 * staffId: requested tech (applied to all items) or null = any available.
 */
export async function getAvailability(
  salonId: number,
  date: string,
  items: { serviceId: number; sameTime?: boolean }[],
  requestedStaffId?: number | null,
  stepMin = 15,
): Promise<Slot[]> {
  const db = getDb();
  const salon = await getSalon();
  const svcRows = await loadServices(items.map((i) => i.serviceId));
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));
  if (svcRows.length !== items.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown service" });
  }

  const dayOfWeek = new Date(date + "T12:00:00").getDay();

  // Staff working that day, with qualifications
  const staffRows = await db.query.staff.findMany({
    where: and(eq(staff.salonId, salonId), eq(staff.active, true)),
    with: { schedules: true, staffServices: true },
  });
  const working = staffRows
    .map((s) => {
      const sched = s.schedules.find((x) => x.dayOfWeek === dayOfWeek);
      return sched
        ? { ...s, workStart: sched.startMin, workEnd: sched.endMin }
        : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Existing segments that day
  const existing = await db
    .select({
      staffId: appointmentServices.staffId,
      startMin: appointmentServices.startMin,
      endMin: appointmentServices.endMin,
      processingMin: appointmentServices.processingMin,
      bufferMin: appointmentServices.bufferMin,
      status: appointments.status,
    })
    .from(appointmentServices)
    .innerJoin(appointments, eq(appointmentServices.appointmentId, appointments.id))
    .where(and(eq(appointments.salonId, salonId), eq(appointments.date, date)));

  const activeExisting = existing.filter(
    (e) => e.status !== "cancelled" && e.status !== "no-show",
  );
  const busyByStaff = new Map<number, [number, number][]>();
  for (const e of activeExisting) {
    if (!e.staffId) continue;
    const arr = busyByStaff.get(e.staffId) ?? [];
    arr.push(...staffBusyIntervals([e]));
    busyByStaff.set(e.staffId, arr);
  }

  const qualifiedFor = (serviceId: number) =>
    working.filter((s) => s.staffServices.some((x) => x.serviceId === serviceId));

  const slots: Slot[] = [];
  const lastStart = salon.closeMin - 30;

  for (let t = salon.openMin; t <= lastStart; t += stepMin) {
    // Build the item placements at candidate start t
    const placements: { svc: (typeof svcRows)[number]; start: number; sameTime: boolean }[] = [];
    let cursor = t;
    for (const it of items) {
      const svc = svcMap.get(it.serviceId)!;
      const start = it.sameTime ? t : cursor;
      placements.push({ svc, start, sameTime: !!it.sameTime });
      if (!it.sameTime) cursor = start + svc.durationMin;
    }
    const endMin = Math.max(...placements.map((p) => p.start + p.svc.durationMin));
    if (endMin > salon.closeMin) continue;

    // Assign staff per placement
    const usedStaff = new Set<number>();
    const assigned: SlotItem[] = [];
    let ok = true;
    for (const p of placements) {
      const busyNeed: [number, number][] = [[p.start, p.start + p.svc.durationMin - p.svc.processingMin]];
      if (p.svc.bufferMin > 0) {
        const e = p.start + p.svc.durationMin;
        busyNeed.push([e, e + p.svc.bufferMin]);
      }
      let candidates = qualifiedFor(p.svc.id).filter((s) => {
        if (usedStaff.has(s.id)) return false;
        if (p.start < s.workStart || p.start + p.svc.durationMin > s.workEnd) return false;
        const busy = busyByStaff.get(s.id) ?? [];
        return busyNeed.every(([bs, be]) => isFree(busy, bs, be));
      });
      if (requestedStaffId) {
        candidates = candidates.filter((s) => s.id === requestedStaffId);
      }
      if (candidates.length === 0) {
        ok = false;
        break;
      }
      const chosen = requestedStaffId
        ? candidates[0]
        : candidates.sort((a, b) => (busyByStaff.get(a.id)?.length ?? 0) - (busyByStaff.get(b.id)?.length ?? 0))[0];
      usedStaff.add(chosen.id);
      assigned.push({
        serviceId: p.svc.id,
        staffId: requestedStaffId ? requestedStaffId : chosen.id,
        staffName: requestedStaffId ? (chosen?.name ?? null) : chosen.name,
      });
    }
    if (ok) slots.push({ startMin: t, endMin, items: assigned });
  }
  return slots;
}
