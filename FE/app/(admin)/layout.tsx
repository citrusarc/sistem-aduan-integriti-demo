import type { Metadata } from "next"

import { StaffSessionProvider } from "@/components/providers/staff-session"

export const metadata: Metadata = {
  title: { default: "Konsol", template: "%s · Konsol Unit Integriti" },
  // Internal console: keep it out of search indexes.
  robots: { index: false, follow: false },
}

/**
 * Everything staff-facing shares one session provider. The gate itself is in
 * `(console)/layout.tsx`, so `/login` and `/tiada-akses` sit inside this group
 * without being gated.
 */
export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <StaffSessionProvider>{children}</StaffSessionProvider>
}
