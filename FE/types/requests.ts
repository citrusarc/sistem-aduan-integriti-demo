/**
 * Request bodies and query filters for BE endpoints. Response shapes live in
 * `entities.ts`. Mirrors the zod schemas in `BE/src/validation/*` — when one
 * changes, change the other in the same PR.
 *
 * Dates are 'YYYY-MM-DD' strings; ids are strings.
 */

import type {
  CaseActionType,
  ComplainantCategory,
  ComplaintDirectedTo,
  ComplaintStatus,
  Gender,
  Nationality,
  GradeLevelGroup,
  InfoClassification,
  IntegrityCategory,
  JmmClassification,
  JmmMeetingStatus,
  JmmOutcome,
  JmmSignatoryCategory,
  JmmSource,
  ProtectionRequestStatus,
  ReceivedVia,
  Sector,
  SourceChannel,
  StaffRole,
} from "./enums"

export type Pagination = {
  limit?: number
  offset?: number
}

export type DateRange = {
  from?: string
  to?: string
}

// ─── Complaints (Integrity Unit) ─────────────────────────────────────────────

export type ComplaintFilters = Pagination & {
  /** Period, on the received date (else complaint date) — same as stats. */
  from?: string
  to?: string
  status?: ComplaintStatus
  reportYear?: number
  reportMonth?: string
  integrityCategory?: IntegrityCategory
  sourceChannel?: SourceChannel
  sector?: Sector
}

type ComplaintFields = {
  reportMonth?: string | null
  reportYear?: number | null
  directedTo?: ComplaintDirectedTo | null
  sourceChannel?: SourceChannel | null
  accusedParticulars?: string | null
  accusedGradeLevel?: GradeLevelGroup | null
  accusedDepartment?: string | null
  accusedPosition?: string | null
  accused2Particulars?: string | null
  accused2Department?: string | null
  accused2Position?: string | null
  infoClassification?: InfoClassification | null
  integrityCategory?: IntegrityCategory | null
  sector?: Sector | null
  caseDescription?: string | null
  complaintDate?: string | null
  receivedDateUi?: string | null
  incidentDate?: string | null
  /** 'HH:MM'. */
  incidentTime?: string | null
  hasSupportingDocuments?: boolean | null
  receivedVia?: ReceivedVia | null
}

export type ComplainantInput = {
  isAnonymous?: boolean
  particulars?: string | null
  gradeLevel?: GradeLevelGroup | null
  contactEmail?: string | null
  /** For staff to call manually. Nothing is ever sent to it (rule 10). */
  contactPhone?: string | null
  // Lampiran 2. Anonymous: identifying fields are refused (422).
  complainantCategory?: ComplainantCategory | null
  icNo?: string | null
  passportNo?: string | null
  age?: number | null
  gender?: Gender | null
  race?: string | null
  nationality?: Nationality | null
  contactPhone2?: string | null
  postalAddress?: string | null
  occupation?: string | null
  employer?: string | null
}

/** POST /admin/complaints. 409 carries duplicate candidates unless acknowledged. */
export type CreateComplaintBody = ComplaintFields & {
  complainant?: ComplainantInput | null
  duplicateCheckAcknowledged?: boolean
}

/** PATCH /admin/complaints/:id. No `complaintRefNo`, no `status` — both refused. */
export type UpdateComplaintBody = ComplaintFields

export type DuplicateCheckBody = {
  accusedParticulars?: string | null
  accusedDepartment?: string | null
  accused2Particulars?: string | null
  accused2Department?: string | null
  caseDescription?: string | null
  withinDays?: number
}

// ─── JMM decisions ───────────────────────────────────────────────────────────

export type CreateDecisionBody = {
  decisionDate: string
  agencyFileNo?: string | null
  complaintNoOnForm?: string | null
  summary?: string | null
  jmmSource?: JmmSource | null
  jmmClassification?: JmmClassification | null
  outcome: JmmOutcome
  remarksFurtherAction?: string | null
  /** Required while the complaint is on an open meeting's agenda. */
  meetingId?: string | null
  /** Must include a PENGERUSI and at least one AHLI (rule 1). */
  signatories: {
    staffId?: string | null
    roleCategory: JmmSignatoryCategory
    roleTitle: string
    signedAt?: string | null
  }[]
}

export type SignSlotBody = {
  signatoryId: string
  signedAt?: string
}

export type DecisionLogFilters = Pagination &
  DateRange & {
    outcome?: JmmOutcome
    meetingId?: string
  }

// ─── Case actions ────────────────────────────────────────────────────────────

/** Rule 4: `actionTaken` is the masterlist vocabulary, never a JMM outcome. */
export type CaseActionBody = {
  jmmDecisionId?: string | null
  psuActionNotes?: string | null
  actionTaken?: CaseActionType | null
  actionDate?: string | null
  responseReceivedDate?: string | null
  feedbackStatus?: string | null
  uiRemarks?: string | null
  fileRefNo?: string | null
  miscNotes?: string | null
}

/** PATCH /referrals/actions/:id — these two fields only; anything else is 422. */
export type UpdateReferredActionBody = {
  responseReceivedDate?: string | null
  feedbackStatus?: string | null
}

// ─── Meetings ────────────────────────────────────────────────────────────────

export type MeetingFilters = Pagination &
  DateRange & {
    status?: JmmMeetingStatus
  }

export type CreateMeetingBody = {
  meetingNo: string
  meetingDate: string
  venue?: string | null
}

/** Details only; status changes through POST /:id/close. */
export type UpdateMeetingBody = Partial<CreateMeetingBody>

export type AddAgendaItemBody = {
  complaintId: string
  /** 1-based; omitted, the item goes last. */
  agendaOrder?: number
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export type StatsFilters = {
  year?: number
  /** 1–12; requires `year`. */
  month?: number
}

// ─── Protection requests ─────────────────────────────────────────────────────

export type ProtectionRequestFilters = Pagination & {
  status?: ProtectionRequestStatus
}

export type ReviewProtectionRequestBody = {
  status: Exclude<ProtectionRequestStatus, "DITERIMA">
  reviewNotes?: string | null
}

export type CreateProtectionRequestBody = {
  complaintRefNo: string
  reason: string
}

// ─── Staff management (ADMIN) ────────────────────────────────────────────────

export type CreateStaffBody = {
  email: string
  fullName: string
  role: StaffRole
  /** 12+ characters. */
  password: string
}
