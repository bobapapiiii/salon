// One-off cleanup: seed.ts's demo catalog/tech rows now coexist in the same
// tables as the salon's real data (imported earlier via import-local-data.ts
// and further edited since Phase 1 shipped). This identifies rows that
// still exactly match seed.ts's hardcoded demo fixtures and removes the
// ones that are safe to remove, archives the ones that look like they're
// now in real use, and prints anything it isn't confident about instead of
// guessing.
//
// Deliberately NOT wired into the migrate.ts chain -- unlike additive
// schema changes, "is this real customer data or demo data" is a judgment
// call that shouldn't run unattended. Run manually, once, after Phase 1's
// schema/routes ship and before Phase 2 starts creating appointment FKs
// against these tables.
//
// Safe by default: without --apply this is a dry run that only prints what
// it *would* do. Nothing is deleted or archived until you pass --apply.
//
//   DATABASE_URL="..." npm run db:cleanup-demo-seed             # dry run
//   DATABASE_URL="..." npm run db:cleanup-demo-seed -- --apply  # for real
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { appointments, jobRoles, salons, serviceCategories, services, techSkills, techs } from "./schema.js";

const APPLY = process.argv.includes("--apply");

// ── exact fixtures from seed.ts -- keep in sync if that file changes ──────
const DEMO_CATEGORY_NAMES = ["Manicure", "Pedicure", "Gel / Acrylic", "Nail Art", "Removal & Repair"];

const DEMO_SERVICES: { name: string; durationMin: number; priceCents: number }[] = [
  { name: "Classic Manicure", durationMin: 45, priceCents: 2800 },
  { name: "Gel Manicure", durationMin: 60, priceCents: 4200 },
  { name: "Classic Pedicure", durationMin: 45, priceCents: 3800 },
  { name: "Gel Pedicure", durationMin: 60, priceCents: 5200 },
  { name: "Spa Pedicure", durationMin: 75, priceCents: 6200 },
  { name: "Acrylic Full Set", durationMin: 90, priceCents: 6500 },
  { name: "Gel-X Extensions", durationMin: 90, priceCents: 7200 },
  { name: "Dip Powder", durationMin: 75, priceCents: 5500 },
  { name: "Acrylic Fill", durationMin: 60, priceCents: 4500 },
  { name: "Custom Nail Art", durationMin: 45, priceCents: 2500 },
  { name: "French Design", durationMin: 30, priceCents: 1500 },
  { name: "Soak-Off Removal", durationMin: 30, priceCents: 1500 },
  { name: "Nail Repair", durationMin: 15, priceCents: 800 },
];

const DEMO_TECHS: { name: string; title: string }[] = [
  { name: "Linh N.", title: "Nail Artists" },
  { name: "Mia P.", title: "Pedi Specialists" },
  { name: "Amy T.", title: "Gel-X & Acrylic" },
  { name: "Jenny V.", title: "Nail Art Studio" },
];

const DEMO_USER_EMAIL = "manager@glossnailbar.com";

