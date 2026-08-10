import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import * as q from "./queries/salon";

const salonIdInput = z.object({ salonId: z.number().int().positive() });

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  salon: createRouter({
    get: publicQuery.query(() => q.getSalon()),
    today: publicQuery.query(() => ({ today: q.todayStr() })),
  }),

  staff: createRouter({
    list: publicQuery.input(salonIdInput).query(({ input }) => q.listStaff(input.salonId)),
  }),

  services: createRouter({
    list: publicQuery.input(salonIdInput).query(({ input }) => q.listServices(input.salonId)),
    create: publicQuery
      .input(
        salonIdInput.extend({
          categoryId: z.number(),
          name: z.string().min(1),
          description: z.string().optional(),
          durationMin: z.number().int().min(5),
          processingMin: z.number().int().min(0).default(0),
          bufferMin: z.number().int().min(0).default(0),
          priceCents: z.number().int().min(0),
          onlineBookable: z.boolean().default(true),
          requiresApproval: z.boolean().default(false),
          staffIds: z.array(z.number()).optional(),
        }),
      )
      .mutation(({ input }) => {
        const { salonId, ...data } = input;
        return q.createService(salonId, data);
      }),
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          data: z.object({
            name: z.string().min(1).optional(),
            description: z.string().optional(),
            durationMin: z.number().int().min(5).optional(),
            processingMin: z.number().int().min(0).optional(),
            bufferMin: z.number().int().min(0).optional(),
            priceCents: z.number().int().min(0).optional(),
            onlineBookable: z.boolean().optional(),
            requiresApproval: z.boolean().optional(),
            active: z.boolean().optional(),
          }),
          staffIds: z.array(z.number()).optional(),
        }),
      )
      .mutation(({ input }) => q.updateService(input.id, input.data, input.staffIds)),
  }),

  clients: createRouter({
    list: publicQuery
      .input(salonIdInput.extend({ search: z.string().optional() }))
      .query(({ input }) => q.listClients(input.salonId, input.search)),
    get: publicQuery.input(z.object({ id: z.number() })).query(({ input }) => q.getClient(input.id)),
    create: publicQuery
      .input(
        salonIdInput.extend({
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ input }) => {
        const { salonId, ...data } = input;
        return q.createClient(salonId, data);
      }),
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          data: z.object({
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            phone: z.string().optional(),
            email: z.string().optional(),
            notes: z.string().optional(),
            blocked: z.boolean().optional(),
          }),
        }),
      )
      .mutation(({ input }) => q.updateClient(input.id, input.data)),
    addNote: publicQuery
      .input(
        z.object({
          clientId: z.number(),
          kind: z.enum(["allergy", "alert", "preference", "general"]),
          text: z.string().min(1),
          pinned: z.boolean().default(false),
        }),
      )
      .mutation(({ input }) => {
        const { clientId, ...note } = input;
        return q.addClientNote(clientId, note);
      }),
  }),

  appointments: createRouter({
    byDate: publicQuery
      .input(salonIdInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .query(({ input }) => q.listAppointmentsByDate(input.salonId, input.date)),
    forClient: publicQuery
      .input(z.object({ clientId: z.number() }))
      .query(({ input }) => q.listClientAppointments(input.clientId)),
    create: publicQuery
      .input(
        salonIdInput.extend({
          clientId: z.number(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          items: z
            .array(
              z.object({
                serviceId: z.number(),
                staffId: z.number().nullish(),
                requestedStaffId: z.number().nullish(),
                anyStaff: z.boolean().default(false),
                startMin: z.number().int(),
              }),
            )
            .min(1),
          source: z.enum(["front-desk", "online", "walk-in"]).default("front-desk"),
          status: z
            .enum(["requested", "confirmed", "checked-in", "in-progress", "completed", "cancelled", "no-show"])
            .default("confirmed"),
          noteToSalon: z.string().optional(),
          internalNote: z.string().optional(),
          sameTimeGroupId: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { salonId, ...data } = input;
        return q.createAppointment(salonId, data);
      }),
    reschedule: publicQuery
      .input(
        z.object({
          id: z.number(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          startMin: z.number().int().optional(),
          staffId: z.number().nullable().optional(),
        }),
      )
      .mutation(({ input }) => {
        const { id, ...data } = input;
        return q.rescheduleAppointment(id, data);
      }),
    updateStatus: publicQuery
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["requested", "confirmed", "checked-in", "in-progress", "completed", "cancelled", "no-show"]),
        }),
      )
      .mutation(({ input }) => q.updateAppointmentStatus(input.id, input.status)),
  }),

  requests: createRouter({
    list: publicQuery
      .input(
        salonIdInput.extend({
          status: z.enum(["pending", "accepted", "declined", "countered"]).optional(),
        }),
      )
      .query(({ input }) => q.listBookingRequests(input.salonId, input.status)),
    forClient: publicQuery
      .input(z.object({ clientId: z.number() }))
      .query(({ input }) => q.listClientRequests(input.clientId)),
    create: publicQuery
      .input(
        salonIdInput.extend({
          clientId: z.number(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          startMin: z.number().int(),
          noteToSalon: z.string().optional(),
          items: z
            .array(
              z.object({
                serviceId: z.number(),
                requestedStaffId: z.number().nullish(),
                anyStaff: z.boolean().default(false),
                sameTime: z.boolean().default(false),
              }),
            )
            .min(1),
        }),
      )
      .mutation(({ input }) => {
        const { salonId, ...data } = input;
        return q.createBookingRequest(salonId, data);
      }),
    accept: publicQuery
      .input(
        z.object({
          id: z.number(),
          assignments: z.array(z.object({ staffId: z.number().nullable() })).optional(),
        }),
      )
      .mutation(({ input }) => q.acceptBookingRequest(input.id, input.assignments)),
    decline: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => q.declineBookingRequest(input.id)),
    counter: publicQuery
      .input(
        z.object({
          id: z.number(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          startMin: z.number().int(),
        }),
      )
      .mutation(({ input }) => {
        const { id, ...counter } = input;
        return q.counterBookingRequest(id, counter);
      }),
    clientDeclineCounter: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => q.clientDeclineCounter(input.id)),
  }),

  availability: createRouter({
    slots: publicQuery
      .input(
        salonIdInput.extend({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          items: z
            .array(z.object({ serviceId: z.number(), sameTime: z.boolean().default(false) }))
            .min(1),
          staffId: z.number().nullish(),
          stepMin: z.number().int().default(15),
        }),
      )
      .query(({ input }) =>
        q.getAvailability(input.salonId, input.date, input.items, input.staffId, input.stepMin),
      ),
  }),
});

export type AppRouter = typeof appRouter;
