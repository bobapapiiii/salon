# Plan — Online Salon Booking Platform (Phase 1: Bones)

## Goal
Two-sided salon booking platform skeleton:
- **Salon side (staff/admin)**: schedule/calendar view for 50+ techs, easy appointment booking, requested appointments queue, services management, same-time services, client notes.
- **Client side**: online booking flow (service → tech optional → availability), account + service history.
- UI/UX first: must stay usable with 50+ technicians.

## Stage 1 — Research (deep-research-swarm)
Deploy parallel research agents:
1. Competitive landscape: Vagaro, Booksy, Fresha, Square Appointments, GlossGenius — feature sets of salon-side scheduling and client-side booking.
2. Calendar/scheduler UX patterns for large teams (50+ resources): resource-view calendars, grouping, color coding, drag-drop rescheduling.
3. Booking domain data model: services, add-ons, same-time services, tech requests, statuses, notes, history.
Output: research brief saved to `/mnt/agents/output/salon-platform/research.md`

## Stage 2 — Architecture & UX Blueprint (orchestrator-designed)
From research, define:
- Data model (users, techs, services, appointments, appointment_services, notes)
- Screen map: salon side (Schedule, Requests, Services, Clients) / client side (Book, My Appointments, History)
- Key UX decisions for 50+ tech scale
Output: `/mnt/agents/output/salon-platform/blueprint.md`

## Stage 3 — Build Skeleton (vibecoding-webapp-swarm + webapp-building-swarm + backend-building-swarm)
- Frontend: React + TS + Tailwind + shadcn/ui. Salon-side schedule grid + client-side booking flow.
- Backend: tRPC + Drizzle + Hono + MySQL via backend-building-swarm.
- Phase 1 scope (bones): working schedule view, book/reschedule appointments, service catalog, booking requests queue, client booking flow, client history. No payments/notifications yet.
Output: running full-stack app, delivered via website_version_manager.

## Stage 4 — Validate & Deliver
- Verify build, save website version, report to user + propose Phase 2.
