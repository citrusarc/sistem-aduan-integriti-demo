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

`CORS_ORIGIN` must list the exact address the web app opens on. If port 3000 is taken and Next picks 3001, use `CORS_ORIGIN=http://localhost:3000,http://localhost:3001` and restart the API.

Create the database and start the API — all from `BE/`:

```bash
npm run db:reset     # creates an EMPTY "aduan", applies schema.sql and every migration (local only)
npm run dev          # API on http://localhost:4000 — keep this terminal open
```

There is no demo data. `db:reset` deletes everything and starts empty again. Check the API: `curl http://localhost:4000/api/health`.

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

On an empty database the page shows **Persediaan awal**: create the first ADMIN (name, email, and a password of at least 12 characters with upper case, lower case, a number and a special character). You're signed in straight away.

Every later sign-in: email + password → slide the captcha piece into the gap → enter the 6-digit code printed in the **API terminal** (MFA). Accounts ADMIN creates, and passwords ADMIN resets, must set their own new password at that first login; any password older than the expiry period (180 days by default, set under Tetapan › Pengurusan staf › Dasar kata laluan) must be changed too. Five wrong passwords block an account: ADMIN clicks **Buka sekatan**, or the owner uses **Lupa kata laluan?** on the login page (code in the API terminal). That ADMIN creates every other account — KUI, PI, KJ, SUB_UNIT and so on — under Tetapan › Pengurusan staf. Setup closes for good once any staff account exists.

**Complainant portal** — http://localhost:3000/me

1. **Daftar**: enter your name and email, then find the 6-digit code in the **API terminal** (`npm run dev` in `BE/`) and enter it. You're registered and signed in.
2. **Log masuk** later: enter the email, then the code from the API terminal. No email is actually sent — every message is printed there.
3. A code is valid for 10 minutes. A new one can be requested after 60 seconds (5 per hour).

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
| No login code appears in the API terminal | Register first (/me › Daftar) and enter that code; an unregistered, unverified address gets no login code. Wait 60 s between requests for the same address. The page shows the same message either way, on purpose — the API terminal says why. |
| `db:migrate` refuses because a migration changed | Never edit an applied migration. Locally, `npm run db:reset` (deletes all data). |
| Port 3000 or 4000 in use | `lsof -i :3000` to find it, or run on other ports and update `PORT`, `CORS_ORIGIN` and `NEXT_PUBLIC_API_URL` together. |

More detail: [BE/README.md](BE/README.md) (endpoints, migrations), [FE/README.md](FE/README.md) (pages and shared UI), [CLAUDE.md](CLAUDE.md) (business rules).
