"use client"

import * as React from "react"

import { UNAUTHORIZED_EVENT } from "@/lib/api"
import {
  getCurrentUser,
  logout as logoutRequest,
  type CurrentUser,
} from "@/lib/auth"

/**
 * The one session (§8 decision 15), from GET /api/auth/me. Staff and
 * complainants sign in the same way with the same cookie (`aduan_sid`); what
 * a session may see comes from `permissions`. Mounted once at the root, so
 * the portal and the console agree on who is signed in.
 */

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: CurrentUser }
  | { status: "error"; error: Error }

type SessionValue = SessionState & {
  refresh: () => Promise<void>
  /** The last sign-in or registration step returned a session. */
  signedIn: (user: CurrentUser) => void
  logout: () => Promise<void>
}

const SessionContext = React.createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({
    status: "loading",
  })

  const refresh = React.useCallback(async () => {
    try {
      const user = await getCurrentUser()
      setState(
        user ? { status: "authenticated", user } : { status: "anonymous" }
      )
    } catch (err) {
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

  // Any signed-in call that returns 401 means the session is gone: expired,
  // signed out elsewhere, or the account was deactivated.
  React.useEffect(() => {
    function onUnauthorized() {
      setState({ status: "anonymous" })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const signedIn = React.useCallback((user: CurrentUser) => {
    setState({ status: "authenticated", user })
  }, [])

  const logout = React.useCallback(async () => {
    await logoutRequest()
    setState({ status: "anonymous" })
  }, [])

  const value = React.useMemo(
    () => ({ ...state, refresh, signedIn, logout }),
    [state, refresh, signedIn, logout]
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionValue {
  const value = React.useContext(SessionContext)
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider")
  }
  return value
}
