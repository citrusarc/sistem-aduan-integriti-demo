import type { Metadata } from "next"

import { MyComplaintsPage } from "@/components/portal/my-complaints"

export const metadata: Metadata = { title: "Aduan Saya" }

export default function PortalMePage() {
  return <MyComplaintsPage />
}
