import { relations } from "drizzle-orm";
import {
  salons,
  staff,
  staffSchedules,
  serviceCategories,
  services,
  staffServices,
  clients,
  clientNotes,
  appointments,
  appointmentServices,
  bookingRequests,
  bookingRequestItems,
} from "./schema";

export const salonsRelations = relations(salons, ({ many }) => ({
  staff: many(staff),
  services: many(services),
  clients: many(clients),
}));

export const staffRelations = relations(staff, ({ many }) => ({
  schedules: many(staffSchedules),
  staffServices: many(staffServices),
  appointmentServices: many(appointmentServices),
}));

export const staffSchedulesRelations = relations(staffSchedules, ({ one }) => ({
  staff: one(staff, { fields: [staffSchedules.staffId], references: [staff.id] }),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ many }) => ({
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  category: one(serviceCategories, {
    fields: [services.categoryId],
    references: [serviceCategories.id],
  }),
  staffServices: many(staffServices),
}));

export const staffServicesRelations = relations(staffServices, ({ one }) => ({
  staff: one(staff, { fields: [staffServices.staffId], references: [staff.id] }),
  service: one(services, { fields: [staffServices.serviceId], references: [services.id] }),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  notes: many(clientNotes),
  appointments: many(appointments),
}));

export const clientNotesRelations = relations(clientNotes, ({ one }) => ({
  client: one(clients, { fields: [clientNotes.clientId], references: [clients.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  client: one(clients, { fields: [appointments.clientId], references: [clients.id] }),
  items: many(appointmentServices),
}));

export const appointmentServicesRelations = relations(appointmentServices, ({ one }) => ({
  appointment: one(appointments, {
    fields: [appointmentServices.appointmentId],
    references: [appointments.id],
  }),
  service: one(services, {
    fields: [appointmentServices.serviceId],
    references: [services.id],
  }),
  staff: one(staff, {
    fields: [appointmentServices.staffId],
    references: [staff.id],
  }),
  requestedStaff: one(staff, {
    fields: [appointmentServices.requestedStaffId],
    references: [staff.id],
  }),
}));

export const bookingRequestsRelations = relations(bookingRequests, ({ one, many }) => ({
  client: one(clients, { fields: [bookingRequests.clientId], references: [clients.id] }),
  items: many(bookingRequestItems),
}));

export const bookingRequestItemsRelations = relations(bookingRequestItems, ({ one }) => ({
  request: one(bookingRequests, {
    fields: [bookingRequestItems.requestId],
    references: [bookingRequests.id],
  }),
  service: one(services, {
    fields: [bookingRequestItems.serviceId],
    references: [services.id],
  }),
  requestedStaff: one(staff, {
    fields: [bookingRequestItems.requestedStaffId],
    references: [staff.id],
  }),
}));
