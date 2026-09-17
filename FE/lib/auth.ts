import { api, ApiRequestError } from "@/lib/api"
import type { StaffRole } from "@/types/enums"

/**
 * Client helpers for staff auth. The session itself is an httpOnly cookie that
 * JavaScript cannot read — these functions only ask BE about it.
 *
 * Anything here is for deciding what to SHOW. The API enforces access on every
 * request; hiding a link does not protect the data behind it.
 */

/** Mirrors MIN_PASSWORD_LENGTH in BE/src/auth/password.ts; BE enforces it. */
export const MIN_PASSWORD_LENGTH = 12

export type CurrentStaff = {
  id: string
  email: string
  fullName: string
  role: StaffRole
  /** False for KJ and SUB_UNIT — they are refused by every /api/admin/* route. */
  isIntegrityUnit: boolean
}

export async function login(email: string, password: string) {
  return api<CurrentStaff & { sessionExpiresAt: string }>("/auth/login", {
    method: "POST",
    json: { email, password },
  })
}

export async function logout(): Promise<void> {
  await api<void>("/auth/logout", { method: "POST" }).catch(() => undefined)
}

/** The signed-in staff member, or null when there's no valid session. */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  try {
    return await api<CurrentStaff>("/auth/me")
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return null
    throw err
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await api<void>("/auth/password", {
    method: "POST",
    json: { currentPassword, newPassword },
  })
}
