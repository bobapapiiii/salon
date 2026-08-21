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
  },
  (t) => [index("services_salon_idx").on(t.salonId)],
);

export const techs = pgTable(
  "techs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title"), // job role label, e.g. "Nail Tech", "Senior Tech"
    active: boolean("active").notNull().default(true),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
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
  },
  (t) => [
    index("clients_salon_idx").on(t.salonId),
    index("clients_salon_phone_idx").on(t.salonId, t.phone),
    index("clients_salon_email_idx").on(t.salonId, t.email),
  ],
);

// Online-booking requests land here as status "requested" until a staff
// member approves or declines them; this table is deliberately NOT the
// same as the frontend's localStorage `Appointment` type -- the two are
// bridged manually (see server/README.md) rather than unified in this pass.
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salonId: uuid("salon_id").notNull().references(() => salons.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    techId: uuid("tech_id").notNull().references(() => techs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
    dateKey: date("date_key").notNull(), // "YYYY-MM-DD", matches the frontend's dateKey convention
    startMin: integer("start_min").notNull(), // minutes from midnight, salon-local time
    durationMin: integer("duration_min").notNull(),
    status: text("status").notNull().default("requested"), // requested | confirmed | declined | cancelled
    source: text("source").notNull().default("online"), // online | front_desk | pos (future)
    clientNote: text("client_note"),
    staffNote: text("staff_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("appointments_salon_date_idx").on(t.salonId, t.dateKey),
    index("appointments_tech_date_idx").on(t.techId, t.dateKey),
    index("appointments_status_idx").on(t.salonId, t.status),
  ],
);

export const salonsRelations = relations(salons, ({ many }) => ({
  users: many(users),
  techs: many(techs),
  services: many(services),
  serviceCategories: many(serviceCategories),
  clients: many(clients),
  appointments: many(appointments),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  category: one(serviceCategories, { fields: [services.categoryId], references: [serviceCategories.id] }),
  techSkills: many(techSkills),
}));

export const techsRelations = relations(techs, ({ one, many }) => ({
  user: one(users, { fields: [techs.userId], references: [users.id] }),
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
