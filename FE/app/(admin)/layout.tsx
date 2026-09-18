import type { Metadata } from "next"

export const metadata: Metadata = {
  title: { default: "Konsol", template: "%s · Konsol Unit Integriti" },
  // Internal console: keep it out of search indexes.
  robots: { index: false, follow: false },
}

/**
 * The console group. The gate itself is in `(console)/layout.tsx`, so
 * `/tiada-akses` sits inside this group without being gated. Sign-in pages
 * are in `(auth)`; the session provider is at the root.
 */
export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
