# Salon Booking Platform — Product & Technical Plan

**Status:** Draft v2 — incorporates owner feedback (2026-07-24)
**Owner context:** Nail salon operator, currently on Zenoti, **70 technicians**, appointment-heavy (must also support walk-in-heavy operation)
**Goal:** A two-sided booking platform — an ops console for the salon and a self-serve booking experience for clients — that feels effortless at 3 techs and still works at 100+.

---

## 1. Vision

> The appointment book is the product. Everything else (client records, notes, payments, reports) hangs off it.

Two facets, one shared real-time data core:

- **Salon Console** — the digital appointment book: schedule, book, move, approve, note. Fast for front desk, glanceable for techs, powerful for owners.
- **Client Booking** — mobile-first self-serve booking: pick service → pick tech (or "any") → pick time → done. Plus an account with full service history and one-tap rebooking.

**Design principles (non-negotiables):**

1. **Fast is a feature** — the #1 Zenoti complaint is slowness under real data volume. Sub-second loads, instant client search, optimistic UI everywhere. Speed is an architecture decision, not a polish pass. (See §9.)
2. **Glanceable** — a tech reads their whole day in 3 seconds; a manager reads 70 techs' day in 10.
3. **Everything is draggable** — reschedule, reassign, extend: no forms required. Moving appointments must be *delightful* — clunky appointment moves are a stated Zenoti pain point.
4. **Fast beats complete** — booking an appointment takes ≤ 15 seconds at the front desk; ≤ 60 seconds for a client on their phone.
5. **Scales by zooming, not paginating** — 3 techs or 130 techs, same calendar, different zoom.
6. **Deep but learnable** — match Zenoti's feature depth without its learning curve: sane defaults, progressive disclosure, contextual in-app help. Powerful on day 30, productive on day 1.
7. **Mobile-first, desktop-strong** — techs live on phones; front desk lives on desktop/tablet.

---

## 2. Competitive Research Summary

Reviewed Zenoti, Vagaro, Fresha, Booksy, Mangomint, Boulevard, GlossGenius, Square Appointments, Mindbody, Phorest (2026 sources) + direct owner experience with Zenoti.

