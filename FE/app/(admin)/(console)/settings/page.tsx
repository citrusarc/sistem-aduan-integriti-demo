import type { Metadata } from "next"

import { AccountSettings } from "@/components/admin/settings/account-settings"

export const metadata: Metadata = { title: "Tetapan Akaun" }

export default function SettingsPage() {
  return <AccountSettings />
}
