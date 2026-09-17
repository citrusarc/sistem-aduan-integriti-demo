# FE — Sistem Aduan Integriti

Next.js 16 frontend (Tailwind v4, Base UI primitives in the shadcn style). The
API it talks to lives in [`../BE`](../BE).

Read [`../CLAUDE.md`](../CLAUDE.md) first — §5 has the route layout, §6 the
business rules, §7 the palette. Full install steps: [`../RUN-LOCALLY.md`](../RUN-LOCALLY.md).

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

`NEXT_PUBLIC_API_URL` points at the BE API (`http://localhost:4000/api` by
default). Start the backend first, or every page shows "Tidak dapat menghubungi
pelayan".

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm run format` | Prettier |

## Pages

| Path | Who | What |
| --- | --- | --- |
| `/` | Public | Landing: how complaints are handled, links to submit and track |
| `/faq` | Public | Questions and answers. Deliberately never explains a "not found" beyond a typo (rule 2) |
| `/submit` | Public | Complaint form: named or anonymous, email required (browser-side — BE only requires it for anonymous), phone labelled staff-call-only, disclaimer, possible-duplicate confirmation (BE returns only a count). Shows the reference number |
| `/track` | Public | Look up by reference number. NFA, unknown and malformed numbers render the same message |
| `/me` | Complainant | Email OTP sign-in, then their own complaints with each one's latest protection request status |
| `/me/complaints/[ref]` | Complainant | One complaint in the public-safe shape, and its protection requests. `[ref]` is the reference number with `/` written as `.` (`UI.2026.00012`, see `lib/ref-slug.ts`); someone else's, NFA and unknown all show one "not found" |
| `/submit/protection` | Complainant | Pick one of their own complaints (those with a pending request are left out; `?aduan=` preselects only their own) and give a reason |
| `/login`, `/tiada-akses` | Staff | Sign in; where a wrong-role user lands |
| `/dashboard` | Integrity Unit | Counts by stored status, recent cases |
| `/complaints` | Integrity Unit | Register with status, category, sector, channel and period filters in the URL, paged |
| `/complaints/new` | Integrity Unit | Registration. A 409 shows the candidate cases; the officer must tick a confirmation, and any edit clears it |
| `/complaints/[id]` | Integrity Unit | Case file: details, decisions with signature block and quorum, signing, case actions, referral to KJ / SUB_UNIT (not on NFA cases), close case |
| `/jmm` | Integrity Unit | Meetings, create meeting |
| `/jmm/[meetingId]` | Integrity Unit | Agenda: add, reorder, remove; record decisions; mark the meeting done. Read-only once done |
| `/jmm/decisions` | Integrity Unit | Decision log filtered by outcome, meeting and date range |
| `/reports` | Integrity Unit | Breakdowns by status, category, sector, channel and month, for a year / month |
| `/protection-requests` | KUI | **Placeholder** — review through the API for now |
| `/kj/inbox`, `/subunit/tasks` | KJ, SUB_UNIT | Actions referred to them; edit response date and feedback status only |
| `/settings` | Every staff role | Own account and password |
| `/settings/staff` | ADMIN | Create, set role, reset password, deactivate / activate |

Page bodies are client components in `components/admin/*` and
`components/portal/*`; `app/**/page.tsx` files only set metadata, read route
params and add a `<Suspense>` boundary where the body reads search params.

## Calling the API

All calls happen in the browser with `credentials: "include"` — the session
cookies are scoped to BE's `/api` path, so Next's server never has them. Use the
typed clients in `lib/api.ts` rather than raw paths:

```tsx
import { adminApi, publicApi, referralsApi, complainantApi } from "@/lib/api"

