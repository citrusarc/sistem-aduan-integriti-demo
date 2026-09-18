import type { ComplaintStatus } from "../types/enums.js";
import type {
  CaseActionRow,
  ComplainantRow,
  ComplaintRow,
  JmmDecisionRow,
  JmmDecisionSignatoryRow,
  JmmMeetingRow,
  StaffUserRow,
} from "../types/entities.js";
import type { AgendaItemRow, MeetingListRow } from "./queries/jmmMeetings.js";
import type { DecisionLogRow, QuorumState } from "./queries/jmmDecisions.js";
import type { ReferredActionRow } from "./queries/caseActions.js";
import type { StaffAccountRow } from "../auth/store.js";
import type { AttachmentRow } from "./queries/attachments.js";
import type { StatusHistoryRow } from "./queries/complaints.js";
import type {
  AdminProtectionRequestRow,
  ComplainantProtectionRequestRow,
} from "./queries/protectionRequests.js";

/**
 * Row -> API shape. Two mappers exist for complaints on purpose.
 *
 * Business rule 9: `case_actions.ui_remarks`, `case_actions.psu_action_notes`,
 * and every `jmm_decisions` field are internal. `toPublicComplaint` is the only
 * shape a `/api/complaints/*` route may return, and it is built by naming the
 * allowed fields rather than by deleting the disallowed ones — so a column
 * added to the table later cannot leak by default.
 */

export type PublicComplaint = {
  complaintRefNo: string;
  complaintDate: string | null;
  receivedDateUi: string | null;
  integrityCategory: string | null;
  /** Stored `complaints.status` (§8 decision 1). Never NFA here — rule 2 filters those out. */
  status: ComplaintStatus;
};

/**
 * Deliberately narrow. Notably absent, and not to be added without a privacy
 * decision: `accused_particulars`, `accused_department`, `case_description`,
 * and anything identifying the complainant. A complainant tracking their own
 * case needs a status, not the case file.
 */
export function toPublicComplaint(row: ComplaintRow): PublicComplaint {
  return {
    complaintRefNo: row.complaint_ref_no,
    complaintDate: row.complaint_date,
    receivedDateUi: row.received_date_ui,
    integrityCategory: row.integrity_category,
    status: row.status,
  };
}

/**
 * The status timeline (§8 decision 13): which status, and when. Nothing about
 * who changed it or why, so it is as public-safe as the status itself. Only
 * ever built for a complaint that already passed the disclosure check, which
 * excludes every complaint that was ever NFA (rule 2).
 */
export function toStatusTimeline(rows: readonly StatusHistoryRow[]) {
  return rows.map((row) => ({
    status: row.to_status,
    changedAt: row.changed_at,
  }));
}

export function toAdminComplaint(row: ComplaintRow) {
  return {
    id: row.id,
    seqNo: row.seq_no,
    reportMonth: row.report_month,
    reportYear: row.report_year,
    directedTo: row.directed_to,
    complaintRefNo: row.complaint_ref_no,
    complainantId: row.complainant_id,
    sourceChannel: row.source_channel,
    accusedParticulars: row.accused_particulars,
    accusedGradeLevel: row.accused_grade_level,
    accusedDepartment: row.accused_department,
    accusedPosition: row.accused_position,
    accused2Particulars: row.accused2_particulars,
    accused2Department: row.accused2_department,
    accused2Position: row.accused2_position,
    infoClassification: row.info_classification,
    integrityCategory: row.integrity_category,
    sector: row.sector,
    caseDescription: row.case_description,
    complaintDate: row.complaint_date,
    receivedDateUi: row.received_date_ui,
    incidentDate: row.incident_date,
    /** 'HH:MM' — the form has no seconds. */
    incidentTime: row.incident_time?.slice(0, 5) ?? null,
    hasSupportingDocuments: row.has_supporting_documents,
    receivedVia: row.received_via,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    /** §8 decision 16. Details (ref no, reasons) come with the case file. */
    suspectedDuplicateOfId: row.suspected_duplicate_of_complaint_id,
    duplicateScore:
      row.duplicate_score === null ? null : Number(row.duplicate_score),
    duplicateOfId: row.duplicate_of_complaint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Another complaint named on a case file (the original of a repeat). Internal. */
export function toComplaintLink(row: ComplaintRow) {
  return {
    id: row.id,
    complaintRefNo: row.complaint_ref_no,
    status: row.status,
  };
}

/**
 * Internal only (Integrity Unit case file): BUTIR-BUTIR PENGADU from Lampiran 2.
 * Never returned by `/api/complaints/*` or `/api/complainant/*` (rule 9).
 */
export function toComplainant(row: ComplainantRow) {
  return {
    id: row.id,
    isAnonymous: row.is_anonymous,
    complainantCategory: row.complainant_category,
    particulars: row.particulars,
    gradeLevel: row.grade_level,
    icNo: row.ic_no,
    passportNo: row.passport_no,
    age: row.age,
    gender: row.gender,
    race: row.race,
    nationality: row.nationality,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contactPhone2: row.contact_phone_2,
    postalAddress: row.postal_address,
    occupation: row.occupation,
    employer: row.employer,
    createdAt: row.created_at,
  };
}

/**
 * Integrity Unit only (rule 9). `storage_key` and `sha256` stay inside BE:
 * files are fetched by id through the download route.
 */
export function toAttachment(row: AttachmentRow) {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    /** null = the complainant, through the portal. */
    uploadedBy: row.uploaded_by_staff_id
      ? { staffId: row.uploaded_by_staff_id, fullName: row.uploaded_by_name }
      : null,
    createdAt: row.created_at,
  };
}

export function toJmmDecision(row: JmmDecisionRow) {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    decisionDate: row.decision_date,
    agencyFileNo: row.agency_file_no,
    complaintNoOnForm: row.complaint_no_on_form,
    summary: row.summary,
    jmmSource: row.jmm_source,
    jmmClassification: row.jmm_classification,
    outcome: row.outcome,
    remarksFurtherAction: row.remarks_further_action,
    meetingId: row.meeting_id,
    createdAt: row.created_at,
  };
}

