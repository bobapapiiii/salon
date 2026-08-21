// ─── Staff roster admin: job roles + techs CRUD ───────────────────────────
// Distinct from routes/staff.ts, which is online-request approval, not
// roster management. Staff-only (requireStaffAuth), scoped to
// req.staff.salonId throughout.
//
// Tech field split (see the Phase 1 migration plan's "jsonb-vs-columns"
// section): only fields actually queried/joined/reported-on are real
// columns (name, jobRoleId, active, archived, bookableOnline, phone, email,
// commissionPct) plus the `skills` join table. Everything else in the
// frontend's much richer Tech shape (documents, weekly schedule, time off,
// per-service overrides, address, PIN, etc) round-trips through one
// catch-all `profile` jsonb column, shallow-merged over the real columns on
// every read/write here -- invisible to the frontend, which keeps sending
// and receiving one flat Tech-shaped object. `skills` is fully
// client-computed (role services + extraSkills, see staff-store.ts's
// syncSkills) -- this file does not reimplement that merge, it just
// persists whatever array it's given as the tech's full skill set.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { jobRoles, jobRoleServices, techs, techSkills } from "../db/schema.js";
import { requireStaffAuth } from "../lib/require-auth.js";

// Frontend Tech fields that are real columns (plus `skills`, handled via the
// join table, and `teamId`, which maps to the jobRoleId column).
const TECH_COLUMN_KEYS = new Set(["name", "active", "archived", "bookableOnline", "phone", "email", "commissionPct"]);

const jobRoleBody = z.object({
  name: z.string().trim().min(1).max(200),
  serviceIds: z.array(z.string().uuid()).optional(),
  sortOrder: z.number().int().optional(),
});
const jobRolePatchBody = jobRoleBody.partial();
// Create-only id override -- see catalog.ts's categoryCreateBody comment;
// same optimistic-UI id-up-front pattern applies to every Phase 1 table.
const jobRoleCreateBody = jobRoleBody.extend({ id: z.string().uuid().optional() });
const reorderBody = z.object({ ids: z.array(z.string().uuid()).min(1) });

const techCreateBody = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    teamId: z.string().uuid(),
    skills: z.array(z.string().uuid()).optional(),
    active: z.boolean().optional(),
    archived: z.boolean().optional(),
    bookableOnline: z.boolean().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    commissionPct: z.number().nullable().optional(),
  })
  .catchall(z.unknown());

const techPatchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    teamId: z.string().uuid().optional(),
    skills: z.array(z.string().uuid()).optional(),
    active: z.boolean().optional(),
    archived: z.boolean().optional(),
    bookableOnline: z.boolean().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    commissionPct: z.number().nullable().optional(),
  })
  .catchall(z.unknown());

/** Split an incoming Tech-shaped patch into { columns, profile }. `teamId`
 *  becomes `jobRoleId`; `skills` is handled by the caller separately (it's
 *  a join table, not a column or a profile key); everything else not a
 *  known column falls into the jsonb catch-all. */
function splitTechPatch(body: Record<string, unknown>) {
  const columns: Record<string, unknown> = {};
  const profile: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "id" || key === "skills") continue;
    else if (key === "teamId") columns.jobRoleId = value;
    else if (TECH_COLUMN_KEYS.has(key)) columns[key] = value;
    else profile[key] = value;
  }
  // Cast once here: `columns` is built dynamically from whatever known keys
  // were present on this particular request, so it can never satisfy
  // Drizzle's exact insert/update shape structurally -- the runtime values
  // are still exactly what TECH_COLUMN_KEYS + `teamId` allow through above.
  return { columns: columns as Partial<typeof techs.$inferInsert>, profile };
}

/** Reassemble the flat Tech-shaped object the frontend expects: known
 *  columns plus `teamId`/`skills`, with `profile`'s catch-all fields
 *  (initials, firstName, weeklySchedule, pin, etc) merged over them. */
function techRowToTech(row: typeof techs.$inferSelect, skillServiceIds: string[]) {
  const profile = (row.profile ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    teamId: row.jobRoleId,
    skills: skillServiceIds,
    active: row.active,
    archived: row.archived,
    bookableOnline: row.bookableOnline,
    phone: row.phone,
    email: row.email,
    commissionPct: row.commissionPct,
    ...profile,
  };
}

async function replaceTechSkills(techId: string, serviceIds: string[]) {
  await db.delete(techSkills).where(eq(techSkills.techId, techId));
  if (serviceIds.length > 0) {
    await db.insert(techSkills).values(serviceIds.map((serviceId) => ({ techId, serviceId })));
  }
}

async function techSkillIds(techId: string): Promise<string[]> {
  const rows = await db.select({ serviceId: techSkills.serviceId }).from(techSkills).where(eq(techSkills.techId, techId));
  return rows.map((r) => r.serviceId);
}

