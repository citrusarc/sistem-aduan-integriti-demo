# Sistem Aduan Integriti — Demo

Complaint management for an Integrity Unit (Unit Integriti): public intake portal, internal case register, JMM decision forms, and post-decision tracking.

Split into two independent applications:

| Folder | What it is | Dev port |
| --- | --- | --- |
| [`FE/`](FE) | Next.js 16 + shadcn/ui frontend | 3000 |
| [`BE/`](BE) | Express 5 + PostgreSQL REST API (plain SQL, no ORM) | 4000 |

`FE` never talks to Postgres; `BE` never renders UI. Each folder has its own `package.json`, `tsconfig.json`, and lint/format setup.

**[CLAUDE.md](CLAUDE.md) is the project guide** — schema, the six JMM outcomes, the status lifecycle, the business rules that must not be broken, and the product decisions (§8). Read it before changing either side.

## Running both

```bash
# terminal 1 — API
cd BE
npm install
cp .env.example .env                 # DATABASE_URL is required
npm run db:reset                     # creates the DB, applies schema + every migration
npm run db:seed                      # demo data; prints one login per role
npm run dev

# terminal 2 — UI
cd FE
npm install
cp .env.example .env.local
npm run dev
```

The frontend reads the API base URL from `NEXT_PUBLIC_API_URL`; the backend allows the frontend's origin via `CORS_ORIGIN`. Keep those in sync when you change ports.

## First login

With `db:seed`, use any login it prints (e.g. `admin@demo.aduan.gov.my` / `Demo-ADMIN-2026!`) — full list in [BE/README.md](BE/README.md#demo-data).

Without demo data, there's no sign-up: create the first ADMIN from `BE/` (you'll be prompted for a password, 12+ characters), then manage everyone else through the ADMIN staff endpoints or the same CLI:

```bash
npm run staff -- create admin@example.gov.my ADMIN "Nama Penuh"
```

Roles: `KUI PI PSU KPSU SETIAUSAHA ADMIN` (Integrity Unit) and `KJ SUB_UNIT` (see only the case actions referred to them, never the case register).

Already have a database from the old `psql -f` steps? Run `npm run db:migrate -- --baseline 003` in `BE/` instead, to keep your data (see [BE/README.md](BE/README.md#migrations)).

## Decisions (CLAUDE.md §8)

All eight are built in the API; there are no screens for them yet:

- **Stored complaint status** (§4). Written on every transition; a case is closed with `POST /api/admin/complaints/:id/close`.
- **JMM meetings and agendas**, the decision log, and dashboard stats.
- **Complainant contact, anonymous submission, email OTP login, my complaints** (§6 rule 6). Email only — no SMS, ever (rule 10). Login codes print to the BE console locally.
- **Protection requests**, reviewed by KUI only.
- **KJ / sub-unit referrals** (§1): the Integrity Unit refers case actions; assignees see and update only what decision 5 allows.
- **Staff management** (§8 decision 7), ADMIN only.

## Layout

```
FE/     Next.js app — see FE/README.md
BE/     Express API + db/schema.sql — see BE/README.md
docs/   aduan-palette-preview.html (source swatches for the palette)
CLAUDE.md
```
