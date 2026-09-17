import type {
  AdminComplaint,
  AdminComplaintDetail,
  AdminProtectionRequest,
  CaseAction,
  ComplainantProtectionRequest,
  ComplainantSession,
  ComplaintStats,
  DecisionLogEntry,
  DecisionSignatureState,
  HealthStatus,
  JmmDecision,
  JmmMeetingDetail,
  JmmMeetingListEntry,
  OtpRequested,
  PublicComplaint,
  PublicComplaintSubmission,
  RecordedDecision,
  ReferralRecipient,
  ReferredAction,
  SignSlotResult,
  StaffAccount,
} from "@/types/entities"
import type { StaffRole } from "@/types/enums"
import type {
  AddAgendaItemBody,
  CaseActionBody,
  ComplaintFilters,
  CreateComplaintBody,
  CreateDecisionBody,
  CreateMeetingBody,
  CreateProtectionRequestBody,
  CreateStaffBody,
  DecisionLogFilters,
  DuplicateCheckBody,
  MeetingFilters,
  ProtectionRequestFilters,
  ReviewProtectionRequestBody,
  SignSlotBody,
  StatsFilters,
  UpdateComplaintBody,
  UpdateMeetingBody,
  UpdateReferredActionBody,
} from "@/types/requests"

/**
 * Browser-side client for BE. Every call sends cookies (`credentials:
 * "include"`): staff auth is `aduan_sid`, complainant auth is `aduan_csid`,
 * both httpOnly and scoped to BE's `/api` path — so Next's own server never
 * sees them, and all authenticated calls happen in the browser.
 *
 * Nothing here decides access. BE enforces every rule; this only calls it.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"

type ApiErrorBody = { error?: string } & Record<string, unknown>

/**
 * Carries the HTTP status and the parsed body, so callers can tell 401 (not
 * signed in) from 403 (wrong role), 404, 409 (state refuses the change) and
 * 422 (invalid input) — and read extra fields such as duplicate candidates.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: ApiErrorBody | null = null
  ) {
    super(message)
  }
}

/**
 * The request never got an HTTP answer: BE isn't running, the network is down,
 * or the browser blocked it (CORS). Kept distinct from other errors so a
 * coding bug is never reported to the user as "server unreachable".
 */
export class NetworkError extends Error {
  constructor(
    readonly url: string,
    readonly cause: unknown
  ) {
    super("Tidak dapat menghubungi pelayan")
  }
}

export type SessionScope = "staff" | "complainant"

/**
 * Dispatched on `window` when a signed-in call comes back 401, so the matching
 * session provider can drop its state and send the user to sign in. Staff and
 * complainant sessions are separate; the event says which one expired.
 */
export const UNAUTHORIZED_EVENT = "aduan:unauthorized"
export type UnauthorizedEventDetail = { scope: SessionScope }

