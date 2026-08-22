// ─── Staff-only routes ─────────────────────────────────────────────────────
// Everything here requires a valid Bearer token (see requireStaffAuth) and
// is scoped to req.staff.salonId -- a logged-in user can only ever see or
// change their own salon's data.
//
// Phase 2 note: booking-feed and the approve/decline actions used to live
// here -- they're superseded by routes/appointments.ts's
// GET /api/staff/day/:dateKey (day-bundle fetch) and
// POST /api/staff/appointments/:id/status (transition-validated, generalizes
// approve/decline to the full status lifecycle) now that online requests
// and calendar appointments are the same row. GET /online-requests stays --
// it's still useful as a flat "all pending requests across days" list
// independent of the calendar's per-day scoping (Settings panel keeps
// working unchanged).
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, clients, services, techs, users } from "../db/schema.js";
import { requireStaffAuth } from "../lib/require-auth.js";

// Shared shape for the pending-requests listing below -- join client/tech/
// service names in so the Settings panel doesn't need N follow-up calls.
const feedColumns = {
  id: appointments.id,
  dateKey: appointments.dateKey,
  startMin: appointments.startMin,
  durationMin: appointments.durationMin,
  status: appointments.status,
  clientNote: appointments.clientNote,
  createdAt: appointments.createdAt,
  clientName: clients.name,
  clientPhone: clients.phone,
  techName: techs.name,
  serviceName: services.name,
  servicePriceCents: services.priceCents,
  // Phase 2: the Settings panel's Confirm/Decline buttons now go through
  // POST /api/staff/appointments/:id/status (optimistic-concurrency,
  // transition-validated), which requires expectedVersion.
  version: appointments.version,
};

export async function staffRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireStaffAuth);

  app.get("/api/staff/me", async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.staff!.userId));
    if (!user) return { user: null };
    return { user: { id: user.id, name: user.name, email: user.email, title: user.title, salonId: user.salonId } };
  });

  // Pending online-booking requests for this salon, newest first. What the
  // Settings → Online requests panel shows.
  app.get("/api/staff/online-requests", async (req) => {
    const salonId = req.staff!.salonId;
    const rows = await db
      .select(feedColumns)
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(techs, eq(appointments.techId, techs.id))
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .where(and(eq(appointments.salonId, salonId), eq(appointments.status, "requested")))
      .orderBy(appointments.createdAt);

    return { requests: rows };
  });
}
