// ─── Catalog routes: categories + services CRUD ───────────────────────────
// Staff-only (see requireStaffAuth), everything scoped to req.staff.salonId.
// Deliberately a dumb persist layer, matching the Phase 1 migration plan:
// color-token assignment for a new category and dollars<->cents conversion
// both stay client-side (in app/src/lib/staff-api.ts), not here -- this file
// just stores whatever shape it's given and hands it back.
//
// Reordering: the frontend's categories-store.ts/services-store.ts have
// always modeled order as "position in the persisted array" (see
// moveCategoryTo/moveServiceTo in SettingsPage.tsx, which recompute a whole
// new array on every drag). Postgres has no array-position concept, so
// sortOrder is a real column and a dedicated reorder endpoint lets the
// frontend translate one drag into one request instead of N individual
// PATCHes -- same pattern the plan calls for on staff-admin.ts's job roles.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { serviceCategories, services } from "../db/schema.js";
import { requireStaffAuth } from "../lib/require-auth.js";

const categoryBody = z.object({
  name: z.string().trim().min(1).max(200),
  hue: z.string().max(50).optional(),
  fill: z.string().max(50).optional(),
  line: z.string().max(50).optional(),
  textColor: z.string().max(50).optional(),
  parentId: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional(),
  onlineExcludedRoleIds: z.array(z.string().uuid()).optional(),
  sortOrder: z.number().int().optional(),
});
const categoryPatchBody = categoryBody.partial();
// Create-only: lets optimistic-UI callers generate the real id up front
// (crypto.randomUUID()) so there's no id to reconcile once the request
// resolves -- the row the client already rendered IS the row the server
// persisted. Never patchable; the primary key never changes after creation.
const categoryCreateBody = categoryBody.extend({ id: z.string().uuid().optional() });

const serviceAddon = z.object({ id: z.string(), name: z.string(), mins: z.number(), price: z.number() });
const serviceBody = z.object({
  name: z.string().trim().min(1).max(200),
  short: z.string().max(200).optional(),
  durationMin: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  categoryId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  bookableOnline: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  teamAffinity: z.string().nullable().optional(),
  addons: z.array(serviceAddon).optional(),
  onlineExcludedRoleIds: z.array(z.string().uuid()).optional(),
  sortOrder: z.number().int().optional(),
});
const servicePatchBody = serviceBody.partial();
const serviceCreateBody = serviceBody.extend({ id: z.string().uuid().optional() });

const reorderBody = z.object({ ids: z.array(z.string().uuid()).min(1) });

export async function catalogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireStaffAuth);

  // ── categories ────────────────────────────────────────────────────────
  app.get("/api/staff/categories", async (req) => {
    const rows = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.salonId, req.staff!.salonId))
      .orderBy(serviceCategories.sortOrder);
    return { categories: rows };
  });

  app.post("/api/staff/categories", async (req, reply) => {
    const parsed = categoryCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    if (parsed.data.parentId) {
      const [parent] = await db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.id, parsed.data.parentId), eq(serviceCategories.salonId, salonId)));
      if (!parent) return reply.code(400).send({ error: "Parent category not found" });
    }

    const [row] = await db
      .insert(serviceCategories)
      .values({ ...parsed.data, salonId })
      .returning();
    return reply.code(201).send({ category: row });
  });

  app.patch("/api/staff/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = categoryPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    if (parsed.data.parentId) {
      if (parsed.data.parentId === id) return reply.code(400).send({ error: "A category cannot be its own parent" });
      const [parent] = await db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.id, parsed.data.parentId), eq(serviceCategories.salonId, salonId)));
      if (!parent) return reply.code(400).send({ error: "Parent category not found" });
    }

    const [row] = await db
      .update(serviceCategories)
      .set(parsed.data)
      .where(and(eq(serviceCategories.id, id), eq(serviceCategories.salonId, salonId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Category not found" });
    return { category: row };
  });

  app.post("/api/staff/categories/reorder", async (req, reply) => {
    const parsed = reorderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    await Promise.all(
      parsed.data.ids.map((id, i) =>
        db.update(serviceCategories).set({ sortOrder: i }).where(and(eq(serviceCategories.id, id), eq(serviceCategories.salonId, salonId))),
      ),
    );
    return { ok: true };
  });

  app.delete("/api/staff/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const salonId = req.staff!.salonId;
    // Defense in depth: the frontend already blocks deleting a category with
    // services in it, but this route may end up called directly someday.
    const [inUse] = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.categoryId, id), eq(services.salonId, salonId), eq(services.active, true)));
    if (inUse) return reply.code(409).send({ error: "Category still has active services" });

    const [row] = await db
      .delete(serviceCategories)
      .where(and(eq(serviceCategories.id, id), eq(serviceCategories.salonId, salonId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Category not found" });
    return { ok: true };
  });

  // ── services ──────────────────────────────────────────────────────────
  app.get("/api/staff/services", async (req) => {
    const rows = await db
      .select()
      .from(services)
      .where(eq(services.salonId, req.staff!.salonId))
      .orderBy(services.sortOrder);
    return { services: rows };
  });

  app.post("/api/staff/services", async (req, reply) => {
    const parsed = serviceCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    if (parsed.data.categoryId) {
      const [cat] = await db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.id, parsed.data.categoryId), eq(serviceCategories.salonId, salonId)));
      if (!cat) return reply.code(400).send({ error: "Category not found" });
    }

    const [row] = await db
      .insert(services)
      .values({ ...parsed.data, salonId })
      .returning();
    return reply.code(201).send({ service: row });
  });

  app.patch("/api/staff/services/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = servicePatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    if (parsed.data.categoryId) {
      const [cat] = await db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.id, parsed.data.categoryId), eq(serviceCategories.salonId, salonId)));
      if (!cat) return reply.code(400).send({ error: "Category not found" });
    }

    const [row] = await db
      .update(services)
      .set(parsed.data)
      .where(and(eq(services.id, id), eq(services.salonId, salonId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Service not found" });
    return { service: row };
  });

  app.post("/api/staff/services/reorder", async (req, reply) => {
    const parsed = reorderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;
    await Promise.all(
      parsed.data.ids.map((id, i) =>
        db.update(services).set({ sortOrder: i }).where(and(eq(services.id, id), eq(services.salonId, salonId))),
      ),
    );
    return { ok: true };
  });

  app.delete("/api/staff/services/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const salonId = req.staff!.salonId;
    const [row] = await db
      .delete(services)
      .where(and(eq(services.id, id), eq(services.salonId, salonId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Service not found" });
    return { ok: true };
  });
}
