// Imports YOUR real salon catalog out of the frontend's browser localStorage
// and into this Postgres backend. Takes the JSON file produced by the
// browser-console export snippet (see the message that pointed you here, or
// re-ask for it) and upserts it against the "gloss-nail-bar" salon --
// matching seed.ts's own upsert-by-name convention, so this is safe to
// re-run if the export changes.
//
// Deliberately scoped to categories, services, techs (+ their skills), and
// clients -- the salon's actual configured catalog. It does NOT import
// appts-v2 (the local calendar's appointment history): this backend's
// `appointments` table is only online-booking requests, a different concept
// from the full calendar (see server/README.md's "Two separate auth
// systems" / HANDOFF.md #10), and the local data includes a lot of
// generator-produced demo bookings mixed in with anything real, so
// importing it wholesale would just move junk data over. If you want real
// past-appointment history moved too, say so explicitly and it can be
// scoped as its own pass.
//
// It also does NOT create staff logins from tech.loginEnabled/tech.pin --
// a 4-digit PIN is not a password this backend's bcrypt-hashed `users`
// table can use safely. The one demo login from db:seed keeps working;
// set up real staff logins deliberately once this data is in.
//
// Usage:
//   npm run db:import-local -- /path/to/gloss-nail-bar-export.json
import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { salons, serviceCategories, services, techs, techSkills, clients } from "./schema.js";

// ── Shapes of the exported localStorage JSON (mirrors app/src/lib/booking-types.ts) ──
interface ExportedCategory {
  id: string;
  name: string;
  parentId?: string;
  archived?: boolean;
}
interface ExportedService {
  id: string;
  name: string;
  short: string;
  durationMin: number;
  price: number; // dollars
  categoryId: string;
  active?: boolean;
  tags?: string[];
}
interface ExportedJobRole {
  id: string;
  name: string;
  serviceIds: string[];
}
interface ExportedTech {
  id: string;
  name: string;
  teamId: string; // -> JobRole.id
  skills: string[]; // service ids
  active?: boolean;
  archived?: boolean;
  endDate?: string;
  bookableOnline?: boolean;
  tags?: string[];
}
interface ExportedClient {
  id: string;
  name: string;
  phone: string;
  tags?: string[];
}
interface ExportedData {
  categories: ExportedCategory[] | null;
  services: ExportedService[] | null;
  staff: { roles: ExportedJobRole[]; techs: ExportedTech[] } | null;
  clients: ExportedClient[] | null;
  appointments: unknown; // intentionally unused, see header comment
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run db:import-local -- /path/to/gloss-nail-bar-export.json");
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(readFileSync(filePath, "utf-8")) as ExportedData;

  const slug = "gloss-nail-bar";
  const [salon] = await db.select().from(salons).where(eq(salons.slug, slug));
  if (!salon) {
    throw new Error(`No salon with slug "${slug}" -- run "npm run db:seed" first to create it.`);
  }
  console.log(`Importing into salon ${salon.name} (${salon.id})`);

  // ── Categories ──────────────────────────────────────────────────────────
  // service_categories has had parent_id/archived columns since the Phase 1
  // migration (0001_phase1_catalog.sql) -- this loop used to predate that
  // and unconditionally flattened every subcategory to top-level, which is
  // why a first import (before this fix) silently dropped the hierarchy.
  // Still deliberately skips archived categories -- an archived category's
  // services import as "uncategorized" below, not silently lost, and
  // resurrecting old archived rows on every re-run isn't what a re-import
  // is for.
  const localCats = (data.categories ?? []).filter((c) => !c.archived);
  if (data.categories?.some((c) => c.archived)) {
    console.log(`  skipping ${data.categories.filter((c) => c.archived).length} archived categor(y/ies)`);
  }

