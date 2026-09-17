import { ApiRequestError, NetworkError } from "@/lib/api"

/**
 * User-facing wording for anything `api()` throws. One place, so every form
 * says the same thing for the same failure — and a failure is never hidden
 * behind "try again later" when the real cause is knowable.
 *
 *   NetworkError        BE unreachable (not running, offline, CORS-blocked)
 *   403 + origin        BE refused this page's address (CORS_ORIGIN)
 *   403                 wrong role
 *   429                 throttled
 *   5xx                 server error
 *   other 4xx           BE's own message, already in Malay
 */

const isDev = process.env.NODE_ENV !== "production"

/**
 * A message written for the user, thrown by our own code (e.g. a check inside
 * a ConfirmDialog's onConfirm). Shown as is; any other Error is treated as a
 * bug and gets the generic wording.
 */
export class UserFacingError extends Error {}

/** BE's requireTrustedOrigin message (BE/src/middleware/auth.ts). */
const ORIGIN_REFUSED = "Asal permintaan tidak dibenarkan"

export type ErrorKind = "network" | "forbidden" | "other"

export function describeError(error: unknown): {
  title: string
  description: string
  kind: ErrorKind
} {
  if (error instanceof NetworkError) {
    return {
      kind: "network",
      title: "Tidak dapat menghubungi pelayan",
      description: isDev
        ? // A CORS refusal is indistinguishable from a stopped server in the browser.
          `Pastikan API sedang berjalan (npm run dev dalam BE/) di ${new URL(error.url).origin}, dan alamat laman ini (${typeof window === "undefined" ? "" : window.location.origin}) disenaraikan dalam CORS_ORIGIN di BE/.env.`
        : "Semak sambungan internet anda atau cuba sebentar lagi.",
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return {
        kind: "other",
        title: "Sesi tamat",
        description: "Sila log masuk semula.",
      }
    }
    if (error.status === 403 && error.message === ORIGIN_REFUSED) {
      return {
        kind: "forbidden",
        title: "Permintaan ditolak oleh pelayan",
        description: isDev
          ? `Alamat laman ini (${typeof window === "undefined" ? "" : window.location.origin}) tiada dalam CORS_ORIGIN di BE/.env. Buka laman melalui http://localhost:3000 atau tambah alamat ini.`
          : "Muat semula halaman dan cuba lagi.",
      }
    }
    if (error.status === 403) {
      return {
        kind: "forbidden",
        title: "Tiada akses",
        description: "Peranan anda tidak dibenarkan melihat maklumat ini.",
      }
    }
    if (error.status === 404) {
      return {
        kind: "other",
        title: "Tidak dijumpai",
        description: error.message,
      }
    }
    if (error.status === 429) {
      return {
        kind: "other",
        title: "Terlalu banyak cubaan",
        description: "Tunggu sebentar sebelum mencuba lagi.",
      }
    }
    if (error.status >= 500) {
      return {
        kind: "other",
        title: "Ralat pelayan",
        description: "Cuba sebentar lagi.",
      }
    }
    return {
      kind: "other",
      title: "Permintaan tidak dapat diproses",
      description: error.message,
    }
  }
  return {
    kind: "other",
    title: "Ralat tidak dijangka",
    description: "Cuba sebentar lagi.",
  }
}

/** One sentence for an inline form message. 4xx keep BE's own wording. */
export function errorMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message
  if (
    error instanceof ApiRequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 403, 429].includes(error.status)
  ) {
    return error.message
  }
  const { title, description } = describeError(error)
  return `${title}. ${description}`
}
