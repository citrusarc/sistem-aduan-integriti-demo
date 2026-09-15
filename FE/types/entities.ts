/**
 * API response shapes from BE. These describe what the API returns, which is
 * camelCase and narrower than the table — not the Postgres rows themselves.
 * See `BE/src/db/mappers.ts` for the mapping.
 */

import type {
  CaseActionType,
  ComplaintDirectedTo,
  ComplaintStatus,
  GradeLevelGroup,
  InfoClassification,
  IntegrityCategory,
  JmmClassification,
  JmmMeetingStatus,
  JmmOutcome,
  JmmSignatoryCategory,
  JmmSource,
  ProtectionRequestStatus,
  StaffRole,
  Sector,
  SourceChannel,
} from "./enums";

/**
 * What the PUBLIC portal gets back. Deliberately narrow: no case description,
 * no accused party, nothing from the JMM decision (business rule 9). If a
 * portal screen seems to need more than this, that is a privacy decision, not
 * a missing field.
 */
export type PublicComplaint = {
  complaintRefNo: string;
  complaintDate: string | null;
  receivedDateUi: string | null;
  integrityCategory: IntegrityCategory | null;
  /** Never NFA: the public API answers 404 for NFA cases (rule 2). */
  status: ComplaintStatus;
};

/** What the INTERNAL console gets back — the full case record. */
export type AdminComplaint = {
  id: string;
  seqNo: number | null;
  reportMonth: string | null;
  reportYear: number | null;
  directedTo: ComplaintDirectedTo | null;
  complaintRefNo: string;
  complainantId: string | null;
  sourceChannel: SourceChannel | null;
  accusedParticulars: string | null;
  accusedGradeLevel: GradeLevelGroup | null;
  accusedDepartment: string | null;
  infoClassification: InfoClassification | null;
  integrityCategory: IntegrityCategory | null;
  sector: Sector | null;
  caseDescription: string | null;
  complaintDate: string | null;
  receivedDateUi: string | null;
  status: ComplaintStatus;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type JmmSignatory = {
  id: string;
  jmmDecisionId: string;
  staffId: string | null;
  roleCategory: JmmSignatoryCategory;
  roleTitle: string;
  signedAt: string | null;
};

/** Quorum state as computed by the API — business rule 1. */
export type QuorumState = {
  hasChair: boolean;
  memberCount: number;
  fullySigned: boolean;
  /** The only state that counts as finalized; also means the row is locked. */
  finalized: boolean;
};

export type JmmDecision = {
  id: string;
  complaintId: string;
  decisionDate: string;
  agencyFileNo: string | null;
  complaintNoOnForm: string | null;
  summary: string | null;
  jmmSource: JmmSource | null;
  jmmClassification: JmmClassification | null;
  outcome: JmmOutcome;
  remarksFurtherAction: string | null;
  meetingId: string | null;
  createdAt: string;
  signatories: JmmSignatory[];
  quorum: QuorumState;
};

export type CaseAction = {
  id: string;
  complaintId: string;
  jmmDecisionId: string | null;
  psuActionNotes: string | null;
  actionTaken: CaseActionType | null;
  actionDate: string | null;
  responseReceivedDate: string | null;
  feedbackStatus: string | null;
  uiRemarks: string | null;
  fileRefNo: string | null;
  miscNotes: string | null;
  /** KJ / SUB_UNIT staff the action is referred to (§8 decision 5). */
  assignedToStaffId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminComplaintDetail = AdminComplaint & {
  decisions: JmmDecision[];
  caseActions: CaseAction[];
};

/** Returned by POST /admin/complaints/:id/decisions — the decision plus the new status. */
export type RecordedDecision = JmmDecision & {
  complaintStatus: ComplaintStatus;
};

/** GET /admin/decisions — one decision-log row. No signatories; `finalized` instead. */
export type DecisionLogEntry = Omit<JmmDecision, "signatories" | "quorum"> & {
  complaintRefNo: string;
  complaintStatus: ComplaintStatus;
  meetingNo: string | null;
  finalized: boolean;
};

export type JmmMeeting = {
  id: string;
  meetingNo: string;
  meetingDate: string;
  venue: string | null;
  status: JmmMeetingStatus;
  createdAt: string;
  updatedAt: string;
};

/** GET /admin/jmm/meetings */
export type JmmMeetingListEntry = JmmMeeting & {
  itemCount: number;
  decidedCount: number;
};

export type AgendaItem = {
  id: string;
  meetingId: string;
  agendaOrder: number;
  /** A decision has been recorded against this meeting for this complaint. */
  hasDecision: boolean;
  complaint: {
    id: string;
    complaintRefNo: string;
    status: ComplaintStatus;
    integrityCategory: IntegrityCategory | null;
    sector: Sector | null;
    receivedDateUi: string | null;
  };
};

/** GET /admin/jmm/meetings/:id, and every meeting/agenda write. */
export type JmmMeetingDetail = JmmMeeting & {
  items: AgendaItem[];
  decisions: DecisionLogEntry[];
};

export type StatsBucket<T extends string> = { value: T | null; count: number };

/** GET /admin/stats — every enum value present, zero-filled; `null` = not recorded. */
export type ComplaintStats = {
  total: number;
  byStatus: StatsBucket<ComplaintStatus>[];
  byIntegrityCategory: StatsBucket<IntegrityCategory>[];
  bySector: StatsBucket<Sector>[];
  bySourceChannel: StatsBucket<SourceChannel>[];
  /** 'YYYY-MM' ascending; all 12 months when `year` is given. */
  byMonth: { month: string; count: number }[];
};

/**
 * POST /complaints body — the public portal submission (§8 decision 3).
 * Anonymous: `contactEmail` required, `particulars` must be absent. Named:
 * `particulars` required. `contactPhone` is kept for staff to call by hand;
 * the system never sends anything to it (rule 10).
 */
export type PublicComplaintSubmission = {
  caseDescription?: string | null;
  accusedParticulars?: string | null;
  accusedDepartment?: string | null;
  integrityCategory?: IntegrityCategory | null;
  complaintDate?: string | null;
  complainant: {
    isAnonymous: boolean;
    particulars?: string | null;
    gradeLevel?: GradeLevelGroup | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  };
  /** Must be literally true. */
  disclaimerAcknowledged: true;
  duplicateCheckAcknowledged?: boolean;
};

/** GET /complainant/auth/me and POST /complainant/auth/verify. */
export type ComplainantSession = {
  email: string;
  sessionExpiresAt: string;
};

/** What a complainant sees of their own protection request — no review notes. */
export type ComplainantProtectionRequest = {
  id: string;
  complaintRefNo: string;
  reason: string;
  status: ProtectionRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
};

/** GET /admin/protection-requests — KUI only. */
export type AdminProtectionRequest = ComplainantProtectionRequest & {
  complaintId: string;
  complaintStatus: ComplaintStatus;
  requestedByEmail: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  updatedAt: string;
};

/**
 * GET /referrals/actions — what a KJ / SUB_UNIT assignee sees (§8 decision 5).
 * These fields and nothing else. PATCH /referrals/actions/:id accepts only
 * `responseReceivedDate` and `feedbackStatus`.
 */
export type ReferredAction = {
  id: string;
  complaintRefNo: string;
  actionTaken: CaseActionType | null;
  actionDate: string | null;
  fileRefNo: string | null;
  responseReceivedDate: string | null;
  feedbackStatus: string | null;
};

/** GET /admin/staff — ADMIN only. Never a password hash. */
export type StaffAccount = {
  id: string;
  email: string | null;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
  hasPassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
};
