import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyStaffToken, type StaffTokenPayload } from "./auth.js";

// Fastify request augmentation so route handlers can read req.staff after
// this preHandler runs, instead of re-parsing the header themselves.
declare module "fastify" {
  interface FastifyRequest {
    staff?: StaffTokenPayload;
  }
}

export async function requireStaffAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  try {
    req.staff = verifyStaffToken(header.slice("Bearer ".length));
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

/** Gate an action to Manager/Owner, mirroring the frontend's
 *  canManageDiscounts()-style title check (discounts-store.ts) since this
 *  backend has no richer RBAC yet either -- see server/README.md. */
export function requireManagerOrOwner(req: FastifyRequest, reply: FastifyReply) {
  if (!req.staff || !["Manager", "Owner"].includes(req.staff.title)) {
    reply.code(403).send({ error: "Only managers and owners can do this" });
    return false;
  }
  return true;
}
