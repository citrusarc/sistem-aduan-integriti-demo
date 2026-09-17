"use client"

import * as React from "react"
import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { PASSWORD_REQUIREMENTS } from "@/lib/auth"
import { cn } from "@/lib/utils"

/**
 * A password or PIN field, hidden while typed, with an eye button to show it
 * (§8 decision 14 (e), (f)). Used for staff passwords and for every emailed
 * code. Showing is per field and resets on remount; nothing is remembered.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Don't offer to save a code or show it in autofill history.
        spellCheck={false}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Sembunyikan" : "Tunjukkan"}
        aria-pressed={visible}
        title={visible ? "Sembunyikan" : "Tunjukkan"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden />
        ) : (
          <EyeIcon className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

/** Live checklist for §8 decision 14 (b). */
export function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul
      aria-label="Syarat kata laluan"
      className="grid gap-1 text-xs sm:grid-cols-2"
    >
      {PASSWORD_REQUIREMENTS.map((rule) => {
        const ok = rule.test(password)
        return (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-1.5",
              ok ? "text-status-selesai-foreground" : "text-muted-foreground"
            )}
          >
            {ok ? (
              <CheckIcon className="size-3.5" aria-hidden />
            ) : (
              <XIcon className="size-3.5" aria-hidden />
            )}
            <span>
              {rule.label}
              <span className="sr-only">{ok ? " — dipenuhi" : " — belum"}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
