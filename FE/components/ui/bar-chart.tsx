"use client"

import * as React from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Single-series count charts for the dashboard and reports. One hue
 * (`--chart-1`): these show magnitude across categories, not identity, so
 * there's no legend — the section title names the series. Specs from the
 * dataviz method: bars ≤ 24px thick with a 4px rounded data end and a square
 * baseline, hairline recessive grid, per-bar hover/focus tooltip, and a table
 * view so no value is hover-only.
 */

export type BarDatum = { key: string; label: string; value: number }

const nf = new Intl.NumberFormat("ms-MY")

function share(value: number, total: number) {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%"
}

type Tip = { x: number; y: number; title: string; body: string }

/**
 * A tooltip that follows the hovered or focused mark, positioned inside
 * `frame` (the chart owns the ref). Text only, rendered as React text.
 */
function useTooltip(frame: React.RefObject<HTMLDivElement | null>) {
  const [tip, setTip] = React.useState<Tip | null>(null)

  function show(
    event: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
    title: string,
    body: string
  ) {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    const target = event.currentTarget.getBoundingClientRect()
    const x =
      "clientX" in event
        ? event.clientX - box.left
        : target.left + target.width / 2 - box.left
    setTip({ x, y: target.top - box.top, title, body })
  }

  return { tip, show, hide: () => setTip(null) }
}

function TooltipBubble({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md"
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      <p className="font-medium">{tip.title}</p>
      <p className="text-muted-foreground tabular-nums">{tip.body}</p>
    </div>
  )
}

function TableView({
  data,
  labelHeading,
  total,
}: {
  data: BarDatum[]
  labelHeading: string
  total: number
}) {
  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline">
        Lihat sebagai jadual
      </summary>
      <div className="mt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labelHeading}</TableHead>
              <TableHead className="text-right">Bilangan</TableHead>
              <TableHead className="text-right">Peratus</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((d) => (
              <TableRow key={d.key}>
                <TableCell>{d.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {nf.format(d.value)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {share(d.value, total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  )
}

/** Categories down the side, bars growing right, value at each bar's tip. */
export function HorizontalBarChart({
  data,
  labelHeading,
  unit = "aduan",
}: {
  data: BarDatum[]
  labelHeading: string
  unit?: string
}) {
  const frame = React.useRef<HTMLDivElement>(null)
  const tooltip = useTooltip(frame)
  const max = Math.max(1, ...data.map((d) => d.value))
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex flex-col gap-3">
      <div ref={frame} className="relative">
        <ul className="flex flex-col gap-0.5">
          {data.map((d) => (
            <li
              key={d.key}
              tabIndex={0}
              aria-label={`${d.label}: ${nf.format(d.value)} ${unit}, ${share(d.value, total)}`}
              className="group/bar grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3 rounded-md px-1 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              onPointerMove={(e) =>
                tooltip.show(
                  e,
                  d.label,
                  `${nf.format(d.value)} ${unit} · ${share(d.value, total)}`
                )
              }
              onPointerLeave={tooltip.hide}
              onFocus={(e) =>
                tooltip.show(
                  e,
                  d.label,
                  `${nf.format(d.value)} ${unit} · ${share(d.value, total)}`
                )
              }
              onBlur={tooltip.hide}
            >
              <span className="truncate text-sm text-foreground" aria-hidden>
                {d.label}
              </span>
              <span className="flex h-6 items-center gap-2" aria-hidden>
                {d.value > 0 && (
                  <span
                    className="h-4 rounded-r-[4px] bg-chart-1 transition-opacity group-hover/bar:opacity-80 group-focus-visible/bar:opacity-80"
                    style={{ width: `calc((100% - 3rem) * ${d.value / max})` }}
                  />
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {nf.format(d.value)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <TooltipBubble tip={tooltip.tip} />
      </div>
      <TableView data={data} labelHeading={labelHeading} total={total} />
    </div>
  )
}

/**
 * Clean axis ticks for whole-number counts: steps of 1, 2 or 5 × 10ⁿ, never a
 * fraction (a month with one complaint must not get a "0,5" tick).
 */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const rough = max / 4
  const pow = 10 ** Math.max(0, Math.floor(Math.log10(rough)))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough)!
  const top = Math.ceil(max / step) * step
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
}

/** Periods along the bottom (e.g. months), columns growing up. */
export function ColumnChart({
  data,
  labelHeading,
  unit = "aduan",
  className,
}: {
  data: (BarDatum & { shortLabel: string })[]
  labelHeading: string
  unit?: string
  className?: string
}) {
  const frame = React.useRef<HTMLDivElement>(null)
  const tooltip = useTooltip(frame)
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)))
  const top = ticks[ticks.length - 1]!
  const total = data.reduce((s, d) => s + d.value, 0)
  const peak = data.reduce<BarDatum | null>(
    (best, d) => (d.value > 0 && (!best || d.value > best.value) ? d : best),
    null
  )

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="grid grid-cols-[2rem_1fr] gap-2">
        <div
          className="relative h-48 text-right text-[0.7rem] text-muted-foreground tabular-nums"
          aria-hidden
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 translate-y-1/2 leading-none"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {nf.format(t)}
            </span>
          ))}
        </div>
        <div ref={frame} className="relative">
          <div className="relative h-48">
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className={cn(
                  "absolute inset-x-0 h-px",
                  t === 0 ? "bg-border" : "bg-border/60"
                )}
                style={{ bottom: `${(t / top) * 100}%` }}
              />
            ))}
            <ul
              className="absolute inset-0 flex items-end"
              aria-label={`${labelHeading}: ${nf.format(total)} ${unit}`}
            >
              {data.map((d) => (
                <li
                  key={d.key}
                  tabIndex={0}
                  aria-label={`${d.label}: ${nf.format(d.value)} ${unit}`}
                  className="group/col relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                  onPointerMove={(e) =>
                    tooltip.show(e, d.label, `${nf.format(d.value)} ${unit}`)
                  }
                  onPointerLeave={tooltip.hide}
                  onFocus={(e) =>
                    tooltip.show(e, d.label, `${nf.format(d.value)} ${unit}`)
                  }
                  onBlur={tooltip.hide}
                >
                  {d === peak && (
                    <span
                      aria-hidden
                      className="absolute text-[0.7rem] font-medium text-foreground tabular-nums"
                      style={{
                        bottom: `calc(${(d.value / top) * 100}% + 2px)`,
                      }}
                    >
                      {nf.format(d.value)}
                    </span>
                  )}
                  {d.value > 0 && (
                    <span
                      aria-hidden
                      className="w-[min(60%,24px)] rounded-t-[4px] bg-chart-1 transition-opacity group-hover/col:opacity-80 group-focus-visible/col:opacity-80"
                      style={{ height: `${(d.value / top) * 100}%` }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-1 flex" aria-hidden>
            {data.map((d) => (
              <span
                key={d.key}
                className="min-w-0 flex-1 truncate text-center text-[0.7rem] text-muted-foreground"
              >
                {d.shortLabel}
              </span>
            ))}
          </div>
          <TooltipBubble tip={tooltip.tip} />
        </div>
      </div>
      <TableView data={data} labelHeading={labelHeading} total={total} />
    </div>
  )
}