export async function staffAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireStaffAuth);

  // ── job roles ─────────────────────────────────────────────────────────
  app.get("/api/staff/job-roles", async (req) => {
    const salonId = req.staff!.salonId;
    const roles = await db.select().from(jobRoles).where(eq(jobRoles.salonId, salonId)).orderBy(jobRoles.sortOrder);
    const links = roles.length
      ? await db.select().from(jobRoleServices).where(inArray(jobRoleServices.jobRoleId, roles.map((r) => r.id)))
      : [];
    return {
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        sortOrder: r.sortOrder,
        serviceIds: links.filter((l) => l.jobRoleId === r.id).map((l) => l.serviceId),
      })),
    };
  });

  app.post("/api/staff/job-roles", async (req, reply) => {
    const parsed = jobRoleCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    const [row] = await db
      .insert(jobRoles)
      .values({ ...(parsed.data.id ? { id: parsed.data.id } : {}), name: parsed.data.name, salonId, sortOrder: parsed.data.sortOrder ?? 0 })
      .returning();
    const serviceIds = parsed.data.serviceIds ?? [];
    if (serviceIds.length > 0) {
      await db.insert(jobRoleServices).values(serviceIds.map((serviceId) => ({ jobRoleId: row.id, serviceId })));
    }
    return reply.code(201).send({ role: { id: row.id, name: row.name, sortOrder: row.sortOrder, serviceIds } });
  });

  app.patch("/api/staff/job-roles/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = jobRolePatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    const { serviceIds, ...columns } = parsed.data;
    const [row] = Object.keys(columns).length
      ? await db.update(jobRoles).set(columns).where(and(eq(jobRoles.id, id), eq(jobRoles.salonId, salonId))).returning()
      : await db.select().from(jobRoles).where(and(eq(jobRoles.id, id), eq(jobRoles.salonId, salonId)));
    if (!row) return reply.code(404).send({ error: "Job role not found" });

    if (serviceIds) {
      await db.delete(jobRoleServices).where(eq(jobRoleServices.jobRoleId, id));
      if (serviceIds.length > 0) await db.insert(jobRoleServices).values(serviceIds.map((serviceId) => ({ jobRoleId: id, serviceId })));

      // A role's service list changing doesn't change any tech's stored
      // skills automatically -- syncSkills() is a frontend concern (it
      // recomputes and PATCHes techs.skills itself right after this call).
    }
    const finalServiceIds =
      serviceIds ?? (await db.select({ serviceId: jobRoleServices.serviceId }).from(jobRoleServices).where(eq(jobRoleServices.jobRoleId, id))).map((r) => r.serviceId);
    return { role: { id: row.id, name: row.name, sortOrder: row.sortOrder, serviceIds: finalServiceIds } };
  });

  app.post("/api/staff/job-roles/reorder", async (req, reply) => {
    const parsed = reorderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    await Promise.all(
      parsed.data.ids.map((id, i) => db.update(jobRoles).set({ sortOrder: i }).where(and(eq(jobRoles.id, id), eq(jobRoles.salonId, salonId)))),
    );
    return { ok: true };
  });

  app.delete("/api/staff/job-roles/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const salonId = req.staff!.salonId;
    const [inUse] = await db.select({ id: techs.id }).from(techs).where(and(eq(techs.jobRoleId, id), eq(techs.salonId, salonId)));
    if (inUse) return reply.code(409).send({ error: "A technician is still assigned to this role" });

    const [row] = await db.delete(jobRoles).where(and(eq(jobRoles.id, id), eq(jobRoles.salonId, salonId))).returning();
    if (!row) return reply.code(404).send({ error: "Job role not found" });
    return { ok: true };
  });

  // ── techs ─────────────────────────────────────────────────────────────
  app.get("/api/staff/techs", async (req) => {
    const salonId = req.staff!.salonId;
    const rows = await db.select().from(techs).where(eq(techs.salonId, salonId));
    const skillRows = rows.length ? await db.select().from(techSkills).where(inArray(techSkills.techId, rows.map((t) => t.id))) : [];
    return {
      techs: rows.map((row) => techRowToTech(row, skillRows.filter((s) => s.techId === row.id).map((s) => s.serviceId))),
    };
  });

  app.post("/api/staff/techs", async (req, reply) => {
    const parsed = techCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    const [role] = await db.select().from(jobRoles).where(and(eq(jobRoles.id, parsed.data.teamId), eq(jobRoles.salonId, salonId)));
    if (!role) return reply.code(400).send({ error: "Job role not found" });

    const { columns, profile } = splitTechPatch(parsed.data);
    const skills = parsed.data.skills ?? [];
    const [row] = await db
      .insert(techs)
      .values({
        ...columns,
        ...(parsed.data.id ? { id: parsed.data.id } : {}),
        name: parsed.data.name,
        salonId,
        jobRoleId: role.id,
        title: role.name,
        profile,
      })
      .returning();
    await replaceTechSkills(row.id, skills);
    return reply.code(201).send({ tech: techRowToTech(row, skills) });
  });

  app.patch("/api/staff/techs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = techPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    const [existing] = await db.select().from(techs).where(and(eq(techs.id, id), eq(techs.salonId, salonId)));
    if (!existing) return reply.code(404).send({ error: "Tech not found" });

    const { columns, profile } = splitTechPatch(parsed.data);
    let title: string | undefined;
    if (typeof columns.jobRoleId === "string") {
      const [role] = await db.select().from(jobRoles).where(and(eq(jobRoles.id, columns.jobRoleId), eq(jobRoles.salonId, salonId)));
      if (!role) return reply.code(400).send({ error: "Job role not found" });
      title = role.name;
    }

    const mergedProfile = { ...(existing.profile as Record<string, unknown>), ...profile };
    const [row] = await db
      .update(techs)
      .set({ ...columns, ...(title ? { title } : {}), profile: mergedProfile })
      .where(and(eq(techs.id, id), eq(techs.salonId, salonId)))
      .returning();

    if (parsed.data.skills) await replaceTechSkills(id, parsed.data.skills);
    const skills = parsed.data.skills ?? (await techSkillIds(id));
    return { tech: techRowToTech(row, skills) };
  });
}
