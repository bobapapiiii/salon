# Research & Product Brief — Two-Sided Salon Booking Platform (Phase 1: Bones)

## What we're building
An online booking platform for nail/hair salons with two sides, designed to stay fast and readable even for salons with **50+ technicians** (most competitors degrade past ~10 staff columns). This phase builds the structural bones: a real data model, the salon-side schedule, and the client-side booking flow. Demo brand: "Lumina Salon".

## Competitive research summary (Vagaro, Booksy, Fresha, Square Appointments, Mangomint, Zenoti)
- Table stakes salon-side: staff-per-column day calendar, drag-and-drop reschedule, color coding, conflict prevention, waitlist, request/approval mode, service catalog with duration/price/buffer/processing time, client notes with allergy/alert flags, no-show tracking.
- Table stakes client-side: service → staff ("any available" option) → real-time date/time grid → confirm; rebooking; history.
- Top complaints in the category: slow/cluttered front-desk UI (Vagaro), forced account creation hurting booking conversion (Vagaro/Booksy), per-seat pricing that explodes for large teams (Booksy/Fresha ≈ $1,000/mo at 50 staff), calendars not designed for large teams.
- Mangomint (highest-rated, built for teams of 2–50+) proves the winning formula: uncluttered fast calendar, color by status OR category with a toggle, zoom levels for short services, filter to scheduled staff only.

## Screen map (build exactly these pages)

### Landing / entry
1. **Home (`/`)** — product entry page for the demo platform: hero explaining the two-sided platform, two big entry cards ("Salon Dashboard" → /salon/schedule, "Book an Appointment" → /book), feature highlights (50+ tech schedule, same-time services, request approvals, client history). Not a marketing site — a clean product shell entry.

### Salon side (staff/admin) — desktop-first, tablet-friendly
2. **Schedule (`/salon/schedule`)** — the centerpiece. Day-view resource calendar:
   - One column per technician, **min column width ~110px, horizontal scroll** — never squeeze columns.
   - Technicians in **collapsible role groups** (Nails / Hair / Lashes) with sticky group headers; filter bar: "working today" toggle, tech search, group visibility.
   - Time gutter 8:00–20:00, density zoom (15/30/60 min), now-line, faded past appointments.
   - Appointment blocks: color = service category (legend in header); **status shown non-color**: requested = dashed outline, confirmed = solid, checked-in = check icon, in-progress = progress fill, completed = muted, no-show = red border, cancelled = ghosted.
   - **Processing time** rendered as a faded/hatched segment within the block (color services).
   - Click empty slot → quick-create appointment modal (client search/select, service, tech + time prefilled, option to add a same-time second service with another tech).
   - Click appointment → popover (client, services, notes/allergy alert icons; actions: check-in, start, complete, no-show, cancel, edit) → full edit modal (change time, tech, services, notes).
   - Drag appointment to another time or tech column; resize edges to change duration; undo toast after every change.
   - **Requests rail** (right side, collapsible): pending requested appointments with Accept / Decline / Propose-time.
   - An **"Unassigned"** column for online bookings without a tech.
3. **Requests (`/salon/requests`)** — full queue view of pending online booking requests: client, services, requested tech vs any, proposed times; accept / decline / propose new time.
4. **Services (`/salon/services`)** — catalog management: categories with services; each service shows duration, processing time, buffer, price, online-bookable toggle, requires-approval toggle; add/edit modal; qualified-techs assignment.
5. **Clients (`/salon/clients`)** — searchable client list; detail drawer: contact, pinned notes (allergy = red flag, alert = amber, preference = neutral), visit history, no-show count, block toggle.

### Client side — mobile-first
6. **Book (`/book`)** — 4-step flow with progress indicator:
   - Step 1 Services: browse by category, price + duration on each card; multi-select; for a second service choose "at the same time" or "back-to-back".
   - Step 2 Technician: card grid, **"Any available"** as first/recommended card; per-service tech override when same-time selected.
   - Step 3 Date & time: horizontal 14-day strip + time-slot grid for selected day; **only genuinely bookable slots**; prominent "Next available" card.
   - Step 4 Details: name/phone/email, note to salon; confirm → success screen (or "Request sent — salon will confirm" if the service requires approval).
7. **My Appointments (`/book/appointments`)** — upcoming appointments (status badges, reschedule/cancel) and past history (service, tech, price, date); "Book again" shortcut.
8. **Account (`/book/account`)** — profile info + full service history timeline.

## UX/visual requirements
- Low-saturation warm palette, ample whitespace, clear hierarchy; no blue-purple gradients; no Google-style look. Professional, calm, salon-appropriate (think premium spa aesthetic, not SaaS neon).
- Front-desk speed: interactions must feel instant; optimistic UI on drag/status changes.
- Salon side desktop-first with ≥44px tap targets; client side mobile-first.
- Demo data: one salon "Lumina Salon", ~16 technicians across Nails/Hair/Lashes groups, realistic service catalog (manicure, gel-x, pedicure, acrylic fill, haircut, balayage with 45-min processing time, lash extensions...), ~12 clients, appointments across today and the coming week including requested/confirmed/checked-in statuses and one same-time mani+pedi pair.

## Build type
Full-stack: tRPC + Drizzle + Hono + MySQL backend (db only — no auth in this phase; a simple demo "view as salon / view as client" switch is enough).

## Data model contract (backend owns this; UI consumes via tRPC)
salons, staff(salon_id, name, title, role_group, color, active), clients(salon_id, first/last name, email, phone, notes, no_show_count, is_blocked), service_categories, services(category_id, name, description, duration_minutes, processing_minutes, buffer_after_minutes, price, is_online_bookable, requires_approval, active), staff_services, staff_schedules(staff_id, day_of_week, start_time, end_time), appointments(client_id, status[requested,confirmed,checked_in,in_progress,completed,cancelled,no_show], source[online,staff,walk_in], start_at, end_at, client_note, internal_note), appointment_services(appointment_id, service_id, requested_staff_id, staff_id, any_staff, start_at, duration_minutes, processing_minutes, price_charged), client_notes(client_id, type[general,allergy,alert,preference], note, is_pinned).