/** Internal only (rule 9): a decision with its signature block and quorum. */
export function toDecisionWithSignatures(item: {
  decision: JmmDecisionRow;
  signatories: JmmDecisionSignatoryRow[];
  quorum: QuorumState;
}) {
  return {
    ...toJmmDecision(item.decision),
    signatories: item.signatories.map(toSignatory),
    quorum: item.quorum,
  };
}

export function toSignatory(row: JmmDecisionSignatoryRow) {
  return {
    id: row.id,
    jmmDecisionId: row.jmm_decision_id,
    staffId: row.staff_id,
    roleCategory: row.role_category,
    roleTitle: row.role_title,
    signedAt: row.signed_at,
  };
}

export function toCaseAction(row: CaseActionRow) {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    jmmDecisionId: row.jmm_decision_id,
    psuActionNotes: row.psu_action_notes,
    actionTaken: row.action_taken,
    actionDate: row.action_date,
    responseReceivedDate: row.response_received_date,
    feedbackStatus: row.feedback_status,
    uiRemarks: row.ui_remarks,
    fileRefNo: row.file_ref_no,
    miscNotes: row.misc_notes,
    assignedToStaffId: row.assigned_to_staff_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toStaffUser(row: StaffUserRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    email: row.email,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** A referral target for the Integrity Unit's picker. Allow-listed: no email. */
export function toReferralRecipient(row: StaffUserRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
  };
}

export function toMeeting(row: JmmMeetingRow) {
  return {
    id: row.id,
    meetingNo: row.meeting_no,
    meetingDate: row.meeting_date,
    venue: row.venue,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toMeetingListEntry(row: MeetingListRow) {
  return {
    ...toMeeting(row),
    itemCount: row.item_count,
    /** Complaints on this meeting with at least one decision recorded against it. */
    decidedCount: row.decided_count,
  };
}

export function toAgendaItem(row: AgendaItemRow) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    agendaOrder: row.agenda_order,
    hasDecision: row.decision_count > 0,
    complaint: {
      id: row.complaint_id,
      complaintRefNo: row.complaint_ref_no,
      status: row.complaint_status,
      integrityCategory: row.integrity_category,
      sector: row.sector,
      receivedDateUi: row.received_date_ui,
    },
  };
}

/** Internal only — everything from `jmm_decisions` is rule 9 material. */
export function toDecisionLogEntry(row: DecisionLogRow) {
  return {
    ...toJmmDecision(row),
    complaintRefNo: row.complaint_ref_no,
    complaintStatus: row.complaint_status,
    meetingNo: row.meeting_no,
    finalized: row.finalized,
  };
}

/**
 * What a complainant sees of their own protection request. Allow-listed: no
 * `reviewNotes`, no reviewer (rule 9). The reason is their own words.
 */
export function toComplainantProtectionRequest(
  row: ComplainantProtectionRequestRow,
) {
  return {
    id: row.id,
    complaintRefNo: row.complaint_ref_no,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

/** KUI only. */
export function toAdminProtectionRequest(row: AdminProtectionRequestRow) {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    complaintRefNo: row.complaint_ref_no,
    complaintStatus: row.complaint_status,
    requestedByEmail: row.requested_by_email,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * KJ / SUB_UNIT view of a referred action — §8 decision 5. Allow-listed to the
 * five permitted fields, the complaint's reference number, and the action id
 * they need to update it. Nothing else, ever.
 */
export function toReferredAction(row: ReferredActionRow) {
  return {
    id: row.id,
    complaintRefNo: row.complaint_ref_no,
    actionTaken: row.action_taken,
    actionDate: row.action_date,
    fileRefNo: row.file_ref_no,
    responseReceivedDate: row.response_received_date,
    feedbackStatus: row.feedback_status,
  };
}

/** ADMIN staff management. Never a password hash — only whether one is set. */
export function toStaffAccount(row: StaffAccountRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    hasPassword: row.has_password,
    locked: row.locked,
    /** §8 decision 14: the next login must set a new password. */
    passwordChangeRequired: row.must_change_password || row.password_expired,
    /** §8 decision 15: false only for a self-registration not yet confirmed. */
    emailVerified: row.email_verified,
    lastLoginAt: row.last_login_at,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
  };
}
