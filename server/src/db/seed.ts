// Seeds one salon ("gloss-nail-bar") with the same categories/services and
// a representative slice of the techs used by the frontend's demo data
// (app/src/lib/mock-data.ts), plus one staff login, so the public booking
// page and staff "Online requests" panel have real data to exercise
// end-to-end. Safe to re-run: it upserts by slug/email and skips catalog
// rows that already exist for the salon.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { salons, users, serviceCategories, services, techs, techSkills } from "./schema.js";

const CATEGORIES = [
  { key: "mani", name: "Manicure" },
  { key: "pedi", name: "Pedicure" },
  { key: "enh", name: "Gel / Acrylic" },
  { key: "art", name: "Nail Art" },
  { key: "rem", name: "Removal & Repair" },
] as const;

const SERVICES = [
  { key: "m-classic", name: "Classic Manicure", durationMin: 45, priceCents: 2800, categoryKey: "mani" },
  { key: "m-gel", name: "Gel Manicure", durationMin: 60, priceCents: 4200, categoryKey: "mani" },
  { key: "p-classic", name: "Classic Pedicure", durationMin: 45, priceCents: 3800, categoryKey: "pedi" },
  { key: "p-gel", name: "Gel Pedicure", durationMin: 60, priceCents: 5200, categoryKey: "pedi" },
  { key: "p-spa", name: "Spa Pedicure", durationMin: 75, priceCents: 6200, categoryKey: "pedi" },
  { key: "e-acrylic", name: "Acrylic Full Set", durationMin: 90, priceCents: 6500, categoryKey: "enh" },
  { key: "e-gelx", name: "Gel-X Extensions", durationMin: 90, priceCents: 7200, categoryKey: "enh" },
  { key: "e-dip", name: "Dip Powder", durationMin: 75, priceCents: 5500, categoryKey: "enh" },
  { key: "e-fill", name: "Acrylic Fill", durationMin: 60, priceCents: 4500, categoryKey: "enh" },
  { key: "a-custom", name: "Custom Nail Art", durationMin: 45, priceCents: 2500, categoryKey: "art" },
  { key: "a-french", name: "French Design", durationMin: 30, priceCents: 1500, categoryKey: "art" },
  { key: "r-soak", name: "Soak-Off Removal", durationMin: 30, priceCents: 1500, categoryKey: "rem" },
  { key: "r-fix", name: "Nail Repair", durationMin: 15, priceCents: 800, categoryKey: "rem" },
] as const;

const BASE_SKILLS = ["m-classic", "m-gel", "p-classic", "p-gel", "r-soak", "r-fix", "a-french"];

// One representative tech per team (the frontend seeds 70 for calendar
// density; the API only needs enough to make availability meaningful).
const TECHS = [
  { name: "Linh N.", title: "Nail Artists", skillKeys: [...BASE_SKILLS, "e-dip", "e-fill"] },
  { name: "Mia P.", title: "Pedi Specialists", skillKeys: [...BASE_SKILLS, "p-spa"] },
  { name: "Amy T.", title: "Gel-X & Acrylic", skillKeys: [...BASE_SKILLS, "e-acrylic", "e-gelx", "e-dip", "e-fill"] },
  { name: "Jenny V.", title: "Nail Art Studio", skillKeys: [...BASE_SKILLS, "a-custom", "e-dip"] },
] as const;

async function main() {
  const slug = "gloss-nail-bar";

  let [salon] = await db.select().from(salons).where(eq(salons.slug, slug));
  if (!salon) {
    [salon] = await db
      .insert(salons)
      .values({
        slug,
        name: "Gloss Nail Bar",
        address: "123 Blossom Ave, Suite 4",
        phone: "(555) 010-1000",
        website: "glossnailbar.com",
        timezone: "America/Los_Angeles",
      })
      .returning();
    console.log(`Created salon ${salon.name} (${salon.id})`);
  } else {
    console.log(`Salon already exists: ${salon.name} (${salon.id})`);
  }

  const existingCats = await db.select().from(serviceCategories).where(eq(serviceCategories.salonId, salon.id));
  const catByKey = new Map<string, string>(); // key -> category id
  if (existingCats.length > 0) {
    for (const c of CATEGORIES) {
      const found = existingCats.find((e) => e.name === c.name);
      if (found) catByKey.set(c.key, found.id);
    }
  }
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    if (catByKey.has(c.key)) continue;
    const [row] = await db.insert(serviceCategories).values({ salonId: salon.id, name: c.name, sortOrder: i }).returning();
    catByKey.set(c.key, row.id);
  }
  console.log(`Categories ready: ${catByKey.size}`);

  const existingSvcs = await db.select().from(services).where(eq(services.salonId, salon.id));
  const svcByKey = new Map<string, string>();
  for (const s of SERVICES) {
    const found = existingSvcs.find((e) => e.name === s.name);
    if (found) svcByKey.set(s.key, found.id);
  }
  for (let i = 0; i < SERVICES.length; i++) {
    const s = SERVICES[i];
    if (svcByKey.has(s.key)) continue;
    const [row] = await db
      .insert(services)
      .values({
        salonId: salon.id,
        categoryId: catByKey.get(s.categoryKey) ?? null,
        name: s.name,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        sortOrder: i,
      })
      .returning();
    svcByKey.set(s.key, row.id);
  }
  console.log(`Services ready: ${svcByKey.size}`);

  const existingTechs = await db.select().from(techs).where(eq(techs.salonId, salon.id));
  for (const t of TECHS) {
    let techRow = existingTechs.find((e) => e.name === t.name);
    if (!techRow) {
      [techRow] = await db.insert(techs).values({ salonId: salon.id, name: t.name, title: t.title }).returning();
      console.log(`  + tech ${t.name}`);
    }
    const existingSkills = await db.select().from(techSkills).where(eq(techSkills.techId, techRow.id));
    const haveServiceIds = new Set(existingSkills.map((s) => s.serviceId));
    for (const key of t.skillKeys) {
      const serviceId = svcByKey.get(key);
      if (!serviceId || haveServiceIds.has(serviceId)) continue;
      await db.insert(techSkills).values({ techId: techRow.id, serviceId });
    }
  }
  console.log(`Techs ready: ${TECHS.length}`);

  const demoEmail = "manager@glossnailbar.com";
  const [existingUser] = await db.select().from(users).where(eq(users.email, demoEmail));
  if (!existingUser) {
    const passwordHash = await bcrypt.hash("gloss-demo-2026", 10);
    await db.insert(users).values({
      salonId: salon.id,
      name: "Demo Manager",
      email: demoEmail,
      passwordHash,
      title: "Manager",
    });
    console.log(`Created staff login: ${demoEmail} / gloss-demo-2026 (change this after first login)`);
  } else {
    console.log(`Staff login already exists: ${demoEmail}`);
  }

  console.log("\nSeed complete. Public booking page: /book/gloss-nail-bar");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
