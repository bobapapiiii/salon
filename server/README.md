# Gloss Nail Bar API

The first real backend for this platform. Everything else in this repo
(`app/`) is still 100% client-side/localStorage -- this is a deliberately
small, self-contained slice: public online booking (a client picks a
service, tech, and time and submits a request) plus a staff-side "Online
requests" panel to confirm or decline them. It is NOT a migration of the
whole app off localStorage; see the root `HANDOFF.md` for what's still
local-only and why.

Stack: Node.js + TypeScript, [Fastify](https://fastify.dev), Postgres via
[Drizzle ORM](https://orm.drizzle.team), JWT + bcrypt for staff login.
Hosting: [Render](https://render.com) (a Web Service for the API + a
managed Postgres, described in `render.yaml` at the repo root).

**Honesty note**: this was written in a sandbox with no npm registry
access, so nothing here has actually been run yet. Every file is
TypeScript-syntax-checked, and the SQL migration is hand-verified against
`schema.ts` line by line, but real verification (does `npm install`
actually resolve, does the server boot, do the routes really work against
a live Postgres) happens on your machine following the steps below. Please
run through "Local setup" once and confirm it all works before deploying.

## Local setup

You need Node.js 20+ and a Postgres database. Easiest local Postgres if
you don't already have one: [Postgres.app](https://postgresapp.com) (Mac)
or `brew install postgresql@16 && brew services start postgresql@16`.

```bash
cd server
npm install
cp .env.example .env
# edit .env: set DATABASE_URL to your local Postgres, and set JWT_SECRET
# to a random string (the command to generate one is in .env.example)

createdb gloss_nail_bar   # or your Postgres GUI's "create database"
npm run db:migrate        # runs migrations/0000_init.sql
npm run db:seed           # creates the "Gloss Nail Bar" demo salon
npm run dev                # starts the API on http://localhost:8080
```

Confirm it's alive: `curl http://localhost:8080/api/health` should return
`{"ok":true,...}`.

The seed script prints a demo staff login (email `manager@glossnailbar.com`,
password `gloss-demo-2026`) -- change this before this ever sees real
traffic; there's no "change password" endpoint yet, so for now that means
re-running the seed with a different password or updating `password_hash`
directly.

## Trying it end to end with the frontend

In a second terminal:

```bash
cd app
cp .env.example .env       # VITE_API_URL=http://localhost:8080 (the default)
npm run dev
```

Then visit `http://localhost:5173/book/gloss-nail-bar` for the public
booking page, and (in the main app) Settings -> Online requests to sign in
with the demo staff login and confirm/decline what comes in. This is a
**separate login from the app's own demo-user switcher** (Mia/Anna/etc in
the bottom-left NavRail) -- see "Two separate auth systems" below.

## Two separate auth systems (intentional, for now)

The existing app has a fake "session" (`src/lib/session.ts`, `DEMO_USERS`)
with no real password, used everywhere else in the product. This backend
has its own real `users` table with bcrypt-hashed passwords and JWTs,
used only by the online-booking staff panel. They are not unified in this
pass -- doing that properly means deciding how the rest of the app's
localStorage-based staff/roles data maps onto real accounts, which is a
bigger migration than "add online booking." Tracked in the root
`HANDOFF.md` as follow-up work.

## Calendar sync

`GET /api/staff/booking-feed` returns every `requested` or `confirmed`
appointment for the salon (declined/cancelled excluded) -- what
`AppointmentBook.tsx` polls every 45s to materialize bookings onto the
existing localStorage calendar (see `app/src/lib/online-booking-sync.ts`
and `HANDOFF.md` #10 for the full picture, including its real limitations:
name-matched catalogs, requires a one-time staff sign-in on that browser,
polling not push). A `requested` row lands in the calendar's own Requests
rail; approving or declining it there calls the same `/approve`/`/decline`
routes below, so Settings -> Online requests stays in sync either way.

## What's deliberately not built yet

- **No real-time push.** The calendar sync above is a 45s poll, not a
  webhook/websocket -- acceptable for a demo, not for a busy front desk
  that needs to see a new request the instant it lands.
- **No `autoConfirm` wiring.** The existing `settings-store.ts` has a
  `booking.autoConfirm` flag that nothing in this backend reads yet;
  every online booking lands as `requested` regardless. One-line change
  in `routes/booking.ts` once that setting has a place to live server-side.
- **No timezone handling.** `/availability`'s "don't show a slot that
  already passed today" check uses the server's own clock, not the
  salon's `timezone` column. Fine for one salon in one timezone; would
  need fixing before a second salon in a different timezone signs up.
- **No password reset / account management UI.** Staff accounts are
  created only by the seed script or direct SQL for now.
- **No rate limiting** on the public booking endpoints. Add
  `@fastify/rate-limit` before this is public on the real internet.

## Deploying

### 1. Push this repo to GitHub

This sandbox (and the device-bridge tools it uses to reach your Mac) has
no network access to GitHub, so this step has to happen in **your own Mac
Terminal app**, not through Claude:

```bash
cd ~/Documents/kimi/workspace/salon-platform
# if you don't have a GitHub repo yet: create one at github.com/new
# (don't initialize it with a README), then:
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

If `git push` asks for a password, GitHub no longer accepts your account
password there -- use a [personal access
token](https://github.com/settings/tokens) as the password, or set up the
GitHub CLI (`gh auth login`) first and it'll handle this for you.

### 2. Create the Render account and connect the repo

1. Sign up at [render.com](https://render.com) (a fresh account, per your
   earlier choice -- this becomes the account you'll also use for the
   rest of this platform as it grows).
2. Dashboard -> **New** -> **Blueprint**, pick the GitHub repo you just
   pushed. Render reads `render.yaml` at the repo root automatically and
   proposes all three resources: the `gloss-nail-bar-api` Web Service
   (building from `server/`), the `gloss-nail-bar` Static Site (building
   from `app/`), and the `gloss-nail-bar-db` Postgres database, all wired
   together -- see "Frontend + backend, one Blueprint" below for how they
   reference each other.
3. Click **Apply**. First build takes a few minutes for each service
   (`npm install && npm run build` per `render.yaml`).
4. Once the API is live, open a **Shell** tab on the `gloss-nail-bar-api`
   service (or run this from your own machine with `DATABASE_URL` set to
   the database's **External Database URL** from its Render dashboard
   page) and run the migration + seed once:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Confirm: `curl https://gloss-nail-bar-api.onrender.com/api/health`, and
   visit `https://gloss-nail-bar.onrender.com/book/gloss-nail-bar` for the
   live booking page.

Render's free-tier web services (not static sites) spin down after
inactivity and take 10-20 seconds to wake back up on the next request --
expected, not a bug, if the first booking-page load feels slow after a
quiet period. Upgrade the plan in `render.yaml` (or the dashboard) once
this needs to stay warm.

### 3. Frontend + backend, one Blueprint

`render.yaml` defines both services so they deploy together and know
about each other automatically, with no manual dashboard configuration:

- The frontend's `VITE_API_URL` is set to `https://gloss-nail-bar-api.onrender.com`
  -- baked into the built JS at build time (Vite env vars aren't readable
  at request time, so this has to be right before the frontend builds).
- The API's `CORS_ORIGINS` includes `https://gloss-nail-bar.onrender.com`
  (the frontend's URL) alongside `localhost:5173` for local dev.
- The frontend's `routes: rewrite /* -> /index.html` makes deep links like
  `/book/gloss-nail-bar` serve the app instead of 404ing (it's a
  single-page app, there's no real file at that path).

**This only works cleanly if both service names in `render.yaml` match
what Render actually assigned them.** Render normally uses the `name:`
field verbatim as the subdomain (that's how `gloss-nail-bar-api` became
`gloss-nail-bar-api.onrender.com`), but if a name were ever taken by
someone else on Render, yours would get a suffix instead -- check the
actual URLs in your Render dashboard against what's hardcoded in
`render.yaml` above if anything doesn't line up, and update the mismatched
`value:` (either `VITE_API_URL` or `CORS_ORIGINS`), then push again.

**If you already applied the Blueprint before the Static Site existed in
`render.yaml`** (i.e. you only have the API + database so far): push this
updated `render.yaml` to GitHub, then open the Blueprint in the Render
dashboard and look for a **Manual Sync** button (or wait for auto-deploy
if it's enabled) -- Render will detect the new `gloss-nail-bar` service
definition and offer to create it, same as if you'd applied fresh.

## Files

- `src/db/schema.ts` -- Drizzle table definitions, the source of truth.
- `migrations/0000_init.sql` -- hand-written to match `schema.ts` exactly
  (see the comment at the top of that file for why it's hand-written
  instead of generated).
- `src/db/seed.ts` -- demo data matching `app/src/lib/mock-data.ts`'s
  categories/services, a representative slice of techs, one staff login.
- `src/lib/availability.ts` -- the open-slot calculation, deliberately
  simple (see the comment at the top of that file for what it does NOT
  handle, like per-tech custom hours or buffer time).
- `src/routes/booking.ts` -- public, unauthenticated: salon info, slot
  availability, create a booking request.
- `src/routes/auth.ts`, `src/routes/staff.ts` -- staff login, the
  online-requests approve/decline API, and the `booking-feed` route the
  calendar sync polls -- all gated by a JWT bearer token.
