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

## What's deliberately not built yet

- **The online-booking data isn't merged into the existing calendar.**
  Approving a request in "Online requests" marks it `confirmed` in the
  new Postgres `appointments` table; it does NOT create a card on the
  existing localStorage calendar (`AppointmentBook.tsx`). For now, staff
  need to also add it to the book by hand after confirming. Unifying the
  two appointment stores is real, deliberate follow-up work, not an
  oversight -- flagged in `HANDOFF.md`.
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
   proposes: a `gloss-nail-bar-api` Web Service (building from `server/`)
   and a `gloss-nail-bar-db` Postgres database, wired together.
3. Click **Apply**. First build takes a few minutes (`npm install && npm
   run build` per `render.yaml`).
4. Once it's live, open a **Shell** tab on the `gloss-nail-bar-api`
   service (or run this from your own machine with `DATABASE_URL` set to
   the database's **External Database URL** from its Render dashboard
   page) and run the migration + seed once:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Confirm: `curl https://<your-service>.onrender.com/api/health`.

Render's free-tier web services spin down after inactivity and take
10-20 seconds to wake back up on the next request -- expected, not a bug,
if the first booking-page load feels slow after a quiet period. Upgrade
the plan in `render.yaml` (or the dashboard) once this needs to stay warm.

### 3. Deploy the frontend

The frontend (`app/`) is a static Vite build with no server-side needs.
Simplest: a second Render **Static Site**, pointed at this same repo,
build command `cd app && npm install && npm run build`, publish directory
`app/dist`. Two things it needs that aren't automatic:

- **Environment variable** `VITE_API_URL` set to your API's Render URL
  (from step 2), so the built frontend calls the real API instead of
  `localhost:8080`.
- **A rewrite rule** so `/book/gloss-nail-bar` (and any other deep link)
  serves `index.html` instead of 404ing -- this is a single-page app with
  no server-side routing. Render Static Sites: Settings -> Redirects/
  Rewrites -> add a rule `/*` -> `/index.html`, type Rewrite.

Once both are deployed, update the API service's `CORS_ORIGINS` env var
(Render dashboard, not `render.yaml`, so you don't have to edit code to
change it) to include the frontend's real URL, then redeploy the API.

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
- `src/routes/auth.ts`, `src/routes/staff.ts` -- staff login and the
  online-requests approve/decline API, gated by a JWT bearer token.
