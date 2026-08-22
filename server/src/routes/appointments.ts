// ─── Calendar core: appointments, time blocks, tech daily schedule
// overrides ──────────────────────────────────────────────────────────────
// Phase 2 of the localStorage -> Postgres migration. Staff-only
// (requireStaffAuth), everything scoped to req.staff.salonId. See the
// Phase 2 plan section for the full design rationale; this file
// implements §4 (routes) end to end.
//
// Column-vs-jsonb split for appointments mirrors staff-admin.ts's
// techs.profile precedent: known/queried fields are real columns, the
// rest round-trips through `profile`, shallow-merged into the API
// response so the frontend keeps sending/receiving one flat
// Appointment-shaped object. `log` is its own jsonb column (not part of
// `profile`) since it's always present and has a fixed array shape.
//
// Optimistic concurrency: every mutating call below (general PATCH,
// /status, /move, block PATCH) requires the caller's `expectedVersion`.
// The update only applies if it still matches
// (`... where id = $1 and version = $2 returning *`); a 409 always
// carries the CURRENT server row so the client can reconcile without a
// second round trip instead of silently clobbering a concurrent edit.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, clients, services, techDayOverrides, techs, timeBlocks } from "../db/schema.js";
import { requireStaffAuth } from "../lib/require-auth.js";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const apptAddon = z.object({ id: z.string(), name: z.string(), mins: z.number(), price: z.number() });
const apptLogEntry = z.object({ at: z.number(), text: z.string() });

const APPT_STATUSES = [
  "requested",
  "confirmed",
  "booked",
  "checked_in",
  "in_service",
  "completed",
  "checked_out",
  "no_show",
  "cancelled",
  "declined",
] as const;

// Which statuses a given status may move to via POST /:id/status. A
// same-status "transition" (X -> X) is always allowed regardless of this
// map -- treated as an idempotent confirmation, not a real state change
// (covers the "completed -> completed" reopen-adjacent no-op the plan
// calls out without needing a special-cased entry for it). cancelled and
// declined are terminal: nothing transitions out of them, and there is no
// DELETE endpoint for appointments at all -- cancel/decline are the only
// ways an appointment leaves the active board, and both are soft status
// writes so a second terminal (or a refresh) never loses the row.
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  // "cancelled" here (alongside the normal confirmed/declined decision)
  // covers approveRequest's unplaced-at-approval-time fallback in
  // AppointmentBook.tsx: the requested slot turned out to be taken, so the
  // original row is cancelled and a brand-new confirmed appointment gets
  // created once staff drags it from the approved-queue rail onto a real
  // slot -- same "no hard deletes, only soft status writes" rule as every
  // other removal in that file's commit() diff-translator.
  requested: ["confirmed", "declined", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  booked: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_service", "cancelled", "no_show"],
  in_service: ["completed", "cancelled"],
  completed: ["checked_out"],
  checked_out: [],
  no_show: [],
  cancelled: [],
  declined: [],
};

// Real columns on `appointments` a general PATCH/create body may set
// directly, keyed by the WIRE field name (matches apptRowToApi's response
// shape both ways -- bookingSource in, bookingSource out, even though the
// underlying column is `source`; see splitApptBody). `status` is
// deliberately included only for CREATE (see apptCreateBody) -- a general
// PATCH must never be able to move status, that's what /:id/status's
// transition-validated endpoint is for.
const APPT_COLUMN_KEYS = new Set([
  "techId",
  "clientId",
  "clientName",
  "serviceId",
  "dateKey",
  "startMin",
  "durationMin",
  "bookingSource",
  "clientNote",
  "staffNote",
  "parallelGroup",
  "issue",
  "addons",
  "log",
]);

const apptBaseFields = {
  techId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().trim().min(1).max(200),
  serviceId: z.string().uuid(),
  dateKey: z.string().regex(DATE_KEY),
  startMin: z.number().int().min(0).max(1440),
  durationMin: z.number().int().positive(),
  bookingSource: z.string().max(50).optional(),
  clientNote: z.string().nullable().optional(),
  staffNote: z.string().nullable().optional(),
  parallelGroup: z.string().nullable().optional(),
  issue: z.boolean().optional(),
  addons: z.array(apptAddon).optional(),
  log: z.array(apptLogEntry).optional(),
};

