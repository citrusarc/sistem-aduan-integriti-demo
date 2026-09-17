# Sistem Aduan Integriti — Demo

Complaint management for an Integrity Unit (Unit Integriti): a public portal to submit and track complaints, a complainant login, an internal case register, JMM meetings and decision forms, post-decision tracking with referrals to department heads, and reporting.

**To run it: [RUN-LOCALLY.md](RUN-LOCALLY.md)** — every install step, the demo logins, and troubleshooting.

| Folder | What it is | Dev port |
| --- | --- | --- |
| [`FE/`](FE) | Next.js 16 + Tailwind v4 + Base UI frontend | 3000 |
| [`BE/`](BE) | Express 5 + PostgreSQL REST API (plain SQL, no ORM) | 4000 |

`FE` never talks to Postgres; `BE` never renders UI. Each folder has its own `package.json`, `tsconfig.json`, and lint/format setup.

**[CLAUDE.md](CLAUDE.md) is the project guide** — schema, the six JMM outcomes, the status lifecycle, the business rules that must not be broken, and the product decisions (§8). Read it before changing either side.

## What's built

| Who | Pages | Can do |
| --- | --- | --- |
| Public | `/`, `/faq`, `/submit`, `/track` | Submit a complaint (named or anonymous; email required, phone for staff to call only; handling disclaimer; possible-duplicate confirmation), track by reference number |
| Complainant (email OTP) | `/me`, `/me/complaints/[ref]`, `/submit/protection` | See only their own complaints in the public-safe shape, request whistleblower protection and follow its status |
| Integrity Unit (`KUI PI PSU KPSU SETIAUSAHA ADMIN`) | `/dashboard`, `/complaints`, `/complaints/new`, `/complaints/[id]`, `/jmm`, `/jmm/[meetingId]`, `/jmm/decisions`, `/reports`, `/settings` | Register with the duplicate check, meetings and agendas, record decisions, sign to quorum, case actions, refer actions to KJ / sub-unit, close cases, decision log, counts and breakdowns |
| ADMIN | `/settings/staff` | Create staff, set role, reset password, deactivate / activate |
| KJ / SUB_UNIT | `/kj/inbox`, `/subunit/tasks`, `/settings` | See actions referred to them (five fields and the reference number) and update the two they may |

Not built yet: the KUI screen for reviewing protection requests (`/protection-requests` is a placeholder; the API `POST /api/admin/protection-requests/:id/review` works).

The business rules are enforced in `BE`, not by hiding things in `FE`: NFA cases are indistinguishable from unknown ones everywhere outside the Integrity Unit (rule 2), internal notes never reach the portal, complainants or KJ / sub-unit (rule 9), and email is the only outbound channel — there is no SMS code, provider or dependency (rule 10).

## First login without demo data

There's no sign-up. Create the first ADMIN from `BE/` (you'll be prompted for a password, 12+ characters), then manage everyone else at `/settings/staff` or with the same CLI:

```bash
npm run staff -- create admin@example.gov.my ADMIN "Nama Penuh"
```

Already have a database from the old `psql -f` steps? Run `npm run db:migrate -- --baseline 003` in `BE/` instead of `db:reset`, to keep your data (see [BE/README.md](BE/README.md#migrations)).

## Layout

```
RUN-LOCALLY.md  install and run guide
CLAUDE.md       project guide: schema, rules, decisions
FE/             Next.js app — see FE/README.md
BE/             Express API + db/schema.sql + migrations — see BE/README.md
docs/           aduan-palette-preview.html (source swatches for the palette)
```
