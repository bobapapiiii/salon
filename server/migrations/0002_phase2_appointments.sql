-- Phase 2 of the localStorage -> Postgres migration (see root plan doc and
-- HANDOFF.md): widens `appointments` from online-request-only into the
-- calendar's real source of truth, and adds `time_blocks` +
-- `tech_day_overrides` for the two other calendar-adjacent stores this
-- phase covers.
--
-- Purely additive, like 0000_init.sql / 0001_phase1_catalog.sql --
-- migrate.ts has no tracking table and reruns every .sql file in this
-- folder on every invocation, and `appointments` already holds real
-- online-request rows. No drops, no `not null` without a default on an
-- existing populated table, everything `if not exists`.

-- ── appointments: online-request-only -> full calendar rows ─────────────
-- client_id becomes nullable: walk-ins/guests booked straight from the
-- calendar often have no phone and therefore no real `clients` row, unlike
-- every existing row today (which always came through routes/booking.ts's
-- upsert-by-phone flow and so always has one). client_name becomes the
-- always-present display value the calendar actually renders.
alter table appointments alter column client_id drop not null;
alter table appointments add column if not exists client_name text not null default '';

-- Grouped cancel/move needs `where parallel_group = X`; issue is a
-- salon-wide "needs attention" filter/badge -- both promoted to real
-- columns per the same "promote only what's queried/joined/filtered" rule
-- 0001 already established for techs.profile.
alter table appointments add column if not exists parallel_group text;
alter table appointments add column if not exists issue boolean not null default false;

-- addons gets its own typed jsonb column (mirrors services.addons's
-- existing precedent -- a well-defined small array shape, not a bag of
-- unrelated fields). Everything else new and not queried this phase
-- (notes, guestOf, priceOverride, requestedTechChoice, techRequested,
-- genderMismatchOk, checkedInMin/startedMin/completedMin, customFields,
-- walkinOrigin) round-trips through one catch-all `profile` jsonb column,
-- shallow-merged into the API response server-side exactly like
-- techs.profile already does. `log` stays a free-text jsonb array, same
-- shape as today (~15 scattered push sites, no existing type/actor
-- taxonomy) -- restructuring it into a real audit-log table is a
-- deliberately separate future phase, not a byproduct of this migration.
alter table appointments add column if not exists addons jsonb not null default '[]';
alter table appointments add column if not exists profile jsonb not null default '{}';
alter table appointments add column if not exists log jsonb not null default '[]';

-- Optimistic-concurrency token: every mutating call sends back the
-- `version` it last saw as `expectedVersion`; the update only applies if
-- it still matches (`... where id = $1 and version = $2 returning *`),
-- otherwise it's a 409 with the current row attached so the client can
-- reconcile without a second round trip.
alter table appointments add column if not exists version integer not null default 1;
alter table appointments add column if not exists updated_at timestamptz not null default now();
alter table appointments add column if not exists updated_by uuid references users(id) on delete set null;

-- One-time backfill: existing online-request rows predate client_name --
-- populate it from the joined client so old rows aren't stuck blank.
-- Idempotent (only touches rows still at the default '').
update appointments a
set client_name = c.name
from clients c
where a.client_id = c.id and a.client_name = '';

-- status: no longer online-request-only. Existing values (requested,
-- confirmed, declined, cancelled) stay valid; the calendar adds its own
-- states on top (booked, checked_in, in_service, completed, checked_out,
-- no_show). Always was a plain text column, so no type/enum change is
-- needed to widen the allowed value set -- validity is enforced in
-- routes/appointments.ts's status-transition map, not at the DB level.
-- Cancel/decline are soft status writes here, never row deletes -- see
-- the Phase 2 plan section for why (cancellations-v2 would otherwise be
-- the only remaining record an appointment ever existed).

create index if not exists appointments_parallel_group_idx on appointments(parallel_group) where parallel_group is not null;

-- ── time_blocks: direct 1:1 mapping of the frontend's TimeBlock, its own
-- version/updated_at/updated_by since two terminals editing the same
-- block (e.g. one extending a lunch break while another deletes it) is a
-- realistic collision, same conflict model as appointments. ────────────
create table if not exists time_blocks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  tech_id uuid not null references techs(id) on delete cascade,
  date_key date not null,
  start_min integer not null,
  duration_min integer not null,
  reason text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);
create index if not exists time_blocks_salon_date_idx on time_blocks(salon_id, date_key);
create index if not exists time_blocks_tech_date_idx on time_blocks(tech_id, date_key);

-- ── tech_day_overrides: one row per (tech, day), matches the frontend's
-- Record<techId, TechDay> exactly. Deliberately NO version column -- this
-- is a low-frequency, single-row-per-tech-per-day upsert edited from one
-- settings panel (TechSchedulePanel.tsx), not a drag-heavy shared
-- surface; two terminals independently deciding "is JJ off today" within
-- seconds of each other is not a realistic collision the way two
-- terminals dragging the same appointment is. Can be added additively
-- later if that changes. ─────────────────────────────────────────────────
create table if not exists tech_day_overrides (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  tech_id uuid not null references techs(id) on delete cascade,
  date_key date not null,
  status text not null,
  start_min integer,
  end_min integer,
  notes text
);
create unique index if not exists tech_day_overrides_tech_date_idx on tech_day_overrides(tech_id, date_key);
create index if not exists tech_day_overrides_salon_date_idx on tech_day_overrides(salon_id, date_key);
