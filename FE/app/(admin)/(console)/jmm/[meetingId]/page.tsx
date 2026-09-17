import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { MeetingDetail } from "@/components/admin/jmm/meeting-detail"

export const metadata: Metadata = { title: "Agenda mesyuarat" }

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>
}) {
  const { meetingId } = await params
  if (!/^\d+$/.test(meetingId)) notFound()
  return <MeetingDetail id={meetingId} />
}
