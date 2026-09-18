import type { Metadata } from "next"

export const metadata: Metadata = {
  // Sign-in pages have nothing worth indexing.
  robots: { index: false, follow: false },
}

/**
 * Sign-in, registration and password reset — one set of pages for staff and
 * complainants alike (§8 decision 15). Not gated. The session provider is at
 * the root, so a successful sign-in is seen by the portal and the console.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm surface-card border-border/70 bg-card p-6">
        {children}
      </div>
    </main>
  )
}