// Create-only id override, same optimistic-UI id-up-front pattern every
// Phase 1 table uses -- the client generates crypto.randomUUID() so
// there's zero id reconciliation once the request resolves.
const apptCreateBody = z
  .object({ id: z.string().uuid().optional(), status: z.enum(APPT_STATUSES).optional(), ...apptBaseFields })
  .catchall(z.unknown());

// General patch: every field optional, `status` NOT accepted here (see
// APPT_COLUMN_KEYS comment), `expectedVersion` required on every write.
const apptPatchBody = z
  .object({
    techId: apptBaseFields.techId.optional(),
    clientId: apptBaseFields.clientId,
    clientName: apptBaseFields.clientName.optional(),
    serviceId: apptBaseFields.serviceId.optional(),
    dateKey: apptBaseFields.dateKey.optional(),
    startMin: apptBaseFields.startMin.optional(),
    durationMin: apptBaseFields.durationMin.optional(),
    bookingSource: apptBaseFields.bookingSource,
    clientNote: apptBaseFields.clientNote,
    staffNote: apptBaseFields.staffNote,
    parallelGroup: apptBaseFields.parallelGroup,
    issue: apptBaseFields.issue,
    addons: apptBaseFields.addons,
    log: apptBaseFields.log,
    expectedVersion: z.number().int(),
  })
  .catchall(z.unknown());

// Same optional content fields as apptPatchBody (minus dateKey -- a
// status change never also relocates the appointment to a different day
// in this app; see commit()'s diff-translator in AppointmentBook.tsx),
// so a status transition and its accompanying edits (a log entry, a
// checkedInMin/startedMin/completedMin stamp, even a techId reassignment
// for approve-and-place) land in ONE request instead of two that would
// race each other on the same expectedVersion.
const apptStatusBody = z
  .object({
    status: z.enum(APPT_STATUSES),
    expectedVersion: z.number().int(),
    techId: apptBaseFields.techId.optional(),
    clientId: apptBaseFields.clientId,
    clientName: apptBaseFields.clientName.optional(),
    serviceId: apptBaseFields.serviceId.optional(),
    startMin: apptBaseFields.startMin.optional(),
    durationMin: apptBaseFields.durationMin.optional(),
    bookingSource: apptBaseFields.bookingSource,
    clientNote: apptBaseFields.clientNote,
    staffNote: apptBaseFields.staffNote,
    parallelGroup: apptBaseFields.parallelGroup,
    issue: apptBaseFields.issue,
    addons: apptBaseFields.addons,
    log: apptBaseFields.log,
  })
  .catchall(z.unknown());

const apptMoveBody = z.object({
  techId: z.string().uuid().optional(),
  dateKey: z.string().regex(DATE_KEY).optional(),
  startMin: z.number().int().min(0).max(1440).optional(),
  expectedVersion: z.number().int(),
});

/** Split an incoming appointment-shaped body into { columns, profile },
 *  same convention staff-admin.ts's splitTechPatch established: known
 *  fields go to real columns, everything else (notes, guestOf,
 *  priceOverride, requestedTechChoice, techRequested, genderMismatchOk,
 *  checkedInMin/startedMin/completedMin, customFields, walkinOrigin, and
 *  any other frontend-only field) falls into the jsonb catch-all. */
function splitApptBody(body: Record<string, unknown>) {
  const columns: Record<string, unknown> = {};
  const profile: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "id" || key === "expectedVersion" || key === "status") continue;
    else if (key === "bookingSource") columns.source = value;
    else if (APPT_COLUMN_KEYS.has(key)) columns[key] = value;
    else profile[key] = value;
  }
  return { columns: columns as Partial<typeof appointments.$inferInsert>, profile };
}

