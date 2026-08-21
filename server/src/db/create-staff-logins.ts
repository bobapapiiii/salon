// Provisions a real staff login (server/'s bcrypt+JWT `users` table), for
// the auth-unification pass (see HANDOFF.md / the migration plan) that
// replaced the frontend's old fake DEMO_USERS switcher with a real sign-in.
//
// Deliberately NOT "create a login for every tech automatically" -- most
// techs use the separate, still-local-only PIN portal (Tech.loginEnabled/
// pin in staff-store.ts), not this real backend login. This script only
// provisions the specific people who actually need to sign in to the app
// itself (front desk / manager / owner), one at a time, by name -- nobody
// gets an account they didn't ask for, and nobody's real name/email gets
// invented on their behalf.
//
// Usage:
//   npm run db:create-staff-login -- --name "Khanh Nguyen" --email khanh@example.com --title Owner
//   npm run db:create-staff-login -- --name "Front Desk" --email frontdesk@glossnailbar.com --title Reception --tech "Amy T."
//
// --title is one of Reception | Manager | Owner (matches users.title,
// server/src/db/schema.ts). --tech "<exact tech name>" is optional -- when
// given, links this login to that tech's existing techs.userId (see
// schema.ts's users<->techs relation) so later phases that key off "which
// user is this tech" have something to join on. Safe to re-run: an
// existing email gets a freshly generated password (printed once) rather
// than a duplicate row.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, pool } from "./client.js";
import { salons, users, techs } from "./schema.js";

const VALID_TITLES = ["Reception", "Manager", "Owner"] as const;
type Title = (typeof VALID_TITLES)[number];

function parseArgs(argv: string[]): { name?: string; email?: string; title?: string; tech?: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        out[key] = val;
        i++;
      }
    }
  }
  return out;
}

function randomPassword(): string {
  // 12 random bytes, base64url -- readable enough to type once, uncommon
  // enough not to guess; the owner should treat it as temporary and change
  // it once there's a "change password" flow (none exists yet, see
  // server/README.md's "What's deliberately not built yet").
  return randomBytes(12).toString("base64url");
}

async function main() {
  const { name, email, title, tech: techName } = parseArgs(process.argv.slice(2));

  if (!name || !email || !title) {
    console.error('Usage: npm run db:create-staff-login -- --name "Full Name" --email someone@example.com --title Owner [--tech "Exact Tech Name"]');
    console.error(`--title must be one of: ${VALID_TITLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (!VALID_TITLES.includes(title as Title)) {
    console.error(`--title must be one of: ${VALID_TITLES.join(", ")} (got "${title}")`);
    process.exitCode = 1;
    return;
  }

  const slug = "gloss-nail-bar";
  const [salon] = await db.select().from(salons).where(eq(salons.slug, slug));
  if (!salon) {
    throw new Error(`No salon with slug "${slug}" -- run "npm run db:seed" first to create it.`);
  }

  const password = randomPassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedEmail = email.trim().toLowerCase();

  const [existing] = await db.select().from(users).where(and(eq(users.salonId, salon.id), eq(users.email, normalizedEmail)));
  let userRow;
  if (existing) {
    [userRow] = await db
      .update(users)
      .set({ name, title, passwordHash, active: true })
      .where(eq(users.id, existing.id))
      .returning();
    console.log(`Updated existing login for ${normalizedEmail} (password reset).`);
  } else {
    [userRow] = await db
      .insert(users)
      .values({ salonId: salon.id, name, email: normalizedEmail, passwordHash, title })
      .returning();
    console.log(`Created new login for ${normalizedEmail}.`);
  }

  if (techName) {
    const [techRow] = await db.select().from(techs).where(and(eq(techs.salonId, salon.id), eq(techs.name, techName)));
    if (!techRow) {
      console.warn(`  ! No tech named "${techName}" found for this salon -- login created, but not linked to a tech row.`);
    } else {
      await db.update(techs).set({ userId: userRow.id }).where(eq(techs.id, techRow.id));
      console.log(`  linked to tech "${techName}" (${techRow.id})`);
    }
  }

  console.log("\nLogin ready -- share these with the person, this password is shown only once:");
  console.log(`  email:    ${normalizedEmail}`);
  console.log(`  password: ${password}`);
  console.log(`  title:    ${title}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