const aduan = await publicApi.trackComplaint("UI/2026/00001")
const senarai = await adminApi.complaints.list({ status: "DALAM_TINDAKAN" })
```

Errors throw `ApiRequestError` with `status` and the parsed `body`
(`duplicateCandidatesOf(err)` reads a 409's candidates). Request and filter
types are in `types/requests.ts`; response shapes in `types/entities.ts`.

## Layouts, sessions and access

- `app/(portal)` — public chrome and the **complainant** session (`aduan_csid`,
  `useComplainantSession()`). Complainant pages wrap their body in
  `RequireComplainant` (`components/portal/complainant-login.tsx`), which shows
  the OTP sign-in in place when there's no session — including when one expires
  mid-visit. It repeats BE's single messages for "code sent" and "bad code"
  rather than guessing a reason, so it never reveals who has filed a complaint.
- `app/(admin)` — the **staff** session (`useStaffSession()`). `/login` and
  `/tiada-akses` are not gated; everything in `(admin)/(console)` is, by
  `components/admin/admin-shell.tsx`.
- `lib/access.ts` maps console paths to roles and builds each role's nav. It is
  deny-by-default: **add a rule when you add a console page.**

These checks only decide what to show; BE enforces access on every request.

## Shared UI

| Need | Use |
| --- | --- |
| Labelled field + error | `FormField` (`components/ui/field.tsx`), `CheckboxField` |
| Text inputs | `Input`, `Textarea`, `Checkbox` (`components/ui/input.tsx`) |
| Enum dropdown | `IntegrityCategorySelect`, `JmmOutcomeSelect`, … one per enum, Malay labels (`components/ui/enum-select.tsx`) |
| Table | `Table`, `TableHeader`, `TableRow`, … (`components/ui/table.tsx`) |
| Paging | `Pagination` + `pageQuery()` / `splitPage()` — BE lists have no total, so fetch one extra row |
| Dates | `DateDisplay` (`kind="date" \| "datetime" \| "month"`), or `formatDate` in `lib/format.ts` |
| Loading / empty / error | `LoadingState`, `EmptyState`, `ErrorState` (`components/ui/states.tsx`) |
| Page title | `PageHeader` |
| Loading data | `useApiData(key, fetcher)` (`hooks/use-api-data.ts`) — refetches when `key` changes; `reload()` keeps data on screen; `setData()` takes a write's response |
| Card block / label–value pairs / inline message | `Section`, `DetailList`, `Notice` (`components/ui/section.tsx`) |
| Modal form / irreversible action | `Dialog`, `ConfirmDialog` (`components/ui/dialog.tsx`) — `ConfirmDialog` shows a thrown error in place |
| Non-status label | `Badge` — complaint statuses still go through `StatusPill` |
| Count charts | `HorizontalBarChart`, `ColumnChart` (`components/ui/bar-chart.tsx`) — one hue, hover/focus tooltip, table view |
| Filters in the URL | `useSearchParamsUpdater()` (`hooks/use-search-params-updater.ts`) sets/clears params and resets `?halaman=`; wrap the client component in `<Suspense>` |
| Error text | `errorMessage(err)` / `describeError(err)` (`lib/errors.ts`) — never `err.message` directly. Throw `UserFacingError` for a message of your own inside a `ConfirmDialog` |
| Scroll to something that just appeared | `ref={scrollIntoViewOnMount}` (`lib/dom.ts`); remount with a `key` to scroll again |
| "← Back" link | `BackLink` (`components/ui/back-link.tsx`) |

## Enums and labels

`types/enums.ts` mirrors `BE/src/types/enums.ts`, which mirrors every Postgres
ENUM in `BE/db/schema.sql`. Three copies, one truth — change all three in the
same PR. This copy is the one that carries the Malay display labels; use
`labelFor(MAP, value)` to render defensively.

## Status badges

Render every status through `components/ui/status-pill.tsx`, never as a bare
string. Status is stored and written by the API on each transition, so the pill
simply shows it. See CLAUDE.md §4.

Palette tokens live in `app/globals.css` for both light and dark. The status
colours are deliberately not red/green: NFA is a legitimate closure, not a
failure.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```
