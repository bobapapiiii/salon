-- Hand-written to mirror server/src/db/schema.ts exactly (Drizzle-generated
-- migrations need `drizzle-kit`, which needs `npm install` to run -- see
-- server/README.md for why this one is hand-written instead of generated).
-- Run once against a fresh database: see README "Local setup" or
-- "First deploy" for the exact command.

create extension if not exists "pgcrypto";

create table if not exists salons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  address text,
  phone text,
  website text,
  timezone text not null default 'America/Los_Angeles',
  booking_open_min integer not null default 540,
  booking_close_min integer not null default 1140,
  slot_size_min integer not null default 30,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  email text not null,
  password_hash text not null,
  title text not null default 'Reception',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists users_salon_email_idx on users(salon_id, email);

create table if not exists service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);
create index if not exists service_categories_salon_idx on service_categories(salon_id);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  category_id uuid references service_categories(id) on delete set null,
  name text not null,
  duration_min integer not null,
  price_cents integer not null,
  active boolean not null default true,
  bookable_online boolean not null default true,
  tags jsonb not null default '[]',
  sort_order integer not null default 0
);
create index if not exists services_salon_idx on services(salon_id);

create table if not exists techs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  name text not null,
  title text,
  active boolean not null default true,
  bookable_online boolean not null default true,
  tags jsonb not null default '[]',
  sort_order integer not null default 0
);
create index if not exists techs_salon_idx on techs(salon_id);

create table if not exists tech_skills (
  tech_id uuid not null references techs(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade
);
create unique index if not exists tech_skills_pk on tech_skills(tech_id, service_id);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  tags jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists clients_salon_idx on clients(salon_id);
create index if not exists clients_salon_phone_idx on clients(salon_id, phone);
create index if not exists clients_salon_email_idx on clients(salon_id, email);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  tech_id uuid not null references techs(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  date_key date not null,
  start_min integer not null,
  duration_min integer not null,
  status text not null default 'requested',
  source text not null default 'online',
  client_note text,
  staff_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id) on delete set null
);
create index if not exists appointments_salon_date_idx on appointments(salon_id, date_key);
create index if not exists appointments_tech_date_idx on appointments(tech_id, date_key);
create index if not exists appointments_status_idx on appointments(salon_id, status);
