"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * BE list endpoints take `limit` / `offset` and return no total count. To know
 * whether a next page exists without a count, ask for one extra row:
 *
 *   const rows = await adminApi.complaints.list({ ...pageQuery(page, 20) })
 *   const { items, hasNextPage } = splitPage(rows, 20)
 */
export function pageQuery(page: number, pageSize: number) {
  const safePage = Math.max(1, Math.floor(page))
  return { limit: pageSize + 1, offset: (safePage - 1) * pageSize }
}

export function splitPage<T>(rows: T[], pageSize: number) {
  return { items: rows.slice(0, pageSize), hasNextPage: rows.length > pageSize }
}

/** Reads `?halaman=` safely: anything that isn't a positive integer is page 1. */
export function pageFromParam(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 1
}

type PaginationProps = {
  page: number
  hasNextPage: boolean
  onPageChange: (page: number) => void
  disabled?: boolean
  className?: string
}

function Pagination({
  page,
  hasNextPage,
  onPageChange,
  disabled,
  className,
}: PaginationProps) {
  if (page === 1 && !hasNextPage) return null

  return (
    <nav
      aria-label="Penomboran"
      className={cn("flex items-center justify-between gap-3", className)}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Sebelumnya
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        Halaman {page}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !hasNextPage}
        onClick={() => onPageChange(page + 1)}
      >
        Seterusnya
      </Button>
    </nav>
  )
}

export { Pagination }
