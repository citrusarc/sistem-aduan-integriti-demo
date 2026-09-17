import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"

/** "← Parent page" above a detail page's header. */
export function BackLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      {children}
    </Link>
  )
}
