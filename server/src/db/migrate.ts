// Runs every .sql file in server/migrations, in filename order, inside a
// transaction each. No migration-tracking table yet (there's only one
// migration file today) -- `create table if not exists` / `create index if
// not exists` makes re-running safe. If you add a second migration file
// later and need real up-tracking, switch to drizzle-kit's migrator once
// `npm install` has run at least once (see README).
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

async function main() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in", migrationsDir);
    return;
  }

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Running migration: ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
        console.log(`  ok`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log("All migrations applied.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
