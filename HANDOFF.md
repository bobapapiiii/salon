# Salon Booking Platform — Handoff Document

**Purpose**: everything a new engineer (human or AI) needs to continue building this platform without re-discovery. Read this first, then read `src/lib/booking-types.ts` and skim `AppointmentBook.tsx`.

---

## 1. What this is

A web platform for nail salons, replacing Zenoti. Two sides are planned:

1. **Salon side (BUILT, this repo)**: the appointment book (calendar) is the heart of the product, plus checkout/POS, walk-ins, waitlist, requests, client profiles, technician management, schedules, time blocks, loyalty, reports, and full settings.
2. **Client side (NOT built)**: online booking, account service history, choosing technicians or preferences, availability browsing. Planned next.

The owner runs a 70-tech appointment-heavy nail salon (demo data uses 20 techs) and currently uses Zenoti. Design goals, in their words: Zenoti's depth of features **without** the learning curve, fast and snappy even with many techs/clients, and smooth drag-and-drop scheduling. Same-time services (mani + pedi in parallel) are the norm in nail salons and must be first-class.

**Scale requirement**: must stay usable from small salons to 100+ techs (column zoom, role-group collapsing, overview mode, per-day density).

---

## 2. Run / verify

```bash
cd salon-platform/app
npm install
npm run dev        # Vite dev server (the host forwards --port)
npm run build      # tsc + vite; MUST pass before declaring work done
```

- TypeScript is **strict with `noUnusedLocals`** — delete unused imports/vars or the build fails.
- Verification loop used so far: `npm run build 2>&1 | grep -E "error|✓ built"`, then `npm run dev -- --port 5123 --strictPort` + `curl localhost:5123`, then **kill the server and `pkill -f "vite.*5123"`** (the child process lingers). Never leave a dev server running.

---

## 3. Tech stack & architecture

- **Vite + React + TypeScript + Tailwind CSS**, shadcn/ui primitives in `src/components/ui/`, lucide-react icons, react-router.
- **No backend yet.** All persistence is `localStorage`, deliberately funneled through one file so a real API can be swapped in later:
  - `src/lib/persist.ts` — `usePersistentState(key, initial)` (useState mirrored to storage) and two key namespaces:
    - `upref(key)` → per-login preferences (zoom, theme, filters, layout). Follows whoever is signed in.
    - `sdata(key)` → salon-shared data (appointments, clients, payments, staff, queues). Same for every login at the salon.
  - **Rule the owner cares deeply about: every user change must persist** (zoom, sizes, role order, settings, everything). When adding UI state that a user can change, use `usePersistentState` with the right namespace, not `useState`.
  - `src/lib/session.ts` — current login + `SALON_ID = "gloss-nail-bar"`; one-time upgrade path adopts old `salon-*` keys.
- App entry: `src/components/book/AppointmentBook.tsx` renders the calendar; settings are a real route `/settings/<section>` (deep-linkable). Tech portal (technician login view) is `TechPortal.tsx`.

### File map (`app/src/`)

