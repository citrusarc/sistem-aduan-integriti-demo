import type { Metadata } from "next"

import { Dashboard } from "@/components/admin/stats/dashboard"

export const metadata: Metadata = { title: "Papan Pemuka" }

export default function DashboardPage() {
  return <Dashboard />
}
