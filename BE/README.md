# BE — Sistem Aduan Integriti API

Express 5 + TypeScript + PostgreSQL (`pg`, plain SQL, no ORM). Serves the frontend in [`../FE`](../FE). Step-by-step install for both apps: [`../RUN-LOCALLY.md`](../RUN-LOCALLY.md).

Read [`../CLAUDE.md`](../CLAUDE.md) before changing anything here — §6 lists the business rules this API enforces, and where; §8 lists the product decisions behind migrations 004+.

## Setup

```bash
npm install
cp .env.example .env          # DATABASE_URL is required; the server won't boot without it

createdb aduan
npm run db:migrate            # applies schema.sql, then every migration in order

npm run dev
```

There is no demo data. On an empty database, open `/login` in the web app: it offers **Persediaan awal** to create the first ADMIN, who then creates every other staff account under Tetapan › Pengurusan staf. (Or from a terminal: `npm run staff -- create you@example.gov.my ADMIN "Your Name"`, which prompts for a password.) Complainants register themselves at `/me` › Daftar. Every email — login and registration codes, acknowledgements — is printed in this terminal instead of being sent.

After pulling new migrations, run `npm run db:migrate` again. It applies only the files not yet recorded, so it's safe to run any time. To start over locally, `npm run db:reset` drops, recreates, and migrates in one step.

`db/schema.sql` is canonical and stays a direct transcription of the Masterlist / BORANG JMM mapping. Incremental changes go in `db/migrations/NNN_name.sql`, never folded back.

### Migrations

- `db:migrate` applies `db/schema.sql`, then each `db/migrations/NNN_*.sql` in order, and records each file with a SHA-256 in `schema_migrations`.
- **Never edit an applied migration.** `db:migrate` refuses to run if a recorded file's contents have changed. Add a new numbered file instead. Locally, `db:reset` rebuilds from scratch.
- A file without its own `BEGIN`/`COMMIT` is applied and recorded in a single transaction. A file with its own transaction is recorded immediately after it commits.
- `db:reset` drops and recreates the database, then migrates. It refuses when `NODE_ENV=production`, when the host isn't local, or when the database is `postgres`/`template*`.

**Already set up by hand** (the old `psql -f` steps)? `db:migrate` will refuse, because it can't tell which files were applied. Either run `npm run db:reset` (deletes local data) or adopt the database without losing data:

```bash
npm run db:migrate -- --baseline 003   # marks schema.sql + 001–003 as applied, then runs 004 onwards
```

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting (includes tests) |
| `npm test` | Unit + API tests. **Drops and recreates** the test database — see [Tests](#tests) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run staff -- <cmd>` | Staff accounts: `create <email> <role> "<name>"`, `set-role <email> <role>`, `set-password`, `deactivate`, `activate`, `list` |
| `npm run db:migrate` | Apply pending migrations (see [Migrations](#migrations)) |
| `npm run db:reset` | Drop, recreate, and migrate the local database. Refuses in production |

## Endpoints

`/api/complaints` and `/api/admin/*` are a **security boundary**, not a naming convention. The public tree never returns internal notes or decision records (business rule 9).

### Auth — staff sessions

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ email, password }` → sets the `aduan_sid` cookie. 401 on any failure, 423 when locked |
| `POST` | `/api/auth/logout` | Deletes the session server-side, clears the cookie |
| `GET` | `/api/auth/me` | Current staff member, incl. `isIntegrityUnit` |
| `POST` | `/api/auth/password` | `{ currentPassword, newPassword }` → signs out all other sessions |

### Public — portal

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + DB round trip |
| `POST` | `/api/complaints` | File a complaint. Accepts only `caseDescription`, `accusedParticulars`, `accusedDepartment`, `integrityCategory`, `complaintDate` plus the complainant block; filed as channel `SAI`, received today (Malaysia time). Requires `complainant` (named: `particulars`; anonymous: `isAnonymous: true` and no other complainant field) and `disclaimerAcknowledged: true`. Emails an acknowledgement when `contactEmail` is given. Also accepts multipart/form-data: the same JSON in `payload`, supporting documents in `files`. 409 with a *count* of possible duplicates unless `duplicateCheckAcknowledged: true` |
| `GET` | `/api/complaints/:refNo` | Track by reference number. Returns a narrow, public-safe shape |

### Complainant — email OTP (cookie `aduan_csid`)

Same public-safe shapes as the portal. NFA cases, and other people's complaints, answer exactly like unknown ones.

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/complainant/auth/request-code` | `{ email }` → always 202 with the same message. A code is emailed only if the address has a visible complaint and isn't throttled |
| `POST` | `/api/complainant/auth/verify` | `{ email, code }` → sets `aduan_csid`. 401 for wrong, expired, used, or exhausted codes alike |
| `POST` | `/api/complainant/auth/logout` | Deletes the session, clears the cookie |
| `GET` | `/api/complainant/auth/me` | `{ email, sessionExpiresAt }` |
| `GET` | `/api/complainant/complaints` | My complaints |
| `GET` | `/api/complainant/complaints/:refNo` | One of my complaints |
| `GET` | `/api/complainant/protection-requests` | My protection requests (no review notes) |
| `POST` | `/api/complainant/protection-requests` | `{ complaintRefNo, reason }` for my own complaint. 404 if not mine / NFA; 409 while one is pending |

Locally, emails — including login codes — are printed to the BE console by `notifyByEmail()`. There is no SMS channel.

### Referrals — KJ / SUB_UNIT only

Outside `/api/admin` on purpose: these roles still get 403 there, and Integrity Unit roles get 403 here.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/referrals/actions` | My referred actions, on non-NFA complaints: `id`, `complaintRefNo`, `actionTaken`, `actionDate`, `fileRefNo`, `responseReceivedDate`, `feedbackStatus` — nothing else |
| `PATCH` | `/api/referrals/actions/:id` | `{ responseReceivedDate?, feedbackStatus? }` only; any other key is 422. Not mine / NFA / missing → 404 |

### Internal — Integrity Unit console

All gated on `INTEGRITY_UNIT_ROLES` (protection requests: KUI only; staff: ADMIN only). `KJ` and `SUB_UNIT` staff get 403 here.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/admin/complaints` | List with filters (`status`, `reportYear`, `reportMonth`, `integrityCategory`, `sourceChannel`, `sector`, `from`/`to`, `limit`, `offset`). `from`/`to` bound the received date, else complaint date, else registration day — the same period date `/api/admin/stats` uses |
| `POST` | `/api/admin/complaints` | Register. 409 with the candidate records unless acknowledged |
| `POST` | `/api/admin/complaints/duplicate-candidates` | Run the duplicate check on its own |
| `GET` | `/api/admin/complaints/:id` | Full case file: complaint + decisions + signatories + quorum + actions |
| `PATCH` | `/api/admin/complaints/:id` | Update. Refuses `complaintRefNo` and `status` outright (400) |
| `POST` | `/api/admin/complaints/:id/close` | Close the case: Dalam Tindakan → Selesai. 409 from any other status |
| `GET`/`POST` | `/api/admin/complaints/:id/decisions` | JMM decisions. POST takes `meetingId` (required while the complaint is on an open agenda) and returns `complaintStatus`. No PATCH — corrections are a new row |
| `GET`/`POST` | `/api/admin/complaints/:id/case-actions` | Post-decision tracking |
| `GET` | `/api/admin/decisions` | Decision log. Filters: `outcome`, `from`/`to` (decision date), `meetingId`, `limit`, `offset` |
| `GET` | `/api/admin/decisions/:id` | Signature block + quorum state |
| `POST` | `/api/admin/decisions/:id/sign` | Sign one slot. 409 once the decision is locked |
| `PUT` | `/api/admin/decisions/:id/meeting` | `{ meetingId }` links (or `null` unlinks). Complaint must be on that agenda; 409 once locked |
| `PATCH` | `/api/admin/case-actions/:id` | Update an action |
| `GET` | `/api/admin/case-actions/assignees` | KJ / SUB_UNIT accounts for the referral picker: `id`, `fullName`, `role`, `isActive` (no email) |
| `PUT` | `/api/admin/case-actions/:id/assignee` | `{ staffId }` refers the action to an active KJ/SUB_UNIT (`null` clears). 422 for any other account; 409 on an NFA complaint |
| `GET` | `/api/admin/jmm/meetings` | List. Filters: `status`, `from`/`to` (meeting date), `limit`, `offset` |
| `POST` | `/api/admin/jmm/meetings` | Create `{ meetingNo, meetingDate, venue? }`. 409 on a duplicate `meetingNo` |
| `GET` | `/api/admin/jmm/meetings/:id` | Meeting + agenda in order + decisions made at it |
| `PATCH` | `/api/admin/jmm/meetings/:id` | Edit details. 409 once closed; refuses `status` (400) |
| `POST` | `/api/admin/jmm/meetings/:id/close` | Mark Selesai. 409 while any agenda item has no decision |
| `POST` | `/api/admin/jmm/meetings/:id/items` | `{ complaintId, agendaOrder? }` → complaint becomes Menunggu JMM. 409 if already on an open meeting |
| `DELETE` | `/api/admin/jmm/meetings/:id/items/:complaintId` | Take off the agenda; Menunggu JMM reverts. 409 once decided at this meeting |
| `PUT` | `/api/admin/jmm/meetings/:id/items/order` | `{ complaintIds }` — exactly the current items, in the new order |
| `GET` | `/api/admin/stats` | Counts by status, integrity category, sector, source channel, month. Filters: `year`, `month` (needs `year`) |
| `GET` | `/api/admin/protection-requests` | **KUI only.** Filters: `status`, `limit`, `offset` |
| `GET` | `/api/admin/protection-requests/:id` | **KUI only** |
| `POST` | `/api/admin/protection-requests/:id/review` | **KUI only.** `{ status: DILULUSKAN \| DITOLAK, reviewNotes? }`. 409 once reviewed |
| `GET` | `/api/admin/staff` | **ADMIN only.** All accounts (`hasPassword`, never a hash) |
| `POST` | `/api/admin/staff` | **ADMIN only.** `{ email, fullName, role, password }`. 409 on a taken email |
| `PUT` | `/api/admin/staff/:id/role` | **ADMIN only.** `{ role }`, effective on the next request |
| `POST` | `/api/admin/staff/:id/password` | **ADMIN only.** `{ password }`; signs the account out everywhere |
| `POST` | `/api/admin/staff/:id/deactivate` | **ADMIN only.** Signs the account out immediately |
| `POST` | `/api/admin/staff/:id/activate` | **ADMIN only** |

Demoting or deactivating the last active ADMIN is refused (409).

Every meeting and agenda write returns the full meeting detail. Status transitions are listed in CLAUDE.md §4.

Responses wrap the payload in `{ "data": ... }`; errors return `{ "error": "..." }`. 400 = malformed request, 404 = not found, 409 = the current state refuses the change, 422 = well-formed but invalid.

## Tests

```bash
TEST_DATABASE_URL=postgres://you@localhost:5432/aduan_test npm test
```

Without `TEST_DATABASE_URL`, tests use `DATABASE_URL` with `_test` appended to the database name. The suite **drops and recreates** that database, so it refuses any name that doesn't end in `_test`, any non-local host, and `NODE_ENV=production`.

- `src/test/complaintStatus.test.ts` — the transition table, every status × every event.
- `src/test/api.test.ts` — the real app over HTTP: each transition and its refusals, meetings, agenda, decision log, stats, and the role gate.
- `src/test/complainant.test.ts` — portal submission, OTP expiry / attempt limit / reuse, my complaints and protection requests across complainants, NFA handling, and rule 10 (no SMS).
- `src/test/referrals.test.ts` — referring actions; KJ/SUB_UNIT see only their own non-NFA actions and allowed fields, update only two fields, and stay 403 on `/api/admin/*`.
- `src/test/staffManagement.test.ts` — ADMIN-only staff endpoints, immediate sign-out on deactivation and password reset, last-ADMIN guard.
- `src/test/attachments.test.ts` — supporting documents: content typing, metadata stripping, nothing written on refusal, Integrity Unit-only download.
- `src/test/accounts.test.ts` — first-run ADMIN setup, complainant registration, and the public status timeline.

Test files run one at a time (`--test-concurrency=1`) because they share the test database. Outbound email is captured in memory rather than printed.

## Calling admin routes

Sign in once, then send the cookie:

```bash
curl -c jar -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.gov.my","password":"…"}'

curl -b jar http://localhost:4000/api/admin/complaints
```

Writes from a browser must come from an origin listed in `CORS_ORIGIN`, or they're refused with 403 (CSRF protection). Clients without an `Origin` header, like curl, are unaffected.

## Things worth knowing

- **Ids are strings.** Every PK is `BIGINT`; converting to a JS number would lose precision past 2^53, so `pg` leaves them as strings and so do we.
- **Dates are strings.** `DATE` columns are calendar dates, not instants. A type parser in `src/db/client.ts` keeps them as `'YYYY-MM-DD'` rather than letting `pg` build a local-midnight `Date` that shifts the day either side of UTC.
- **`.env` is loaded automatically** from `BE/.env` when present; real environment variables take precedence.
- **Status is stored.** Only `applyStatusEvent()` in `src/db/queries/complaints.ts` writes `complaints.status`, after checking the transition table in `src/db/complaintStatus.ts`. Don't `UPDATE complaints SET status` anywhere else.