| File | What it owns |
|---|---|
| `lib/booking-types.ts` | **All domain types + calendar constants.** `Appointment`, `Tech`, `Service`, `ServiceCategory`, `ApptStatus`, `OPEN_MIN`/`CLOSE_MIN` (8 AM/8 PM), `SLOT_MIN` (15), `fmtTime`, zoom bounds. Read this first. |
| `lib/persist.ts` | Storage namespaces + `usePersistentState`. The single API swap point. |
| `lib/settings-store.ts` | `SalonSettings` (general incl. `weekHours` + `holidays`, booking rules, payments, checkout custom fields, loyalty incl. redemptions). `useSettingsStore`, `setSettings`. |
| `lib/staff-store.ts` | Job roles + technicians, `roleColor`, `boardTechs`, `isArchived`, `uid(prefix)`. |
| `lib/services-store.ts`, `lib/categories-store.ts` | Service menu + categories, `svcById`, `catById` (reactive proxies). |
| `lib/mock-data.ts` | Demo clients/services/day generation (`generateDay(dateKey)` ~20% booking density). |
| `components/book/AppointmentBook.tsx` | **The calendar, 3000 lines.** Drag/drop, conflict checks, queues, checkout orchestration, clipboard, blocks, tech header menus. All times are **minutes from `OPEN_MIN`**; `yAt(m)` maps minutes → px. |
| `components/book/BookingPanel.tsx` | Right-side new/edit appointment flow (multi-guest, multi-service, parallel/sequential, per-service time + tech). |
| `components/book/RequestsRail.tsx` | Right rail: waitlist / requests (approve→draggable, decline w/ confirm) / walk-ins (per-service drag onto grid). |
| `components/book/CheckoutDialog.tsx` | `PaymentFlow` (shared pay panel: lines, tip + per-tech tip split, loyalty redeem, method, receipt) + appointment checkout. |
| `components/book/PosPanel.tsx` | POS sale (no appointments). |
| `components/book/ClientProfile.tsx` | Client profile: overview, profile, notes, appointments/visits with clickable invoices, loyalty points, guest history. |
| `components/book/TechCalendarView.tsx` | In-calendar weekly/monthly takeover for one tech (from tech header "..." menu). |
| `components/book/SettingsPage.tsx` | Full-screen settings, sidebar sections. |
| `components/book/ReportsSection.tsx` | Reports tab suite (overview/revenue/techs/services/clients/appointments). |
| `components/book/AppointmentDetail.tsx`, `ApptMenus.tsx`, `QuickBookPopover.tsx`, `BlockEditor.tsx`, `Toolbar.tsx`, `TechSchedulePanel.tsx`, `LegendPopover.tsx` | Supporting dialogs/menus. |

---

## 4. Data model & storage keys

`src/lib/booking-types.ts` is the source of truth. Key facts:

- **Time model**: `startMin`/`durationMin` are minutes from `OPEN_MIN` (8 AM). `fmtTime(min)` renders 12h/24h per settings.
- `Appointment.status`: `booked` (default for salon-made), `requested` (online, awaiting approval), `confirmed`, `checked_in`, `in_service`, `completed` (= checked out), `no_show`.
- Linked services: `parallelGroup` id shared by same-time services; client check-in/confirm/start/complete cascade across **all of that client's** services that day (groups remain per-person). Dragging moves **only** the dragged card, never its links.
- Request markers: `techRequested` (by name, heart 💚 green), `requestedTechChoice: 'first' | 'pref-female' | 'pref-male'` (pink/blue hearts), `issue` (amber heart). Requested-by-name appointments **must not** be auto-moved; tech-requested bookings auto-relocate a conflicting *non-requested* appointment to the least-booked qualified tech (`makeRoom`), else double-book prompt (salon side) or no availability (online side, future).
- `log`: every mutation appends `{at, text}` (create, move, check-in w/ time, start, complete, checkout). Right-click → "Show log". `checkedInMin`/`startedMin`/`completedMin` show on hover.
- Payments (`payments-v1`): `{id, dateKey, clientName, itemCount, subtotal, tip, total, method, points, notes?, pos?, party?, discount?, redeemed?, lines?: {techId, price}[], apptIds?, tipByTech?: {techId, amount}[]}`.
  - **Tip split**: checkout records `tipByTech` (exact per-provider amounts); default split is pro-rata by service value, salon can override per tech; reports/tech portal use `tipByTech` when present, else fall back to pro-rata from `lines`.

| `sdata` key | Contents |
|---|---|
| `appts-v1` | `Record<dateKey, Appointment[]>` — the book, per day |
| `payments-v1` | completed checkouts + POS sales |
| `clients-v1` | `ClientRecord[]` (name, phone, visits, guests) |
| `waitlist-v1` / `walkins-v1` / `approved-v1` | right-rail queues |
| `blocks-v1` | per-day time blocks (right-click grid; draggable/resizable; salon may drop appts into blocks with a confirm prompt; blocks hide for online booking) |
| `schedule-v1` | per-day tech schedule overrides (off/vacation/emergency/late/early + notes) |
| `checkout-draft-v1` | open checkout edits survive panel close |
| `notes-v1` | client notes |
| `loyalty-v1` | points balance by client id |

