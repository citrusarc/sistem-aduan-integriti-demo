import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { CaseFile } from "@/components/admin/complaints/case-file"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Fail kes" }

export default async function CaseFilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Ids are BIGINT strings; anything else can't be a complaint.
  if (!/^\d+$/.test(id)) notFound()

  return (
    // The "just registered" banner reads useSearchParams.
    <Suspense fallback={<LoadingState />}>
      <CaseFile id={id} />
    </Suspense>
  )
}
