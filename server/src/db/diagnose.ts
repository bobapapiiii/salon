// ─── Read-only data-health report ─────────────────────────────────────────
// Prints exactly what's in Postgres for the salon right now: categories
// (with parent links), job roles (with linked-service and tech counts),
// techs (with role/archived state), services, and every appointment with
// whether its tech/service still resolve to something active. Makes zero
// writes -- this is purely for eyeballing "why doesn't X show up."
//
// Usage:
//   npm run db:diagnose
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { salons, serviceCategories, services, jobRoles, jobRoleServices, techs, appointments } from "./schema.js";

async function main() {
  const slug = "gloss-nail-bar";
  const [salon] = await db.select().from(salons).where(eq(salons.slug, slug));
  if (!salon) {
    throw new Error(`No salon with slug "${slug}".`);
  }
  console.log(`Salon: ${salon.name} (${salon.id})\n`);

  const cats = await db.select().from(serviceCategories).where(eq(serviceCategories.salonId, salon.id));
  const catById = new Map(cats.map((c) => [c.id, c]));
  console.log(`── Categories (${cats.length}) ──`);
  for (const c of cats.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const parent = c.parentId ? catById.get(c.parentId) : null;
    const parentNote = c.parentId ? (parent ? `sub of "${parent.name}"` : `sub of MISSING PARENT ${c.parentId}`) : "top-level";
    console.log(`  ${c.archived ? "[archived] " : ""}"${c.name}" -- ${parentNote} -- ${c.id}`);
  }

  const svcs = await db.select().from(services).where(eq(services.salonId, salon.id));
  const svcById = new Map(svcs.map((s) => [s.id, s]));
  console.log(`\n── Services (${svcs.length}) ──`);
  for (const s of svcs.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const cat = s.categoryId ? catById.get(s.categoryId) : null;
    const catNote = s.categoryId ? (cat ? `"${cat.name}"` : `MISSING CATEGORY ${s.categoryId}`) : "uncategorized";
    console.log(`  ${s.active ? "" : "[inactive] "}"${s.name}" -- ${catNote} -- ${s.id}`);
  }

  const roles = await db.select().from(jobRoles).where(eq(jobRoles.salonId, salon.id));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const jrs = await db.select().from(jobRoleServices);
  const techRows = await db.select().from(techs).where(eq(techs.salonId, salon.id));
  console.log(`\n── Job roles (${roles.length}) ──`);
  for (const r of roles.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const svcCount = jrs.filter((j) => j.jobRoleId === r.id).length;
    const techCount = techRows.filter((t) => t.jobRoleId === r.id).length;
    console.log(`  "${r.name}" -- ${svcCount} service(s) linked, ${techCount} tech(s) assigned -- ${r.id}`);
  }

  console.log(`\n── Techs (${techRows.length}) ──`);
  for (const t of techRows.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const role = t.jobRoleId ? roleById.get(t.jobRoleId) : null;
    const roleNote = t.jobRoleId ? (role ? `role "${role.name}"` : `MISSING ROLE ${t.jobRoleId}`) : "NO ROLE";
    const flags = [t.archived ? "archived" : null, t.active ? null : "inactive"].filter(Boolean).join(", ");
    console.log(`  "${t.name}" -- ${roleNote}${flags ? ` -- [${flags}]` : ""} -- ${t.id}`);
  }

  const appts = await db.select().from(appointments).where(eq(appointments.salonId, salon.id));
  console.log(`\n── Appointments (${appts.length}) ──`);
  for (const a of appts.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.startMin - y.startMin))) {
    const tech = techRows.find((t) => t.id === a.techId);
    const svc = svcById.get(a.serviceId);
    const techNote = tech
      ? `tech "${tech.name}"${tech.archived ? " [ARCHIVED]" : ""}${tech.jobRoleId == null ? " [NO ROLE]" : ""}`
      : `tech MISSING ${a.techId}`; // shouldn't be possible -- techId is a NOT NULL FK
    const svcNote = svc ? `svc "${svc.name}"` : `svc MISSING ${a.serviceId}`;
    console.log(`  ${a.dateKey} ${String(a.startMin).padStart(4)}m [${a.status}] ${a.clientName || "(no name)"} -- ${techNote} -- ${svcNote} -- ${a.id}`);
  }

  console.log("\nDone. Anything flagged MISSING/ARCHIVED/NO ROLE above is why it won't render on the calendar.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
