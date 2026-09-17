# CLAUDE.md — Sistem Pengurusan Aduan

Project guide for AI-assisted development. This file summarizes decisions already made in design/discovery; anything marked **(assumption)** has not actually been confirmed and should be checked before being treated as fixed.

---

## 1. Tech Stack

| Layer | Choice | Status |
|---|---|---|
| Repo shape | Two apps: `FE/` (Next.js) and `BE/` (Express) — see §5 | Confirmed |
| Frontend | Next.js 16, **App Router**, TypeScript | Confirmed |
| Backend | Express 5, TypeScript, standalone HTTP API | Confirmed |
| Database | PostgreSQL, plain SQL — **no ORM** | Confirmed (see `BE/db/schema.sql`) |
| DB access | **`pg` (node-postgres)**, hand-written queries | Confirmed — `BE/src/db/client.ts` |
| Styling | Tailwind CSS v4 | Confirmed — already in `FE` |
| Staff auth | Email + password (scrypt), server-side sessions, httpOnly cookie | Confirmed — see "Staff auth" below |
| Complainant auth | Email OTP only, own tables and cookie `aduan_csid`, plus an anonymous submission path | **Implemented — §8 decisions 3–4.** BE: `BE/src/auth/complainantStore.ts`, `BE/src/routes/complainant.ts`. FE: `/me`, `components/portal/complainant-login.tsx` |
| Hosting/infra | Not yet decided — runs locally, see `RUN-LOCALLY.md` | Open |

Do not assume an ORM (Prisma, Drizzle, etc.) will be introduced later without an explicit decision — the schema and all queries in this project are plain SQL by design.

### Staff auth

Implemented in `BE/src/auth/*` and `BE/src/middleware/auth.ts`; schema in `BE/db/migrations/003_staff_auth.sql`.

