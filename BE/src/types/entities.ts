/**
 * TypeScript types matching each table's columns in `db/schema.sql`.
 *
 * Column names stay snake_case here — these describe raw rows as `pg` returns
 * them. Mapping to the camelCase API shape happens in `src/db/mappers.ts`.
 *
 * BIGINT columns come back from `pg` as strings (see `src/db/client.ts` for
 * why we leave that alone), so every id is typed `string`. DATE columns are
 * likewise kept as raw 'YYYY-MM-DD' strings to dodge timezone drift; only
 * TIMESTAMPTZ columns become `Date`.
 */

import type {
  CaseActionType,
  ComplainantCategory,
  ComplaintDirectedTo,
  Gender,
  Nationality,
  GradeLevelGroup,
  InfoClassification,
  ComplaintStatus,
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
} from "./enums.js";

/**
 * Deliberately excludes `password_hash` and the lockout counters. Those are
 * read only by `src/auth/*`, through its own narrow queries, so no general
 * staff query can ever carry a hash into an API response.
 */
export type StaffUserRow = {
  id: string;
  full_name: string;
  role: StaffRole;
  email: string | null;
  is_active: boolean;
  created_at: Date;
};

export type ComplainantRow = {
  id: string;
  particulars: string | null;
  grade_level: GradeLevelGroup | null;
  /** Migration 006. Required when `is_anonymous`; the only return channel. */
  contact_email: string | null;
  /** For staff to call manually only — nothing sends to it (rule 10). */
  contact_phone: string | null;
  /** When true, `particulars` is always NULL (DB check constraint). */
  is_anonymous: boolean;
  /**
   * Migration 010 — BORANG ADUAN/ MAKLUMAT (Lampiran 2). All optional, all
   * internal. When `is_anonymous`, everything from `ic_no` to `employer` except
   * `contact_phone_2` is NULL (chk_anonymous_identity).
   */
  complainant_category: ComplainantCategory | null;
  ic_no: string | null;
  passport_no: string | null;
  age: number | null;
  gender: Gender | null;
  race: string | null;
  nationality: Nationality | null;
  /** For staff to call manually only — nothing sends to it (rule 10). */
  contact_phone_2: string | null;
  postal_address: string | null;
  occupation: string | null;
  employer: string | null;
  created_at: Date;
};

export type ComplaintRow = {
  id: string;
  seq_no: number | null;
  report_month: string | null;
  report_year: number | null;
  directed_to: ComplaintDirectedTo | null;
  complaint_ref_no: string;
  complainant_id: string | null;
  source_channel: SourceChannel | null;
  accused_particulars: string | null;
  accused_grade_level: GradeLevelGroup | null;
  accused_department: string | null;
  /** Migration 010 — Lampiran 2 JAWATAN (1), and the second accused person. */
  accused_position: string | null;
  accused2_particulars: string | null;
  accused2_department: string | null;
  accused2_position: string | null;
  info_classification: InfoClassification | null;
  integrity_category: IntegrityCategory | null;
  sector: Sector | null;
  case_description: string | null;
  complaint_date: string | null;
  received_date_ui: string | null;
  /** Migration 010 — TARIKH / MASA KEJADIAN. Time is 'HH:MM:SS' as pg returns it. */
  incident_date: string | null;
  incident_time: string | null;
  /** Migration 010 — DOKUMEN SOKONGAN ADA/ TIADA; NULL = not stated. */
  has_supporting_documents: boolean | null;
  /** Migration 010 — Lampiran 2's own channel list, not `source_channel`. */
  received_via: ReceivedVia | null;
  /** Migration 005. Written by the API on each transition. */
  status: ComplaintStatus;
  status_changed_at: Date;
  /** Migration 006. Set by portal submissions; NULL for staff-registered rows. */
  disclaimer_acknowledged_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type JmmDecisionRow = {
  id: string;
  complaint_id: string;
  decision_date: string;
  agency_file_no: string | null;
  complaint_no_on_form: string | null;
  summary: string | null;
  jmm_source: JmmSource | null;
  jmm_classification: JmmClassification | null;
  outcome: JmmOutcome;
  remarks_further_action: string | null;
  /** Migration 004. The meeting the decision was made at, when recorded. */
  meeting_id: string | null;
  created_at: Date;
};

export type JmmDecisionSignatoryRow = {
  id: string;
  jmm_decision_id: string;
  staff_id: string | null;
  role_category: JmmSignatoryCategory;
  role_title: string;
  signed_at: Date | null;
};

export type CaseActionRow = {
  id: string;
  complaint_id: string;
  jmm_decision_id: string | null;
  psu_action_notes: string | null;
  action_taken: CaseActionType | null;
  action_date: string | null;
  response_received_date: string | null;
  feedback_status: string | null;
  ui_remarks: string | null;
  file_ref_no: string | null;
  misc_notes: string | null;
  /** Migration 008. The KJ / SUB_UNIT staff member the action is referred to. */
  assigned_to_staff_id: string | null;
  created_at: Date;
  updated_at: Date;
};

/** Migration 004. */
export type JmmMeetingRow = {
  id: string;
  meeting_no: string;
  meeting_date: string;
  venue: string | null;
  status: JmmMeetingStatus;
  created_at: Date;
  updated_at: Date;
};

/** Migration 004. A complaint may sit on only one DIJADUALKAN meeting at a time. */
export type JmmMeetingItemRow = {
  id: string;
  meeting_id: string;
  complaint_id: string;
  agenda_order: number;
  created_at: Date;
};

/**
 * Migration 009. `review_notes` is internal (rule 9) — never map it into a
 * public or complainant-facing shape.
 */
export type ProtectionRequestRow = {
  id: string;
  complaint_id: string;
  requested_by_email: string;
  reason: string;
  status: ProtectionRequestStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  created_at: Date;
  updated_at: Date;
};
