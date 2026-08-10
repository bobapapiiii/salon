# Salon Booking Platform — Architecture & UX Blueprint (Phase 1: Bones)

Synthesized from competitive research (Vagaro, Booksy, Fresha, Square, Mangomint, Zenoti), scheduler-UX research, and booking-domain modeling research.

## Differentiators we bake in from the start
1. Calendar designed for **50+ techs** (most competitors degrade past ~10 columns).
2. **Nail/hair scheduling physics**: processing-time gaps, same-time multi-tech services, walk-ins alongside bookings.
3. Request/approval flow as a first-class status (Square/Vagaro model).
4. Fast, clean UI — front-desk speed is the category's #1 complaint driver.

## Tech stack
- Frontend: React + TypeScript + Tailwind CSS + shadcn/ui (Vite).
- Backend: Hono + tRPC + Drizzle ORM + MySQL (backend-building-swarm graft).
- Schedule grid: **custom-built resource calendar** (salon-specific rendering; no paid lib for the bones). Client picker: custom day-strip + slot grid.

## Data model (Phase 1 subset of researched schema)
- `salons` (id, name, timezone)
- `staff` (id, salon_id, name, title, role_group [e.g. Nails, Hair, Lashes], color, pricing_tier, active)
- `clients` (id, salon_id, first_name, last_name, email, phone, notes, no_show_count, is_blocked)
- `service_categories` (id, salon_id, name, sort_order)
- `services` (id, salon_id, category_id, name, description, duration_minutes, processing_minutes, buffer_after_minutes, price, is_online_bookable, requires_approval, active)
- `staff_services` (staff_id, service_id) — qualifications
- `staff_schedules` (staff_id, day_of_week, start_time, end_time)
- `appointments` (id, salon_id, client_id, status enum[requested,confirmed,checked_in,in_progress,completed,cancelled,no_show], source enum[online,staff,walk_in], start_at, end_at, client_note, internal_note)
- `appointment_services` (id, appointment_id, service_id, requested_staff_id nullable, staff_id nullable, any_staff bool, start_at, duration_minutes, processing_minutes, price_charged)
  → header + segments model (Square-style). Same-time services = two segments, same start_at, different staff_id. Requested tech preserved separately from assigned tech.
- `client_notes` (id, client_id, staff_id, type[general,allergy,alert,preference], note, is_pinned)

## Screen map

### Salon side (`/salon/*`)
1. **Schedule** (`/salon/schedule`) — the centerpiece:
   - Day view, tech-per-column, **min column width ~110px + horizontal scroll** (never squeeze).
   - **Collapsible groups** by role (Nails / Hair / Lashes) with sticky group headers.
   - Filter: "working today" default, tech search, hide/show techs.
   - Color = service category (legend); status via border/icon/opacity (requested = dashed outline, confirmed = solid, checked-in = check icon, in-progress = animated fill, no-show = hatched red border).
   - Processing-time rendered as faded segment inside the block.
   - Click empty slot → quick-create modal (client, service, tech prefilled, same-time service option).
   - Click appointment → popover (details, check-in, no-show, complete, cancel) → full edit modal.
   - Drag to reschedule (another tech column or time) + resize duration; undo toast.
   - "Requests" badge + side rail showing pending requested appointments (accept / decline / propose time).
   - Unassigned lane ("Any tech") column for online bookings without assignment.
   - Now-line, faded past appointments, density zoom (15/30/60 min).
2. **Requests** (`/salon/requests`) — queue of pending online bookings: accept, decline, propose new time.
3. **Services** (`/salon/services`) — catalog CRUD: categories, duration, processing time, buffer, price, online-bookable, requires-approval, qualified techs.
4. **Clients** (`/salon/clients`) — list + detail: notes (allergy/alert flags), history, no-show count.

### Client side (`/book/*`)
1. **Book** (`/book`) — canonical flow:
   - Step 1: service picker by category (price + duration shown; multi-select for stacked services + same-time option).
   - Step 2: tech picker with **"Any available"** default (cards with name/role).
   - Step 3: availability — horizontal day-strip (14 days) + time-slot grid; only genuinely bookable slots; "Next available" shortcut card.
   - Step 4: details (name/phone/email or returning-client) + note → confirm. If service requires approval → "Request sent" state.
2. **My Appointments** (`/book/appointments`) — upcoming (reschedule/cancel) + past history with service/tech/price.
3. **Account** (`/book/account`) — profile + service history.

## Phase 1 scope (bones)
- Seeded salon with ~16 techs across 3 role groups (UI must not break at 50 — test by duplicating seed techs).
- All screens above functional against real MySQL via tRPC.
- No auth for Phase 1 (demo salon + demo client switcher), no payments, no SMS/email, no recurring, no walk-in queue rail (walk-in = appointment with source=walk_in).
- Availability computation server-side from staff_schedules − appointments (with buffers).

## UX/visual standards
- Low-saturation warm palette, ample whitespace, clear hierarchy (per default standards). No blue-purple gradients.
- Front-desk speed: sub-second interactions, optimistic updates on drag.
- Tablet-friendly tap targets (≥44px) on salon side; mobile-first on client side.
