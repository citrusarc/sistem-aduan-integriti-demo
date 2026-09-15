const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"

type ApiError = { error: string }

/**
 * Carries the HTTP status so callers can tell "not signed in" (401) from
 * "signed in, wrong role" (403) and "account locked" (423).
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * Fetch wrapper for the BE API. Unwraps the `{ data }` envelope and turns
 * `{ error }` responses into thrown errors.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    // Staff auth is an httpOnly session cookie set by BE. Without this the
    // browser neither sends it nor stores it, and every admin call is a 401.
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    const message = (body as ApiError | null)?.error ?? res.statusText
    throw new ApiRequestError(res.status, message)
  }

  // 204 No Content (logout, password change) has no body to unwrap.
  return (body as { data: T } | null)?.data as T
}