async function main() {
  const slug = "gloss-nail-bar";
  const [salon] = await db.select().from(salons).where(eq(salons.slug, slug));
  if (!salon) {
    console.log(`No salon with slug "${slug}" -- nothing to clean up.`);
    return;
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} -- salon ${salon.name} (${salon.id})\n`);

  let deleted = 0;
  let archived = 0;
  let reviewNeeded = 0;

  // ── techs: exact name + title match against DEMO_TECHS. A demo tech
  // referenced by a real appointment is archived, not deleted (deleting
  // would cascade-delete that appointment). Deleting a clean match also
  // cascades tech_skills, which is fine -- it's just that tech's own rows. ──
  const allTechs = await db.select().from(techs).where(eq(techs.salonId, salon.id));
  for (const fixture of DEMO_TECHS) {
    const matches = allTechs.filter((t) => t.name === fixture.name && t.title === fixture.title);
    for (const t of matches) {
      const [inUse] = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.techId, t.id));
      if (inUse) {
        console.log(`TECH "${t.name}" (${t.id}) matches the demo fixture but has real appointments -- archiving, not deleting.`);
        if (APPLY) await db.update(techs).set({ archived: true }).where(eq(techs.id, t.id));
        archived++;
      } else {
        console.log(`TECH "${t.name}" (${t.id}) matches the demo fixture, no appointments reference it -- deleting.`);
        if (APPLY) {
          await db.delete(techSkills).where(eq(techSkills.techId, t.id));
          await db.delete(techs).where(eq(techs.id, t.id));
        }
        deleted++;
      }
    }
  }

  // ── services: exact name + duration + price match against DEMO_SERVICES
  // (tighter than name alone -- a real salon plausibly has its own "Classic
  // Manicure", far less plausibly one priced and timed identically to the
  // demo fixture). A name-only match that fails on duration/price is left
  // alone and printed for manual review rather than guessed at. ───────────
  const allServices = await db.select().from(services).where(eq(services.salonId, salon.id));
  for (const fixture of DEMO_SERVICES) {
    const nameMatches = allServices.filter((s) => s.name === fixture.name);
    for (const s of nameMatches) {
      const exact = s.durationMin === fixture.durationMin && s.priceCents === fixture.priceCents;
      if (!exact) {
        console.log(`SERVICE "${s.name}" (${s.id}) shares the demo fixture's name but not its duration/price -- leaving alone, review manually.`);
        reviewNeeded++;
        continue;
      }
      const [inUse] = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.serviceId, s.id));
      if (inUse) {
        console.log(`SERVICE "${s.name}" (${s.id}) matches the demo fixture but has real appointments -- deactivating, not deleting.`);
        if (APPLY) await db.update(services).set({ active: false }).where(eq(services.id, s.id));
        archived++;
      } else {
        console.log(`SERVICE "${s.name}" (${s.id}) matches the demo fixture, no appointments reference it -- deleting.`);
        if (APPLY) await db.delete(services).where(eq(services.id, s.id));
        deleted++;
      }
    }
  }

  // ── categories: name-only match (nothing else to fingerprint on). Never
  // hard-deleted automatically -- archived if no active service still
  // references it, otherwise left alone and printed for review. Re-reads
  // the services table so it reflects any deletes just applied above. ────
  const remainingServices = await db.select().from(services).where(eq(services.salonId, salon.id));
  const allCategories = await db.select().from(serviceCategories).where(eq(serviceCategories.salonId, salon.id));
  for (const name of DEMO_CATEGORY_NAMES) {
    const matches = allCategories.filter((c) => c.name === name);
    for (const c of matches) {
      const stillReferenced = remainingServices.some((s) => s.active && s.categoryId === c.id);
      if (stillReferenced) {
        console.log(`CATEGORY "${c.name}" (${c.id}) matches a demo fixture name but still has active services -- leaving alone, review manually.`);
        reviewNeeded++;
      } else {
        console.log(`CATEGORY "${c.name}" (${c.id}) matches the demo fixture, no active services reference it -- archiving.`);
        if (APPLY) await db.update(serviceCategories).set({ archived: true }).where(eq(serviceCategories.id, c.id));
        archived++;
      }
    }
  }

  // ── job roles: Phase 1's migration backfill created one job_role per
  // distinct tech.title, including the demo techs' titles. Once the demo
  // techs above are gone, a job role with one of those exact names and zero
  // remaining techs is cruft too. ──────────────────────────────────────────
  const remainingTechs = await db.select().from(techs).where(eq(techs.salonId, salon.id));
  const allRoles = await db.select().from(jobRoles).where(eq(jobRoles.salonId, salon.id));
  for (const fixture of DEMO_TECHS) {
    const matches = allRoles.filter((r) => r.name === fixture.title);
    for (const r of matches) {
      const stillReferenced = remainingTechs.some((t) => t.jobRoleId === r.id);
      if (stillReferenced) {
        console.log(`JOB ROLE "${r.name}" (${r.id}) matches a demo fixture name but still has techs assigned -- leaving alone, review manually.`);
        reviewNeeded++;
      } else {
        console.log(`JOB ROLE "${r.name}" (${r.id}) matches the demo fixture, no techs reference it -- deleting.`);
        if (APPLY) await db.delete(jobRoles).where(and(eq(jobRoles.id, r.id), eq(jobRoles.salonId, salon.id)));
        deleted++;
      }
    }
  }

  // ── demo staff login: never touched automatically -- a login is higher-
  // stakes than catalog data (someone might genuinely be using it) and its
  // password hash can't be compared against the known demo password to
  // confirm it's untouched. Just flagged for a human to decide. ──────────
  console.log(
    `\nDEMO LOGIN: if ${DEMO_USER_EMAIL} still exists and is unused, remove or repassword it by hand -- ` +
      `this script never touches staff logins. Real logins are provisioned via "npm run db:create-staff-login".`,
  );

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${deleted} deleted, ${archived} archived, ${reviewNeeded} flagged for manual review.`);
  if (!APPLY) console.log("Dry run only -- rerun with --apply to make these changes.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
