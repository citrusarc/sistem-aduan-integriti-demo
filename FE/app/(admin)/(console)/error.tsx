"use client"

import { ErrorState } from "@/components/ui/states"

export default function ConsoleError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <ErrorState error={error} onRetry={retry} />
}