function scopeOf(path: string): SessionScope | null {
  if (path.startsWith("/complainant/")) return "complainant"
  if (/^\/(admin|referrals|auth)\//.test(path)) return "staff"
  return null
}

/** A 401 from these means "wrong credentials", not "session expired". */
const CREDENTIAL_ENDPOINTS = new Set([
  "/auth/login",
  // A wrong *current* password on change is 401 too; the session is fine.
  "/auth/password",
  "/complainant/auth/verify",
])

type Query = Record<string, string | number | boolean | null | undefined>

export type ApiInit = Omit<RequestInit, "body"> & {
  query?: Query
  /** JSON-encoded as the request body. */
  json?: unknown
}

function buildUrl(path: string, query?: Query): string {
  const url = `${API_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

/**
 * Unwraps BE's `{ data }` envelope and turns `{ error }` responses into
 * ApiRequestError.
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { query, json, headers, ...rest } = init
  const url = buildUrl(path, query)
  let res: Response
  try {
    res = await fetch(url, {
      // Without this the browser neither sends nor stores the session cookies.
      credentials: "include",
      ...rest,
      headers: {
        ...(json !== undefined && { "Content-Type": "application/json" }),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    })
  } catch (err) {
    // An aborted request is the caller's decision, not a network failure.
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new NetworkError(url, err)
  }

  // 204 No Content (logout) has no body.
  if (res.status === 204) return undefined as T

  const body = (await res.json().catch(() => null)) as ApiErrorBody | null

  if (!res.ok) {
    const scope = scopeOf(path)
    if (
      res.status === 401 &&
      scope &&
      !CREDENTIAL_ENDPOINTS.has(path) &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent<UnauthorizedEventDetail>(UNAUTHORIZED_EVENT, {
          detail: { scope },
        })
      )
    }
    throw new ApiRequestError(res.status, body?.error ?? res.statusText, body)
  }

  return (body as { data: T } | null)?.data as T
}

/** Staff duplicate check refusal (409 on POST /admin/complaints): the candidates. */
export function duplicateCandidatesOf(err: unknown): AdminComplaint[] | null {
  if (!(err instanceof ApiRequestError) || err.status !== 409) return null
  const data = err.body?.data
  return Array.isArray(data) ? (data as AdminComplaint[]) : null
}

/** Public duplicate check refusal (409 on POST /complaints): only a count. */
export function possibleDuplicateCountOf(err: unknown): number | null {
  if (!(err instanceof ApiRequestError) || err.status !== 409) return null
  const count = err.body?.possibleDuplicateCount
  return typeof count === "number" ? count : null
}

const ref = (refNo: string) => encodeURIComponent(refNo)

// ─── Public portal ───────────────────────────────────────────────────────────

export const publicApi = {
  health: () => api<HealthStatus>("/health"),
  submitComplaint: (body: PublicComplaintSubmission) =>
    api<PublicComplaint>("/complaints", { method: "POST", json: body }),
  /** 404 for unknown and NFA reference numbers alike (rule 2). */
  trackComplaint: (refNo: string) =>
    api<PublicComplaint>(`/complaints/${ref(refNo)}`),
}

// ─── Complainant (email OTP, cookie aduan_csid) ──────────────────────────────

export const complainantApi = {
  requestCode: (email: string) =>
    api<OtpRequested>("/complainant/auth/request-code", {
      method: "POST",
      json: { email },
    }),
  verify: (email: string, code: string) =>
    api<ComplainantSession>("/complainant/auth/verify", {
      method: "POST",
      json: { email, code },
    }),
  logout: () => api<void>("/complainant/auth/logout", { method: "POST" }),
  me: () => api<ComplainantSession>("/complainant/auth/me"),
  complaints: () => api<PublicComplaint[]>("/complainant/complaints"),
  complaint: (refNo: string) =>
    api<PublicComplaint>(`/complainant/complaints/${ref(refNo)}`),
  protectionRequests: () =>
    api<ComplainantProtectionRequest[]>("/complainant/protection-requests"),
  createProtectionRequest: (body: CreateProtectionRequestBody) =>
    api<ComplainantProtectionRequest>("/complainant/protection-requests", {
      method: "POST",
      json: body,
    }),
}

// ─── Integrity Unit console (/api/admin/*) ───────────────────────────────────

export const adminApi = {
  complaints: {
    list: (filters: ComplaintFilters = {}) =>
      api<AdminComplaint[]>("/admin/complaints", { query: filters }),
    get: (id: string) => api<AdminComplaintDetail>(`/admin/complaints/${id}`),
    /** 409 with candidates unless `duplicateCheckAcknowledged` — see duplicateCandidatesOf. */
    create: (body: CreateComplaintBody) =>
      api<AdminComplaint>("/admin/complaints", { method: "POST", json: body }),
    update: (id: string, body: UpdateComplaintBody) =>
      api<AdminComplaint>(`/admin/complaints/${id}`, {
        method: "PATCH",
        json: body,
      }),
    duplicateCandidates: (body: DuplicateCheckBody) =>
      api<AdminComplaint[]>("/admin/complaints/duplicate-candidates", {
        method: "POST",
        json: body,
      }),
    /** DALAM_TINDAKAN -> SELESAI; 409 from any other status. */
    close: (id: string) =>
      api<AdminComplaint>(`/admin/complaints/${id}/close`, { method: "POST" }),
    decisions: (id: string) =>
      api<JmmDecision[]>(`/admin/complaints/${id}/decisions`),
    recordDecision: (id: string, body: CreateDecisionBody) =>
      api<RecordedDecision>(`/admin/complaints/${id}/decisions`, {
        method: "POST",
        json: body,
      }),
    caseActions: (id: string) =>
      api<CaseAction[]>(`/admin/complaints/${id}/case-actions`),
    addCaseAction: (id: string, body: CaseActionBody) =>
      api<CaseAction>(`/admin/complaints/${id}/case-actions`, {
        method: "POST",
        json: body,
      }),
  },

  decisions: {
    log: (filters: DecisionLogFilters = {}) =>
      api<DecisionLogEntry[]>("/admin/decisions", { query: filters }),
    get: (id: string) => api<DecisionSignatureState>(`/admin/decisions/${id}`),
    sign: (id: string, body: SignSlotBody) =>
      api<SignSlotResult>(`/admin/decisions/${id}/sign`, {
        method: "POST",
        json: body,
      }),
    /** `null` unlinks. 409 once the decision is fully signed. */
    setMeeting: (id: string, meetingId: string | null) =>
      api<JmmDecision>(`/admin/decisions/${id}/meeting`, {
        method: "PUT",
        json: { meetingId },
      }),
  },

  caseActions: {
    /** Active and inactive KJ / SUB_UNIT accounts; only active ones can be assigned. */
    assignees: () => api<ReferralRecipient[]>("/admin/case-actions/assignees"),
    update: (id: string, body: CaseActionBody) =>
      api<CaseAction>(`/admin/case-actions/${id}`, {
        method: "PATCH",
        json: body,
      }),
    /** Refer to an active KJ / SUB_UNIT account; `null` clears. */
    setAssignee: (id: string, staffId: string | null) =>
      api<CaseAction>(`/admin/case-actions/${id}/assignee`, {
        method: "PUT",
        json: { staffId },
      }),
  },

  meetings: {
    list: (filters: MeetingFilters = {}) =>
      api<JmmMeetingListEntry[]>("/admin/jmm/meetings", { query: filters }),
    get: (id: string) => api<JmmMeetingDetail>(`/admin/jmm/meetings/${id}`),
    create: (body: CreateMeetingBody) =>
      api<JmmMeetingDetail>("/admin/jmm/meetings", {
        method: "POST",
        json: body,
      }),
    update: (id: string, body: UpdateMeetingBody) =>
      api<JmmMeetingDetail>(`/admin/jmm/meetings/${id}`, {
        method: "PATCH",
        json: body,
      }),
    /** 409 while any agenda item has no decision. */
    close: (id: string) =>
      api<JmmMeetingDetail>(`/admin/jmm/meetings/${id}/close`, {
        method: "POST",
      }),
    addItem: (id: string, body: AddAgendaItemBody) =>
      api<JmmMeetingDetail>(`/admin/jmm/meetings/${id}/items`, {
        method: "POST",
        json: body,
      }),
    removeItem: (id: string, complaintId: string) =>
      api<JmmMeetingDetail>(`/admin/jmm/meetings/${id}/items/${complaintId}`, {
        method: "DELETE",
      }),
    reorder: (id: string, complaintIds: string[]) =>
      api<JmmMeetingDetail>(`/admin/jmm/meetings/${id}/items/order`, {
        method: "PUT",
        json: { complaintIds },
      }),
  },

  stats: {
    get: (filters: StatsFilters = {}) =>
      api<ComplaintStats>("/admin/stats", { query: filters }),
  },

  /** KUI only. */
  protectionRequests: {
    list: (filters: ProtectionRequestFilters = {}) =>
      api<AdminProtectionRequest[]>("/admin/protection-requests", {
        query: filters,
      }),
    get: (id: string) =>
      api<AdminProtectionRequest>(`/admin/protection-requests/${id}`),
    review: (id: string, body: ReviewProtectionRequestBody) =>
      api<AdminProtectionRequest>(`/admin/protection-requests/${id}/review`, {
        method: "POST",
        json: body,
      }),
  },

  /** ADMIN only. */
  staff: {
    list: () => api<StaffAccount[]>("/admin/staff"),
    create: (body: CreateStaffBody) =>
      api<StaffAccount>("/admin/staff", { method: "POST", json: body }),
    setRole: (id: string, role: StaffRole) =>
      api<StaffAccount>(`/admin/staff/${id}/role`, {
        method: "PUT",
        json: { role },
      }),
    resetPassword: (id: string, password: string) =>
      api<StaffAccount>(`/admin/staff/${id}/password`, {
        method: "POST",
        json: { password },
      }),
    deactivate: (id: string) =>
      api<StaffAccount>(`/admin/staff/${id}/deactivate`, { method: "POST" }),
    activate: (id: string) =>
      api<StaffAccount>(`/admin/staff/${id}/activate`, { method: "POST" }),
  },
}

// ─── KJ / SUB_UNIT referrals (/api/referrals) ────────────────────────────────

export const referralsApi = {
  actions: () => api<ReferredAction[]>("/referrals/actions"),
  updateAction: (id: string, body: UpdateReferredActionBody) =>
    api<ReferredAction>(`/referrals/actions/${id}`, {
      method: "PATCH",
      json: body,
    }),
}
