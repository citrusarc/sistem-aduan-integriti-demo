"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Pages keep their filters in the URL. This sets or clears several params at
 * once (`null`/`""` clears) with `router.replace`, so filtering doesn't add
 * history entries or scroll. Any change that doesn't set `halaman` itself goes
 * back to page 1 — a new filter on page 3 would otherwise show a stale page.
 */
export function useSearchParamsUpdater() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return function setParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams)
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value)
      else next.delete(name)
    }
    if (!("halaman" in changes)) next.delete("halaman")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
}