/** Reassemble the flat Appointment-shaped object the frontend expects:
 *  real columns (with `source` presented as `bookingSource`, matching
 *  booking-types.ts's field name) plus `profile`'s catch-all fields. */
function apptRowToApi(row: typeof appointments.$inferSelect) {
  const profile = (row.profile ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    techId: row.techId,
    clientId: row.clientId,
    clientName: row.clientName,
    serviceId: row.serviceId,
    dateKey: row.dateKey,
    startMin: row.startMin,
    durationMin: row.durationMin,
    status: row.status,
    bookingSource: row.source,
    clientNote: row.clientNote,
    staffNote: row.staffNote,
    parallelGroup: row.parallelGroup,
    issue: row.issue,
    addons: row.addons,
    log: row.log,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    ...profile,
  };
}

function blockRowToApi(row: typeof timeBlocks.$inferSelect) {
  return {
    id: row.id,
    techId: row.techId,
    dateKey: row.dateKey,
    startMin: row.startMin,
    durationMin: row.durationMin,
    reason: row.reason,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function overrideRowToApi(row: typeof techDayOverrides.$inferSelect) {
  return {
    techId: row.techId,
    dateKey: row.dateKey,
    status: row.status,
    startMin: row.startMin,
    endMin: row.endMin,
    notes: row.notes,
  };
}

async function techBelongsToSalon(techId: string, salonId: string) {
  const [row] = await db.select({ id: techs.id }).from(techs).where(and(eq(techs.id, techId), eq(techs.salonId, salonId)));
  return !!row;
}
async function serviceBelongsToSalon(serviceId: string, salonId: string) {
  const [row] = await db.select({ id: services.id }).from(services).where(and(eq(services.id, serviceId), eq(services.salonId, salonId)));
  return !!row;
}
async function clientBelongsToSalon(clientId: string, salonId: string) {
  const [row] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)));
  return !!row;
}

// Typed as Set<string> deliberately -- a.status below comes off the DB as
// a plain string (the column has no literal-union type), so narrowing this
// to the filtered literal union would just force an unsound cast at the
// call site instead of a real check.
const ACTIVE_APPT_STATUSES: Set<string> = new Set(APPT_STATUSES.filter((s) => s !== "cancelled" && s !== "declined"));

/** True if [startMin, startMin+durationMin) overlaps any other active
 *  appointment for the same tech/day. Used by /move -- create/general
 *  PATCH don't run this check today (matching the existing frontend,
 *  which lets staff deliberately double-book/overlap via drag when
 *  needed); /move is the one path the plan calls out for a server-side
 *  clash-check since it's the highest-frequency, latency-sensitive
 *  mutation and the one optimistic concurrency exists for. */
async function findClash(salonId: string, techId: string, dateKey: string, startMin: number, durationMin: number, excludeId: string) {
  const rows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.salonId, salonId), eq(appointments.techId, techId), eq(appointments.dateKey, dateKey)));
  return rows.find(
    (a) =>
      a.id !== excludeId &&
      ACTIVE_APPT_STATUSES.has(a.status) &&
      startMin < a.startMin + a.durationMin &&
      a.startMin < startMin + durationMin,
  );
}

