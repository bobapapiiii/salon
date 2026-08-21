// ─── Client roster CRUD ─────────────────────────────────────────────────
// Staff-only, scoped to req.staff.salonId. No DELETE (clients are never
// removed, only edited) and no dedicated increment endpoint for `visits` --
// a plain `PATCH {visits: n}` is fine given the existing single-writer-
// per-browser assumption (see the Phase 1 migration plan).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { clients } from "../db/schema.js";
import { requireStaffAuth } from "../lib/require-auth.js";

const preferredTech = z.object({ id: z.string(), techId: z.string(), categoryIds: z.array(z.string()) });
const guest = z.object({ id: z.string(), name: z.string() });

const clientBody = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().max(200).nullable().optional(),
  tags: z.array(z.string()).optional(),
  visits: z.number().int().nonnegative().optional(),
  preferredTechs: z.array(preferredTech).optional(),
  guests: z.array(guest).optional(),
});
const clientPatchBody = clientBody.partial();
// Create-only id override -- see catalog.ts's categoryCreateBody comment.
const clientCreateBody = clientBody.extend({ id: z.string().uuid().optional() });

export async function clientsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireStaffAuth);

  app.get("/api/staff/clients", async (req) => {
    const rows = await db.select().from(clients).where(eq(clients.salonId, req.staff!.salonId));
    return { clients: rows };
  });

  app.post("/api/staff/clients", async (req, reply) => {
    const parsed = clientCreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    const [row] = await db
      .insert(clients)
      .values({ ...parsed.data, salonId })
      .returning();
    return reply.code(201).send({ client: row });
  });

  app.patch("/api/staff/clients/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = clientPatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const salonId = req.staff!.salonId;

    const [row] = await db
      .update(clients)
      .set(parsed.data)
      .where(and(eq(clients.id, id), eq(clients.salonId, salonId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Client not found" });
    return { client: row };
  });
}
