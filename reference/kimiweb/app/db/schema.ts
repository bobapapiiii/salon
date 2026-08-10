import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  varchar,
  text,
  int,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";

// ---- Salon ----
export const salons = mysqlTable("salons", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Los_Angeles"),
  phone: varchar("phone", { length: 32 }),
  address: varchar("address", { length: 255 }),
  openMin: int("open_min").notNull().default(480), // 8:00
  closeMin: int("close_min").notNull().default(1200), // 20:00
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- Staff (technicians) ----
export const roleGroupEnum = mysqlEnum("role_group", ["nails", "hair", "lashes", "spa"]);

export const staff = mysqlTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    salonId: bigint("salon_id", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    initials: varchar("initials", { length: 4 }).notNull(),
    title: varchar("title", { length: 120 }),
    roleGroup: roleGroupEnum.notNull(),
    avatarTint: varchar("avatar_tint", { length: 32 }).notNull().default("clay"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ salonIdx: index("staff_salon_idx").on(t.salonId) }),
);

// Weekly recurring schedule; minutes from midnight
export const staffSchedules = mysqlTable(
  "staff_schedules",
  {
    id: serial("id").primaryKey(),
    staffId: bigint("staff_id", { mode: "number", unsigned: true }).notNull(),
    dayOfWeek: int("day_of_week").notNull(), // 0=Sunday
    startMin: int("start_min").notNull(),
    endMin: int("end_min").notNull(),
  },
  (t) => ({ staffIdx: index("sched_staff_idx").on(t.staffId) }),
);

// ---- Service catalog ----
export const serviceCategories = mysqlTable("service_categories", {
  id: serial("id").primaryKey(),
  salonId: bigint("salon_id", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
});

export const services = mysqlTable(
  "services",
  {
    id: serial("id").primaryKey(),
    salonId: bigint("salon_id", { mode: "number", unsigned: true }).notNull(),
    categoryId: bigint("category_id", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    durationMin: int("duration_min").notNull(),
    processingMin: int("processing_min").notNull().default(0),
    bufferMin: int("buffer_min").notNull().default(0),
    priceCents: int("price_cents").notNull(),
    onlineBookable: boolean("online_bookable").notNull().default(true),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({ salonIdx: index("svc_salon_idx").on(t.salonId) }),
);

export const staffServices = mysqlTable(
  "staff_services",
  {
    id: serial("id").primaryKey(),
    staffId: bigint("staff_id", { mode: "number", unsigned: true }).notNull(),
    serviceId: bigint("service_id", { mode: "number", unsigned: true }).notNull(),
  },
  (t) => ({
    staffIdx: index("ss_staff_idx").on(t.staffId),
    svcIdx: index("ss_svc_idx").on(t.serviceId),
  }),
);

// ---- Clients ----
export const clients = mysqlTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    salonId: bigint("salon_id", { mode: "number", unsigned: true }).notNull(),
    firstName: varchar("first_name", { length: 80 }).notNull(),
    lastName: varchar("last_name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 320 }),
    notes: text("notes"),
    noShowCount: int("no_show_count").notNull().default(0),
    blocked: boolean("blocked").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ salonIdx: index("cli_salon_idx").on(t.salonId) }),
);

export const clientNotes = mysqlTable(
  "client_notes",
  {
    id: serial("id").primaryKey(),
    clientId: bigint("client_id", { mode: "number", unsigned: true }).notNull(),
    kind: mysqlEnum("kind", ["allergy", "alert", "preference", "general"]).notNull(),
    text: text("text").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ clientIdx: index("cn_client_idx").on(t.clientId) }),
);

// ---- Appointments (header + segments) ----
// Dates stored as 'YYYY-MM-DD' + minute offsets for simple salon-day math.
export const appointments = mysqlTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    salonId: bigint("salon_id", { mode: "number", unsigned: true }).notNull(),
    clientId: bigint("client_id", { mode: "number", unsigned: true }).notNull(),
    status: mysqlEnum("status", [
      "requested",
      "confirmed",
      "checked-in",
      "in-progress",
      "completed",
      "cancelled",
      "no-show",
    ]).notNull(),
    source: mysqlEnum("source", ["front-desk", "online", "walk-in"]).notNull().default("front-desk"),
    date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
    startMin: int("start_min").notNull(), // denormalized: min segment start
    endMin: int("end_min").notNull(), // denormalized: max segment end
    sameTimeGroupId: varchar("same_time_group_id", { length: 40 }),
    noteToSalon: text("note_to_salon"),
    internalNote: text("internal_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    salonDateIdx: index("appt_salon_date_idx").on(t.salonId, t.date),
    clientIdx: index("appt_client_idx").on(t.clientId),
  }),
);

export const appointmentServices = mysqlTable(
  "appointment_services",
  {
    id: serial("id").primaryKey(),
    appointmentId: bigint("appointment_id", { mode: "number", unsigned: true }).notNull(),
    serviceId: bigint("service_id", { mode: "number", unsigned: true }).notNull(),
    requestedStaffId: bigint("requested_staff_id", { mode: "number", unsigned: true }),
    staffId: bigint("staff_id", { mode: "number", unsigned: true }), // null = unassigned
    anyStaff: boolean("any_staff").notNull().default(false),
    startMin: int("start_min").notNull(),
    endMin: int("end_min").notNull(),
    durationMin: int("duration_min").notNull(),
    processingMin: int("processing_min").notNull().default(0),
    bufferMin: int("buffer_min").notNull().default(0),
    priceCents: int("price_cents").notNull(),
  },
  (t) => ({
    apptIdx: index("as_appt_idx").on(t.appointmentId),
    staffIdx: index("as_staff_idx").on(t.staffId),
  }),
);

// ---- Booking requests (online, pending approval) ----
export const bookingRequests = mysqlTable(
  "booking_requests",
  {
    id: serial("id").primaryKey(),
    salonId: bigint("salon_id", { mode: "number", unsigned: true }).notNull(),
    clientId: bigint("client_id", { mode: "number", unsigned: true }).notNull(),
    status: mysqlEnum("status", ["pending", "accepted", "declined", "countered"])
      .notNull()
      .default("pending"),
    date: varchar("date", { length: 10 }).notNull(),
    startMin: int("start_min").notNull(),
    noteToSalon: text("note_to_salon"),
    counterDate: varchar("counter_date", { length: 10 }),
    counterStartMin: int("counter_start_min"),
    appointmentId: bigint("appointment_id", { mode: "number", unsigned: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ salonIdx: index("br_salon_idx").on(t.salonId, t.status) }),
);

export const bookingRequestItems = mysqlTable(
  "booking_request_items",
  {
    id: serial("id").primaryKey(),
    requestId: bigint("request_id", { mode: "number", unsigned: true }).notNull(),
    serviceId: bigint("service_id", { mode: "number", unsigned: true }).notNull(),
    requestedStaffId: bigint("requested_staff_id", { mode: "number", unsigned: true }),
    anyStaff: boolean("any_staff").notNull().default(false),
    sameTime: boolean("same_time").notNull().default(false),
  },
  (t) => ({ reqIdx: index("bri_req_idx").on(t.requestId) }),
);

// ---- Types ----
export type Salon = typeof salons.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type StaffSchedule = typeof staffSchedules.$inferSelect;
export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type ClientNote = typeof clientNotes.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AppointmentService = typeof appointmentServices.$inferSelect;
export type BookingRequest = typeof bookingRequests.$inferSelect;
export type BookingRequestItem = typeof bookingRequestItems.$inferSelect;
