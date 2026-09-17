"use client"

import * as React from "react"

import { UNAUTHORIZED_EVENT, type UnauthorizedEventDetail } from "@/lib/api"
import {
  getCurrentStaff,
  logout as logoutRequest,
  setupFirstAdmin as setupRequest,
  type CurrentStaff,
} from "@/lib/auth"

/**
 * Staff session state for the (admin) route group, from GET /api/auth/me.
 *
 * Separate from the complainant session on purpose (§8 decision 4): a
 * different cookie (`aduan_sid` vs `aduan_csid`), a different provider, and a
 * 401 on one never signs out the other.
 */

export type StaffSessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; staff: CurrentStaff }
  | { status: "error"; error: Error }

type StaffSessionValue = StaffSessionState & {
  refresh: () => Promise<void>
  /** The last sign-in step returned a session (§8 decision 14). */
  signedIn: (staff: CurrentStaff) => void
  /** First-run setup: creates the first ADMIN and signs them in. */
  setupFirstAdmin: (input: {
    fullName: string
    email: string
    password: string
  }) => Promise<CurrentStaff>
  logout: () => Promise<void>
}

const StaffSessionContext = React.createContext<StaffSessionValue | null>(null)

export function StaffSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = React.useState<StaffSessionState>({
    status: "loading",
  })

  const refresh = React.useCallback(async () => {
    try {
      const staff = await getCurrentStaff()
      setState(
        staff ? { status: "authenticated", staff } : { status: "anonymous" }
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

  // Any staff call that returns 401 means the session is gone: expired,
  // signed out elsewhere, or the account was deactivated.
  React.useEffect(() => {
    function onUnauthorized(event: Event) {
      const { scope } = (event as CustomEvent<UnauthorizedEventDetail>).detail
      if (scope === "staff") setState({ status: "anonymous" })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const signedIn = React.useCallback((staff: CurrentStaff) => {
    setState({ status: "authenticated", staff })
  }, [])

  const setupFirstAdmin = React.useCallback(
    async (input: { fullName: string; email: string; password: string }) => {
      const staff = await setupRequest(input)
      setState({ status: "authenticated", staff })
      return staff
    },
    []
  )

  const logout = React.useCallback(async () => {
    await logoutRequest()
    setState({ status: "anonymous" })
  }, [])

  const value = React.useMemo(
    () => ({ ...state, refresh, signedIn, setupFirstAdmin, logout }),
    [state, refresh, signedIn, setupFirstAdmin, logout]
  )

  return (
    <StaffSessionContext.Provider value={value}>
      {children}
    </StaffSessionContext.Provider>
  )
}

export function useStaffSession(): StaffSessionValue {
  const value = React.useContext(StaffSessionContext)
  if (!value) {
    throw new Error("useStaffSession must be used inside StaffSessionProvider")
  }
  return value
}