| Platform | What users love | What users complain about |
|---|---|---|
| **Zenoti** (owner's current) | Deepest, most detailed feature set; great scheduling calendar; robust client online-booking customization that can match salon aesthetics; AI help bot (Zeenie); staff app (myZen); multi-location architecture | **Slow loading under heavy data volume** (large client base, many techs); steep learning curve; clunky appointment moves; enterprise heaviness |
| **Vagaro** | Feature depth at low price; payroll + inventory included | "Functional but dated" UI; feature-dense and slow; per-staff pricing adds up |
| **Mangomint** | Modern clean calendar UX — frequently cited as best-in-class interface | Weak multi-location; less granular service timing |
| **Boulevard** | Premium client experience; strong waitlist | Annual contracts; pricey |
| **Fresha / Booksy** | Free/cheap entry; client marketplace brings new customers; great mobile apps | Marketplace fees; shallow ops features; basic reporting |
| **GlossGenius** | Best-in-class polish for solo techs; fast setup | Doesn't scale to teams; fixed durations |
| **Square Appointments** | Seamless payments | Not salon-specific; weak scheduling depth |

**Recurring pain points across the industry (our opportunities):**

- **Performance at scale** — big salons outgrow their software's speed (owner-confirmed with Zenoti at 70 techs).
- **"One system vs. four apps"** — booking, POS, notes, and reminders that don't talk to each other is the #1 frustration on salon forums.
- **Dated, dense UIs + learning curves** — staff won't use software they don't trust; ease of use drives adoption more than feature lists.
- **Double-bookings & sync lag** — the calendar must be real-time for every device, no exceptions.
- **No-shows** — solved by automated SMS reminders (24h + 2h) + deposits/card-on-file; platforms report 25–40% no-show reduction.
- **Color/processing time wasted** — split-timing (tech free during processing windows) can raise utilization ~20%+; nail salons have analogous dry-time and parallel-service logic.

**Our wedge:** Zenoti-grade scheduling depth and booking customization, with Mangomint-grade UX, *engineered for speed at 70–130 tech scale*, mobile-first and purpose-built for nail salon workflows (same-time mani+pedi as a first-class flow) — then grows into payments, POS, and multi-location.

---

## 3. Personas & Roles

| Role | Device | Top jobs |
|---|---|---|
| **Owner / Manager** | Desktop + phone | See the whole book (70+ techs), approve requests, track utilization/revenue, manage staff & services |
| **Front desk** | Desktop/tablet | Book fast, move things, check clients in/out, handle walk-ins & waitlist |
| **Technician** | Phone | See *my* day, client notes/history, mark status, request time off |
| **Client** | Phone (web) | Book/rebook/cancel, see history, manage preferences & card |

Role-based access control (RBAC) from day one: `owner > manager > frontdesk > tech > client`, permission flags per location.

---

## 4. Salon Console — Feature Spec

### 4.1 The Appointment Book (hero screen)

- **Column-per-tech day view**, color-coded by service category, with tech avatar + name on top.
- **Views:** Day / Week / "My day" (tech's phone view) / List (agenda).
- **Direct manipulation (a stated Zenoti pain point — must be excellent):**
  - Click empty slot → quick-book popover (client search → service → confirm; < 15s).
  - Drag to move time, drag across columns to reassign tech, drag edge to extend duration.
  - **Multi-select drag:** move a client's parallel mani+pedi pair together.
  - Live drop-target preview + conflict warnings *while* dragging (red glow if invalid for that tech/skill); undo for every move.
  - Right-click / long-press → context menu (check-in, no-show, cancel, note, checkout).
- **Status at a glance:** booked · confirmed · checked-in · in-service · completed · no-show — shown via border/icon so color stays reserved for service category.
- **Live sync:** every change broadcasts instantly to all devices (WebSocket). No refresh, no stale double-bookings.

### 4.2 Scaling the calendar: 1 → 100+ techs — DAY-ONE REQUIREMENT

**Validated by owner: 70 techs today.** This is not a later-phase concern — the MVP ships with the full scaling model. Layered strategy:

1. **Zoom levels (semantic zoom):**
   - *Comfortable* (≤8 techs): full-height cards, client name + service + notes icon.
   - *Compact* (~8–20): slimmer cards, name + service abbreviation.
   - *Overview* (20–100+): heat-strip density view — bars of color per tech; click or pinch to zoom into a cluster.
2. **Grouping/swimlanes:** group tech columns by team, station type (nail desk / pedi chair / private room), or shift. Collapse groups to headers showing "7/9 booked".
3. **Virtualized rendering:** only visible columns/rows render — 130 columns stays 60fps.
4. **Filter & quick-jump:** filter by team/service/skill; type-ahead "jump to tech"; pin favorite techs to the left.
5. **Utilization rail (optional right panel):** % booked per tech today — drag an appointment from an overloaded column onto an under-booked one.

### 4.3 Booking engine rules (salon side)

- **Same-time services (MVP — nail salon core workflow):** one appointment, multiple services at once — the classic mani with Tech A *while* pedi with Tech B. The engine computes overlapping segments and blocks *all* involved techs/resources. Also supports sequential multi-service (mani → then pedi, same or different techs, auto-chained) and single-service bookings. All three flows are one code path with different segment layouts. Foundation for group/party bookings later.
- **Booking policy engine (owner-specified):** salon-level default of **auto-confirm** *or* **require approval**, overridable per service and per tech (e.g., auto-confirm returning clients for standard services; approval-required for nail-art sets or a specific senior tech). Approval-required bookings land in a **pending queue** badge on the calendar; approve → client auto-notified; decline → suggest alternates. Nothing silently drops onto the book.
- **Processing/split time:** services can have phases (apply → process/dry → finish) where the tech is free during the middle phase — the calendar renders the "free" window as bookable.
- **Buffers:** per-service or per-tech cleanup/setup padding, enforced automatically.
- **Walk-ins & waitlist:** walk-in queue alongside the book (must support walk-in-heavy salons even though owner is appointment-heavy); when a slot opens, waitlisted clients get an auto-SMS offer ("A 2:30 with Linh just opened — reply Y to take it").
- **Recurring appointments:** weekly/biweekly standing bookings for regulars.
- **Double-book prevention:** hard conflict checks at write time (not just UI), per tech + room/resource.

### 4.4 Notes (everywhere they matter)

- **Client notes** — preferences, allergies, "hates small talk", photos of past sets/designs.
- **Appointment notes** — attached to one visit ("used OPI Bubble Bath + chrome").
- **Design/formula history** — photo gallery per client, visible to the tech before the appointment.
- Notes surface as a badge on the appointment card; tapping opens them in-context.

### 4.5 Staff management

- Shifts/availability per tech, recurring patterns, time-off requests with approval flow.
- Skills/tags per tech ("Gel-X", "acrylic", "nail art") — services require skills; booking engine only offers qualified techs.
- Commission tracking hooks (Phase 3).

### 4.6 Learnability layer (anti-learning-curve)

- Progressive disclosure: default views stay simple; advanced features reveal in context.
- Contextual empty states, inline tips, and a searchable help center from day one.
- **Phase 4: AI help assistant** (inspired by Zenoti's Zeenie, which the owner values) — "how do I…" answered in-app, plus AI-assisted schedule suggestions.

### 4.7 Later phases (designed-for, built-later)

POS/checkout, deposits & card-on-file, no-show fees, gift cards, memberships/packages, inventory, marketing campaigns, multi-location dashboards, payroll export, AI receptionist/after-hours booking.

---

## 5. Client Side — Feature Spec

Mobile-first web app (PWA — installable, no app-store friction; native wrapper optional later).

1. **Book:** pick service (category browsable, photos + price + duration) → "Any technician" or a specific tech → availability grid (only *real* bookable slots, respecting skills, shifts, buffers) → confirm. Guest checkout allowed; account optional but rewarded.
2. **Same-time booking for clients:** "Mani + Pedi together" presented as one combined option with total time and price; engine assigns one or two techs automatically (client can still request a specific tech for either part).
3. **Salon-branded booking portal (Zenoti-praised feature):** robust but *easy* customization — logo, brand colors, fonts, service photos, banner, policies, custom domain. Theme presets with guardrails so a salon can match its aesthetics in minutes, not days. Live preview while editing.
4. **Requests vs instant confirm:** honors the salon's booking policy engine — client sees either "Confirmed ✓" or "Request sent — we'll text you within X" transparently.
5. **Availability transparency:** calendar shows open slots per tech; "next available with Lan" shortcut.
6. **My account:**
   - Upcoming appointments — reschedule/cancel inside the salon's policy window.
   - Full service history (date, tech, service, price, photos).
   - **One-tap rebook** — "Same as last time with Mia" is the single highest-value button in the client app.
   - Saved preferences (usual tech, usual set), notes to the salon, card on file.
7. **Notifications:** SMS/email confirmations, 24h + 2h reminders with confirm/reschedule links, waitlist offers.
8. **Trust & policy:** prices shown upfront, cancellation policy acknowledged at booking, deposits where required.

---

## 6. UI/UX Design System

- **Stack:** Tailwind CSS + shadcn/ui primitives, custom `dnd-kit`-based calendar component (purpose-built — this is the crown jewel, don't buy a generic scheduler).
- **Tokens:** 8pt spacing grid; service-category palette (max 8 hues, colorblind-safe); status conveyed by iconography/border, never color alone.
- **Type:** single geometric sans (e.g., Inter); tabular numerals for times.
- **Touch targets:** ≥ 44px; tech's mobile view is one-thumb operable.
- **Density control:** user-settable zoom remembered per device.
- **Dark mode** for the console (long front-desk shifts).
- **Motion:** drag physics with live drop-target preview; every mutation optimistic (UI updates instantly, server confirms, silent rollback on the rare conflict).
- **Accessibility:** WCAG 2.2 AA; full keyboard operation of the calendar.

---

## 7. Technical Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  Client PWA (web)   │     │  Salon Console (web) │
└─────────┬───────────┘     └──────────┬───────────┘
          │        HTTPS + WebSocket   │
┌─────────▼────────────────────────────▼───────────┐
│  Next.js (TypeScript) — app router, RSC          │
│  API layer: tRPC/REST + availability engine       │
│  Auth: Auth.js — staff (email/SSO), client (SMS  │
│  OTP or magic link) — RBAC per location           │
├───────────────────────────────────────────────────┤
│  PostgreSQL (Prisma ORM) · Redis (slot cache +    │
│  pub/sub for realtime) · S3-compatible (photos)   │
├───────────────────────────────────────────────────┤
│  Twilio (SMS) · Resend/SES (email) · Stripe       │
│  (deposits, card-on-file, no-show fees — Phase 3) │
└───────────────────────────────────────────────────┘
```

**Key backend services:**

- **Availability engine** — given (service set, tech preference, date range), computes bookable slots from shifts − appointments − buffers, with skill matching and **parallel-service resource solving** (finding two techs free in the same window for mani+pedi). Cached in Redis, invalidated on any write touching the window.
- **Booking policy engine** — evaluates auto-confirm vs approval-required per salon/service/tech/client-type at booking time.
- **Conflict enforcement** — DB-level exclusion constraints on (tech, time range) + app-level checks for rooms/resources. UI conflicts are warnings; DB conflicts are impossible.
- **Realtime** — WebSocket channel per location; calendar subscribes to its visible window.
- **Timezones & DST** — store all times in UTC + location timezone; render in salon-local time. Multi-location means this must be right from the first schema.

---

## 8. Data Model (core entities — draft)

```
Salon ──< Location ──< Staff (tech) ──< Shift
   │           │            │
   │           │            └──< StaffSkill >── Skill
   │           ├──< Room/Station (typed: desk, pedi chair…)
   │           └──< Appointment ──< AppointmentService (line item)
   │                                   │  tech_id, start, duration,
   │                                   │  segments[] (apply/process/finish),
   │                                   │  parallel_group_id (same-time services)
   ├──< ServiceCategory ──< Service (duration, price, buffer,
   │                                phases, required skills)
   ├──< BookingPolicy (default: auto_confirm | require_approval;
   │                    overrides per service / per tech / new-vs-returning)
   ├──< SalonTheme (booking-portal branding: colors, logo, fonts,
   │                banner, photos, policies, custom domain)
   └──< Client ──< ClientNote / Photo
              └──< AppointmentService.client_id (guests on group bookings)

Appointment: status (requested/confirmed/checked_in/in_service/
             completed/no_show/cancelled), source (online/desk/walkin),
             location_id, notes, created_by
WaitlistEntry: client, service(s), preferred tech?, window, status
Notification: channel, template, status, related appointment
(Phase 3: Payment, Deposit, Package, Membership, InventoryItem…)
```

**Design callouts:**

- `AppointmentService` as line items with their own tech/time/segments + `parallel_group_id` is what makes same-time mani+pedi and split-timing first-class rather than hacks.
- Requested-appointment workflow is just a status + transition — keeps the pending queue trivial to query and the policy engine declarative.
- Everything is scoped by `location_id` even at one location — multi-location becomes a feature flag, not a migration.

---

## 9. Scalability & Performance Plan

Performance targets are written for the owner's real workload on day one: **70 techs, large client database, heavy daily booking volume.** Zenoti's slowness at this scale is the reason this product exists — these budgets are acceptance criteria, not aspirations.

| Metric | Budget |
|---|---|
| Calendar interaction (drag, zoom, filter) | < 16ms frame time, 60fps |
| Availability query | p95 < 300ms |
| Booking write round trip | < 500ms |
| Client search (100k+ records) | < 100ms, typeahead |
| Initial console load | < 1.5s on office Wi-Fi |
| Any mutation feels instant | Optimistic UI, server confirms async |

| Layer | Strategy |
|---|---|
| Calendar render | Virtualized columns/rows + semantic zoom; only visible window in DOM |
| Availability queries | Redis slot cache, invalidation on write |
| Client/appointment data | Cursor pagination everywhere — no offset scans over huge tables; trigram indexes for search |
| Realtime | One WS room/location, presence throttling |
| DB | Proper composite indexes on (location_id, tech_id, start_time); read replica for reports when needed |

---

## 10. Roadmap

**Phase 0 — Design & validation (2–3 wks)**
Clickable prototype of the appointment book **at 70-tech scale** (zoom, grouping, drag & drop, multi-select parallel-service moves), quick-book flow, same-time mani+pedi booking flow (both console and client side), branded portal customization. Validate with owner's front desk team.

**Phase 1 — MVP (6–8 wks)**
Calendar with full scaling model (zoom/grouping/virtualization), drag/drop/resize + multi-select moves, services & categories, staff + shifts + skills, quick-book, **same-time parallel services**, booking policy engine (auto-confirm vs approval per salon/service/tech), client booking flow with **themable portal**, confirmations + 24h/2h SMS reminders, client accounts + history + rebook, "My day" tech mobile view, basic client/appointment notes.

**Phase 2 — Depth (4–6 wks)**
Waitlist + auto-fill, walk-in queue, split-time phases, photo/design history gallery, recurring appointments, reports lite (utilization, bookings, no-shows), help center.

**Phase 3 — Money (4–6 wks)**
Stripe deposits & card-on-file, no-show fees, checkout/POS lite, tips, commission tracking, gift cards, payroll-hours export.

**Phase 4 — Growth (ongoing)**
Multi-location dashboards, memberships/packages, inventory, marketing campaigns, Google/Instagram booking integrations, **AI help assistant** (Zeenie-style "how do I…") + AI schedule suggestions.

---

## 11. Owner Decisions — Locked (2026-07-24)

| # | Question | Decision |
|---|---|---|
| 1 | What do you love in Zenoti? | Deep, detailed, powerful feature set; great scheduling calendar; robust client-booking customization matching salon aesthetics; AI help bot. → Keep depth + customization + AI help; kill the learning curve. |
| 2 | What frustrates you? | **Slowness under heavy data load; steep learning curve; clunky appointment moves.** → Performance budget is an acceptance criterion (§9); drag & drop must be excellent (§4.1); learnability layer (§4.6). |
| 3 | Salon shape | **70 techs; appointment-heavy, but platform must support walk-in-heavy salons too.** → 70-tech calendar scaling is MVP scope; walk-in queue Phase 2. |
| 4 | Same-time services | **Very common — clients typically do nails + feet simultaneously (two techs, one time slot); sequential is less common; single-service also common.** → Parallel services in MVP (§4.3, §5.2). |
| 5 | Online booking policy | **Salon chooses: auto-confirm or require approval.** → Booking policy engine with per-service/per-tech overrides (§4.3). |
| 6 | Payments | Deposits/no-show protection in **Phase 3** as planned. |
| 7 | Migration | Import clients/history from Zenoti **later — design for it now** (CSV/API import tool when needed). |
| 8 | Multi-location | **Yes, eventually** — schema is location-scoped from day one; build the feature later. |
| 9 | "Any available" assignment (2026-07-27) | **Auto-assign to the least-booked qualified tech** for that service at that time — balances the day instead of roster order. Applies to online booking AND "First available" in the console. No Unassigned queue needed. |

---

*Next step: Phase 0 — a clickable prototype of the 70-tech appointment book so you can feel the zoom, grouping, and drag & drop before we commit to build.*

## Accounts & persistence model (2026-07-28)

Everything a user changes persists — scoped to the right account so it works across salons and across many computers at one salon:

| Scope | Contents | Prototype storage | Production mapping |
|---|---|---|---|
| **Per login** (view preferences) | zoom/width/height, density, color mode, hidden/collapsed role groups, tech & category filters, viewing date, dark mode, rail open, personal clipboard | `u:{userId}:…` localStorage keys | `GET/PUT /api/me/preferences` — follows the login to any computer |
| **Per salon** (shared data) | appointments per day, clients + notes, waitlist, walk-in queue, job roles, tech roster | `s:{salonId}:…` localStorage keys | salon-scoped API + realtime sync so every computer shows the same book |

- `src/lib/session.ts` is the prototype login (demo switcher in the nav rail: Front Desk / Manager / Owner). The real build swaps it for auth tokens; **only `src/lib/persist.ts` changes** when the backend lands — components never touch storage directly.
- Multi-location note (decision #7) holds: every data row is already salon-scoped, so adding `locationId` later is an additive filter, not a rework.
