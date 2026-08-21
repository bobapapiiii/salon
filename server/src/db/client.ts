import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set -- copy server/.env.example to server/.env and fill it in.");
}

// Render's managed Postgres requires SSL for external connections; the
// internal connection (API and DB in the same Render region) doesn't need
// it but accepts it fine, so we always enable it except for plain
// localhost dev, where a local Postgres typically has no SSL configured.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
