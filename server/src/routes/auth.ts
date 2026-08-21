import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { signStaffToken, verifyPassword } from "../lib/auth.js";

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    // Same generic message whether the email doesn't exist or the password
    // is wrong -- don't leak which staff emails are registered.
    if (!user || !user.active) return reply.code(401).send({ error: "Invalid email or password" });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "Invalid email or password" });

    const token = signStaffToken({ userId: user.id, salonId: user.salonId, title: user.title });
    return { token, user: { id: user.id, name: user.name, email: user.email, title: user.title, salonId: user.salonId } };
  });
}
