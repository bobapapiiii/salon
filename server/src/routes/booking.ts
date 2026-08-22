// ─── Public online-booking routes ─────────────────────────────────────────
// No auth -- these are the endpoints the public /book/:slug page calls.
// Every query is scoped by the salon resolved from :slug, so one salon can
// never see or affect another's data even though there's only one today.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { salons, serviceCategories, services, techs, techSkills, clients, appointments } from "../db/schema.js";
import { computeAvailableSlots, type BusyWindow } from "../lib/availability.js";

async function salonBySlug(slug: string) {
  const [salon] = await db.select().from(salons).where(eq(salons.slug, slug));
  return salon ?? null;
}

const availabilityQuery = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  techId: z.string().uuid().optional(),
});

const createBookingBody = z.object({
  serviceId: z.string().uuid(),
  techId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMin: z.number().int().min(0).max(1440),
  client: z.object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(50),
    email: z.string().trim().email().optional().or(z.literal("")).optional(),
  }),
  note: z.string().trim().max(500).optional(),
});

export async function bookingRoutes(app: FastifyInstance) {
  // Salon info + bookable service/tech catalog, everything the booking
  // page's first screen needs in one call.
  app.get("/api/booking/:slug/info", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const salon = await salonBySlug(slug);
    if (!salon) return reply.code(404).send({ error: "Salon not found" });

    const cats = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.salonId, salon.id));
    const svcRows = await db
      .select()
      .from(services)
      .where(and(eq(services.salonId, salon.id), eq(services.active, true), eq(services.bookableOnline, true)));
    const techRows = await db
      .select()
      .from(techs)
      .where(and(eq(techs.salonId, salon.id), eq(techs.active, true), eq(techs.bookableOnline, true)));
    const skillRows = techRows.length
      ? await db.select().from(techSkills).where(inArray(techSkills.techId, techRows.map((t) => t.id)))
      : [];

    return {
      salon: {
        slug: salon.slug,
        name: salon.name,
        address: salon.address,
        phone: salon.phone,
        website: salon.website,
        timezone: salon.timezone,
        bookingOpenMin: salon.bookingOpenMin,
        bookingCloseMin: salon.bookingCloseMin,
        slotSizeMin: salon.slotSizeMin,
      },
      categories: cats.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
      services: svcRows
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({
          id: s.id,
          categoryId: s.categoryId,
          name: s.name,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
          tags: s.tags,
        })),
      techs: techRows.map((t) => ({
        id: t.id,
        name: t.name,
        title: t.title,
        skillServiceIds: skillRows.filter((s) => s.techId === t.id).map((s) => s.serviceId),
      })),
    };
  });

  // Open time slots for a service (optionally narrowed to one tech) on one day.
  app.get("/api/booking/:slug/availability", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const parsed = availabilityQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    const { serviceId, date, techId } = parsed.data;

    const salon = await salonBySlug(slug);
    if (!salon) return reply.code(404).send({ error: "Salon not found" });

    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.salonId, salon.id), eq(services.active, true)));
    if (!service) return reply.code(404).send({ error: "Service not found" });

    const skilled = await db.select().from(techSkills).where(eq(techSkills.serviceId, serviceId));
    const skilledTechIds = new Set(skilled.map((s) => s.techId));
    const techRows = await db
      .select()
      .from(techs)
      .where(and(eq(techs.salonId, salon.id), eq(techs.active, true), eq(techs.bookableOnline, true)));
    const eligibleTechIds = techRows.filter((t) => skilledTechIds.has(t.id)).map((t) => t.id);
    if (eligibleTechIds.length === 0) return { date, slots: [] };

    const existing = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.salonId, salon.id),
          eq(appointments.dateKey, date),
          inArray(appointments.techId, eligibleTechIds),
          ne(appointments.status, "declined"),
          ne(appointments.status, "cancelled"),
        ),
      );
    const busy: BusyWindow[] = existing.map((a) => ({ techId: a.techId, startMin: a.startMin, durationMin: a.durationMin }));

    // "today" gets a floor at the current salon-local minute so we never
    // offer a slot that's already passed; other dates get no floor. This
    // uses server time, not the salon's timezone -- see server/README.md.
    const todayKey = new Date().toISOString().slice(0, 10);
    const nowFloorMin = date === todayKey ? new Date().getHours() * 60 + new Date().getMinutes() : 0;

    const slots = computeAvailableSlots({
      openMin: salon.bookingOpenMin,
      closeMin: salon.bookingCloseMin,
      slotSizeMin: salon.slotSizeMin,
      serviceDurationMin: service.durationMin,
      eligibleTechIds,
      busy,
      requestedTechId: techId,
      nowFloorMin,
    });

    return { date, slots };
  });

  // Create a booking request. Always lands as status "requested" -- staff
  // approve it from the "Online requests" panel. (A salon that wants
  // instant auto-confirm is a one-line change here; deferred because the
  // frontend's own `settings.booking.autoConfirm` flag isn't wired to this
  // new backend yet, see server/README.md.)
  app.post("/api/booking/:slug/bookings", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const parsed = createBookingBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const { serviceId, techId, date, startMin, client, note } = parsed.data;

    const salon = await salonBySlug(slug);
    if (!salon) return reply.code(404).send({ error: "Salon not found" });

    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.salonId, salon.id), eq(services.active, true)));
    if (!service) return reply.code(404).send({ error: "Service not found" });

    const [tech] = await db.select().from(techs).where(and(eq(techs.id, techId), eq(techs.salonId, salon.id)));
    if (!tech) return reply.code(404).send({ error: "Tech not found" });

    // Re-check the slot is still free server-side -- never trust that the
    // client's earlier /availability call is still true by the time they submit.
    const skilled = await db.select().from(techSkills).where(and(eq(techSkills.techId, techId), eq(techSkills.serviceId, serviceId)));
    if (skilled.length === 0) return reply.code(409).send({ error: "This tech does not perform this service" });

    const clash = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.techId, techId),
          eq(appointments.dateKey, date),
          ne(appointments.status, "declined"),
          ne(appointments.status, "cancelled"),
        ),
      );
    const overlapsExisting = clash.some(
      (a) => startMin < a.startMin + a.durationMin && a.startMin < startMin + service.durationMin,
    );
    if (overlapsExisting) return reply.code(409).send({ error: "That time was just booked -- please pick another slot" });

    // Upsert the client by phone within this salon (simplest dedup key for
    // a walk-in-heavy nail salon; email is optional and often not given).
    let [clientRow] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.salonId, salon.id), eq(clients.phone, client.phone)));
    if (!clientRow) {
      [clientRow] = await db
        .insert(clients)
        .values({ salonId: salon.id, name: client.name, phone: client.phone, email: client.email || null })
        .returning();
    }

    const [appt] = await db
      .insert(appointments)
      .values({
        salonId: salon.id,
        clientId: clientRow.id,
        // clientName is Phase 2's always-present display value on the
        // calendar -- set it here too, not just on calendar-created rows,
        // so an online request never renders with a blank name.
        clientName: clientRow.name,
        techId,
        serviceId,
        dateKey: date,
        startMin,
        durationMin: service.durationMin,
        status: "requested",
        source: "online",
        clientNote: note || null,
      })
      .returning();

    return reply.code(201).send({
      id: appt.id,
      status: appt.status,
      date: appt.dateKey,
      startMin: appt.startMin,
      durationMin: appt.durationMin,
      service: { id: service.id, name: service.name },
      tech: { id: tech.id, name: tech.name },
    });
  });
}
