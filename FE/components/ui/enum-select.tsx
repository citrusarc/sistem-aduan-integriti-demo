"use client"

import * as React from "react"

import { Select, type SelectProps } from "@/components/ui/select"
import {
  CASE_ACTION_TYPE,
  COMPLAINANT_CATEGORY,
  COMPLAINT_DIRECTED_TO,
  COMPLAINT_STATUS,
  GENDER,
  GRADE_LEVEL_GROUP,
  INFO_CLASSIFICATION,
  INTEGRITY_CATEGORY,
  JMM_CLASSIFICATION,
  JMM_MEETING_STATUS,
  JMM_OUTCOME,
  JMM_SIGNATORY_CATEGORY,
  JMM_SOURCE,
  PROTECTION_REQUEST_STATUS,
  RECEIVED_VIA,
  SECTOR,
  SOURCE_CHANNEL,
  STAFF_ROLE,
} from "@/types/enums"

/**
 * One select per Postgres ENUM, built from the label maps in `types/enums.ts`
 * — so the options are exactly the values BE accepts, in the same order, with
 * Malay labels. Never hand-type an option list for an enum.
 */

type EnumSelectProps<M extends Record<string, string>> = Omit<
  SelectProps<Extract<keyof M, string>>,
  "options"
> & {
  labels: M
  /** Restrict to a subset, e.g. the two review decisions. Keeps enum order. */
  only?: readonly Extract<keyof M, string>[]
}

function EnumSelect<M extends Record<string, string>>({
  labels,
  only,
  ...props
}: EnumSelectProps<M>) {
  const options = React.useMemo(
    () =>
      (Object.entries(labels) as [Extract<keyof M, string>, string][])
        .filter(([value]) => !only || only.includes(value))
        .map(([value, label]) => ({ value, label })),
    [labels, only]
  )
  return <Select options={options} {...props} />
}

type Props<M extends Record<string, string>> = Omit<
  EnumSelectProps<M>,
  "labels"
>

function bind<M extends Record<string, string>>(labels: M, name: string) {
  function BoundEnumSelect(props: Props<M>) {
    return <EnumSelect labels={labels} {...props} />
  }
  BoundEnumSelect.displayName = name
  return BoundEnumSelect
}

// Masterlist (Month_Year sheet)
export const GradeLevelSelect = bind(GRADE_LEVEL_GROUP, "GradeLevelSelect")
export const DirectedToSelect = bind(COMPLAINT_DIRECTED_TO, "DirectedToSelect")
export const SourceChannelSelect = bind(SOURCE_CHANNEL, "SourceChannelSelect")
export const InfoClassificationSelect = bind(
  INFO_CLASSIFICATION,
  "InfoClassificationSelect"
)
export const IntegrityCategorySelect = bind(
  INTEGRITY_CATEGORY,
  "IntegrityCategorySelect"
)
export const SectorSelect = bind(SECTOR, "SectorSelect")
/** Rule 4: the masterlist's follow-up vocabulary — not JMM outcomes. */
export const CaseActionTypeSelect = bind(
  CASE_ACTION_TYPE,
  "CaseActionTypeSelect"
)

// BORANG JMM
export const JmmSourceSelect = bind(JMM_SOURCE, "JmmSourceSelect")
export const JmmClassificationSelect = bind(
  JMM_CLASSIFICATION,
  "JmmClassificationSelect"
)
/** Rule 3: exactly the six outcomes. */
export const JmmOutcomeSelect = bind(JMM_OUTCOME, "JmmOutcomeSelect")
export const JmmSignatoryCategorySelect = bind(
  JMM_SIGNATORY_CATEGORY,
  "JmmSignatoryCategorySelect"
)

// BORANG ADUAN/ MAKLUMAT (Lampiran 2)
export const ComplainantCategorySelect = bind(
  COMPLAINANT_CATEGORY,
  "ComplainantCategorySelect"
)
export const GenderSelect = bind(GENDER, "GenderSelect")
export const ReceivedViaSelect = bind(RECEIVED_VIA, "ReceivedViaSelect")

// System
export const StaffRoleSelect = bind(STAFF_ROLE, "StaffRoleSelect")
export const ComplaintStatusSelect = bind(
  COMPLAINT_STATUS,
  "ComplaintStatusSelect"
)
export const MeetingStatusSelect = bind(
  JMM_MEETING_STATUS,
  "MeetingStatusSelect"
)
export const ProtectionRequestStatusSelect = bind(
  PROTECTION_REQUEST_STATUS,
  "ProtectionRequestStatusSelect"
)

export { EnumSelect }
