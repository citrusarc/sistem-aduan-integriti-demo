# Sistem Aduan Integriti

Complaint management for an Integrity Unit (Unit Integriti), following the SPRM *Tatacara Pengurusan Aduan* (2022):

- **Public portal:** submit and track complaints.
- **Complainant accounts:** registered complainants see their own cases.
- **Internal console:** case register, JMM meetings and decision forms, post-decision tracking with referrals to department heads, and reporting.

Everything runs on your own machine: no cloud services, no SMS. Email is printed to the API terminal instead of being sent.

**To install and run it, see [RUN-LOCALLY.md](RUN-LOCALLY.md).**

| Folder | What it is | Dev port |
| --- | --- | --- |
| [`FE/`](FE) | Next.js 16 frontend (App Router, Tailwind v4, Base UI). See [FE/README.md](FE/README.md) | 3000 |
| [`BE/`](BE) | Express 5 REST API on PostgreSQL (plain SQL, no ORM). See [BE/README.md](BE/README.md) | 4000 |

`FE` never talks to Postgres, and `BE` never renders UI. Each folder has its own `package.json`, TypeScript and lint setup.

**Read [CLAUDE.md](CLAUDE.md) before changing either side.** It holds the schema, the six JMM outcomes, the status lifecycle, the business rules that must not be broken (§6), and every product decision (§8).

## Quick start

```bash
# terminal 1 — API
cd BE
npm install
cp .env.example .env           # set DATABASE_URL; CORS_ORIGIN must match the web app's address
npm run db:reset               # creates an EMPTY database and applies every migration
npm run dev                    # http://localhost:4000 — login codes and emails print here

# terminal 2 — web app
cd FE
npm install
cp .env.example .env.local
npm run dev                    # http://localhost:3000
```

There is no demo data. On first run:

1. **First staff account:** open `/login`. With no staff accounts yet, it shows **Persediaan awal**; create the first ADMIN there.
2. **Other staff:** that ADMIN creates every other account under **Tetapan › Pengurusan staf**.
3. **Complainants:** they register themselves at `/me` › **Daftar**.

## Signing in

| Who | How |
| --- | --- |
| **Staff** | Email + password → slider image captcha → 6-digit code from the API terminal. Passwords need 12+ characters with upper case, lower case, a number and a special character. They expire after 180 days (ADMIN can change the period). A password ADMIN sets must be replaced at first login. Five wrong passwords block the account until ADMIN unlocks it or the owner uses **Lupa kata laluan?** |
| **Complainant** | No password. Register once with name + email, then sign in with a 6-digit code from the API terminal. |
| **Anyone** | Submit a complaint and track it by reference number without signing in. |

Passwords and codes are hidden while typed, with an eye button to show them.

## What's built

| Who | Pages | Can do |
| --- | --- | --- |
| Public | `/`, `/submit`, `/track`, `/hubungi` | **Submit** a complaint, named or anonymous, laid out as BORANG ADUAN (Lampiran 2), with an optional supporting-document upload. **Track** by reference number, including a status timeline. **Hubungi Kami** has the unit's contact details and the FAQ. |
| Complainant | `/me`, `/me/complaints/[ref]`, `/submit/protection` | Register and sign in, see their own complaints with status timelines, request whistleblower protection. |
| Integrity Unit (`KUI PI PSU KPSU SETIAUSAHA ADMIN`) | `/dashboard`, `/complaints`, `/complaints/new`, `/complaints/[id]`, `/jmm`, `/jmm/[meetingId]`, `/jmm/decisions`, `/reports`, `/settings` | **Cases:** register with the duplicate check, and work each case file (status history, supporting documents, JMM decisions and signing to quorum, case actions, referral to KJ / sub-unit, closing). **JMM:** meetings, agendas, decision log. **Reports:** counts and breakdowns. |
| ADMIN | `/settings/staff` | Create staff, set roles, reset passwords, unblock, deactivate or activate, and set the password expiry period. |
| KJ / SUB_UNIT | `/kj/inbox`, `/subunit/tasks`, `/settings` | See actions referred to them (five fields and the reference number) and update the two fields they may change. |
| Staff (no session needed) | `/login`, `/lupa-kata-laluan` | Sign in, first-run setup, password reset. |

**Not built yet:** the KUI screen for reviewing protection requests. `/protection-requests` is a placeholder, but the API endpoint `POST /api/admin/protection-requests/:id/review` works.

## Rules worth knowing before you change anything

These are enforced in `BE`, not by hiding things in `FE`. The full list is in [CLAUDE.md §6](CLAUDE.md).

- **NFA stays hidden.** Outside the Integrity Unit, an NFA case looks exactly like an unknown one, including to the person who filed it (rule 2).
- **Internal data never reaches the public.** Notes, JMM decisions, complainant identity and supporting documents never reach the portal, complainants or KJ / sub-unit. Public views show only the status and its timeline (rule 9).
- **Anonymous means nothing about the complainant is stored.** Not even an email; the reference number is their only way back (rule 6).
- **Email only, no SMS.** Email is the only outbound channel. There is no SMS code, provider or dependency (rule 10).
- **Status moves only through defined events.** Registration, agenda, decision and closing are the only ways a case changes status (§4).

## Checks

```bash
cd BE && npm test                              # creates and DROPS the "<db>_test" database
cd BE && npm run typecheck && npm run lint
cd FE && npm run typecheck && npm run lint
```

## Layout

```
README.md       this file
RUN-LOCALLY.md  install, first run, troubleshooting
CLAUDE.md       project guide: schema, business rules, product decisions
FE/             Next.js app
BE/             Express API, db/schema.sql and db/migrations/ (001–015)
docs/           aduan-palette-preview.html (source swatches for the colour palette)
```
