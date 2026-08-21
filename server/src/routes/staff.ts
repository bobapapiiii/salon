// ─── Staff-only routes ─────────────────────────────────────────────────────
// Everything here requires a valid Bearer token (see requireStaffAuth) and
// is scoped to req.staff.salonId -- a logged-in user can only ever see or
// change their own salon's data.
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, clients, services, techs, users } from "../db/schema.js";
import { requireStaffAuth } from "../lib/require-auth.js";

// Shared shape for both listing routes below -- join client/tech/service
// names in so neither the Settings panel nor the calendar sync needs N
// follow-up calls per row.
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

  // Everything the calendar (AppointmentBook.tsx) should materialize onto
  // the board: still-pending requests (it places these in the Requests
  // rail, same as any other online request) PLUS anything already
  // confirmed elsewhere (e.g. approved from the Settings panel) that the
  // calendar hasn't pulled onto the board yet. Declined/cancelled rows are
  // deliberately excluded -- nothing to show for those.
  app.get("/api/staff/booking-feed", async (req) => {
    const salonId = req.staff!.salonId;
    const rows = await db
      .select(feedColumns)
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(techs, eq(appointments.techId, techs.id))
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .where(and(eq(appointments.salonId, salonId), inArray(appointments.status, ["requested", "confirmed"])))
      .orderBy(appointments.createdAt);

    return { requests: rows };
  });

  app.post("/api/staff/online-requests/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const salonId = req.staff!.salonId;
    const [appt] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
    if (!appt) return reply.code(404).send({ error: "Request not found" });
    if (appt.status !== "requested") return reply.code(409).send({ error: `Already ${appt.status}` });

    const [updated] = await db
      .update(appointments)
      .set({ status: "confirmed", decidedAt: new Date(), decidedBy: req.staff!.userId })
      .where(eq(appointments.id, id))
      .returning();
    return { appointment: updated };
  });

  app.post("/api/staff/online-requests/:id/decline", async (req, reply) => {
    const { id } = req.params as { id: string };
    const salonId = req.staff!.salonId;
    const [appt] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
    if (!appt) return reply.code(404).send({ error: "Request not found" });
    if (appt.status !== "requested") return reply.code(409).send({ error: `Already ${appt.status}` });

    const [updated] = await db
      .update(appointments)
      .set({ status: "declined", decidedAt: new Date(), decidedBy: req.staff!.userId })
      .where(eq(appointments.id, id))
      .returning();
    return { appointment: updated };
  });
}
