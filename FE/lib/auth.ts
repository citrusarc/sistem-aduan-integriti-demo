import { api, ApiRequestError } from "@/lib/api"
import type { Permission, StaffRole } from "@/types/enums"

/**
 * Client helpers for sign-in and registration — one flow for staff and
 * complainants (§8 decisions 14 and 15). The session itself is an httpOnly
 * cookie that JavaScript cannot read — these functions only ask BE about it.
 *
 * Anything here is for deciding what to SHOW. The API enforces access on every
 * request; hiding a link does not protect the data behind it.
 */

/** Mirrors MIN_PASSWORD_LENGTH in BE/src/auth/password.ts; BE enforces it. */
export const MIN_PASSWORD_LENGTH = 12

/**
 * §8 decision 14 (b), mirroring PASSWORD_RULES in BE/src/auth/password.ts —
 * for the live checklist only. BE enforces them.
 */
export const PASSWORD_REQUIREMENTS = [
  {
    label: `Sekurang-kurangnya ${MIN_PASSWORD_LENGTH} aksara`,
    test: (p: string) => p.length >= MIN_PASSWORD_LENGTH,
  },
  { label: "Huruf besar (A-Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Huruf kecil (a-z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Nombor (0-9)", test: (p: string) => /[0-9]/.test(p) },
  {
    label: "Aksara khas (@ # $ % ^ & …)",
    test: (p: string) => /[^A-Za-z0-9\s]/.test(p),
  },
] as const

export function meetsPasswordPolicy(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every((r) => r.test(password))
}

// ─── Sign-in steps (§8 decision 14) ──────────────────────────────────────────

export type Captcha = {
  challengeToken: string
  width: number
  height: number
  pieceSize: number
  pieceY: number
  background: string
  piece: string
}

export const getCaptcha = () => api<Captcha>("/auth/captcha")

/** 422 with `retry` in the body when the slide misses. */
export const verifyCaptcha = (challengeToken: string, x: number) =>
  api<{ captchaToken: string }>("/auth/captcha/verify", {
    method: "POST",
    json: { challengeToken, x },
  })

export type SignedIn = CurrentUser

/** Correct password: a code is emailed; nothing is signed in yet. */
export const submitPassword = (
  email: string,
  password: string,
  captchaToken: string
) =>
  api<{ mfaRequired: true; mfaToken: string; sentTo: string }>("/auth/login", {
    method: "POST",
    json: { email, password, captchaToken },
  })

export const submitLoginCode = (mfaToken: string, code: string) =>
  api<SignedIn | { passwordChangeRequired: true; changeToken: string }>(
    "/auth/login/verify",
    { method: "POST", json: { mfaToken, code } }
  )

export const changeExpiredPassword = (
  changeToken: string,
  newPassword: string
) =>
  api<SignedIn>("/auth/password/expired", {
    method: "POST",
    json: { changeToken, newPassword },
  })

export const requestPasswordReset = (email: string, captchaToken: string) =>
  api<{ resetToken: string; message: string }>("/auth/forgot-password", {
    method: "POST",
    json: { email, captchaToken },
  })

export const resetPassword = (
  resetToken: string,
  code: string,
  newPassword: string
) =>
  api<void>("/auth/reset-password", {
    method: "POST",
    json: { resetToken, code, newPassword },
  })

/** §8 decision 15: name + email + password; a code is emailed to confirm. */
export const register = (input: {
  fullName: string
  email: string
  password: string
  captchaToken: string
}) =>
  api<{ verifyToken: string; sentTo: string; message: string }>(
    "/auth/register",
    { method: "POST", json: input }
  )

export const verifyRegistration = (verifyToken: string, code: string) =>
  api<SignedIn>("/auth/register/verify", {
    method: "POST",
    json: { verifyToken, code },
  })

export type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: StaffRole
  /** From BE; decides what to SHOW. BE checks the permission on every request. */
  permissions: Permission[]
  /** False for KJ, SUB_UNIT and PENGADU — refused by every /api/admin/* route. */
  isIntegrityUnit: boolean
  /** False for PENGADU: the portal only. */
  hasConsole: boolean
  sessionExpiresAt: string
}

export const can = (user: CurrentUser, permission: Permission) =>
  user.permissions.includes(permission)

export async function logout(): Promise<void> {
  await api<void>("/auth/logout", { method: "POST" }).catch(() => undefined)
}

/** The signed-in account, or null when there's no valid session. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await api<CurrentUser>("/auth/me")
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