- **Passwords**: scrypt via `node:crypto` (N=2¹⁵, r=8), self-describing hash format so parameters can be raised later. Minimum 12 characters. `password_hash` is read only by `src/auth/store.ts` — `StaffUserRow` omits it on purpose.
- **Sessions**: rows in `staff_sessions`, keyed by the SHA-256 of a random token; only the cookie holds the raw token. 8 h absolute cap, 30 min idle timeout. Every request re-checks `staff_users.is_active`, so deactivation is immediate.
- **Cookie**: `aduan_sid`, `HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` in production. FE must call with `credentials: "include"` (done in `FE/lib/api.ts`).
- **CSRF**: `SameSite=Lax` plus `requireTrustedOrigin`, which refuses any non-GET whose `Origin` isn't in `CORS_ORIGIN`.
- **Brute force**: 5 failures → 15 min lockout. Failures during a lockout don't extend it (otherwise anyone knowing an email could lock that person out forever). Lockout is only revealed after a correct password.
- **Enumeration**: one error message for every login failure, and unknown emails are verified against a dummy hash (warmed at startup) so timing matches a wrong password.
- **Revocation**: logout deletes the session row; a password change or reset signs out every other session.
- **Accounts** (§8 decision 7): ADMIN-only endpoints under `/api/admin/staff`, and `npm run staff -- create|set-role|set-password|deactivate|activate|list` in `BE/`. Both call the same functions in `src/auth/store.ts`. Neither will leave the system without an active ADMIN (409). The CLI reads passwords from a hidden prompt or stdin, never argv. Everyone changes their own password at `POST /api/auth/password`.

Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`.

### Roles and the Integrity Unit gate

`staff_role_enum` = `KUI | PI | PSU | KPSU | SETIAUSAHA | ADMIN | KJ | SUB_UNIT`. `KJ` (Ketua Jabatan) and `SUB_UNIT` were added by `002_add_kj_subunit_roles.sql` to match the sitemap's `kj/inbox` and `subunit/tasks` screens.

**KJ and SUB_UNIT are staff, but outside the Integrity Unit.** They can log in, and are refused (403) by every `/api/admin/*` router, which is gated on `INTEGRITY_UNIT_ROLES` in `BE/src/auth/roles.ts` — not on "any logged-in staff". Letting them through would break rules 2 and 9. Adding a role to the enum does not add it to that list, deliberately. Never mount an admin router with a bare `requireStaff()`.

**Their API is `/api/referrals`** (§8 decision 5), gated on `REFERRAL_RECIPIENT_ROLES` — a separate tree, not a loosened admin gate; Integrity Unit roles get 403 there. It returns only `toReferredAction()`: the five allowed action fields, the complaint reference number, and the action id, for the caller's own actions on disclosable complaints. The query itself selects nothing else. The only write is `responseReceivedDate` / `feedbackStatus`; any other key is refused. Referring an action (`PUT /api/admin/case-actions/:id/assignee`) is Integrity Unit only, accepts only active KJ/SUB_UNIT accounts, and is refused on NFA complaints.

---

## 2. Database Entities (`BE/db/schema.sql` + `BE/db/migrations/*` are the source of truth)

| Table | Key fields | Purpose |
|---|---|---|
| `complainants` | `id`, `particulars` (text = NAMA), `grade_level` (enum), `contact_email`, `contact_phone`, `is_anonymous`; Lampiran 2 (migration 010): `complainant_category`, `ic_no`, `passport_no`, `age`, `gender`, `race`, `nationality`, `contact_phone_2`, `postal_address`, `occupation`, `employer` | Masterlist complainant record, a return channel (006), and the BORANG ADUAN/ MAKLUMAT identity fields (§8 decision 9) — **all optional, internal only**. Anonymous rows have `contact_email` and no `particulars` (`chk_anonymous_contact`) and none of IC/passport/age/gender/race/nationality/address/occupation/employer (`chk_anonymous_identity`) |
| `complaints` | `id`, `complaint_ref_no` (unique), `complainant_id` (FK), `source_channel`, `directed_to`, `accused_particulars`/`accused_grade_level`/`accused_department`, `info_classification`, `integrity_category`, `sector`, `case_description`, `complaint_date`, `received_date_ui`, `status` (enum), `status_changed_at`, `disclaimer_acknowledged_at`; Lampiran 2 (010): `accused_position`, `accused2_particulars`/`accused2_department`/`accused2_position`, `incident_date`, `incident_time`, `has_supporting_documents`, `received_via` (enum, 14 values) | Core case record, one row per complaint |
| `jmm_decisions` | `id`, `complaint_id` (FK), `decision_date`, `agency_file_no`, `summary`, `jmm_source`, `jmm_classification`, `outcome` (enum, 6 values — see §3), `remarks_further_action`, `meeting_id` (FK, nullable) | The formal JMM decision form, one-to-many per complaint (a case can be re-tabled) |
| `jmm_meetings` | `id`, `meeting_no` (unique), `meeting_date`, `venue`, `status` (`DIJADUALKAN`/`SELESAI`) | A JMM sitting (migration 004) |
| `jmm_meeting_items` | `id`, `meeting_id` (FK), `complaint_id` (FK), `agenda_order` | Agenda. Unique per (meeting, complaint); a trigger keeps each complaint on at most one `DIJADUALKAN` meeting |
| `jmm_decision_signatories` | `id`, `jmm_decision_id` (FK), `staff_id` (FK, nullable), `role_category` (`PENGERUSI`/`AHLI`/`URUS_SETIA`), `role_title`, `signed_at` | Signature block for a decision — variable number of signatories |
| `case_actions` | `id`, `complaint_id` (FK), `jmm_decision_id` (FK, nullable), `psu_action_notes`, `action_taken` (enum, 6 values, **distinct vocabulary from `jmm_decisions.outcome`**), `action_date`, `response_received_date`, `feedback_status`, `ui_remarks`, `file_ref_no`, `assigned_to_staff_id` (FK, nullable) | Post-decision tracking; a complaint can accumulate more than one action over time |
| `staff_users` | `id`, `full_name`, `role` (`KUI`/`PI`/`PSU`/`KPSU`/`SETIAUSAHA`/`ADMIN`/`KJ`/`SUB_UNIT`), `email`, `is_active`, `password_hash`, lockout columns | Staff accounts, supports FKs above — not itself derived from an Excel sheet |
| `staff_sessions` | `id` (SHA-256 of token), `staff_id` (FK), `expires_at`, `last_seen_at` | Server-side login sessions (migration 003) |
| `complainant_otp_codes` | `id`, `email` (lower-case), `code_hash`, `expires_at`, `attempt_count` (≤ 5), `consumed_at` | Email OTP codes, hashed (migration 007) |
| `complainant_sessions` | `id` (SHA-256 of token), `email`, `expires_at`, `last_seen_at` | Complainant sessions, cookie `aduan_csid` (migration 007) |
| `protection_requests` | `id`, `complaint_id` (FK), `requested_by_email`, `reason`, `status` (`DITERIMA`/`DILULUSKAN`/`DITOLAK`), `reviewed_by` (FK staff), `reviewed_at`, `review_notes` (internal) | Whistleblower protection requests (migration 009) |
| `schema_migrations` | `name`, `checksum`, `applied_at` | Created and owned by `npm run db:migrate`, not by a migration file |

Full column list, enum definitions, and indexes: `BE/db/schema.sql` plus the migrations.

Migrations layer on top and are never folded back into `schema.sql`, which stays a direct transcription of the Masterlist/BORANG JMM mapping. `npm run db:migrate` (in `BE/`) applies `schema.sql` then each migration in order, records each with a SHA-256 in `schema_migrations`, and **refuses to run if an already-applied file has been edited** — add a new numbered file instead. `npm run db:reset` drops, recreates, and migrates; it refuses `NODE_ENV=production` and non-local hosts.

| Migration | Adds |
|---|---|
| `001_enable_pg_trgm.sql` | `pg_trgm` + GIN indexes — without it the duplicate check (§6 rule 5) fails at runtime |
| `002_add_kj_subunit_roles.sql` | `KJ`, `SUB_UNIT` on `staff_role_enum` — its own file, because a new enum value can't be used in the transaction that adds it |
| `003_staff_auth.sql` | Password/lockout columns on `staff_users`, case-insensitive email index, `staff_sessions` |
| `004_jmm_meetings.sql` | `jmm_meetings`, `jmm_meeting_items`, `jmm_decisions.meeting_id`, one-open-meeting triggers (§8 decision 2) |
| `005_complaint_status.sql` | `complaints.status` + `status_changed_at`, backfilled (§8 decision 1). After 004 so the backfill sees agendas |
| `006_complainant_contact.sql` | Contact columns + anonymous check on `complainants`, `complaints.disclaimer_acknowledged_at` (§8 decision 3) |
| `007_complainant_auth.sql` | `complainant_otp_codes`, `complainant_sessions` (§8 decision 4) |
| `008_case_action_assignment.sql` | `case_actions.assigned_to_staff_id` (§8 decision 5) |
| `009_protection_requests.sql` | `protection_requests` (§8 decision 6) |
| `010_borang_aduan_lampiran2.sql` | Lampiran 2 columns on `complainants` and `complaints`, `complainant_category_enum`, `gender_enum`, `received_via_enum`, `chk_anonymous_identity` (§8 decision 9) |

### Type mirrors — three copies, one truth

| File | Role |
|---|---|
| `BE/db/schema.sql` + migrations | Canonical |
| `BE/src/types/enums.ts` | Mirrors it 1:1, no labels |
| `FE/types/enums.ts` | Mirrors that, plus Malay display labels |

All three change in the same PR. `BE/src/validation/common.ts` derives its zod validators from the BE mirror rather than re-typing values, so BE validation cannot drift from the BE types — but it can still drift from the database, and from FE.

---

## 3. JMM Decision Values

⚠️ **Correction from an earlier draft**: this project's schema uses **6** fixed outcomes (from the actual "BORANG JMM" / "B. JMM" form), not 8. The 8-value list (Pengesanan & Pengesahan, Tatatertib, Pematuhan/Tadbir Urus, Tindakan Dalaman Agensi, Rujuk Agensi Penguatkuasaan, Rujuk Pengadu, Rujuk Lain-lain Agensi, NFA) came from the generic SPRM Tatacara PDF and was superseded once the actual Masterlist/JMM form was provided. If the 8-value list is actually what you want enforced, that's a real product decision — confirm it explicitly rather than silently switching the enum.

The 6 canonical values (`jmm_outcome_enum`):

1. `UTK_MAKLUMAN_KSU` — for KSU's information only
2. `TINDAKAN_SPRM` — referred to SPRM
3. `TINDAKAN_BAHAGIAN_JABATAN_AGENSI` — referred to the relevant division/department/agency
4. `PENUBUHAN_JKSD` — establish an internal investigation committee (Jawatankuasa Siasatan Dalaman)
5. `TINDAKAN_TATATERTIB` — Disciplinary Section, Integrity Unit
6. `NFA` — No Further Action

Never introduce a 7th value into `jmm_outcome_enum` without an explicit product decision — code that assumes 8 outcomes will silently mishandle real data.

---

## 4. Status Lifecycle

Five UI-facing states (matches the badge convention already agreed): **Baru → Menunggu JMM → Dalam Tindakan → Selesai / NFA**.

`complaints.status` is **stored** (migration 005) and written by the API on every transition — §8 decisions 1–2. Nothing derives or guesses status at read time; read the column. The transition table is `BE/src/db/complaintStatus.ts`, and `applyStatusEvent()` in `BE/src/db/queries/complaints.ts` is the **only** writer of the column. It runs inside the transaction that locks the complaint row.

| Event | Endpoint | Allowed from | → |
|---|---|---|---|
| Registered | `POST /api/complaints`, `POST /api/admin/complaints` | — | Baru |
| Added to agenda | `POST /api/admin/jmm/meetings/:id/items` | Baru, Dalam Tindakan, NFA | Menunggu JMM |
| Removed from agenda | `DELETE /api/admin/jmm/meetings/:id/items/:complaintId` | Menunggu JMM | Baru, or what the last recorded decision made it (NFA / Dalam Tindakan) |
| Decision recorded | `POST /api/admin/complaints/:id/decisions` | Baru, Menunggu JMM, Dalam Tindakan, NFA | NFA if outcome = NFA, else Dalam Tindakan |
| Case closed | `POST /api/admin/complaints/:id/close` | Dalam Tindakan | Selesai |

Everything else is refused with 409 and leaves the status unchanged. In particular:
- **Selesai is terminal.** Nothing re-tables, decides, or reopens a closed case.
- **NFA cannot be "closed".** NFA is already a closure, just not a Selesai one; it can be re-tabled.
- **Menunggu JMM always means "on an open meeting's agenda".** Adding it again is refused, and so is closing a meeting while any item has no decision (see §8).
- **No PATCH moves status.** A `status` key on `PATCH /api/admin/complaints/:id` is refused with 400.

`status_changed_at` moves only when the status actually changes, so a second non-NFA decision doesn't reset a case's age. Rows set by the migration 005 backfill before this API existed — especially `SELESAI` ones, which came from a text match — deserve one staff review.

---

## 5. Repo Structure

Two independently installed and deployed apps. `FE` never talks to Postgres; `BE` never renders UI.

```
FE/                                  # Next.js 16, UI only
  app/
    layout.tsx                       # root: <html lang="ms">, metadata, theme
    not-found.tsx
    (portal)/                        # public; complainant session only (aduan_csid)
      layout.tsx                     # ComplainantSessionProvider + header/footer, no console nav
      page.tsx  faq/  submit/  track/                    # public
      me/  me/complaints/[id]/  submit/protection/       # complainant (email OTP); [id] = ref no with "/" as "."
    (admin)/                         # staff; StaffSessionProvider wraps everything below
      layout.tsx
      login/page.tsx                 # NOT gated; honours a safe ?next=
      tiada-akses/page.tsx           # NOT gated; where a wrong-role user lands
      (console)/
        layout.tsx                   # AdminShell: the gate + role-aware nav
        dashboard/  reports/
        complaints/  complaints/new/  complaints/[id]/
        jmm/  jmm/[meetingId]/  jmm/decisions/
        protection-requests/         # KUI only — placeholder, review via the API
        kj/inbox/                    # KJ only
        subunit/tasks/               # SUB_UNIT only
        settings/                    # every staff role (own password)
        settings/staff/              # ADMIN only
    globals.css                      # palette + status tokens (§7)
  components/
    complaints/                      # borang-aduan-fields: Lampiran 2 field groups shared by /submit and complaints/new
    admin/                           # admin-shell (gate), login-form, no-access
      complaints/                    # register, registration-form, case-file, decision-card, case-actions
      jmm/                           # meeting-list, meeting-detail, decision-form, decision-log
      stats/                         # dashboard, reports, buckets
      referrals/                     # referred-actions (KJ inbox + sub-unit tasks)
      settings/                      # account-settings, staff-management
    portal/                          # header, footer, track-lookup, complaint-submit-form,
                                     # complainant-login (RequireComplainant), my-complaints,
                                     # my-complaint-detail, protection-request-form, public-status
    providers/                       # staff-session, complainant-session — separate on purpose
    ui/                              # button, input/textarea/checkbox, field, select, enum-select,
                                     # table, pagination, date-display, states, page-header, status-pill,
                                     # dialog (Dialog, ConfirmDialog), section (Section, DetailList, Notice),
                                     # badge, bar-chart (single-series bars/columns + table view), back-link
  hooks/
    use-api-data.ts                  # browser fetch state: key-based refetch, reload(), setData()
    use-search-params-updater.ts     # set/clear URL filter params; resets ?halaman=
  lib/
    api.ts                           # api() + publicApi / complainantApi / adminApi / referralsApi; NetworkError
    errors.ts                        # describeError / errorMessage — the ONLY wording for API failures; UserFacingError
    dom.ts                           # mount-time scroll refs (no requestAnimationFrame timing guesses)
    auth.ts                          # staff login / logout / me / change password
    access.ts                        # path -> roles (deny by default), nav per role, safe ?next=
    format.ts                        # Malay dates; DATE strings never shift a day; MYT datetime inputs
    ref-slug.ts                      # UI/2026/00012 <-> UI.2026.00012 for complainant URLs
  types/
    enums.ts                         # mirrors BE/src/types/enums.ts + labels
    entities.ts                      # API response shapes
    requests.ts                      # request bodies and query filters

BE/                                  # Express 5 + pg, no UI
  db/
    schema.sql                       # canonical — never hand-edit prod without updating
    migrations/                      # 001–003 trgm/roles/staff auth; 004–009 §8 decisions (see §2)
  src/
    app.ts                           # CORS, JSON, router, error handler
    server.ts                        # entry, graceful shutdown
    config.ts                        # loads .env, fails fast on missing DATABASE_URL
    auth/
      password.ts                    # scrypt hash/verify, policy, dummy hash
      store.ts                       # the ONLY reader of password_hash / sessions
      complainantStore.ts            # the ONLY reader of complainant OTP codes / sessions
      roles.ts                       # INTEGRITY_UNIT_ROLES gate list
    notify/
      email.ts                       # notifyByEmail() — the ONLY outbound channel (rule 10)
    middleware/
      auth.ts                        # requireStaff(), cookie helpers, Origin check
      complainantAuth.ts             # requireComplainant(), aduan_csid cookie
      error-handler.ts               # HttpError, 404, error handler
    scripts/
      staff.ts                       # npm run staff -- create|set-password|...
      db.ts                          # npm run db:migrate | db:reset
      seed.ts                        # npm run db:seed (demo data lives in src/db/seed.ts)
    routes/
      index.ts                       # mounts auth + the two trees
      auth.ts                        # /api/auth/login|logout|me|password
      complaints.public.ts           # /api/complaints      — public portal
      complaints.admin.ts            # /api/admin/complaints — console
      decisions.admin.ts             # /api/admin/decisions (log, sign, link), /api/admin/case-actions
      meetings.admin.ts              # /api/admin/jmm/meetings — meetings + agenda
      stats.admin.ts                 # /api/admin/stats — dashboard/report counts
      complainant.ts                 # /api/complainant — OTP login, my complaints, protection requests
      protectionRequests.admin.ts    # /api/admin/protection-requests — KUI only
      referrals.ts                   # /api/referrals — KJ / SUB_UNIT only
      staff.admin.ts                 # /api/admin/staff — ADMIN only
    db/
      client.ts                      # pg Pool, type parsers, withTransaction
      mappers.ts                     # row -> API shape; public vs admin
      complaintStatus.ts             # status transition table (§4)
      errors.ts                      # DomainError: 404/409/422 raised inside transactions
      migrate.ts                     # migration runner (db:migrate, db:reset, tests)
      queries/                       # complaints, jmmMeetings, jmmDecisions, stats, ...
    types/
      enums.ts  entities.ts
    validation/                      # zod, derived from types/enums.ts
    test/                            # node:test over real HTTP + a *_test database
```

Conventions:
- Route groups `(portal)` and `(admin)` keep URLs clean while giving each side its own layout/auth wrapper.
- **FE auth checks run in the browser, and only decide what to show.** BE sets both session cookies with `Path=/api` on its own origin, so Next's server never sees them and can't gate a page (no `proxy.ts`, no server `redirect()` on session). `AdminShell` asks `GET /api/auth/me`, re-checks on every console navigation, and routes: no session → `/login?next=`, role not allowed by `lib/access.ts` → `/tiada-akses`. A 401 from any staff or complainant call signs out only that session (`UNAUTHORIZED_EVENT` in `lib/api.ts`). BE still refuses the data on every request — never rely on the FE gate.
- **New console page = new rule in `lib/access.ts`.** Paths without a rule are refused for every role, so a page can't silently appear for KJ or SUB_UNIT.
- Pass `buttonVariants()` overrides through `cn(buttonVariants(...), "...")`: cva concatenates, only `cn` resolves conflicting Tailwind classes.
- **`/api/complaints` vs `/api/admin/*` is a security boundary, not a naming convention.** Never mount an admin handler under the public prefix, however convenient the URL looks.
- No query is written inline in a route handler — everything lives in `BE/src/db/queries/*`.
- A business-rule check that must share a lock with its write lives in the query layer and throws `DomainError`; the error handler maps it to the status code. Route handlers don't catch it.
- Tests: `npm test` in `BE/`. It **drops and recreates** `TEST_DATABASE_URL` (default: `DATABASE_URL` + `_test`), and refuses any database whose name doesn't end in `_test` or that isn't local. The build (`tsconfig.build.json`) leaves `src/test` out of `dist`.
- Ids are `BIGINT` and travel as **strings** end to end; `DATE` columns travel as `'YYYY-MM-DD'` strings, never JS `Date` (see the type parsers in `client.ts`).

> Superseded: an earlier draft of this file placed the API inside Next.js at `/app/api/*` with `/lib/db`. The FE/BE split replaces that. There is no `app/api` directory.

---

## 6. Business Rules — Never Break

Each rule names where it is enforced. Enforcement lives in the query/validation layer, not the UI.

1. **JMM quorum.** A `jmm_decisions` row is finalized only with a `PENGERUSI` signatory and at least one `AHLI`, each actually signed. → `jmmDecisions.getQuorumState()`; also refused at submit by `validation/jmmDecisions.ts`.
2. **NFA confidentiality.** A complaint whose decision is `NFA` is never disclosed outside the Integrity Unit — including after it is re-tabled, and **including to its own complainant**. → One predicate, `PUBLICLY_DISCLOSABLE_SQL` in `queries/complaints.ts` (status ≠ NFA **and** no NFA decision ever recorded), used by public tracking, the public duplicate check, a complainant's own complaints and protection requests, and deciding who can receive a login code. Every one of those answers an NFA case **identically to an unknown one** — a distinct message would itself disclose the NFA. The public duplicate check passes `excludeNfa`, or someone could confirm an NFA case exists by submitting a matching complaint.
3. **Six fixed JMM outcomes, no more.** → `jmmOutcomeSchema`, derived from the enum mirror.
4. **Two outcome vocabularies are not interchangeable.** `jmm_decisions.outcome` and `case_actions.action_taken` come from different forms. They overlap on `NFA` only by coincidence — that is not a mapping. → no code path converts between them, by design.
5. **Duplicate check before new registration.** → `findDuplicateCandidates()`, recall-biased, over the same period date as stats (so a complaint with no received date is still a candidate). Both create paths refuse with 409 unless `duplicateCheckAcknowledged` is explicitly true. Staff see the candidates; the public caller gets only a count.
6. **Anonymous complainants still need a way back to them.** → `publicCreateComplaintSchema` (422): anonymous requires `contactEmail` and refuses `particulars`; a named portal submission requires `particulars`, so leaving the name blank can't bypass this; `disclaimerAcknowledged` must be literally `true`, and the insert records `complaints.disclaimer_acknowledged_at`. Backstop: check constraint `chk_anonymous_contact` (migration 006). Never stuff an email into `particulars`.
7. **`complaint_ref_no` is immutable once issued.** Server-issued as `UI/<year>/<5-digit seq>` inside the insert transaction, under a per-year advisory lock so concurrent registrations get consecutive numbers instead of a 500, absent from every update schema, and a client sending one on PATCH is refused rather than silently ignored.
8. **Signed decisions are append-only.** Once fully signed, the row is locked; corrections are a new decision row. → `isDecisionLocked()`; `signDecisionSlot()` only ever moves a slot from NULL to a timestamp, and only a slot of the decision in the URL, so a signature cannot be withdrawn, overwritten, or recorded through another decision's lock check.
9. **Internal notes never reach the public API.** `ui_remarks`, `psu_action_notes`, `protection_requests.review_notes` / `reviewed_by`, and everything from `jmm_decisions` stay internal. → `toPublicComplaint()` and `toComplainantProtectionRequest()` **allow-list** fields rather than deleting them, so a column added later cannot leak by default. `/api/complainant/*` returns only those shapes.
10. **No SMS, strictly.** Email is the only automated outbound channel — OTP codes, status updates, any notification — and it goes through a single `notifyByEmail()` that prints to the BE console locally. No SMS OTP, SMS notification, SMS provider, or SMS fallback, now or as a "later" option. `complainants.contact_phone` is for staff to call manually; no code may send anything to it. → `BE/src/notify/email.ts`: refuses any recipient that isn't an email address, prints locally, and **refuses in production** until a real mail transport is added there (printing OTP codes into production logs would leak them). `src/test/complainant.test.ts` fails if SMS-provider code or dependencies appear, or if any module handles `contact_phone` and also calls `notifyByEmail`.

---

## 7. Palette & Status Badges

Tokens live in `FE/app/globals.css`, defined for light and dark. Source swatches: `docs/aduan-palette-preview.html`.

| Token | Hex | Role |
|---|---|---|
| `--primary` | `#1E3A5F` | Deep navy |
| `--secondary` | `#3F6B6E` | Slate teal |
| `--accent` | `#B8863C` | Muted gold |
| `--foreground` | `#23272B` | Ink |
| `--background` | `#F6F5F2` | Warm off-white |
| `--border` | `#D8D6D0` | Border/divider |

Status badges use `--status-*` / `--status-*-foreground` pairs, exposed as Tailwind `bg-status-baru` etc. The colour logic is deliberate and should not be "fixed" into red/green: **NFA is a legitimate closure, not a failure**, and Dalam Tindakan reads as active rather than alarming.

Render statuses through `FE/components/ui/status-pill.tsx`, never as a bare string.

---

## 8. Decisions

Product decisions made after discovery. Each closes a gap flagged elsewhere in this file. Schema for all of them exists (migrations 004–010, see §2). **API:** all nine are implemented in BE (see "How the API implements them" below). **UI:** all nine have screens except the KUI review of protection requests (decision 6's `/protection-requests` is a placeholder; complainants can already file and follow requests). See "How the UI implements them" at the end of this section. Recorded as given:

1. Stored status: complaints.status enum (BARU, MENUNGGU_JMM, DALAM_TINDAKAN,
   SELESAI, NFA), backfilled from the current derivation. Transitions written
   by the API:
   - new → BARU
   - added to meeting agenda → MENUNGGU_JMM
   - decision recorded, outcome ≠ NFA → DALAM_TINDAKAN
   - outcome = NFA → NFA
   - staff closes case → SELESAI
2. JMM meetings:
   - jmm_meetings: meeting_no, meeting_date, venue, status DIJADUALKAN | SELESAI
   - jmm_meeting_items: meeting_id, complaint_id, agenda order, unique pair
   - nullable jmm_decisions.meeting_id
   - A complaint may be on only one open meeting at a time.
3. Complainant contact: complainants gains contact_email, contact_phone
   (nullable), is_anonymous. Anonymous requires contact_email and stores no
   name or particulars. Submission requires acknowledging a disclaimer.
   contact_phone is for staff to call manually only.
4. Complainant login: EMAIL OTP only — 6 digits, 10-minute expiry, max 5
   attempts, stored hashed, own table, separate cookie aduan_csid. Codes go
   through notifyByEmail() to the BE console. Complainants see only complaints
   linked to their email, in the public-safe shape; rules 2 and 9 hold.
5. KJ / sub-unit assignment: case_actions.assigned_to_staff_id (nullable FK).
   - KJ/SUB_UNIT see only their assigned actions, and only: actionTaken,
     actionDate, fileRefNo, responseReceivedDate, feedbackStatus, and the
     complaint's reference number.
   - They may update responseReceivedDate and feedbackStatus only.
   - Never internal notes, case description, accused party, JMM data, or
     actions on NFA complaints.
6. Protection requests: protection_requests (complaint_id, reason, status
   DITERIMA | DILULUSKAN | DITOLAK, reviewed_by FK staff, reviewed_at,
   review_notes internal). Submitted by a logged-in complainant for one of
   their own complaints. Reviewed by KUI only.
7. Settings: every staff member changes own password. ADMIN-only UI to create
   staff, set role, reset password, deactivate. CLI stays.
8. No SMS, strictly. Email is the only automated outbound channel (OTP, status
   updates, any notification). No code may send anything to contact_phone.
   Record this in CLAUDE.md §6 as business rule 10.
9. Complaint forms follow BORANG ADUAN/ MAKLUMAT (SPRM Tatacara Pengurusan
   Aduan 2022, Lampiran 2), on both the portal and staff registration:
   - every field on that form is stored, all optional, including IC/passport
     number (supersedes "no IC column"); identity fields are Integrity Unit
     only and never reach a public or complainant response (rule 9)
   - anonymous complaints store none of the identifying fields (422, plus a
     check constraint)
   - "Cara aduan/ maklumat diterima" is its own 14-value `received_via_enum`,
     alongside — not replacing or mapped to — `source_channel` and `jmm_source`
   - portal: the complaint date is the submission day (server-set); what the
     complainant gives is the incident date/time. Portal sets `received_via`
     to SISTEM_ADUAN_INTEGRITI. No document upload — only ADA/TIADA
   - the duplicate check matches both accused names/agencies against both
     accused slots of existing cases

### How the schema implements them

Choices made while writing migrations 004–009 that the decisions above don't spell out:

| Decision | Implementation detail |
|---|---|
| 1 | Also adds `complaints.status_changed_at`, for SLA/ageing reports. Migration order is meetings (004) before status (005) so the backfill can yield `MENUNGGU_JMM` for a pre-decision complaint on an open agenda. `SELESAI` rows from the backfill are a one-time text-match guess. |
| 2 | "One open meeting" is enforced by triggers (a cross-table rule can't be a UNIQUE index), including when a closed meeting is reopened. `jmm_decisions.meeting_id` is `ON DELETE RESTRICT`, because `SET NULL` would rewrite a signed decision (rule 8). |
| 3 | Disclaimer acknowledgement is stored per complaint as `complaints.disclaimer_acknowledged_at` (NULL for staff-registered rows). `contact_email` gets a loose shape check; lookups are by `lower(contact_email)`, non-unique. |
| 4 | `complainant_otp_codes` and `complainant_sessions` store emails lower-cased (check constraint). Session ids are SHA-256 of the token, as for staff. |
| 6 | Adds `requested_by_email` (who asked). A check ties `status = DITERIMA` to `reviewed_at IS NULL`; `reviewed_by` isn't required because deleting a staff row nulls it. |
| 7 | No schema change — `staff_users` already has everything needed. |

### How the API implements them

Decisions 1 and 2 (BE). Where the decisions left a gap, the stricter reading was chosen:

| Topic | Behaviour |
|---|---|
| Transitions | The table in §4. `statusReliable` is gone from BE, FE types, and `StatusPill` — status is no longer guessed. |
| Removing an agenda item | Allowed only on an open meeting and only while no decision is recorded against that meeting for that complaint. A Menunggu JMM complaint reverts to what its last *recorded* decision (by insertion order, not `decision_date`) made it, or Baru. |
| Recording a decision while queued | Must name the open meeting the complaint is on (`meetingId`); otherwise 409. `meetingId` may name a closed meeting whose agenda had the complaint — forms are often signed after the sitting. |
| Closing a meeting | `POST /api/admin/jmm/meetings/:id/close`. Refused while any item has no decision recorded against it. Deferred items are removed first, then tabled at a later meeting. Closed meetings are read-only: no detail edits, agenda changes, or reopening through the API. |
| Linking a decision | `PUT /api/admin/decisions/:id/meeting` (`null` unlinks). The complaint must be on that meeting's agenda; refused once the decision is fully signed (rule 8). |
| Agenda order | `agendaOrder` inserts at a position; removal renumbers 1..n; `PUT …/items/order` must list exactly the current items. |
| Stats period | A complaint's month is `received_date_ui`, else `complaint_date`, else its registration day in Asia/Kuala_Lumpur. `report_month` is free text and isn't used. Every enum bucket is zero-filled; `null` = not recorded. |
| Concurrency | Lock order is meeting row, then complaint row. The migration 004 trigger stays as a backstop and maps to 409. |
| Period filter | `GET /api/admin/complaints?from=&to=` bounds the same period date the stats use, so a month's count and its list agree. |

Decisions 3, 4, 6 and 8 (BE):

| Topic | Behaviour |
|---|---|
| Portal submission | Accepts only `caseDescription`, `accusedParticulars`, `accusedDepartment`, `integrityCategory`, `complaintDate` and the complainant block; the server files it as channel `SAI`, received today (Asia/Kuala_Lumpur) with that report month/year, and drops any other key — the unit's own fields are never chosen by the public. Complainant block required. Named needs `particulars`; anonymous needs `contactEmail` and refuses `particulars` (422, not silently dropped). Email stored trimmed and lower-cased; phone checked for shape only. An acknowledgement with the reference number goes to `contactEmail` when present; a failure to send is logged and doesn't fail the submission. Staff registration accepts the same contact fields, without the disclaimer. |
| Who can get a login code | Only an address that is the contact email of at least one complaint it may see (rule 2). Every request answers 202 with the same message — known, unknown, NFA-only, or throttled — and costs the same scrypt. The email is sent without awaiting it, so transport latency doesn't reveal which. |
| Codes | 6 digits from `crypto.randomInt`, 10-minute expiry, scrypt-hashed. Only the newest code for an address is accepted, so a new code supersedes older ones. 5 wrong guesses exhaust it. Throttle: 60 s between codes, 5 per hour per address (`OTP_COOLDOWN_SECONDS`, `OTP_MAX_PER_HOUR`). Wrong, expired, used, and exhausted all return the same 401. |
| Complainant session | `complainant_sessions`, SHA-256 of the token, cookie `aduan_csid` (same flags as staff). 2 h absolute, 30 min idle (`COMPLAINANT_SESSION_TTL_MINUTES`, `COMPLAINANT_SESSION_IDLE_MINUTES`). Rotated on sign-in. A complainant cookie opens no staff route and vice versa. |
| My complaints | Complaints whose complainant row carries the session's email, disclosable only, in `toPublicComplaint` shape, addressed by reference number. Someone else's, NFA, and unknown all return the same 404. |
| Protection requests | A complainant files for their own disclosable complaint; one `DITERIMA` request per complaint at a time (409). They can list their own, without review notes; a complaint that turns NFA drops its requests from that list. Listing and review are **KUI only** (ADMIN and other Integrity Unit roles get 403). Review is `DITERIMA` → `DILULUSKAN`/`DITOLAK` once (409 after). The complainant is not emailed about the outcome. |

Decisions 5 and 7 (BE):

| Topic | Behaviour |
|---|---|
| Referring | `GET /api/admin/case-actions/assignees` lists KJ/SUB_UNIT accounts (`id, fullName, role, isActive` — no email) for the picker, since `/api/admin/staff` is ADMIN only. `PUT /api/admin/case-actions/:id/assignee` `{ staffId \| null }`, Integrity Unit only. Assignee must be an active KJ/SUB_UNIT (422). Refused (409) on an NFA or ever-NFA complaint. A case decided NFA *after* referral keeps the row but disappears from the assignee's view. |
| KJ / SUB_UNIT view | `GET /api/referrals/actions`: own actions on disclosable complaints; fields `id, complaintRefNo, actionTaken, actionDate, fileRefNo, responseReceivedDate, feedbackStatus`. The action `id` is included because updates need a handle. |
| KJ / SUB_UNIT write | `PATCH /api/referrals/actions/:id`: strict body, those two fields only (422 for anything else, or neither). Not theirs, NFA, and missing all return the same 404. |
| Staff management | `/api/admin/staff`, **ADMIN only**: list, create (password policy as CLI), set role, reset password, deactivate, activate. A role change applies on the next request (role is re-read per request). Reset and deactivate delete the account's sessions; deactivated accounts are also refused per request. Resetting your own password keeps your current session. |
| Last ADMIN | Demoting or deactivating the last active ADMIN is refused (409), under row locks. |
| Seed | `npm run db:seed`: local only, empty database only. Built through the query functions, so its data obeys every rule above. See `BE/README.md`. |

### How the UI implements them

Choices made in `FE` that the decisions don't spell out. None of them is the enforcement — BE refuses regardless — but each is shaped so the UI can't undo a rule by what it shows.

| Topic | Behaviour |
|---|---|
| Duplicate check (rule 5) | Staff: a 409 shows the candidate cases and the officer must tick a confirmation; editing any field clears it. Portal: BE returns only a count, and the complainant confirms the complaint is new. |
| NFA on the portal (rule 2) | `/track` and `/me/complaints/[ref]` render one message for unknown, NFA, malformed and (for complainants) someone else's reference number. Portal copy (FAQ, status meanings) never explains a "not found" beyond a typo, and no status text mentions NFA. |
| Complainant URLs | `/me/complaints/UI.2026.00012` — the reference number with `/` as `.` (`lib/ref-slug.ts`; `.` is outside BE's reference charset, so the mapping is exact). The URL is a handle, not access: BE answers only the session's own disclosable complaints. |
| Complainant sign-in | `RequireComplainant` shows the OTP form in place on `/me`, a complaint page and `/submit/protection`, and again if the session expires. It repeats BE's single messages; "request a new code" waits 60 s to match the throttle. |
| Portal email | `/submit` requires an email for named complaints too; BE requires it only for anonymous ones (rule 6). Phone is labelled for staff to call by hand (rule 10). |
| Signing (rule 8) | A slot is signed with a date-time read as Malaysia time; the card shows quorum as BE computes it, and once finalized shows "Muktamad · dikunci" with no sign buttons. |
| Referral | The picker offers only active KJ / SUB_UNIT accounts; on an NFA or ever-NFA case it's replaced by a notice (clearing an existing referral stays possible). KJ / SUB_UNIT pages have no link to the case file. |
| Role gate | `lib/access.ts`, deny by default: a console path with no rule is "Tiada akses" for every role, so KJ / SUB_UNIT land there on any Integrity Unit page (and BE answers their `/api/admin/*` calls with 403). |
| Password change | `lib/api.ts` treats a 401 from `POST /api/auth/password` as "wrong current password", not an expired session, so it doesn't sign the user out, and the form shows BE's message. |
| Error wording | Every form goes through `errorMessage()` (`lib/errors.ts`): `NetworkError` (API not running, offline, or CORS-blocked) says the server can't be reached — in development also naming `npm run dev` and `CORS_ORIGIN`; 403 from the origin check says so; 5xx/429 get their own text; other 4xx show BE's Malay message. No form falls back to a bare "cuba sebentar lagi" that hides the cause. |
| Not built | KUI review screen for protection requests (`/protection-requests`). |
