"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { controlClassName } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type SelectOption<V extends string> = { value: V; label: string }

export type SelectProps<V extends string> = {
  options: readonly SelectOption<V>[]
  value: V | null
  onValueChange: (value: V | null) => void
  /** Shown when nothing is selected. */
  placeholder?: string
  /**
   * Adds a first option that selects `null` — e.g. "Semua" for a filter or
   * "Tiada" for an optional field. Omit for a required choice.
   */
  nullLabel?: string
  disabled?: boolean
  required?: boolean
  name?: string
  className?: string
  "aria-label"?: string
}

/**
 * Single-value select on Base UI. Values are enum keys (strings); labels are
 * what the user reads. Inside a FormField the label is wired automatically.
 */
function Select<V extends string>({
  options,
  value,
  onValueChange,
  placeholder = "Pilih…",
  nullLabel,
  disabled,
  required,
  name,
  className,
  "aria-label": ariaLabel,
}: SelectProps<V>) {
  const items = React.useMemo(
    () => [
      ...(nullLabel ? [{ value: null, label: nullLabel }] : []),
      ...options,
    ],
    [options, nullLabel]
  )

  return (
    <SelectPrimitive.Root
      items={items}
      value={value}
      onValueChange={(next) => onValueChange((next as V | null) ?? null)}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          controlClassName,
          "flex h-9 items-center justify-between gap-2 text-left data-[popup-open]:border-ring",
          className
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          className="truncate data-[placeholder]:text-muted-foreground"
        />
        <SelectPrimitive.Icon className="text-muted-foreground">
          <ChevronsUpDownIcon className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-50 outline-none"
        >
          <SelectPrimitive.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
            <SelectPrimitive.List>
              {items.map((item) => (
                <SelectPrimitive.Item
                  key={item.value ?? "__null"}
                  value={item.value}
                  className="flex cursor-default items-center gap-2 rounded-md py-1.5 pr-3 pl-2 outline-none select-none data-[highlighted]:bg-muted data-[selected]:font-medium"
                >
                  <span className="flex size-4 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <CheckIcon className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>
                    {item.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export { Select }
