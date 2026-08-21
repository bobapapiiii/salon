-- Phase 1 of the localStorage -> Postgres migration (see root HANDOFF.md and
-- the migration plan): brings categories, services, job roles/techs, and
-- clients up to parity with the frontend's booking-types.ts shapes.
--
-- Purely additive, like 0000_init.sql -- migrate.ts has no tracking table
-- and reruns every .sql file in this folder on every invocation, and these
-- tables already hold real production rows (from the earlier
-- import-local-data.ts run against the live salon). No `not null` without a
-- default on an existing table, no drops, everything `if not exists`.

-- ── service_categories: color tokens the frontend lets staff edit directly,
-- subcategory nesting, archive (soft-delete) ─────────────────────────────
alter table service_categories add column if not exists hue text;
alter table service_categories add column if not exists fill text;
alter table service_categories add column if not exists line text;
alter table service_categories add column if not exists text_color text;
alter table service_categories add column if not exists parent_id uuid references service_categories(id) on delete set null;
alter table service_categories add column if not exists archived boolean not null default false;
alter table service_categories add column if not exists online_excluded_role_ids jsonb not null default '[]';

-- ── services: add-ons, per-role online exclusion, short label ───────────
alter table services add column if not exists short text not null default '';
alter table services add column if not exists team_affinity text;
alter table services add column if not exists addons jsonb not null default '[]';
alter table services add column if not exists online_excluded_role_ids jsonb not null default '[]';

-- ── job roles: a new concept server-side, mirrors the frontend's JobRole
-- (staff-store.ts) -- distinct from users.title, which is a permission
-- level (Reception/Manager/Owner), not a job role. job_role_services
-- mirrors tech_skills exactly (which service ids the role covers). ──────
create table if not exists job_roles (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);
create index if not exists job_roles_salon_idx on job_roles(salon_id);

create table if not exists job_role_services (
  job_role_id uuid not null references job_roles(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade
);
create unique index if not exists job_role_services_pk on job_role_services(job_role_id, service_id);

-- ── techs: promote what's actually queried/joined/reported-on; everything
-- else (documents, weekly schedule, time off, per-service overrides,
-- address, PIN, etc) round-trips through one catch-all `profile` jsonb
-- column instead of five-plus new child tables -- see the migration plan's
-- "jsonb-vs-columns" section for the full reasoning. `title` stays as a
-- denormalized cache of the job role's name (set server-side on every
-- write), so the public booking route needs zero changes. ───────────────
alter table techs add column if not exists job_role_id uuid references job_roles(id) on delete set null;
alter table techs add column if not exists archived boolean not null default false;
alter table techs add column if not exists phone text;
alter table techs add column if not exists email text;
alter table techs add column if not exists commission_pct integer;
alter table techs add column if not exists profile jsonb not null default '{}';

-- ── clients: visits (arithmetic, feeds reports), preferred techs + guests
-- (small nested arrays, no query need) ───────────────────────────────────
alter table clients add column if not exists visits integer not null default 0;
alter table clients add column if not exists preferred_techs jsonb not null default '[]';
alter table clients add column if not exists guests jsonb not null default '[]';

-- ── one-time backfill: seed job_roles from each salon's distinct existing
-- tech titles, then point every tech at its matching role. Required, not
-- optional -- a null job_role_id breaks the frontend's teamId-keyed lookups
-- (isOnlineBookable, the calendar's role-grouped columns) for every
-- pre-existing tech. Both steps are idempotent (guarded by not-exists /
-- only touch nulls), safe to rerun. ──────────────────────────────────────
insert into job_roles (salon_id, name, sort_order)
select distinct t.salon_id, t.title, 0
from techs t
where t.title is not null
  and not exists (
    select 1 from job_roles r where r.salon_id = t.salon_id and r.name = t.title
  );

update techs t
set job_role_id = r.id
from job_roles r
where t.job_role_id is null
  and t.title is not null
  and r.salon_id = t.salon_id
  and r.name = t.title;
