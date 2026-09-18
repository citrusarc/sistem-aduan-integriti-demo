/**
 * The transition table on its own: every status × every event, including the
 * refused combinations. No database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transition, type StatusEvent } from "../db/complaintStatus.js";
import { COMPLAINT_STATUS, type ComplaintStatus } from "../types/enums.js";

type Case = { event: StatusEvent; label: string };

const EVENTS: Case[] = [
  { label: "agenda added", event: { type: "AGENDA_ADDED" } },
  {
    label: "agenda removed, no prior decision",
    event: { type: "AGENDA_REMOVED", lastOutcome: null },
  },
  {
    label: "agenda removed, last decision NFA",
    event: { type: "AGENDA_REMOVED", lastOutcome: "NFA" },
  },
  {
    label: "agenda removed, last decision TINDAKAN_SPRM",
    event: { type: "AGENDA_REMOVED", lastOutcome: "TINDAKAN_SPRM" },
  },
  {
    label: "decision NFA",
    event: { type: "DECISION_RECORDED", outcome: "NFA" },
  },
  {
    label: "decision PENUBUHAN_JKSD",
    event: { type: "DECISION_RECORDED", outcome: "PENUBUHAN_JKSD" },
  },
  { label: "case closed", event: { type: "CASE_CLOSED" } },
  { label: "duplicate confirmed", event: { type: "DUPLICATE_CONFIRMED" } },
  { label: "duplicate undone", event: { type: "DUPLICATE_UNDONE" } },
];

/** Expected result per [status][event label]; `null` = refused. */
const EXPECTED: Record<
  ComplaintStatus,
  Record<string, ComplaintStatus | null>
> = {
  BARU: {
    "agenda added": "MENUNGGU_JMM",
    "agenda removed, no prior decision": null,
    "agenda removed, last decision NFA": null,
    "agenda removed, last decision TINDAKAN_SPRM": null,
    "decision NFA": "NFA",
    "decision PENUBUHAN_JKSD": "DALAM_TINDAKAN",
    "case closed": null,
    "duplicate confirmed": "PENDUA",
    "duplicate undone": null,
  },
  MENUNGGU_JMM: {
    "agenda added": null,
    "agenda removed, no prior decision": "BARU",
    "agenda removed, last decision NFA": "NFA",
    "agenda removed, last decision TINDAKAN_SPRM": "DALAM_TINDAKAN",
    "decision NFA": "NFA",
    "decision PENUBUHAN_JKSD": "DALAM_TINDAKAN",
    "case closed": null,
    "duplicate confirmed": null,
    "duplicate undone": null,
  },
  DALAM_TINDAKAN: {
    "agenda added": "MENUNGGU_JMM",
    "agenda removed, no prior decision": null,
    "agenda removed, last decision NFA": null,
    "agenda removed, last decision TINDAKAN_SPRM": null,
    "decision NFA": "NFA",
    "decision PENUBUHAN_JKSD": "DALAM_TINDAKAN",
    "case closed": "SELESAI",
    "duplicate confirmed": null,
    "duplicate undone": null,
  },
  SELESAI: {
    "agenda added": null,
    "agenda removed, no prior decision": null,
    "agenda removed, last decision NFA": null,
    "agenda removed, last decision TINDAKAN_SPRM": null,
    "decision NFA": null,
    "decision PENUBUHAN_JKSD": null,
    "case closed": null,
    "duplicate confirmed": null,
    "duplicate undone": null,
  },
  NFA: {
    "agenda added": "MENUNGGU_JMM",
    "agenda removed, no prior decision": null,
    "agenda removed, last decision NFA": null,
    "agenda removed, last decision TINDAKAN_SPRM": null,
    "decision NFA": "NFA",
    "decision PENUBUHAN_JKSD": "DALAM_TINDAKAN",
    "case closed": null,
    "duplicate confirmed": null,
    "duplicate undone": null,
  },
  // §8 decision 16: nothing moves a repeat but undoing it.
  PENDUA: {
    "agenda added": null,
    "agenda removed, no prior decision": null,
    "agenda removed, last decision NFA": null,
    "agenda removed, last decision TINDAKAN_SPRM": null,
    "decision NFA": null,
    "decision PENUBUHAN_JKSD": null,
    "case closed": null,
    "duplicate confirmed": null,
    "duplicate undone": "BARU",
  },
};

describe("complaint status transition table", () => {
  for (const from of COMPLAINT_STATUS) {
    for (const { label, event } of EVENTS) {
      const expected = EXPECTED[from][label];
      it(`${from} + ${label} -> ${expected ?? "refused"}`, () => {
        const result = transition(from, event);
        if (expected === null) {
          assert.equal(result.ok, false);
          assert.ok(!result.ok && result.reason.length > 0);
        } else {
          assert.deepEqual(result, { ok: true, to: expected });
        }
      });
    }
  }

  it("covers every status", () => {
    assert.deepEqual(
      Object.keys(EXPECTED).sort(),
      [...COMPLAINT_STATUS].sort(),
    );
  });
});
