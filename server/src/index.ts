import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { bookingRoutes } from "./routes/booking.js";
import { authRoutes } from "./routes/auth.js";
import { staffRoutes } from "./routes/staff.js";

const app = Fastify({ logger: true });

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

await app.register(cors, { origin: origins });

app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString() }));

await app.register(bookingRoutes);
await app.register(authRoutes);
await app.register(staffRoutes);

const port = Number(process.env.PORT ?? 8080);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`Gloss Nail Bar API listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
