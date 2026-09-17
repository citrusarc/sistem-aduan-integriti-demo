"use client"

import * as React from "react"

import {
  ApiRequestError,
  complainantApi,
  UNAUTHORIZED_EVENT,
  type UnauthorizedEventDetail,
} from "@/lib/api"
import type { ComplainantSession } from "@/types/entities"

/**
 * Complainant session for the (portal) route group — email OTP, cookie
 * `aduan_csid` (§8 decision 4). Independent of staff auth: a staff member
 * signed in to the console is still anonymous here, and vice versa.
 */

export type ComplainantSessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: ComplainantSession }
  | { status: "error"; error: Error }

type ComplainantSessionValue = ComplainantSessionState & {
  refresh: () => Promise<void>
  /** Exchange an emailed code for a session. Throws ApiRequestError(401) on a bad code. */
  verify: (email: string, code: string) => Promise<ComplainantSession>
  logout: () => Promise<void>
}

const ComplainantSessionContext =
  React.createContext<ComplainantSessionValue | null>(null)

export function ComplainantSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = React.useState<ComplainantSessionState>({
    status: "loading",
  })

  const refresh = React.useCallback(async () => {
    try {
      const session = await complainantApi.me()
      setState({ status: "authenticated", session })
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setState({ status: "anonymous" })
        return
      }
      setState({
        status: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      })
    }
  }, [])

  React.useEffect(() => {
    // Initial session lookup against BE; the result lands asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    function onUnauthorized(event: Event) {
      const { scope } = (event as CustomEvent<UnauthorizedEventDetail>).detail
      if (scope === "complainant") setState({ status: "anonymous" })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const verify = React.useCallback(async (email: string, code: string) => {
    const session = await complainantApi.verify(email, code)
    setState({ status: "authenticated", session })
    return session
  }, [])

  const logout = React.useCallback(async () => {
    await complainantApi.logout().catch(() => undefined)
    setState({ status: "anonymous" })
  }, [])

  const value = React.useMemo(
    () => ({ ...state, refresh, verify, logout }),
    [state, refresh, verify, logout]
  )

  return (
    <ComplainantSessionContext.Provider value={value}>
      {children}
    </ComplainantSessionContext.Provider>
  )
}

export function useComplainantSession(): ComplainantSessionValue {
  const value = React.useContext(ComplainantSessionContext)
  if (!value) {
    throw new Error(
      "useComplainantSession must be used inside ComplainantSessionProvider"
    )
  }
  return value
}
