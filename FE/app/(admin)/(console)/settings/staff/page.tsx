import type { Metadata } from "next"

import { StaffManagement } from "@/components/admin/settings/staff-management"

export const metadata: Metadata = { title: "Pengurusan Staf" }

export default function SettingsStaffPage() {
  return <StaffManagement />
}
