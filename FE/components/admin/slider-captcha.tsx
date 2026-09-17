"use client"

import * as React from "react"
import { CheckCircle2Icon, RotateCwIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/states"
import { ApiRequestError } from "@/lib/api"
import { getCaptcha, verifyCaptcha, type Captcha } from "@/lib/auth"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/**
 * Slider image captcha — §8 decision 14 (g). BE draws the picture and keeps
 * the answer; this only moves the piece and reports where it was let go. A
 * solved slide yields a one-time token for the next sign-in request.
 */
export function SliderCaptcha({
  onSolved,
}: {
  onSolved: (captchaToken: string) => void
}) {
  const [captcha, setCaptcha] = React.useState<Captcha | null>(null)
  const [x, setX] = React.useState(0)
  const [state, setState] = React.useState<
    "loading" | "ready" | "dragging" | "checking" | "solved"
  >("loading")
  const [message, setMessage] = React.useState<string | null>(null)
  const [scale, setScale] = React.useState(1)
  const frameRef = React.useRef<HTMLDivElement>(null)
  const trackRef = React.useRef<HTMLDivElement>(null)

  const load = React.useCallback(async (note?: string) => {
    setState("loading")
    setX(0)
    try {
      setCaptcha(await getCaptcha())
      setMessage(note ?? null)
      setState("ready")
    } catch (err) {
      setMessage(errorMessage(err))
      setState("ready")
    }
  }, [])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  // The picture shrinks on narrow screens; slide positions stay in picture pixels.
  React.useEffect(() => {
    const frame = frameRef.current
    if (!frame || !captcha) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / captcha.width)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [captcha])

  const maxX = captcha ? captcha.width - captcha.pieceSize : 0
  const busy = state === "checking" || state === "solved" || state === "loading"

  async function release(finalX: number) {
    if (!captcha) return
    setState("checking")
    try {
      const { captchaToken } = await verifyCaptcha(
        captcha.challengeToken,
        Math.round(finalX)
      )
      setState("solved")
      setMessage(null)
      onSolved(captchaToken)
    } catch (err) {
      const retry = err instanceof ApiRequestError && err.body?.retry === true
      if (err instanceof ApiRequestError && err.status === 422 && retry) {
        setMessage(err.message)
        setX(0)
        setState("ready")
      } else {
        void load(
          err instanceof ApiRequestError && err.status === 422
            ? err.message
            : errorMessage(err)
        )
      }
    }
  }

  function positionFrom(clientX: number) {
    const track = trackRef.current
    if (!track || !captcha) return 0
    const rect = track.getBoundingClientRect()
    const handle = captcha.pieceSize * scale
    const px = clientX - rect.left - handle / 2
    return Math.max(0, Math.min(maxX, px / scale))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Luncurkan kepingan ke tempat kosong
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === "checking" || state === "solved"}
          aria-label="Muat semula captcha"
          title="Gambar lain"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RotateCwIcon className="size-4" aria-hidden />
        </button>
      </div>

      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-xl border border-border/70 bg-muted"
        style={{
          aspectRatio: captcha
            ? `${captcha.width} / ${captcha.height}`
            : "2 / 1",
        }}
      >
        {!captcha || state === "loading" ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL from BE */}
            <img
              src={captcha.background}
              alt="Gambar captcha dengan satu ruang kosong"
              draggable={false}
              className="absolute inset-0 size-full select-none"
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL from BE */}
            <img
              src={captcha.piece}
              alt=""
              draggable={false}
              className={cn(
                "absolute shadow-[0_2px_8px_rgb(0_0_0/0.45)] select-none",
                state !== "dragging" && "transition-[left] duration-150"
              )}
              style={{
                left: x * scale,
                top: captcha.pieceY * scale,
                width: captcha.pieceSize * scale,
                height: captcha.pieceSize * scale,
              }}
            />
            {state === "solved" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                <CheckCircle2Icon className="size-10" aria-hidden />
              </div>
            )}
          </>
        )}
      </div>

      <div
        ref={trackRef}
        className={cn(
          "relative h-11 w-full touch-none rounded-xl border border-border/70 bg-muted/60 select-none",
          state === "solved" &&
            "border-status-selesai-foreground/40 bg-status-selesai"
        )}
        onPointerDown={(e) => {
          if (busy || !captcha) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setState("dragging")
          setX(positionFrom(e.clientX))
        }}
        onPointerMove={(e) => {
          if (state === "dragging") setX(positionFrom(e.clientX))
        }}
        onPointerUp={(e) => {
          if (state !== "dragging") return
          const finalX = positionFrom(e.clientX)
          setX(finalX)
          void release(finalX)
        }}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-0 rounded-xl bg-primary/10"
          style={{ width: captcha ? x * scale + captcha.pieceSize * scale : 0 }}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {state === "solved"
            ? "Disahkan"
            : state === "checking"
              ? "Menyemak…"
              : "Seret ke kanan →"}
        </span>
        <div
          role="slider"
          tabIndex={busy ? -1 : 0}
          aria-label="Kedudukan kepingan captcha"
          aria-valuemin={0}
          aria-valuemax={maxX}
          aria-valuenow={Math.round(x)}
          aria-disabled={busy}
          onKeyDown={(e) => {
            if (busy) return
            const step = e.shiftKey ? 10 : 2
            if (e.key === "ArrowRight") setX((v) => Math.min(maxX, v + step))
            else if (e.key === "ArrowLeft") setX((v) => Math.max(0, v - step))
            else if (e.key === "Enter" || e.key === " ") void release(x)
            else return
            e.preventDefault()
          }}
          className={cn(
            "absolute top-1/2 flex h-9 -translate-y-1/2 cursor-grab items-center justify-center rounded-lg border border-border bg-card shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing",
            state !== "dragging" && "transition-[left] duration-150"
          )}
          style={{
            left: x * scale,
            width: captcha ? captcha.pieceSize * scale : 44,
          }}
        >
          <span aria-hidden className="text-muted-foreground">
            ⋮⋮
          </span>
        </div>
      </div>

      {message && (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Papan kekunci: anak panah kiri/kanan, kemudian Enter.
      </p>
    </div>
  )
}