export async function appointmentsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireStaffAuth);

  // ── day bundle: everything the calendar's goDay() needs in one round
  // trip, replacing three separate Record<dateKey,...> reads. ────────────
  app.get("/api/staff/day/:dateKey", async (req, reply) => {
    const { dateKey } = req.params as { dateKey: string };
    if (!DATE_KEY.test(dateKey)) return reply.code(400).send({ error: "dateKey must be YYYY-MM-DD" });
    const salonId = req.staff!.salonId;

    const [apptRows, blockRows, overrideRows] = await Promise.all([
      db.select().from(appointments).where(and(eq(appointments.salonId, salonId), eq(appointments.dateKey, dateKey))),
      db.select().from(timeBlocks).where(and(eq(timeBlocks.salonId, salonId), eq(timeBlocks.dateKey, dateKey))),
      db.select().from(techDayOverrides).where(and(eq(techDayOverrides.salonId, salonId), eq(techDayOverrides.dateKey, dateKey))),
    ]);

    return {
      appointments: apptRows.map(apptRowToApi),
      blocks: blockRows.map(blockRowToApi),
      scheduleOverrides: overrideRows.map(overrideRowToApi),
    };
  });

  // ── appointments ──────────────────────────────────────────────────────
  app.post("/api/staff/appointments", async (req, reply) => {
    const parsed = apptCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    const d = parsed.data;

    if (!(await techBelongsToSalon(d.techId, salonId))) return reply.code(400).send({ error: "Tech not found" });
    if (!(await serviceBelongsToSalon(d.serviceId, salonId))) return reply.code(400).send({ error: "Service not found" });
    if (d.clientId && !(await clientBelongsToSalon(d.clientId, salonId))) return reply.code(400).send({ error: "Client not found" });

    const { columns, profile } = splitApptBody(d as Record<string, unknown>);
    const [row] = await db
      .insert(appointments)
      .values({
        ...columns,
        ...(d.id ? { id: d.id } : {}),
        salonId,
        techId: d.techId,
        clientName: d.clientName,
        serviceId: d.serviceId,
        dateKey: d.dateKey,
        startMin: d.startMin,
        durationMin: d.durationMin,
        // Calendar-created appointments default to front_desk/booked --
        // distinct from routes/booking.ts's public insert, which always
        // sets online/requested itself and never hits this route.
        source: d.bookingSource ?? "front_desk",
        status: d.status ?? "booked",
        profile,
        updatedBy: req.staff!.userId,
      })
      .returning();
    return reply.code(201).send({ appointment: apptRowToApi(row) });
  });

  app.patch("/api/staff/appointments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = apptPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    const { expectedVersion, ...rest } = parsed.data;

    const [existing] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
    if (!existing) return reply.code(404).send({ error: "Appointment not found" });

    if (rest.techId && !(await techBelongsToSalon(rest.techId, salonId))) return reply.code(400).send({ error: "Tech not found" });
    if (rest.serviceId && !(await serviceBelongsToSalon(rest.serviceId, salonId))) return reply.code(400).send({ error: "Service not found" });
    if (rest.clientId && !(await clientBelongsToSalon(rest.clientId, salonId))) return reply.code(400).send({ error: "Client not found" });

    const { columns, profile } = splitApptBody(rest as Record<string, unknown>);
    const mergedProfile = { ...(existing.profile as Record<string, unknown>), ...profile };

    const [row] = await db
      .update(appointments)
      .set({ ...columns, profile: mergedProfile, version: sql`${appointments.version} + 1`, updatedAt: new Date(), updatedBy: req.staff!.userId })
      .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId), eq(appointments.version, expectedVersion)))
      .returning();

    if (!row) {
      const [current] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
      if (!current) return reply.code(404).send({ error: "Appointment not found" });
      return reply.code(409).send({ error: "Changed by someone else -- refreshed", appointment: apptRowToApi(current) });
    }
    return { appointment: apptRowToApi(row) };
  });

  app.post("/api/staff/appointments/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = apptStatusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    const { status, expectedVersion, ...rest } = parsed.data;

    const [existing] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
    if (!existing) return reply.code(404).send({ error: "Appointment not found" });

    if (status !== existing.status && !(STATUS_TRANSITIONS[existing.status] ?? []).includes(status)) {
      return reply.code(409).send({ error: `Cannot move from ${existing.status} to ${status}`, appointment: apptRowToApi(existing) });
    }

    if (rest.techId && !(await techBelongsToSalon(rest.techId as string, salonId))) return reply.code(400).send({ error: "Tech not found" });
    if (rest.serviceId && !(await serviceBelongsToSalon(rest.serviceId as string, salonId))) return reply.code(400).send({ error: "Service not found" });
    if (rest.clientId && !(await clientBelongsToSalon(rest.clientId as string, salonId))) return reply.code(400).send({ error: "Client not found" });

    const { columns, profile } = splitApptBody(rest as Record<string, unknown>);
    const mergedProfile = { ...(existing.profile as Record<string, unknown>), ...profile };

    // decidedAt/decidedBy mean "the online request was decided" -- only
    // set on the requested -> confirmed/declined transition specifically,
    // unchanged from the pre-Phase-2 approve/decline routes. A plain
    // calendar status change never touches them.
    const decidedFields =
      existing.status === "requested" && (status === "confirmed" || status === "declined")
        ? { decidedAt: new Date(), decidedBy: req.staff!.userId }
        : {};

    const [row] = await db
      .update(appointments)
      .set({ ...columns, profile: mergedProfile, status, ...decidedFields, version: sql`${appointments.version} + 1`, updatedAt: new Date(), updatedBy: req.staff!.userId })
      .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId), eq(appointments.version, expectedVersion)))
      .returning();

    if (!row) {
      const [current] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
      if (!current) return reply.code(404).send({ error: "Appointment not found" });
      return reply.code(409).send({ error: "Changed by someone else -- refreshed", appointment: apptRowToApi(current) });
    }
    return { appointment: apptRowToApi(row) };
  });

  app.post("/api/staff/appointments/:id/move", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = apptMoveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    const { techId, dateKey, startMin, expectedVersion } = parsed.data;

    const [existing] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
    if (!existing) return reply.code(404).send({ error: "Appointment not found" });

    const targetTechId = techId ?? existing.techId;
    const targetDateKey = dateKey ?? existing.dateKey;
    const targetStartMin = startMin ?? existing.startMin;
    if (techId && !(await techBelongsToSalon(techId, salonId))) return reply.code(400).send({ error: "Tech not found" });

    const clash = await findClash(salonId, targetTechId, targetDateKey, targetStartMin, existing.durationMin, id);
    if (clash) return reply.code(409).send({ error: "That slot is already booked", appointment: apptRowToApi(existing) });

    const [row] = await db
      .update(appointments)
      .set({
        techId: targetTechId,
        dateKey: targetDateKey,
        startMin: targetStartMin,
        version: sql`${appointments.version} + 1`,
        updatedAt: new Date(),
        updatedBy: req.staff!.userId,
      })
      .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId), eq(appointments.version, expectedVersion)))
      .returning();

    if (!row) {
      const [current] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)));
      if (!current) return reply.code(404).send({ error: "Appointment not found" });
      return reply.code(409).send({ error: "Changed by someone else -- refreshed", appointment: apptRowToApi(current) });
    }
    return { appointment: apptRowToApi(row) };
  });

  // ── time blocks ───────────────────────────────────────────────────────
  app.get("/api/staff/blocks", async (req) => {
    const salonId = req.staff!.salonId;
    const { dateKey, techId } = req.query as { dateKey?: string; techId?: string };
    const conds = [eq(timeBlocks.salonId, salonId)];
    if (dateKey) conds.push(eq(timeBlocks.dateKey, dateKey));
    if (techId) conds.push(eq(timeBlocks.techId, techId));
    const rows = await db.select().from(timeBlocks).where(and(...conds));
    return { blocks: rows.map(blockRowToApi) };
  });

  const blockCreateBody = z.object({
    id: z.string().uuid().optional(),
    techId: z.string().uuid(),
    dateKey: z.string().regex(DATE_KEY),
    startMin: z.number().int().min(0).max(1440),
    durationMin: z.number().int().positive(),
    reason: z.string().max(500).optional(),
  });
  app.post("/api/staff/blocks", async (req, reply) => {
    const parsed = blockCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    if (!(await techBelongsToSalon(parsed.data.techId, salonId))) return reply.code(400).send({ error: "Tech not found" });

    const [row] = await db
      .insert(timeBlocks)
      .values({ ...parsed.data, salonId, updatedBy: req.staff!.userId })
      .returning();
    return reply.code(201).send({ block: blockRowToApi(row) });
  });

  const blockPatchBody = z.object({
    techId: z.string().uuid().optional(),
    dateKey: z.string().regex(DATE_KEY).optional(),
    startMin: z.number().int().min(0).max(1440).optional(),
    durationMin: z.number().int().positive().optional(),
    reason: z.string().max(500).optional(),
    expectedVersion: z.number().int(),
  });
  app.patch("/api/staff/blocks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = blockPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    const { expectedVersion, ...columns } = parsed.data;

    const [row] = await db
      .update(timeBlocks)
      .set({ ...columns, version: sql`${timeBlocks.version} + 1`, updatedAt: new Date(), updatedBy: req.staff!.userId })
      .where(and(eq(timeBlocks.id, id), eq(timeBlocks.salonId, salonId), eq(timeBlocks.version, expectedVersion)))
      .returning();

    if (!row) {
      const [current] = await db.select().from(timeBlocks).where(and(eq(timeBlocks.id, id), eq(timeBlocks.salonId, salonId)));
      if (!current) return reply.code(404).send({ error: "Block not found" });
      return reply.code(409).send({ error: "Changed by someone else -- refreshed", block: blockRowToApi(current) });
    }
    return { block: blockRowToApi(row) };
  });

  app.delete("/api/staff/blocks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const salonId = req.staff!.salonId;
    const [row] = await db.delete(timeBlocks).where(and(eq(timeBlocks.id, id), eq(timeBlocks.salonId, salonId))).returning();
    if (!row) return reply.code(404).send({ error: "Block not found" });
    return { ok: true };
  });

  // ── tech daily schedule overrides ────────────────────────────────────
  app.get("/api/staff/schedule-overrides", async (req) => {
    const salonId = req.staff!.salonId;
    const { dateKey, from, to } = req.query as { dateKey?: string; from?: string; to?: string };
    const conds = [eq(techDayOverrides.salonId, salonId)];
    if (dateKey) conds.push(eq(techDayOverrides.dateKey, dateKey));
    if (from) conds.push(gte(techDayOverrides.dateKey, from));
    if (to) conds.push(lte(techDayOverrides.dateKey, to));
    const rows = await db.select().from(techDayOverrides).where(and(...conds));
    return { scheduleOverrides: rows.map(overrideRowToApi) };
  });

  const overrideUpsertBody = z.object({
    status: z.enum(["working", "off", "vacation", "emergency", "late", "early"]),
    startMin: z.number().int().min(0).max(1440).nullable().optional(),
    endMin: z.number().int().min(0).max(1440).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  });
  // Pure upsert by natural key (techId, dateKey) -- matches setTechDay's
  // existing shallow-merge-upsert semantics exactly. No expectedVersion:
  // see the schema note on techDayOverrides for why this table skips
  // optimistic locking.
  app.put("/api/staff/schedule-overrides/:techId/:dateKey", async (req, reply) => {
    const { techId, dateKey } = req.params as { techId: string; dateKey: string };
    if (!DATE_KEY.test(dateKey)) return reply.code(400).send({ error: "dateKey must be YYYY-MM-DD" });
    const parsed = overrideUpsertBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    if (!(await techBelongsToSalon(techId, salonId))) return reply.code(400).send({ error: "Tech not found" });

    const [existing] = await db
      .select()
      .from(techDayOverrides)
      .where(and(eq(techDayOverrides.techId, techId), eq(techDayOverrides.dateKey, dateKey)));

    const row = existing
      ? (
          await db
            .update(techDayOverrides)
            .set(parsed.data)
            .where(eq(techDayOverrides.id, existing.id))
            .returning()
        )[0]
      : (
          await db
            .insert(techDayOverrides)
            .values({ ...parsed.data, salonId, techId, dateKey })
            .returning()
        )[0];
    return { scheduleOverride: overrideRowToApi(row) };
  });

  app.delete("/api/staff/schedule-overrides/:techId/:dateKey", async (req) => {
    const { techId, dateKey } = req.params as { techId: string; dateKey: string };
    const salonId = req.staff!.salonId;
    await db
      .delete(techDayOverrides)
      .where(and(eq(techDayOverrides.techId, techId), eq(techDayOverrides.dateKey, dateKey), eq(techDayOverrides.salonId, salonId)));
    return { ok: true };
  });
}