`upref` keys: `ui-scale` (colW + px/min zoom), `ui-density` (15/30/60 grid), `ui-date`, `ui-dark`, `ui-colormode`, `ui-catfilter`, `ui-collapsed` (role groups), `ui-hidden` (techs), `ui-techquery`, `ui-railopen`, `clipboard-v1`.

**Settings highlights** (`settings-store.ts`): `general.weekHours` (per-weekday open/close/off, absolute minutes from midnight) + `general.holidays` — closed days grey out and reject all booking paths; `booking.allowOverlap` (side-by-side lanes), `booking.warnOnDoubleBook`, `booking.increment`, 12h/24h clock; `checkout.serviceFields`/`generalFields` (custom invoice fields, e.g. polish Color per service); `loyalty.pointsPerDollar` + multiple `redemptions` (amount/percent/freeService). Checkout only shows redemptions the client can actually use (enough points + qualifying service on ticket).

---

## 5. What's built (feature inventory)

**Calendar**: independent width/height zoom sliders + presets + fit-to-width/height; 15/30/60-min density; day view with role-group bands (draggable chips to reorder role groups, persist; collapse/hide); techs A–Z within role; tech gender strip; grey off-hours (salon operating hours + holidays); techs with no appointments & day off are hidden; hour before open/after close visible but hatched.
**Appointments**: double-click empty slot to book (single-click does nothing); right-click appt menu (edit, check in, confirm, start service + undo, cancel w/ confirm incl. cancel-group, checkout, clipboard, rebook, send text placeholder, show log); right-click empty slot → new appt or time block; hover card with full details incl. checked-in/started/completed times; 2-second hover → spotlight mode dims everything except linked services/group (sticky until click anywhere); drag is smooth, single card, live time label, linked appointments glow during drag; drop conflict checks (qualifications, shift, overlap→double-book prompt when enabled, block-time prompt); per-service clipboard to move services across days (shows requested-tech/preference; revert supported).
**Queues (right rail)**: walk-ins (client search by name/phone or add guest, multi-service, multi-guest; each service drags separately); waitlist (client lookup, day(s), time range, preferred tech); requests (approve → auto-books at requested time/tech if free, else draggable card showing the client's wishes; decline w/ confirm).
**Checkout/POS**: right-side panel; party checkout with per-person selection (any subset pays together); add services mid-checkout (assigned to the right guest); edit service/tech/time/price live, instantly reflected on the book; per-service custom fields (e.g. color); loyalty redeem (only usable rewards shown); **per-provider tip split** (pro-rata default, manual override, charge blocked until balanced); invoice + print receipt after checkout; drafts persist.
**Clients**: profiles w/ overview, notes, appointment history, invoice viewer (incl. per-service colors), loyalty points, guest history (name-only guests tracked under the host client).
**Techs**: settings roster (first/last/nickname, gender, birthday, hire/end dates, active/inactive/archive w/ auto-archive on end date, address, documents upload W-9/license/ID, permanent weekly schedule, temporary time off incl. coming-late/leaving-early with time, job role, per-service duration/price/online overrides incl. beyond-role exceptions, commission %, login PIN for tech portal, online-booking photo/bio). Tech header "..." menu: profile, weekly/monthly in-calendar views (navigable, bookable, right-click works), move all non-requested appointments. Off/late/early grey the grid accordingly. Tech portal: own appointments, day stats, tips per client.
**Reports** (`/settings/reports`): date-range presets + custom; Overview (KPIs, daily chart, top services/techs), Revenue (methods, POS vs appt vs party, loyalty, by-hour, per-day table), Technicians (sortable: services, hours, sales, tips from recorded split, commission est., utilization vs schedule, requested, no-shows), Services (by category w/ colors, add-ons, per-service table), Clients (served, first-time, spend, top-25), Appointments (status funnel, request mix, parallel groups, busiest hours/weekdays, no-show rate).
**Settings sections**: General (salon info, clock format, **operating hours per weekday + holidays/days off**), Job roles (per-role service permissions, delete w/ tech-move confirm), Technicians, Services (categories w/ calendar colors, add-ons w/ time+price), Online booking (allow overlap, double-book prompt toggle, increment, auto-confirm vs approval — wired for the future client side), Payments (methods, tip presets), Checkout (custom fields), Loyalty (points-per-dollar + robust multi-redemption builder), Notifications (SMS prefs placeholder), Reports.

---

## 6. Conventions & gotchas (do not skip)

- **UI text rules**: NEVER use `…` (ellipsis char) or em/en dashes (`—`, `–`) anywhere in user-facing text. Use commas, colons, or "to" for ranges (owner explicitly banned these as unprofessional).
- **Every destructive action gets a confirmation prompt** (cancel appointment, cancel group, decline request, delete role/tech/holiday). Use existing `ConfirmDialog`.
- **Persist everything user-changeable** via `usePersistentState` (see §3).
- Settings saves must **not** close the settings window.
- Appointment cards prioritize **client name + service**; time shows even on short cards (owner preference).
- Card colors follow Zenoti semantics: orange = booked, green = confirmed, violet = past-start not checked in, red/grey = checked out; **left rail = service category color** (category colors editable in Settings → Services and update the legend/key dynamically).
- `DAY_MIN = CLOSE_MIN - OPEN_MIN` is recomputed locally per file; grid math uses minutes-from-OPEN_MIN everywhere.
- New `Appointment` objects need a `log: [logEntry(...)]`; use `uid('prefix')` for ids.
- Bash tool in this environment requires a plain-language `description`.
- The host preview convention: final replies include the app root path as inline code, then `[Salon Appointment Book](http://localhost:7100/)`, and no dev server left running.

---

## 7. Roadmap (agreed with owner)

- **Phase 2 (next)**: client-side online booking — service selection, same-time/parallel services, requested tech / female-preferred / male-preferred / first-available (auto-assign least-booked qualified tech), availability honoring operating hours, holidays, blocks, per-tech/per-service online flags, auto-confirm vs require-approval (feeds the Requests queue), account service history. Remember: online bookings with a specific tech auto-relocate conflicting non-requested appointments, and simply don't show availability when there's no room.
- **Phase 3**: deposits & no-show protection (owner deferred this deliberately).
- **Later**: multi-location, Zenoti data migration, real backend + auth (swap `persist.ts` internals), SMS notifications, payroll reports from commission data.

## 8. Owner taste notes (from watching their Zenoti walkthroughs)

- Loves Zenoti's feature depth, customizable online booking, hover-spotlight for linked appointments, clipboard across days; hates its slowness, learning curve, and clunky appointment moves. Speed and obvious UI win every trade-off.
- Light, neutral theme (they rejected cream, then "too pink"; current theme passed). Clean top bar, legend available but not noisy, bottom bar flush with the window bottom.
- Edit-appointment actions should be prominent, not sandwiched between other buttons. No "..." text in labels; align form fields precisely.

## 9. Discounts feature (added this session)

Built a full discount-management feature (Marketing-style nav item "Discounts", builder drawer,
promo codes, BOGO, advanced rules, POS integration, manual one-time discounts, audit log) entirely
on today's client-side architecture, per explicit owner sign-off. Key note for whoever builds the
real backend from the roadmap above:

- **`src/lib/discount-engine.ts` is the single, shared, pure, deterministic pricing evaluator** —
  no React/DOM/localStorage access inside it, only plain functions over plain data. POS calls it
  and nothing else computes discount math. **When the real backend lands, this file should move
  server-side largely unchanged** — that was the whole point of keeping it pure. Redemption-limit
  enforcement is currently a best-effort in-process check (there's only one browser tab today, no
  real concurrency); the real backend must make that check transactional (a DB constraint or
  row lock), per the original spec.
- **Multi-location**: `Discount.availability.locations`/`locationIds` fields exist and are wired
  end to end, but there is still only one real location (`SALON_ID`), so today they're always
  effectively "this location." Do not need to touch the discount model when multi-location lands,
  just populate real location ids.
- **Tax**: this app still has no tax line anywhere (`payments` = subtotal + tip - discount).
  The engine's discount-capping logic caps against `subtotal` only. When tax is added, cap against
  the pre-tax subtotal still (discounts should not apply to tax) and confirm that explicitly.
- **RBAC**: still no real permission system app-wide. Manual discounts are gated by a small
  `canManageDiscounts()`/`isManagerOrAbove()` helper keyed off the existing `SessionUser` list
  (owner/manager titles) in `src/lib/discounts-store.ts` — a stopgap, not real RBAC. When real
  auth/roles land, replace that helper's internals; nothing else should need to change.
- **Customer tags**: added `ClientRecord.tags?: string[]` and `Tech.tags?: string[]` (small,
  additive fields, not a new system) so discount targeting has something to filter on.

## 10. Real backend + online booking (added this session)

Added `server/` -- the platform's first real backend (Node/TypeScript, Fastify,
Postgres via Drizzle, JWT+bcrypt staff auth), deployed via Render (`render.yaml`
at repo root). See `server/README.md` for full setup/deploy instructions; this
section is the durable "why" and "what's still split" for whoever picks this up.

