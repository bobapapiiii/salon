// ─── Database schema (Drizzle ORM, Postgres) ──────────────────────────────
// Deliberately small: this is the first real backend for a platform that
// has been 100% client-side/localStorage until now. It covers only what
// online booking needs (salon, staff login, techs, services, clients,
// appointments) -- not a migration of every localStorage store. See
// server/README.md and the root HANDOFF.md for what's intentionally left
// for a later, larger migration pass (payments, discounts, reports, etc).
//
// Money is stored in integer cents everywhere, matching the pattern
// already established in the frontend's discount-engine.ts.

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// One row per tenant. Only one exists today (Gloss Nail Bar), but every
// other table is scoped by salon_id from day one so adding a second
// tenant later never requires a backfill.
export const salons = pgTable("salons", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // used in the public booking URL: /book/:slug
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  website: text("website"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  bookingOpenMin: integer("booking_open_min").notNull().default(9 * 60), // 9:00am, minutes from midnight
  bookingCloseMin: integer("booking_close_min").notNull().default(19 * 60), // 7:00pm
  slotSizeMin: integer("slot_size_min").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Staff login. Separate from `techs` -- not every tech has a login (e.g. a
// new hire not yet set up), and not every login is a tech (front desk).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    title: text("title").notNull().default("Reception"), // "Reception" | "Manager" | "Owner" -- mirrors SessionUser.title client-side
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_salon_email_idx").on(t.salonId, t.email)],
);

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Phase 1 (localStorage->Postgres migration) additions -- see
    // migrations/0001_phase1_catalog.sql. Color tokens are directly
    // user-editable client-side (a raw <input type="color"> per token), so
    // they're stored verbatim, not derived server-side.
    hue: text("hue"),
    fill: text("fill"),
    line: text("line"),
    textColor: text("text_color"),
    parentId: uuid("parent_id").references((): AnyPgColumn => serviceCategories.id, { onDelete: "set null" }),
    archived: boolean("archived").notNull().default(false),
    onlineExcludedRoleIds: jsonb("online_excluded_role_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [index("service_categories_salon_idx").on(t.salonId)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull(),
    priceCents: integer("price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    // Phase 1 additions -- see migrations/0001_phase1_catalog.sql. `addons`
    // follows the exact precedent `tags` already sets (jsonb, no query need).
    short: text("short").notNull().default(""),
    teamAffinity: text("team_affinity"),
    addons: jsonb("addons").$type<{ id: string; name: string; mins: number; price: number }[]>().notNull().default([]),
    onlineExcludedRoleIds: jsonb("online_excluded_role_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [index("services_salon_idx").on(t.salonId)],
);

// Job roles -- a new concept as of Phase 1, mirrors the frontend's JobRole
// (app/src/lib/staff-store.ts): distinct from users.title, which is a
// permission level (Reception/Manager/Owner), not a job role.
export const jobRoles = pgTable(
  "job_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("job_roles_salon_idx").on(t.salonId)],
);

// Which services a job role covers -- mirrors techSkills exactly.
export const jobRoleServices = pgTable(
  "job_role_services",
  {
    jobRoleId: uuid("job_role_id").notNull().references(() => jobRoles.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("job_role_services_pk").on(t.jobRoleId, t.serviceId)],
);

export const techs = pgTable(
  "techs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    // Denormalized cache of jobRoleId's name, kept in sync server-side on
    // every write (see routes/staff-admin.ts) so the public booking route
    // (routes/booking.ts) needs zero changes. jobRoleId is the source of
    // truth as of Phase 1; this column is a read convenience, not a second
    // source of truth to edit directly.
    title: text("title"),
    active: boolean("active").notNull().default(true),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    // Phase 1 additions -- see migrations/0001_phase1_catalog.sql and the
    // migration plan's "jsonb-vs-columns" section. Only fields actually
    // queried/joined/reported-on are promoted to real columns; the rest of
    // the frontend's much richer Tech shape (documents, weekly schedule,
    // time off, per-service overrides, address, PIN, etc) round-trips
    // through `profile`, shallow-merged over these columns on every
    // read/write in routes/staff-admin.ts -- invisible to the frontend.
    jobRoleId: uuid("job_role_id").references(() => jobRoles.id, { onDelete: "set null" }),
    archived: boolean("archived").notNull().default(false),
    phone: text("phone"),
    email: text("email"),
    commissionPct: integer("commission_pct"),
    profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("techs_salon_idx").on(t.salonId)],
);

// Which techs can perform which services -- drives the availability
// calculation (a service can only be booked with a tech who has the skill).
export const techSkills = pgTable(
  "tech_skills",
  {
    techId: uuid("tech_id").notNull().references(() => techs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("tech_skills_pk").on(t.techId, t.serviceId)],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Phase 1 additions -- see migrations/0001_phase1_catalog.sql. `visits`
    // is a real column (arithmetic, feeds reports); preferredTechs/guests
    // are small nested arrays with no query need, kept as jsonb.
    visits: integer("visits").notNull().default(0),
    preferredTechs: jsonb("preferred_techs").$type<{ id: string; techId: string; categoryIds: string[] }[]>().notNull().default([]),
    guests: jsonb("guests").$type<{ id: string; name: string }[]>().notNull().default([]),
  },
  (t) => [
    index("clients_salon_idx").on(t.salonId),
    index("clients_salon_phone_idx").on(t.salonId, t.phone),
    index("clients_salon_email_idx").on(t.salonId, t.email),
  ],
);

// The calendar's single source of truth as of Phase 2 -- online-booking
// requests AND every staff-created/dragged/checked-in appointment are the
// same row in this table, distinguished only by `source`/`status`. Was
// online-request-only before Phase 2 (see migrations/0001 and earlier);
// widened in migrations/0002_phase2_appointments.sql. Column-vs-jsonb
// split follows the same "promote only what's queried/joined/filtered"
// rule Phase 1 established for techs.profile -- everything else round-trips
// through `profile`, shallow-merged into the API response in
// routes/appointments.ts, invisible to the frontend.
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    // Nullable as of Phase 2: walk-ins/guests booked straight from the
    // calendar often have no phone and so no real `clients` row (unlike
    // every pre-Phase-2 row, which always came through routes/booking.ts's
    // upsert-by-phone flow). `clientName` is the always-present display
    // value; `clientId`, when set, is the real client to jump to from
    // ClientProfile.tsx etc.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    clientName: text("client_name").notNull().default(""),
    techId: uuid("tech_id").notNull().references(() => techs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
    // mode: "string" pinned explicitly -- callers (routes/booking.ts,
    // routes/appointments.ts, the frontend's dateKey convention) all treat
    // this as a plain "YYYY-MM-DD" string; leaving mode unspecified risks
    // node-postgres/Drizzle handing back a JS Date instead, which would
    // silently break every string comparison and equality filter against
    // this column.
    dateKey: date("date_key", { mode: "string" }).notNull(),
    startMin: integer("start_min").notNull(), // minutes from midnight, salon-local time
    durationMin: integer("duration_min").notNull(),
    // requested | confirmed | booked | checked_in | in_service | completed
    // | checked_out | no_show | cancelled | declined -- see
    // routes/appointments.ts's status-transition map for what's a valid
    // move from what. cancelled/declined are soft statuses, never row
    // deletes (see the Phase 2 plan for why).
    status: text("status").notNull().default("requested"),
    source: text("source").notNull().default("online"), // online | front_desk | walk_in | pos
    clientNote: text("client_note"),
    staffNote: text("staff_note"),
    // Phase 2 additions -- grouped cancel/move needs `where parallel_group
    // = X`; `issue` is a cheap salon-wide "needs attention" filter/badge.
    parallelGroup: text("parallel_group"),
    issue: boolean("issue").notNull().default(false),
    // Own typed column (mirrors services.addons's existing precedent) --
    // a well-defined small array shape, not a bag of unrelated fields.
    addons: jsonb("addons").$type<{ id: string; name: string; mins: number; price: number }[]>().notNull().default([]),
    // Catch-all for everything else new this phase and not queried on:
    // notes, guestOf, priceOverride, requestedTechChoice, techRequested,
    // genderMismatchOk, checkedInMin/startedMin/completedMin, customFields,
    // walkinOrigin.
    profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
    // Free-text audit trail, same shape as the frontend's existing
    // Appointment.log ({at, text}[]) -- deliberately NOT a table this
    // phase, see the Phase 2 plan's "log stays jsonb" section.
    log: jsonb("log").$type<{ at: number; text: string }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    // Optimistic-concurrency token -- every mutating route requires the
    // caller's `expectedVersion` to match before applying, 409s with the
    // current row otherwise. See routes/appointments.ts.
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("appointments_salon_date_idx").on(t.salonId, t.dateKey),
    index("appointments_tech_date_idx").on(t.techId, t.dateKey),
    index("appointments_status_idx").on(t.salonId, t.status),
  ],
);

// One row per (tech, day) -- a scheduled unavailable window (lunch break,
// personal appointment, etc), distinct from a full-day override (see
// techDayOverrides below). Direct 1:1 mapping of the frontend's TimeBlock;
// own version/updatedAt/updatedBy since two terminals editing the same
// block is a realistic collision (same model as appointments).
export const timeBlocks = pgTable(
  "time_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    techId: uuid("tech_id").notNull().references(() => techs.id, { onDelete: "cascade" }),
    dateKey: date("date_key", { mode: "string" }).notNull(),
    startMin: integer("start_min").notNull(),
    durationMin: integer("duration_min").notNull(),
    reason: text("reason").notNull().default(""),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("time_blocks_salon_date_idx").on(t.salonId, t.dateKey),
    index("time_blocks_tech_date_idx").on(t.techId, t.dateKey),
  ],
);

// One row per (tech, day) that overrides the tech's normal weekly
// schedule/time-off -- matches the frontend's Record<techId, TechDay>
// exactly via the unique (techId, dateKey) index, which doubles as the
// upsert key for PUT /api/staff/schedule-overrides/:techId/:dateKey.
// Deliberately NO version column -- see the Phase 2 plan's schema section
// (low-frequency, single-settings-panel edits, not a shared drag surface).
export const techDayOverrides = pgTable(
  "tech_day_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    techId: uuid("tech_id").notNull().references(() => techs.id, { onDelete: "cascade" }),
    dateKey: date("date_key", { mode: "string" }).notNull(),
    status: text("status").notNull(), // working | off | vacation | emergency | late | early
    startMin: integer("start_min"),
    endMin: integer("end_min"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("tech_day_overrides_tech_date_idx").on(t.techId, t.dateKey),
    index("tech_day_overrides_salon_date_idx").on(t.salonId, t.dateKey),
  ],
);

export const salonsRelations = relations(salons, ({ many }) => ({
  users: many(users),
  techs: many(techs),
  services: many(services),
  serviceCategories: many(serviceCategories),
  jobRoles: many(jobRoles),
  clients: many(clients),
  appointments: many(appointments),
  timeBlocks: many(timeBlocks),
  techDayOverrides: many(techDayOverrides),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ one, many }) => ({
  parent: one(serviceCategories, { fields: [serviceCategories.parentId], references: [serviceCategories.id] }),
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  category: one(serviceCategories, { fields: [services.categoryId], references: [serviceCategories.id] }),
  techSkills: many(techSkills),
  jobRoleServices: many(jobRoleServices),
}));

export const jobRolesRelations = relations(jobRoles, ({ many }) => ({
  jobRoleServices: many(jobRoleServices),
  techs: many(techs),
}));

export const jobRoleServicesRelations = relations(jobRoleServices, ({ one }) => ({
  jobRole: one(jobRoles, { fields: [jobRoleServices.jobRoleId], references: [jobRoles.id] }),
  service: one(services, { fields: [jobRoleServices.serviceId], references: [services.id] }),
}));

export const techsRelations = relations(techs, ({ one, many }) => ({
  user: one(users, { fields: [techs.userId], references: [users.id] }),
  jobRole: one(jobRoles, { fields: [techs.jobRoleId], references: [jobRoles.id] }),
  techSkills: many(techSkills),
}));

export const techSkillsRelations = relations(techSkills, ({ one }) => ({
  tech: one(techs, { fields: [techSkills.techId], references: [techs.id] }),
  service: one(services, { fields: [techSkills.serviceId], references: [services.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  client: one(clients, { fields: [appointments.clientId], references: [clients.id] }),
  tech: one(techs, { fields: [appointments.techId], references: [techs.id] }),
  service: one(services, { fields: [appointments.serviceId], references: [services.id] }),
}));

export const timeBlocksRelations = relations(timeBlocks, ({ one }) => ({
  tech: one(techs, { fields: [timeBlocks.techId], references: [techs.id] }),
}));

export const techDayOverridesRelations = relations(techDayOverrides, ({ one }) => ({
  tech: one(techs, { fields: [techDayOverrides.techId], references: [techs.id] }),
}));
