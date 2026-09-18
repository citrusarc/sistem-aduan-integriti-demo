import { PortalFooter } from "@/components/portal/portal-footer"
import { PortalHeader } from "@/components/portal/portal-header"

/**
 * Public portal chrome. No console navigation here; the header reflects the
 * one session (§8 decision 15) and links to the console only for accounts
 * that have one. Pages are public by default; `/me` needs a signed-in account.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <PortalHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
        {children}
      </main>
      <PortalFooter />
    </div>
  )
}
