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
| Accounts & auth | **One** account table (`staff_users`, complainants are role `PENGADU`), one sign-in page, one cookie `aduan_sid`: email + password (scrypt) + captcha + emailed code. Gates are **permissions** per role. Anonymous submission needs no account | Confirmed — §8 decision 15; see "Staff auth" below (it now applies to every account) |
| Hosting/infra | Not yet decided — runs locally, see `RUN-LOCALLY.md` | Open |

Do not assume an ORM (Prisma, Drizzle, etc.) will be introduced later without an explicit decision — the schema and all queries in this project are plain SQL by design.

### Staff auth

Applies to **every** account since §8 decision 15 — staff and registered complainants (`PENGADU`) sign in the same way. The name stays for history. Implemented in `BE/src/auth/*` and `BE/src/middleware/auth.ts`; schema in `BE/db/migrations/003_staff_auth.sql` and `017_unified_accounts.sql`.

- **Passwords**: scrypt via `node:crypto` (N=2¹⁵, r=8), self-describing hash format so parameters can be raised later. Minimum 12 characters with upper case, lower case, a digit and a special character, for every password including temporary and first-ADMIN ones; a new password must differ from the current one (§8 decision 14). `password_hash` is read only by `src/auth/store.ts` — `StaffUserRow` omits it on purpose.
- **Sessions**: rows in `staff_sessions`, keyed by the SHA-256 of a random token; only the cookie holds the raw token. 8 h absolute cap, 30 min idle timeout. Every request re-checks `staff_users.is_active`, so deactivation is immediate.
- **Cookie**: `aduan_sid`, `HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` in production. FE must call with `credentials: "include"` (done in `FE/lib/api.ts`).
- **CSRF**: `SameSite=Lax` plus `requireTrustedOrigin`, which refuses any non-GET whose `Origin` isn't in `CORS_ORIGIN`.
- **Sign-in steps** (§8 decision 14): email + password → slider image captcha (`src/auth/captcha.ts`, PNGs drawn with node:zlib, answer kept server-side, pass token single-use, spent before the password is checked) → 6-digit code emailed to the staff address (MFA; scrypt-hashed, 10 min, 5 tries) → session. If the password is older than `security_settings.password_max_age_days` (default 180, ADMIN sets it at Tetapan › Pengurusan staf) or was set by ADMIN (`must_change_password`), the code step returns a change token instead, and only a compliant new password opens the session.
- **Brute force**: 5 wrong passwords **block** the account (`locked_until = infinity`) until ADMIN unlocks it (`POST /api/admin/staff/:id/unlock`) or the owner resets it through **Lupa kata laluan**. The block is only revealed after a correct password. Anyone who knows a staff email can trigger a block; the captcha and the self-service reset are the counterweights.
- **Lupa kata laluan**: email + captcha → code emailed (unknown emails get an identical answer and a token no code can satisfy) → new password. A reset lifts the block and signs out every session.
- **Enumeration**: one error message for every login failure, and unknown emails are verified against a dummy hash (warmed at startup) so timing matches a wrong password.
- **Revocation**: logout deletes the session row; a password change or reset signs out every other session.
- **Registration** (§8 decision 15): `/daftar` → name + email + password (same policy) + captcha → `POST /api/auth/register` creates an **unverified PENGADU** row (`email_verified_at` NULL; every other insert path defaults it to now()) and emails a code → `POST /api/auth/register/verify` verifies it and signs in. Login refuses an unverified account (403, said only after a correct password). An address that already has a verified account gets the same 202 and a token no code satisfies; the owner is emailed a notice instead, and nothing about the account changes. Re-registering an unverified address replaces its name and password. Unverified sign-ups older than a day are deleted.
- **First ADMIN** (§8 decision 15, supersedes decision 13's setup page): `INITIAL_ADMIN_EMAIL` in `BE/.env` (`badrul@badrulhanif.com`). Whenever that address proves itself with an emailed code (registration or login MFA) **while no active ADMIN exists**, `promoteInitialAdmin()` makes it ADMIN, under an advisory lock. Afterwards ADMIN assigns every role. Unset → the CLI is the only way. `/api/auth/setup` is gone.
- **Accounts** (§8 decision 7): ADMIN-only endpoints under `/api/admin/staff`, and `npm run staff -- create|set-role|set-password|deactivate|activate|list` in `BE/`. Both call the same functions in `src/auth/store.ts`. Neither will leave the system without an active ADMIN (409). The CLI reads passwords from a hidden prompt or stdin, never argv. Everyone changes their own password at `POST /api/auth/password`.

Endpoints: `GET /api/auth/captcha`, `POST /api/auth/captcha/verify`, `POST /api/auth/register`, `POST /api/auth/register/verify`, `POST /api/auth/login`, `POST /api/auth/login/verify`, `POST /api/auth/password/expired`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/logout`, `GET /api/auth/me` (adds `permissions`, `isIntegrityUnit`, `hasConsole`), `POST /api/auth/password`; ADMIN: `GET/PUT /api/admin/settings/security`.

### Roles, permissions and the Integrity Unit gate

`staff_role_enum` = `KUI | PI | PSU | KPSU | SETIAUSAHA | ADMIN | KJ | SUB_UNIT | PENGADU`. `KJ` (Ketua Jabatan) and `SUB_UNIT` were added by `002_add_kj_subunit_roles.sql` to match the sitemap's `kj/inbox` and `subunit/tasks` screens; `PENGADU` (a registered complainant) by `016` — §8 decision 15.

**Routers are gated on a permission, never a role name** (`requirePermission()` in `BE/src/middleware/auth.ts`). The role → permission matrix is fixed in code, `BE/src/auth/permissions.ts`, and deliberately not ADMIN-editable: `complaints.manage`, `jmm.manage` and `reports.view` reach NFA cases and internal notes, and are granted to `INTEGRITY_UNIT_ROLES` as a whole (`BE/src/auth/roles.ts`). `protection.review` = KUI, `referrals.respond` = KJ/SUB_UNIT, `users.manage` + `security.manage` = ADMIN, `portal.use` = everyone. ADMIN manages people by giving them a role. `requireSignedIn()` (no permission) is only for `/api/auth/me` and own-password change — never a data route, because a PENGADU is signed in too.

**KJ, SUB_UNIT and PENGADU are outside the Integrity Unit.** They sign in, and are refused (403) by every `/api/admin/*` router. Letting them through would break rules 2 and 9. Adding a role to the enum grants it only `portal.use`, deliberately. A JMM signatory linked to an account must not be a PENGADU (422).

**KJ / SUB_UNIT's API is `/api/referrals`** (§8 decision 5), gated on `referrals.respond` — a separate tree, not a loosened admin gate; Integrity Unit roles get 403 there. It returns only `toReferredAction()`: the five allowed action fields, the complaint reference number, and the action id, for the caller's own actions on disclosable complaints. The query itself selects nothing else. The only write is `responseReceivedDate` / `feedbackStatus`; any other key is refused. Referring an action (`PUT /api/admin/case-actions/:id/assignee`) is Integrity Unit only, accepts only active KJ/SUB_UNIT accounts, and is refused on NFA complaints.

---

## 2. Database Entities (`BE/db/schema.sql` + `BE/db/migrations/*` are the source of truth)

| Table | Key fields | Purpose |
|---|---|---|
| `complainants` | `id`, `particulars` (text = NAMA), `grade_level` (enum), `contact_email`, `contact_phone`, `is_anonymous`; Lampiran 2 (migration 010): `complainant_category`, `ic_no`, `passport_no`, `age`, `gender`, `race`, `nationality` (enum since 013: `WARGANEGARA`/`BUKAN_WARGANEGARA`), `contact_phone_2`, `postal_address`, `occupation`, `employer` | Masterlist complainant record, a return channel (006), and the BORANG ADUAN/ MAKLUMAT identity fields (§8 decision 9) — **all optional, internal only**. Anonymous rows carry **no details at all** (§8 decision 11): no name (`chk_anonymous_no_name`, 011), grade, category, email or phones (`chk_anonymous_no_details`, 012, NOT VALID — older anonymous rows may still hold an email), and none of IC/passport/age/gender/race/nationality/address/occupation/employer (`chk_anonymous_identity`, 010) |
| `complaints` | `id`, `complaint_ref_no` (unique), `complainant_id` (FK), `source_channel`, `directed_to`, `accused_particulars`/`accused_grade_level`/`accused_department`, `info_classification`, `integrity_category`, `sector`, `case_description`, `complaint_date`, `received_date_ui`, `status` (enum), `status_changed_at`, `disclaimer_acknowledged_at`; Lampiran 2 (010): `accused_position`, `accused2_particulars`/`accused2_department`/`accused2_position`, `incident_date`, `incident_time`, `has_supporting_documents`, `received_via` (enum, 14 values); duplicates (018): `suspected_duplicate_of_complaint_id` + `duplicate_score` + `duplicate_reasons` (set at registration, cleared by staff), `duplicate_of_complaint_id` (required while `PENDUA`, `chk_pendua_has_original`) | Core case record, one row per complaint |
| `jmm_decisions` | `id`, `complaint_id` (FK), `decision_date`, `agency_file_no`, `summary`, `jmm_source`, `jmm_classification`, `outcome` (enum, 6 values — see §3), `remarks_further_action`, `meeting_id` (FK, nullable) | The formal JMM decision form, one-to-many per complaint (a case can be re-tabled) |
| `jmm_meetings` | `id`, `meeting_no` (unique), `meeting_date`, `venue`, `status` (`DIJADUALKAN`/`SELESAI`) | A JMM sitting (migration 004) |
| `jmm_meeting_items` | `id`, `meeting_id` (FK), `complaint_id` (FK), `agenda_order` | Agenda. Unique per (meeting, complaint); a trigger keeps each complaint on at most one `DIJADUALKAN` meeting |
| `jmm_decision_signatories` | `id`, `jmm_decision_id` (FK), `staff_id` (FK, nullable), `role_category` (`PENGERUSI`/`AHLI`/`URUS_SETIA`), `role_title`, `signed_at` | Signature block for a decision — variable number of signatories |
| `case_actions` | `id`, `complaint_id` (FK), `jmm_decision_id` (FK, nullable), `psu_action_notes`, `action_taken` (enum, 6 values, **distinct vocabulary from `jmm_decisions.outcome`**), `action_date`, `response_received_date`, `feedback_status`, `ui_remarks`, `file_ref_no`, `assigned_to_staff_id` (FK, nullable) | Post-decision tracking; a complaint can accumulate more than one action over time |
| `staff_users` | `id`, `full_name`, `role` (`KUI`/`PI`/`PSU`/`KPSU`/`SETIAUSAHA`/`ADMIN`/`KJ`/`SUB_UNIT`/`PENGADU`), `email`, `is_active`, `password_hash`, lockout columns, `email_verified_at` (017) | **Every account** — staff and registered complainants (§8 decision 15); the name predates that. Supports the FKs above |
| `staff_sessions` | `id` (SHA-256 of token), `staff_id` (FK), `expires_at`, `last_seen_at` | Server-side login sessions (migration 003) |
| `complaint_status_history` | `id`, `complaint_id` (FK, RESTRICT), `from_status`, `to_status`, `changed_at` | One row per status a complaint entered (migration 014, §8 decision 13); the public timeline |
| `complaint_attachments` | `id`, `complaint_id` (FK, RESTRICT), `storage_key` (random UUID, file name on disk), `original_name`, `mime_type` (PDF/JPEG/PNG/DOCX), `size_bytes`, `sha256`, `uploaded_by_staff_id` (FK, NULL = portal), `created_at` | Supporting documents (migration 011, §8 decision 10). Files live in `UPLOAD_DIR` on the BE machine; Integrity Unit only |
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
| `011_anonymous_email_optional_attachments.sql` | Replaces `chk_anonymous_contact` with `chk_anonymous_no_name`; adds `complaint_attachments` (§8 decision 10) |
| `013_nationality_two_options.sql` | `nationality_enum` (`WARGANEGARA`, `BUKAN_WARGANEGARA`); `complainants.nationality` converted from free text (§8 decision 12) |
| `012_anonymous_no_details.sql` | `chk_anonymous_no_details` (NOT VALID): anonymous rows hold no grade, category, email or phones (§8 decision 11) |
| `014_status_history_complainant_accounts.sql` | `complaint_status_history` (backfilled: BARU at registration + current status), `complainant_accounts` (§8 decision 13) |
| `015_staff_password_security.sql` | `staff_users.must_change_password`, `security_settings` (single row, expiry days), `staff_captcha_challenges`, `staff_auth_challenges` (MFA / change / reset) (§8 decision 14) |
| `016_pengadu_role_pendua_status.sql` | `PENGADU` on `staff_role_enum`, `PENDUA` on `complaint_status_enum` — own file, like 002 (§8 decisions 15–16) |
| `017_unified_accounts.sql` | `staff_users.email_verified_at` (default now(); self-registration inserts NULL); verified `complainant_accounts` moved in as PENGADU with no password (they set one via Lupa kata laluan); **drops** `complainant_otp_codes`, `complainant_sessions`, `complainant_accounts`; `REGISTER` challenge purpose (§8 decision 15) |
| `018_duplicate_flags.sql` | Duplicate suspicion and `duplicate_of_complaint_id` on `complaints`, `chk_pendua_has_original` (§8 decision 16) |

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

Five UI-facing states (matches the badge convention already agreed): **Baru → Menunggu JMM → Dalam Tindakan → Selesai / NFA**, plus **Pendua** (§8 decision 16), which a Baru complaint enters only when staff confirm it repeats another case.

`complaints.status` is **stored** (migration 005) and written by the API on every transition — §8 decisions 1–2. Nothing derives or guesses status at read time; read the column. The transition table is `BE/src/db/complaintStatus.ts`, and `applyStatusEvent()` in `BE/src/db/queries/complaints.ts` is the **only** writer of the column. It runs inside the transaction that locks the complaint row.

| Event | Endpoint | Allowed from | → |
|---|---|---|---|
| Registered | `POST /api/complaints`, `POST /api/admin/complaints` | — | Baru |
| Added to agenda | `POST /api/admin/jmm/meetings/:id/items` | Baru, Dalam Tindakan, NFA | Menunggu JMM |
| Removed from agenda | `DELETE /api/admin/jmm/meetings/:id/items/:complaintId` | Menunggu JMM | Baru, or what the last recorded decision made it (NFA / Dalam Tindakan) |
| Decision recorded | `POST /api/admin/complaints/:id/decisions` | Baru, Menunggu JMM, Dalam Tindakan, NFA | NFA if outcome = NFA, else Dalam Tindakan |
| Case closed | `POST /api/admin/complaints/:id/close` | Dalam Tindakan | Selesai |
| Duplicate confirmed | `POST /api/admin/complaints/:id/duplicate` `{ duplicateOfId }` | Baru | Pendua |
| Duplicate undone | `DELETE /api/admin/complaints/:id/duplicate` | Pendua | Baru |

Everything else is refused with 409 and leaves the status unchanged. In particular:
- **Selesai is terminal.** Nothing re-tables, decides, or reopens a closed case.
- **NFA cannot be "closed".** NFA is already a closure, just not a Selesai one; it can be re-tabled.
- **Menunggu JMM always means "on an open meeting's agenda".** Adding it again is refused, and so is closing a meeting while any item has no decision (see §8).
- **Pendua is never tabled or decided**, and never set automatically — only by staff, only from Baru (take it off an agenda first). Its original must exist and not itself be Pendua.
- **No PATCH moves status.** A `status` key on `PATCH /api/admin/complaints/:id` is refused with 400.

Every change is also appended to `complaint_status_history`, in the same transaction, by `applyStatusEvent()` (and the initial BARU by `createComplaint()`) — §8 decision 13. `status_changed_at` moves only when the status actually changes, so a second non-NFA decision doesn't reset a case's age. Rows set by the migration 005 backfill before this API existed — especially `SELESAI` ones, which came from a text match — deserve one staff review.

---

## 5. Repo Structure

Two independently installed and deployed apps. `FE` never talks to Postgres; `BE` never renders UI.

```
FE/                                  # Next.js 16, UI only
  app/
    layout.tsx                       # root: <html lang="ms">, metadata, theme, SessionProvider (the one session)
    not-found.tsx
    (auth)/                          # NOT gated; one set of pages for staff and complainants (§8 decision 15)
      login/  daftar/  lupa-kata-laluan/                 # honour a safe ?next=
    (portal)/                        # public chrome; header reflects the one session
      layout.tsx                     # header/footer, no console nav
      page.tsx  faq/  submit/  track/                    # public
      me/  me/complaints/[id]/  submit/protection/       # any signed-in account; [id] = ref no with "/" as "."
    (admin)/                         # staff console
      layout.tsx
      tiada-akses/page.tsx           # NOT gated; where a user without the permission lands
      (console)/
        layout.tsx                   # AdminShell: the gate (PENGADU -> /me) + permission-aware nav
        dashboard/  reports/
        complaints/  complaints/new/  complaints/[id]/
        jmm/  jmm/[meetingId]/  jmm/decisions/
        protection-requests/         # KUI only — placeholder, review via the API
        kj/inbox/                    # KJ only
        subunit/tasks/               # SUB_UNIT only
        settings/                    # every staff role (own password)
        settings/staff/              # ADMIN only — every account, Kakitangan / Pengadu tabs
    globals.css                      # palette + status tokens (§7)
  components/
    complaints/                      # borang-aduan-fields: Lampiran 2 field groups shared by /submit and complaints/new;
                                     # document-picker: supporting-document picker (portal + case file)
    auth/                            # login-form, register-form, forgot-password, slider-captcha, auth-heading
    admin/                           # admin-shell (gate), no-access
      complaints/                    # register, registration-form, case-file, decision-card, case-actions, case-documents,
                                     # duplicate-panel (§8 decision 16)
      jmm/                           # meeting-list, meeting-detail, decision-form, decision-log
      stats/                         # dashboard, reports, buckets
      referrals/                     # referred-actions (KJ inbox + sub-unit tasks)
      settings/                      # account-settings, staff-management
    portal/                          # header, footer, track-lookup, complaint-submit-form,
                                     # require-signed-in (RequireSignedIn), my-complaints,
                                     # my-complaint-detail, protection-request-form, public-status
    providers/                       # session — the one session (useSession), mounted at the root
    ui/                              # button, input/textarea/checkbox, field, select, enum-select,
                                     # table, pagination, date-display, states, page-header, status-pill, status-timeline,
                                     # dialog (Dialog, ConfirmDialog), section (Section, DetailList, Notice),
                                     # badge, bar-chart (single-series bars/columns + table view), back-link
  hooks/
    use-api-data.ts                  # browser fetch state: key-based refetch, reload(), setData()
    use-search-params-updater.ts     # set/clear URL filter params; resets ?halaman=
  lib/
    api.ts                           # api() + publicApi / complainantApi / adminApi / referralsApi; NetworkError
    errors.ts                        # describeError / errorMessage — the ONLY wording for API failures; UserFacingError
    dom.ts                           # mount-time scroll refs (no requestAnimationFrame timing guesses)
    auth.ts                          # register / login steps / logout / me (CurrentUser + permissions) / change password
    access.ts                        # path -> permission (deny by default), nav per account, destinationFor(?next=)
    format.ts                        # Malay dates; DATE strings never shift a day; MYT datetime inputs
    ref-slug.ts                      # UI/2026/00012 <-> UI.2026.00012 for complainant URLs
  types/
    enums.ts                         # mirrors BE/src/types/enums.ts + labels
    entities.ts                      # API response shapes
    requests.ts                      # request bodies and query filters

BE/                                  # Express 5 + pg, no UI
  db/
    schema.sql                       # canonical — never hand-edit prod without updating
    migrations/                      # 001–003 trgm/roles/staff auth; 004–018 §8 decisions (see §2)
  src/
    app.ts                           # CORS, JSON, router, error handler
    server.ts                        # entry, graceful shutdown
    config.ts                        # loads .env, fails fast on missing DATABASE_URL
    auth/
      password.ts                    # scrypt hash/verify, policy, dummy hash
      store.ts                       # the ONLY reader of password_hash / sessions
      roles.ts                       # INTEGRITY_UNIT_ROLES, REFERRAL_RECIPIENT_ROLES
      permissions.ts                 # role -> permission matrix, fixed in code (§8 decision 15)
    duplicates/
      similarity.ts                  # pure text scoring: stopwords, topic words, Malay stemming, TF-IDF, identifiers
      assess.ts                      # assessDuplicate(): the likely-repeat score + reasons (§8 decision 16)
    notify/
      email.ts                       # notifyByEmail() — the ONLY outbound channel (rule 10)
    attachments/
      files.ts                       # the ONLY code touching upload bytes / UPLOAD_DIR: multer, content typing, EXIF strip
    middleware/
      auth.ts                        # requirePermission(), requireSignedIn(), cookie helpers, Origin check
      rateLimit.ts                   # portal submissions per IP, in memory only
      error-handler.ts               # HttpError, 404, error handler
    scripts/
      staff.ts                       # npm run staff -- create|set-password|...
      db.ts                          # npm run db:migrate | db:reset  (there is no seed / demo data)
    routes/
      index.ts                       # mounts auth + the two trees
      auth.ts                        # /api/auth/register|login|logout|me|password — every account
      complaints.public.ts           # /api/complaints      — public portal
      complaints.admin.ts            # /api/admin/complaints — console
      decisions.admin.ts             # /api/admin/decisions (log, sign, link), /api/admin/case-actions
      meetings.admin.ts              # /api/admin/jmm/meetings — meetings + agenda
      stats.admin.ts                 # /api/admin/stats — dashboard/report counts
      complainant.ts                 # /api/complainant — own complaints + protection requests (portal.use)
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
- **FE auth checks run in the browser, and only decide what to show.** BE sets the session cookie with `Path=/api` on its own origin, so Next's server never sees it and can't gate a page (no `proxy.ts`, no server `redirect()` on session). `SessionProvider` (root) asks `GET /api/auth/me`; `AdminShell` re-checks on every console navigation and routes: no session → `/login?next=`, no console (PENGADU) → `/me`, permission missing per `lib/access.ts` → `/tiada-akses`. A 401 from any signed-in call signs the session out (`UNAUTHORIZED_EVENT` in `lib/api.ts`). BE still refuses the data on every request — never rely on the FE gate.
- **New console page = new rule in `lib/access.ts`**, naming a permission. Paths without a rule are refused for everyone, so a page can't silently appear for KJ, SUB_UNIT or a complainant.
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
2. **NFA confidentiality.** A complaint whose decision is `NFA` is never disclosed outside the Integrity Unit — including after it is re-tabled, and **including to its own complainant**. → One predicate, `PUBLICLY_DISCLOSABLE_SQL` in `queries/complaints.ts` (status ≠ NFA **and** no NFA decision ever recorded), used by public tracking, the public duplicate check, and a signed-in account's own complaints and protection requests. It also hides a **PENDUA complaint whose original is (or ever was) NFA** — "this repeats an existing case" would confirm the NFA case exists (§8 decision 16). Every one of those answers an NFA case **identically to an unknown one** — a distinct message would itself disclose the NFA. The public duplicate check passes `excludeNfa`, or someone could confirm an NFA case exists by submitting a matching complaint.
3. **Six fixed JMM outcomes, no more.** → `jmmOutcomeSchema`, derived from the enum mirror.
4. **Two outcome vocabularies are not interchangeable.** `jmm_decisions.outcome` and `case_actions.action_taken` come from different forms. They overlap on `NFA` only by coincidence — that is not a mapping. → no code path converts between them, by design.
5. **Duplicate check before new registration.** → `findDuplicateCandidates()`, recall-biased, over the same period date as stats (so a complaint with no received date is still a candidate). Both create paths refuse with 409 unless `duplicateCheckAcknowledged` is explicitly true. Staff see the candidates; the public caller gets only a count. After that, the complaint is **always registered**; `assessDuplicate()` only stores a suspicion for staff, who confirm `PENDUA` or dismiss it (§8 decision 16). Nothing is marked a repeat automatically.
6. **Anonymous means anonymous, knowingly.** An anonymous complaint stores **no complainant details at all** — no name, identity field, category, grade, email or phone (§8 decision 11; superseded decision 3's "anonymous requires an email" and decision 10's "email optional"). The form must say what that costs before sending (no SAT, no follow-up, no login, only the reference number shown once). → `publicCreateComplaintSchema` and `createComplaintSchema` (422): anonymous refuses every complainant field; a named portal submission requires `particulars`, so a blank name isn't silently anonymous; `disclaimerAcknowledged` must be literally `true`, and the insert records `complaints.disclaimer_acknowledged_at`. Backstops: `chk_anonymous_no_name` (011), `chk_anonymous_no_details` (012), `chk_anonymous_identity` (010), and `createComplaint` nulls every detail on an anonymous row. Never stuff an email into `particulars`.
7. **`complaint_ref_no` is immutable once issued.** Server-issued as `UI/<year>/<5-digit seq>` inside the insert transaction, under a per-year advisory lock so concurrent registrations get consecutive numbers instead of a 500, absent from every update schema, and a client sending one on PATCH is refused rather than silently ignored.
8. **Signed decisions are append-only.** Once fully signed, the row is locked; corrections are a new decision row. → `isDecisionLocked()`; `signDecisionSlot()` only ever moves a slot from NULL to a timestamp, and only a slot of the decision in the URL, so a signature cannot be withdrawn, overwritten, or recorded through another decision's lock check.
9. **Internal notes never reach the public API.** `ui_remarks`, `psu_action_notes`, `protection_requests.review_notes` / `reviewed_by`, everything from `jmm_decisions`, and supporting documents (`complaint_attachments` and the files) stay internal. → `toPublicComplaint()` and `toComplainantProtectionRequest()` **allow-list** fields rather than deleting them, so a column added later cannot leak by default. `/api/complainant/*` returns only those shapes.
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

Status badges use `--status-*` / `--status-*-foreground` pairs, exposed as Tailwind `bg-status-baru` etc. The colour logic is deliberate and should not be "fixed" into red/green: **NFA is a legitimate closure, not a failure**, Dalam Tindakan reads as active rather than alarming, and Pendua (dusty violet) is a case folded into another, not a rejection.

Render statuses through `FE/components/ui/status-pill.tsx`, never as a bare string.

---

## 8. Decisions

Product decisions made after discovery. Each closes a gap flagged elsewhere in this file. Schema for all of them exists (migrations 004–018, see §2). **API:** all sixteen are implemented in BE (see "How the API implements them" below). **UI:** all sixteen have screens except the KUI review of protection requests (decision 6's `/protection-requests` is a placeholder; complainants can already file and follow requests). See "How the UI implements them" at the end of this section. Recorded as given:

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
   (nullable), is_anonymous. Anonymous requires contact_email [superseded by
   decision 10: now optional] and stores no
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
     to SISTEM_ADUAN_INTEGRITI. ~~No document upload — only ADA/TIADA~~ (superseded
     by decision 10)
   - the duplicate check matches both accused names/agencies against both
     accused slots of existing cases
10. Anonymous email optional + supporting-document upload (2026-09-17),
    checked against Lampiran 2, which makes every BUTIR-BUTIR PENGADU field
    optional and accepts "Surat Layang":
    - anonymous asks for no personal details; the email is optional, with a
      warning of what having none costs. Supersedes decision 3's "anonymous
      requires contact_email" and rewrites rule 6
    - DOKUMEN SOKONGAN: choosing ADA shows an upload; TIADA hides it. Stored
      on the BE's local disk (no cloud), PDF/JPG/PNG/DOCX, size-limited,
      Integrity Unit only, never through public/complainant APIs
    - image metadata (EXIF/GPS) stripped for anonymous complainants
11. Refines decision 10 (2026-09-17):
    - "Tanpa nama" is strictly no butiran pengadu: nothing is asked or stored,
      not even an email or phone. Tracking is by reference number only.
      Applies to the portal and staff registration alike
    - the portal has no ADA/TIADA question: supporting documents are an
      optional upload, and has_supporting_documents is set to true when files
      are attached (NULL otherwise). Staff registration keeps ADA/TIADA,
      since it transcribes the paper form
12. Identity document by nationality (2026-09-17), Lampiran 2, portal
    submission, named complainants only:
    - WARGANEGARA has exactly two options: Warganegara / Bukan warganegara
    - Warganegara: NO. KAD PENGENALAN required; passport optional
    - Bukan warganegara: NO. PASSPORT required; no IC asked (the field is
      hidden and not sent)
    - staff registration shows the same two options and fields, all optional
13. Real local accounts, no demo data (2026-09-17):
    - no seed script and no demo/dummy records; the local database starts
      empty. The first ADMIN is created through a first-run setup page that
      closes once any staff account exists (CLI still works)
    - complainants register with name + email, confirmed by an email OTP;
      a verified account can log in with or without complaints. Codes and
      every other email print in the BE terminal locally (rule 10 unchanged)
    - "Semak Status" shows a status timeline: each status entered and when,
      nothing about who or why (rule 9); NFA complaints stay undisclosed
      (rule 2). Staff see the same history on the case file
14. Staff password and sign-in security (2026-09-17), from the agency
    password policy:
    - (a) 12+ characters, and MFA by a code sent to the staff email
      (printed in the BE terminal locally)
    - (b) every password has upper case, lower case, special character, digit
    - (c) passwords expire after 180 days; the period is ADMIN-configurable;
      an expired password must be replaced before use. Passwords ADMIN sets
      (new accounts, resets) must also be replaced at first login
    - (d) 5 failed attempts block the account
    - (e)(f) passwords and PINs/codes are hidden when typed, with an eye
      button to show them
    - (g) slider image captcha after the password is entered
    - (l) "Lupa kata laluan" on the login page
15. One login/registration for complainants and staff, roles and permissions
    (2026-09-18). Supersedes decision 4 (email-OTP-only complainant login,
    separate cookie) and decision 13's first-run setup page:
    - one account table (staff_users), one sign-in page, one cookie;
      a self-registration is PENGADU until ADMIN gives it a role
    - every account gets decision 14's password features: 12+ chars with
      upper/lower/digit/special, captcha, emailed code at every login,
      5-try block, expiry, ADMIN-set passwords replaced, Lupa kata laluan
    - gates are permissions per role, fixed in code (not an ADMIN-editable
      matrix); ADMIN manages people by assigning roles
    - badrul@badrulhanif.com (INITIAL_ADMIN_EMAIL) becomes the first ADMIN
      by registering and proving the address; that ADMIN manages the rest
    - anonymous submission still needs no account
16. Duplicate complaints and email spam (2026-09-18):
    - every submission is still registered (rule 5 is about not doing it
      silently); a likely repeat is scored and flagged for staff, who
      confirm it as the new status PENDUA or dismiss the flag
    - scoring ignores words that only say what kind of complaint it is
      ("rasuah", "belanja", …) and weighs names, places, amounts and
      identifiers; plain JS + Postgres, no Python, no external service
    - no acknowledgement email for a likely repeat from the same address, a
      daily cap per address, and a per-IP submission limit

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
| Portal submission | Accepts only `caseDescription`, `accusedParticulars`, `accusedDepartment`, `integrityCategory`, `complaintDate` and the complainant block; the server files it as channel `SAI`, received today (Asia/Kuala_Lumpur) with that report month/year, and drops any other key — the unit's own fields are never chosen by the public. Complainant block required. Named needs `particulars`; anonymous refuses every complainant field, including `contactEmail` (422, not silently dropped — decision 11). Named also needs `nationality`, then `icNo` if `WARGANEGARA` or `passportNo` if `BUKAN_WARGANEGARA`; the other document is accepted, never required (decision 12). Email stored trimmed and lower-cased; phone checked for shape only. An acknowledgement with the reference number goes to `contactEmail` when present; a failure to send is logged and doesn't fail the submission. Staff registration accepts the same contact fields, without the disclaimer. |
| ~~Who can get a login code~~ | **Superseded by decision 15** — complainants sign in like staff (§1). Was: an address with a verified `complainant_accounts` row (decision 13), or the contact email of at least one complaint it may see (rule 2). Every request answers 202 with the same message — known, unknown, NFA-only, unverified, or throttled — and costs the same scrypt; locally the API terminal logs why no code was printed. The email is sent without awaiting it, so transport latency doesn't reveal which. |
| ~~Codes~~ | **Superseded by decision 15** (migration 017 dropped the tables). Was: 6 digits from `crypto.randomInt`, 10-minute expiry, scrypt-hashed. Only the newest code for an address is accepted, so a new code supersedes older ones. 5 wrong guesses exhaust it. Throttle: 60 s between codes, 5 per hour per address (`OTP_COOLDOWN_SECONDS`, `OTP_MAX_PER_HOUR`). Wrong, expired, used, and exhausted all return the same 401. |
| ~~Complainant session~~ | **Superseded by decision 15**: one session and cookie (`aduan_sid`) for every account. Was: `complainant_sessions`, SHA-256 of the token, cookie `aduan_csid` (same flags as staff). 2 h absolute, 30 min idle (`COMPLAINANT_SESSION_TTL_MINUTES`, `COMPLAINANT_SESSION_IDLE_MINUTES`). Rotated on sign-in. A complainant cookie opens no staff route and vice versa. |
| My complaints | Any signed-in account (`portal.use`); complaints whose complainant row carries the account's (verified) email, disclosable only, in `toPublicComplaint` shape, addressed by reference number. Someone else's, NFA, and unknown all return the same 404. |
| Protection requests | A complainant files for their own disclosable complaint; one `DITERIMA` request per complaint at a time (409). They can list their own, without review notes; a complaint that turns NFA drops its requests from that list. Listing and review are **KUI only** (ADMIN and other Integrity Unit roles get 403). Review is `DITERIMA` → `DILULUSKAN`/`DITOLAK` once (409 after). The complainant is not emailed about the outcome. |

Decisions 5 and 7 (BE):

| Topic | Behaviour |
|---|---|
| Referring | `GET /api/admin/case-actions/assignees` lists KJ/SUB_UNIT accounts (`id, fullName, role, isActive` — no email) for the picker, since `/api/admin/staff` is ADMIN only. `PUT /api/admin/case-actions/:id/assignee` `{ staffId \| null }`, Integrity Unit only. Assignee must be an active KJ/SUB_UNIT (422). Refused (409) on an NFA or ever-NFA complaint. A case decided NFA *after* referral keeps the row but disappears from the assignee's view. |
| KJ / SUB_UNIT view | `GET /api/referrals/actions`: own actions on disclosable complaints; fields `id, complaintRefNo, actionTaken, actionDate, fileRefNo, responseReceivedDate, feedbackStatus`. The action `id` is included because updates need a handle. |
| KJ / SUB_UNIT write | `PATCH /api/referrals/actions/:id`: strict body, those two fields only (422 for anything else, or neither). Not theirs, NFA, and missing all return the same 404. |
| Staff management | `/api/admin/staff`, **ADMIN only**: list, create (password policy as CLI), set role, reset password, deactivate, activate. A role change applies on the next request (role is re-read per request). Reset and deactivate delete the account's sessions; deactivated accounts are also refused per request. Resetting your own password keeps your current session. |
| Last ADMIN | Demoting or deactivating the last active ADMIN is refused (409), under row locks. |

Decision 14 (BE): see §1 "Staff auth" for the sign-in steps, blocking and reset. Test helper `ctx.staffLogin()` walks the whole flow (it reads the captcha answer and the emailed code); `src/test/passwordSecurity.test.ts` covers each point.

Decisions 15 and 16 (BE):

| Topic | Behaviour |
|---|---|
| Registration & first ADMIN | See §1 "Staff auth" (Registration, First ADMIN). `startSession()` calls `promoteInitialAdmin()` after every emailed-code step, so a sign-in promotes as well as a registration. |
| Permissions | `BE/src/auth/permissions.ts`; every router `requirePermission(...)`. `/api/complainant/*` needs `portal.use`, which every role has: a staff member sees their own complaints as a complainant would (public shape), and anyone else's answers 404. A PENGADU gets 403 from every `/api/admin/*` and `/api/referrals`. |
| Scoring | `assessDuplicate()` (after the rule 5 check, both create paths). Pool: up to 50 non-PENDUA complaints from the last 365 days sharing the email, an accused name/agency, or a loose trigram match. Score = 0.40 text (TF-IDF cosine over `contentTokens()`: stopwords and `TOPIC_WORDS` dropped, conservative Malay stemming, proper nouns unstemmed, IDF over the last 1000 descriptions) + 0.25 accused name (≥ 0.75 bigram match) + 0.10 agency + 0.15 shared identifiers (amounts, plates, file numbers) + 0.10 same email; or text ≥ 0.85 alone. ≥ 0.5 stores the best match with its Malay reasons. NFA cases are scored too — the result never leaves the Integrity Unit. |
| Acknowledgement email | Held back when the likely repeat came from the same email, or when that address has had `PORTAL_ACK_EMAILS_PER_DAY` (3) acknowledgements in 24 h. The complaint is registered and the response is identical either way; locally the API terminal logs why. |
| Per-IP limit | `PORTAL_SUBMISSIONS_PER_IP_PER_HOUR` (10; 0 = off) successful portal registrations per IP, in memory only (never stored — anonymous complainants). 429 beyond. 409 and 422 attempts don't count. |
| PENDUA | `POST/DELETE /api/admin/complaints/:id/duplicate`, `DELETE …/duplicate-suspicion` (dismiss), `GET /api/admin/complaints?suspectedDuplicate=true`. The case file adds `suspectedDuplicate` (id, ref no, status, score, reasons) and `duplicateOf`. Public tracking shows PENDUA like any status, except rule 2's PENDUA-of-NFA case. |

Decision 13 (BE):

| Topic | Behaviour |
|---|---|
| Registration | `POST /api/complainant/auth/register` `{ fullName, email }` → upserts an unverified `complainant_accounts` row (a verified one is never renamed) and emails a code, 202 with one message. `POST /api/complainant/auth/verify` then marks the account verified and signs in. `/auth/verify` and `/auth/me` return `fullName` (null for complaint-only sign-ins). |
| Timeline | `GET /api/complaints/:refNo` and `GET /api/complainant/complaints/:refNo` add `timeline: [{ status, changedAt }]`, oldest first (`toStatusTimeline` allow-lists the two fields). Lists don't carry it. `GET /api/admin/complaints/:id` carries it too, including NFA. |
| ~~First-run setup~~ | **Superseded by decision 15**: `INITIAL_ADMIN_EMAIL`, see §1. `/api/auth/setup` no longer exists. |

Decision 10 (BE):

| Topic | Behaviour |
|---|---|
| Transport | `POST /api/complaints` and `POST /api/admin/complaints/:id/attachments` take multipart/form-data: the JSON body in `payload`, files in `files`. JSON-only submissions still work. multer in memory: 5 files per request, `UPLOAD_MAX_FILE_MB` (10) each (413 beyond); 20 per complaint (409). |
| Typing | By content (PDF/JPEG/PNG magic bytes; DOCX = ZIP with `word/document.xml`, refused if it contains `vbaProject.bin`). Filename and client MIME are ignored. One bad file refuses the whole request (422). The portal body has no `hasSupportingDocuments`; the route sets it to true when files are attached, NULL otherwise (decision 11). |
| Order | Validate → inspect files → duplicate check → write files (random UUID name, 0600) → insert complaint + attachment rows in one transaction → on failure delete the files. A refused or 409 request writes nothing. |
| Metadata | JPEG APP1/APP3–13/APP15/COM and PNG tEXt/zTXt/iTXt/eXIf/tIME removed **only when the complainant is anonymous**; named complaints keep them as possible evidence. PDF/DOCX author metadata is not stripped — the portal warns anonymous users. |
| Access | `GET /api/admin/complaints/:id` includes `attachments` (no storage key or hash). `GET …/attachments/:attachmentId/download` — Integrity Unit only, `Content-Disposition: attachment`, `nosniff`, `CSP: sandbox`, `no-store`; the attachment must belong to the complaint in the URL. Staff uploads set `has_supporting_documents` = true. |
| Storage | `UPLOAD_DIR` (default `BE/uploads`, git-ignored). Evidence: back it up with the database. Tests use a temp dir. |

### How the UI implements them

Choices made in `FE` that the decisions don't spell out. None of them is the enforcement — BE refuses regardless — but each is shaped so the UI can't undo a rule by what it shows.

| Topic | Behaviour |
|---|---|
| Duplicate check (rule 5) | Staff: a 409 shows the candidate cases and the officer must tick a confirmation; editing any field clears it. Portal: BE returns only a count, and the complainant confirms the complaint is new. |
| NFA on the portal (rule 2) | `/track` and `/me/complaints/[ref]` render one message for unknown, NFA, malformed and (for complainants) someone else's reference number. Portal copy (FAQ, status meanings) never explains a "not found" beyond a typo, and no status text mentions NFA. |
| Complainant URLs | `/me/complaints/UI.2026.00012` — the reference number with `/` as `.` (`lib/ref-slug.ts`; `.` is outside BE's reference charset, so the mapping is exact). The URL is a handle, not access: BE answers only the session's own disclosable complaints. |
| ~~Complainant sign-in~~ | **Superseded by decision 15** — see "Sign-in and registration" below. Was: `RequireComplainant` shows the OTP card in place on `/me`, a complaint page and `/submit/protection`, and again if the session expires, with **Log masuk** and **Daftar** tabs (decision 13). It repeats BE's single messages; "request a new code" waits 60 s to match the throttle. Outside production it says the code is printed in the BE terminal. A signed-in registered complainant gets name and email prefilled on `/submit`. |
| Status timeline | `StatusTimeline` (newest first, status pill + date-time) on `/track`, `/me/complaints/[ref]` and the staff case file. |
| Staff sign-in | `login-form.tsx` steps: credentials (with "Lupa kata laluan?") → `SliderCaptcha` (drag or arrow keys + Enter; a miss resets the piece, a dead challenge loads a new picture) → code → new password if required. `/lupa-kata-laluan` (not gated) does email → captcha → code + new password. Every password and code field is `PasswordInput` (hidden, eye button), and new passwords show `PasswordRequirements`, a live checklist mirroring BE. Staff management shows Disekat / Perlu tukar kata laluan badges, a Buka sekatan action, and the "Dasar kata laluan" expiry setting. |
| ~~First-run setup~~ | **Superseded by decision 15.** Was: `/login` asks `GET /api/auth/setup`; when required it shows **Persediaan awal** (`staff-sign-in.tsx`) instead of the login form, then goes to the ADMIN's home. A 409 (someone finished first) falls back to the login form. |
| Portal email | `/submit` requires an email for named complaints; BE doesn't. Anonymous shows no fields at all — only a warning of what that costs — and a "save this number now" notice after sending (rule 6, decision 11). Staff registration's anonymous mode likewise shows a notice instead of fields. Phone is labelled for staff to call by hand (rule 10). |
| Nationality | `NationalityField` (two radio options) in the shared complainant fields. Choosing Bukan warganegara hides the IC field and drops it from the request; the passport label says "(pilihan)" for citizens. Portal marks and checks the required document (`identityDocumentErrors`), mirroring BE; staff registration can clear the choice and nothing is required. |
| Documents | Portal: an optional "Dokumen sokongan" `DocumentPicker` (drag/drop or pick, client checks mirror BE), no ADA/TIADA question. Case file: "Dokumen sokongan" lists files as download links and lets staff add more. Staff registration keeps ADA/TIADA only and points to the case file. |
| Signing (rule 8) | A slot is signed with a date-time read as Malaysia time; the card shows quorum as BE computes it, and once finalized shows "Muktamad · dikunci" with no sign buttons. |
| Referral | The picker offers only active KJ / SUB_UNIT accounts; on an NFA or ever-NFA case it's replaced by a notice (clearing an existing referral stays possible). KJ / SUB_UNIT pages have no link to the case file. |
| Role gate | `lib/access.ts`, deny by default: a console path with no rule is "Tiada akses" for every role, so KJ / SUB_UNIT land there on any Integrity Unit page (and BE answers their `/api/admin/*` calls with 403). |
| Password change | `lib/api.ts` treats a 401 from `POST /api/auth/password` as "wrong current password", not an expired session, so it doesn't sign the user out, and the form shows BE's message. |
| Error wording | Every form goes through `errorMessage()` (`lib/errors.ts`): `NetworkError` (API not running, offline, or CORS-blocked) says the server can't be reached — in development also naming `npm run dev` and `CORS_ORIGIN`; 403 from the origin check says so; 5xx/429 get their own text; other 4xx show BE's Malay message. No form falls back to a bare "cuba sebentar lagi" that hides the cause. |
| Sign-in and registration | `(auth)` group: `/login`, `/daftar`, `/lupa-kata-laluan`, for everyone (decision 15). `/daftar`: name + email + password with `PasswordRequirements` → `SliderCaptcha` → emailed code → signed in. After sign-in `destinationFor()` honours a safe `?next=` (portal paths, or console paths the permissions allow), else PENGADU → `/me`, staff → their console home. `RequireSignedIn` on `/me` etc. shows Log masuk / Daftar links carrying `?next=`. The portal header shows **Konsol** for accounts with one. |
| Accounts page | `/settings/staff` ("Pengurusan Akaun"): Kakitangan / Pengadu tabs, an "E-mel belum disahkan" badge; promoting a Pengadu is the existing Peranan dialog. |
| Duplicates | Case file: `DuplicatePanel` shows the suspected original, score and reasons, with **Tandakan Pendua** (only from Baru) and **Bukan pendua**; a PENDUA case shows its original and **Batal Pendua**. Register: a "Mungkin pendua" badge and a "Mungkin pendua sahaja" filter (`?pendua=1`). Portal copy says the acknowledgement may not be re-sent for a similar recent complaint, without saying whether that happened. |
| Not built | KUI review screen for protection requests (`/protection-requests`). |
