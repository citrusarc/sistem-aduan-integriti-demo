# FE — Sistem Aduan Integriti

Next.js 16 + shadcn/ui frontend. The API it talks to lives in [`../BE`](../BE).

Read [`../CLAUDE.md`](../CLAUDE.md) first — §5 has the route layout, §7 the palette.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

`NEXT_PUBLIC_API_URL` points at the BE API (`http://localhost:4000/api` by
default). Start the backend first, or requests will fail.

## Calling the API

`lib/api.ts` wraps `fetch`, unwraps the `{ data }` envelope, and throws on
`{ error }` responses:

```tsx
import { api } from "@/lib/api";
import type { PublicComplaint } from "@/types/entities";

const aduan = await api<PublicComplaint>(`/complaints/${encodeURIComponent(ref)}`);
```

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