  const existingCats = await db.select().from(serviceCategories).where(eq(serviceCategories.salonId, salon.id));
  const catIdMap = new Map<string, string>(); // local id -> backend id
  let sortOrder = existingCats.length;
  // Pass 1: make sure every category row exists (matched by name, same
  // upsert convention as everything else here) so catIdMap is complete
  // before any parentId gets resolved through it in pass 2 below --
  // a subcategory can appear before its parent in the export.
  for (const c of localCats) {
    const found = existingCats.find((e) => e.name === c.name);
    if (found) {
      catIdMap.set(c.id, found.id);
      continue;
    }
    const [row] = await db.insert(serviceCategories).values({ salonId: salon.id, name: c.name, sortOrder: sortOrder++ }).returning();
    catIdMap.set(c.id, row.id);
    existingCats.push(row);
    console.log(`  + category "${c.name}"`);
  }
  // Pass 2: set parentId on every subcategory, including ones matched to an
  // already-existing row from a prior (pre-fix) run that flattened them --
  // this is what actually heals a salon that already imported once.
  let reparented = 0;
  for (const c of localCats) {
    if (!c.parentId) continue;
    const backendParentId = catIdMap.get(c.parentId);
    if (!backendParentId) continue; // parent wasn't in this export (shouldn't happen) -- leave top-level rather than guess
    const backendId = catIdMap.get(c.id)!;
    const row = existingCats.find((e) => e.id === backendId);
    if (row && row.parentId !== backendParentId) {
      await db.update(serviceCategories).set({ parentId: backendParentId }).where(eq(serviceCategories.id, backendId));
      reparented++;
    }
  }
  if (reparented > 0) console.log(`  ~ re-parented ${reparented} subcategor(y/ies)`);

  // ── Services ────────────────────────────────────────────────────────────
  const localSvcs = data.services ?? [];
  const existingSvcs = await db.select().from(services).where(eq(services.salonId, salon.id));
  const svcIdMap = new Map<string, string>();
  sortOrder = existingSvcs.length;
  for (const s of localSvcs) {
    const found = existingSvcs.find((e) => e.name === s.name);
    if (found) {
      svcIdMap.set(s.id, found.id);
      continue;
    }
    const [row] = await db
      .insert(services)
      .values({
        salonId: salon.id,
        categoryId: catIdMap.get(s.categoryId) ?? null,
        name: s.name,
        durationMin: s.durationMin,
        priceCents: Math.round(s.price * 100),
        active: s.active !== false,
        tags: s.tags ?? [],
        sortOrder: sortOrder++,
      })
      .returning();
    svcIdMap.set(s.id, row.id);
    console.log(`  + service "${s.name}" ($${s.price}, ${s.durationMin}min)`);
  }

  // ── Techs (+ skills) ────────────────────────────────────────────────────
  const roleById = new Map((data.staff?.roles ?? []).map((r) => [r.id, r]));
  const localTechs = data.staff?.techs ?? [];
  const existingTechs = await db.select().from(techs).where(eq(techs.salonId, salon.id));
  sortOrder = existingTechs.length;
  const todayKey = new Date().toISOString().slice(0, 10);
  for (const t of localTechs) {
    const isInactive = t.archived === true || t.active === false || (t.endDate != null && t.endDate !== "" && t.endDate <= todayKey);
    const roleName = roleById.get(t.teamId)?.name;

    let techRow = existingTechs.find((e) => e.name === t.name);
    if (!techRow) {
      [techRow] = await db
        .insert(techs)
        .values({
          salonId: salon.id,
          name: t.name,
          title: roleName ?? null,
          active: !isInactive,
          bookableOnline: t.bookableOnline ?? true,
          tags: t.tags ?? [],
          sortOrder: sortOrder++,
        })
        .returning();
      console.log(`  + tech "${t.name}"${roleName ? ` (${roleName})` : ""}${isInactive ? " [inactive]" : ""}`);
    }

    const existingSkills = await db.select().from(techSkills).where(eq(techSkills.techId, techRow.id));
    const haveServiceIds = new Set(existingSkills.map((s) => s.serviceId));
    for (const localServiceId of t.skills) {
      const serviceId = svcIdMap.get(localServiceId);
      if (!serviceId || haveServiceIds.has(serviceId)) continue;
      await db.insert(techSkills).values({ techId: techRow.id, serviceId });
      haveServiceIds.add(serviceId);
    }
  }

  // ── Clients ─────────────────────────────────────────────────────────────
  const localClients = data.clients ?? [];
  const existingClients = await db.select().from(clients).where(eq(clients.salonId, salon.id));
  let imported = 0;
  for (const c of localClients) {
    const found = existingClients.find((e) => e.name === c.name && e.phone === c.phone);
    if (found) continue;
    await db.insert(clients).values({
      salonId: salon.id,
      name: c.name,
      phone: c.phone || null,
      tags: c.tags ?? [],
    });
    imported++;
  }
  console.log(`  + ${imported} client(s) (${localClients.length - imported} already present, skipped)`);

  console.log("\nImport complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
