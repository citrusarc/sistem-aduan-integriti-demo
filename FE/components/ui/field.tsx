"use client"

import * as React from "react"
import { Field as FieldPrimitive } from "@base-ui/react/field"

import { cn } from "@/lib/utils"

/**
 * A labelled form field. Base UI's Field wires the label, description and
 * error to the control (`aria-labelledby`, `aria-describedby`, `aria-invalid`)
 * — for Input and Select automatically, and for any other element passed
 * through `FieldControl render`.
 *
 * `error` is the message to show, usually BE's 422 text for this field. When
 * set, the field is marked invalid.
 */
type FormFieldProps = {
  label: React.ReactNode
  description?: React.ReactNode
  error?: string | null
  required?: boolean
  disabled?: boolean
  name?: string
  className?: string
  children: React.ReactNode
}

function FormField({
  label,
  description,
  error,
  required,
  disabled,
  name,
  className,
  children,
}: FormFieldProps) {
  return (
    <FieldPrimitive.Root
      name={name}
      invalid={Boolean(error)}
      disabled={disabled}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <FieldPrimitive.Label className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </FieldPrimitive.Label>
      {children}
      {description && (
        <FieldPrimitive.Description className="text-xs text-muted-foreground">
          {description}
        </FieldPrimitive.Description>
      )}
      {error && (
        <FieldPrimitive.Error match className="text-xs text-destructive">
          {error}
        </FieldPrimitive.Error>
      )}
    </FieldPrimitive.Root>
  )
}

/** Connects a non-Base-UI control (e.g. <Textarea>) to the surrounding FormField. */
const FieldControl = FieldPrimitive.Control

/** A checkbox with its label beside it, for acknowledgements like the disclaimer. */
function CheckboxField({
  label,
  error,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  label: React.ReactNode
  error?: string | null
}) {
  const id = React.useId()
  const errorId = `${id}-error`
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-0.5 size-4 shrink-0 accent-primary"
          {...props}
        />
        <span>{label}</span>
      </label>
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export { CheckboxField, FieldControl, FormField }
