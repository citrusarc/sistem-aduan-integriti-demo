# Run locally

Everything runs on your machine: PostgreSQL, the API (`BE/`, port 4000) and the web app (`FE/`, port 3000). No cloud services, and no SMS — emails, including login codes, are printed in the API's terminal.

## 1. Install the prerequisites

| Tool | Version | macOS |
| --- | --- | --- |
| Node.js + npm | **20.12 or newer** (the API loads `.env` with `process.loadEnvFile`) | [nodejs.org](https://nodejs.org), or `nvm install 20` |
| PostgreSQL | 17 (16 works) | [Postgres.app](https://postgresapp.com) — start it and click **Initialize** |
| Git | any | `xcode-select --install` |

Check:

```bash
node -v            # v20.12+ 
psql --version     # psql (PostgreSQL) 17.x
```

With Postgres.app, add its tools to your PATH once if `psql` isn't found:
`sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp`, then open a new terminal.

## 2. Configure and start the API

```bash
cd BE
npm install
cp .env.example .env
```

Edit `BE/.env` and set `DATABASE_URL` for your Postgres. Postgres.app uses your macOS username and no password:

```bash
DATABASE_URL=postgres://YOUR_MAC_USERNAME@localhost:5432/aduan
```

Leave `CORS_ORIGIN=http://localhost:3000` as it is unless you change the web app's port.

Create the database, load demo data, and start the API — all from `BE/`:

```bash
npm run db:reset     # creates "aduan", applies schema.sql and migrations 001–010 (local only)
npm run db:seed      # demo data; prints one login per role
npm run dev          # API on http://localhost:4000 — keep this terminal open
```

`db:reset` deletes and recreates the database every time; run it again whenever you want the demo data back (followed by `db:seed`). Check the API: `curl http://localhost:4000/api/health`.

## 3. Start the web app

In a **second terminal**:

```bash
cd FE
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm run dev                    # http://localhost:3000
```

## 4. Sign in

**Staff console** — http://localhost:3000/login

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| KUI | `kui@demo.aduan.gov.my` | `Demo-KUI-2026!` | Dashboard (only role that sees Permohonan Perlindungan) |
| PI / PSU / KPSU / SETIAUSAHA | `pi@…`, `psu@…`, `kpsu@…`, `setiausaha@demo.aduan.gov.my` | `Demo-<ROLE>-2026!` | Dashboard |
| ADMIN | `admin@demo.aduan.gov.my` | `Demo-ADMIN-2026!` | Dashboard + Pengurusan Staf |
| KJ | `kj@demo.aduan.gov.my` | `Demo-KJ-2026!` | Peti Masuk KJ (referred actions only) |
| SUB_UNIT | `subunit@demo.aduan.gov.my` | `Demo-SUB_UNIT-2026!` | Tugasan Sub-unit (referred actions only) |

**Complainant portal** — http://localhost:3000/me

1. Enter `pengadu.demo@contoh.my` (named, 4 visible complaints) or `tanpa.nama.demo@contoh.my` (anonymous, 2).
2. Find the 6-digit code in the **API terminal**, under `Kod log masuk anda:`.
3. Enter it within 10 minutes. A new code can be requested after 60 seconds (5 per hour).

Anyone can also submit at `/submit` and track by reference number at `/track` without signing in.

## 5. Run the checks (optional)

```bash
cd BE && npm test                     # API tests; creates and DROPS the database "aduan_test"
cd BE && npm run typecheck && npm run lint
cd FE && npm run typecheck && npm run lint && npm run build
```

`npm test` uses `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test` appended, and refuses any database whose name doesn't end in `_test`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API exits with a missing `DATABASE_URL` message | Run it from `BE/`, where `.env` lives, and check Node is 20.12+. |
| `password authentication failed` / `role "postgres" does not exist` | `DATABASE_URL` user doesn't exist in your Postgres. With Postgres.app use your macOS username. |
| *Tidak dapat menghubungi pelayan* when submitting, requesting a login code, or on any console page | The API isn't running (start `npm run dev` in `BE/` and keep that terminal open), `FE/.env.local` points elsewhere, or you opened the site at an address not in `CORS_ORIGIN`. Restart `npm run dev` in `FE/` after editing `.env.local`. |
| *Permintaan ditolak oleh pelayan*, or sign-in works but every save fails | `CORS_ORIGIN` in `BE/.env` must exactly match the address in your browser (`http://localhost:3000`, not `127.0.0.1`). |
| No login code appears | Wait 60 s between requests for the same address; the address must belong to a complaint that isn't NFA. The page shows the same message either way, on purpose. |
| `db:migrate` refuses because a migration changed | Never edit an applied migration. Locally, `npm run db:reset && npm run db:seed`. |
| `db:seed` refuses | It only runs on an empty database — `npm run db:reset` first. |
| Port 3000 or 4000 in use | `lsof -i :3000` to find it, or run on other ports and update `PORT`, `CORS_ORIGIN` and `NEXT_PUBLIC_API_URL` together. |

More detail: [BE/README.md](BE/README.md) (endpoints, migrations, demo data), [FE/README.md](FE/README.md) (pages and shared UI), [CLAUDE.md](CLAUDE.md) (business rules).