- **Deliberately a self-contained slice, not a migration.** The rest of the app
  (`app/src/lib/*-store.ts`) is still 100% localStorage. This backend covers
  only public online booking (a new `/book/:slug` page) and a staff "Online
  requests" approval panel (Settings -> Online requests). It does NOT touch
  the existing calendar, checkout, discounts, or reports.
- **Two separate appointment stores that are NOT unified.** An online booking
  request lives in Postgres (`server/src/db/schema.ts`'s `appointments` table)
  with its own status lifecycle (`requested -> confirmed/declined/cancelled`).
  Approving one in the staff panel does NOT create a card on the existing
  localStorage calendar (`AppointmentBook.tsx`'s `Appointment` type, a
  different shape entirely) -- staff currently have to add it to the book by
  hand after confirming. Merging these is real, sizable follow-up work:
  decide whether the localStorage calendar becomes a read/write view onto
  Postgres, or whether confirmed online bookings get synced across on
  approval. Do not assume this is done just because both features exist.
- **Two separate auth systems.** The existing app's "login" (`src/lib/
  session.ts`, `DEMO_USERS`) has no real password and is used everywhere
  else. This backend has its own real `users` table (bcrypt + JWT), used only
  by the online-requests panel. Not unified in this pass; see `server/
  README.md` "Two separate auth systems" for the reasoning.
- **Discount engine, if online checkout ever happens**: `discount-engine.ts`
  was written pure/stateless specifically so it could move server-side (see
  §9). It has not been ported into `server/` in this pass since online
  booking has no checkout step yet (requests are unpriced holds, payment
  still happens in person). When online payment is built, that's the moment
  to actually lift `discount-engine.ts` server-side rather than duplicating
  pricing logic.
- **Nothing here has been executed in this session** (the sandbox that built
  it has no npm registry access) -- every file is TypeScript-syntax-checked
  and the SQL migration is hand-verified line-by-line against `schema.ts`,
  but `npm install`, the actual server boot, and real Postgres queries are
  all unverified until you run `server/README.md`'s "Local setup" yourself.
- **A real bug was found and fixed in already-shipped code while working in
  this area**: the BOGO discount fix described in §9 as "fixed and shipped"
  had NOT actually reached the committed `discount-engine.ts` (the commit
  still had the old buggy split-pool logic) -- caught via a Mac-vs-cloud-clone
  content diff while starting this backend work, and fixed for real in a
  follow-up commit. Worth remembering: a reported fix is only real once the
  file that's actually committed on the machine you develop from has been
  re-diffed against what was verified, not just re-described from memory.

