import type { Metadata } from "next"

import { MyComplaintDetailPage } from "@/components/portal/my-complaint-detail"
import { slugToRef } from "@/lib/ref-slug"

export const metadata: Metadata = {
  title: "Aduan Saya",
  // Reference numbers are the complainant's handle; keep them out of indexes.
  robots: { index: false, follow: false },
}

export default async function MyComplaintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // `UI.2026.00012` -> `UI/2026/00012`; anything else renders the same "not
  // found" as someone else's complaint, after sign-in.
  return <MyComplaintDetailPage refNo={slugToRef(id)} />
}
