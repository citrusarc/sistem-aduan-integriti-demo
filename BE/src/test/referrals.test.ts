/**
 * §8 decision 5 over the real HTTP API: referring case actions to KJ /
 * SUB_UNIT staff, what those staff can see and change, and that they stay
 * locked out of /api/admin/*.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  startTestContext,
  TEST_PASSWORD,
  type ApiResponse,
  type Client,
  type TestContext,
} from "./harness.js";

const ALLOWED_KEYS = [
  "actionDate",
  "actionTaken",
  "complaintRefNo",
  "feedbackStatus",
  "fileRefNo",
  "id",
  "responseReceivedDate",
];

/** Strings planted in every forbidden field; none may ever reach a KJ response. */
const SECRETS = {
  caseDescription: "PERIHAL-KES-RAHSIA",
  accusedParticulars: "PENAMA-RAHSIA",
  accusedDepartment: "JABATAN-PENAMA-RAHSIA",
  decisionSummary: "RINGKASAN-JMM-RAHSIA",
  decisionRemarks: "ULASAN-JMM-RAHSIA",
  psuActionNotes: "NOTA-PSU-RAHSIA",
  uiRemarks: "CATATAN-UI-RAHSIA",
  miscNotes: "LAIN-LAIN-RAHSIA",
};

type Referred = {
  id: string;
  complaintRefNo: string;
  feedbackStatus: string | null;
  responseReceivedDate: string | null;
};
type CaseAction = { id: string; assignedToStaffId: string | null };
type Staff = { id: string; email: string; role: string };

let ctx: TestContext;
let kui: Client;
let kj: Client;
let subUnit: Client;
let staffIds: Record<string, string>;
let seq = 0;

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

async function newDecidedComplaint(
  outcome = "TINDAKAN_BAHAGIAN_JABATAN_AGENSI",
) {
  seq += 1;
  const complaint = expectStatus<{ id: string; complaintRefNo: string }>(
    await kui.post("/admin/complaints", {
      caseDescription: `${SECRETS.caseDescription} ${seq} ${"q".repeat(seq)}`,
      accusedParticulars: `${SECRETS.accusedParticulars} ${seq}`,
      accusedDepartment: SECRETS.accusedDepartment,
      duplicateCheckAcknowledged: true,
    }),
    201,
  );
  await decide(complaint.id, outcome);
  return complaint;
}

async function decide(complaintId: string, outcome: string) {
  expectStatus(
    await kui.post(`/admin/complaints/${complaintId}/decisions`, {
      decisionDate: "2026-04-01",
      outcome,
      summary: SECRETS.decisionSummary,
      remarksFurtherAction: SECRETS.decisionRemarks,
      signatories: [
        { roleCategory: "PENGERUSI", roleTitle: "KUI (Pengerusi)" },
        { roleCategory: "AHLI", roleTitle: "PI (Ahli 1)" },
      ],
    }),
    201,
  );
}

async function newAction(complaintId: string, fileRefNo: string) {
  return expectStatus<CaseAction>(
    await kui.post(`/admin/complaints/${complaintId}/case-actions`, {
      actionTaken: "RUJUK_BAHAGIAN",
      actionDate: "2026-04-10",
      fileRefNo,
      feedbackStatus: "Menunggu maklum balas",
      psuActionNotes: SECRETS.psuActionNotes,
      uiRemarks: SECRETS.uiRemarks,
      miscNotes: SECRETS.miscNotes,
    }),
    201,
  );
}

const assign = (actionId: string, staffId: string | null) =>
  kui.put<CaseAction>(`/admin/case-actions/${actionId}/assignee`, { staffId });

before(async () => {
  ctx = await startTestContext();
  kui = await ctx.as("KUI");
  kj = await ctx.as("KJ");
  subUnit = await ctx.as("SUB_UNIT");
  const { rows } = await ctx.sql<{ id: string; role: string }>(
    "SELECT id, role::text FROM staff_users",
  );
  staffIds = Object.fromEntries(rows.map((r) => [r.role, r.id]));
});

after(async () => {
  await ctx.close();
});

describe("referring actions (Integrity Unit)", () => {
  it("assigns only to active KJ / SUB_UNIT accounts, never on an NFA complaint, and only Integrity Unit staff may assign", async () => {
    const complaint = await newDecidedComplaint();
    const action = await newAction(complaint.id, "FAIL/ASSIGN/1");

    const assigned = expectStatus(await assign(action.id, staffIds.KJ!), 200);
    assert.equal(assigned.assignedToStaffId, staffIds.KJ);
    expectStatus(await assign(action.id, staffIds.SUB_UNIT!), 200);

    for (const role of ["PI", "KUI", "ADMIN"]) {
      assert.equal(
        (await assign(action.id, staffIds[role]!)).status,
        422,
        role,
      );
    }
    assert.equal((await assign(action.id, "999999999")).status, 422);

    const admin = await ctx.as("ADMIN");
    const inactiveKj = expectStatus<Staff>(
      await admin.post("/admin/staff", {
        email: "kj.tidak.aktif@ujian.gov.my",
        fullName: "KJ Tidak Aktif",
        role: "KJ",
        password: TEST_PASSWORD,
      }),
      201,
    );
    expectStatus(
      await admin.post(`/admin/staff/${inactiveKj.id}/deactivate`),
      200,
    );
    assert.equal((await assign(action.id, inactiveKj.id)).status, 422);

    // The picker: KJ / SUB_UNIT only, inactive flagged, no email; IU only.
    const recipients = expectStatus<Record<string, unknown>[]>(
      await kui.get("/admin/case-actions/assignees"),
      200,
    );
    assert.deepEqual(
      new Set(recipients.map((r) => r.role)),
      new Set(["KJ", "SUB_UNIT"]),
    );
    for (const r of recipients) {
      assert.deepEqual(Object.keys(r).sort(), [
        "fullName",
        "id",
        "isActive",
        "role",
      ]);
    }
    assert.equal(
      recipients.find((r) => r.id === inactiveKj.id)?.isActive,
      false,
    );
    for (const client of [kj, subUnit]) {
      assert.equal(
        (await client.get("/admin/case-actions/assignees")).status,
        403,
      );
    }

    const cleared = expectStatus(await assign(action.id, null), 200);
    assert.equal(cleared.assignedToStaffId, null);

    const nfa = await newDecidedComplaint("NFA");
    const nfaAction = await newAction(nfa.id, "FAIL/ASSIGN/NFA");
    assert.equal((await assign(nfaAction.id, staffIds.KJ!)).status, 409);

    assert.equal((await assign("999999999", staffIds.KJ!)).status, 404);
    for (const client of [kj, subUnit]) {
      assert.equal(
        (
          await client.put(`/admin/case-actions/${action.id}/assignee`, {
            staffId: staffIds.KJ,
          })
        ).status,
        403,
      );
    }
  });
});

describe("KJ / SUB_UNIT referrals", () => {
  let mine: CaseAction;
  let unassigned: CaseAction;
  let subUnits: CaseAction;
  let turnedNfa: CaseAction;

  before(async () => {
    const complaint = await newDecidedComplaint();
    mine = await newAction(complaint.id, "FAIL/KJ/MINE");
    unassigned = await newAction(complaint.id, "FAIL/KJ/UNASSIGNED");
    subUnits = await newAction(complaint.id, "FAIL/KJ/SUBUNIT");
    expectStatus(await assign(mine.id, staffIds.KJ!), 200);
    expectStatus(await assign(subUnits.id, staffIds.SUB_UNIT!), 200);

    // Referred while in action, then decided NFA afterwards.
    const later = await newDecidedComplaint();
    turnedNfa = await newAction(later.id, "FAIL/KJ/NFA");
    expectStatus(await assign(turnedNfa.id, staffIds.KJ!), 200);
    await decide(later.id, "NFA");
  });

  it("KJ sees only their own actions on disclosable complaints, and only the allowed fields", async () => {
    const res = await kj.get<Referred[]>("/referrals/actions");
    const list = expectStatus(res, 200);

    assert.deepEqual(
      list.map((a) => a.id),
      [mine.id],
      "not unassigned, not another assignee's, not NFA",
    );
    for (const item of list) {
      assert.deepEqual(Object.keys(item).sort(), ALLOWED_KEYS);
    }
    const raw = JSON.stringify(res.body);
    for (const [field, secret] of Object.entries(SECRETS)) {
      assert.ok(!raw.includes(secret), `leaked ${field}`);
    }
    for (const forbidden of [
      "FAIL/KJ/UNASSIGNED",
      "FAIL/KJ/SUBUNIT",
      "FAIL/KJ/NFA",
    ]) {
      assert.ok(!raw.includes(forbidden), `leaked action ${forbidden}`);
    }

    const theirs = expectStatus(
      await subUnit.get<Referred[]>("/referrals/actions"),
      200,
    );
    assert.deepEqual(
      theirs.map((a) => a.id),
      [subUnits.id],
    );
  });

  it("KJ updates the two allowed fields on their own action; anything else is refused", async () => {
    const updated = expectStatus<Referred>(
      await kj.patch(`/referrals/actions/${mine.id}`, {
        responseReceivedDate: "2026-05-02",
        feedbackStatus: "Maklum balas diterima daripada jabatan",
      }),
      200,
    );
    assert.deepEqual(Object.keys(updated).sort(), ALLOWED_KEYS);
    assert.equal(updated.responseReceivedDate, "2026-05-02");
    assert.equal(
      updated.feedbackStatus,
      "Maklum balas diterima daripada jabatan",
    );

    const snapshot = async () =>
      (
        await ctx.sql(
          `SELECT action_taken, action_date, file_ref_no, psu_action_notes,
                  ui_remarks, misc_notes, jmm_decision_id, assigned_to_staff_id
             FROM case_actions WHERE id = $1`,
          [mine.id],
        )
      ).rows[0];
    const before = await snapshot();

    for (const body of [
      { actionTaken: "NFA" },
      { uiRemarks: "cubaan" },
      { feedbackStatus: "ok", psuActionNotes: "cubaan" },
      { fileRefNo: "BARU" },
      { assignedToStaffId: staffIds.KJ },
      {},
    ]) {
      assert.equal(
        (await kj.patch(`/referrals/actions/${mine.id}`, body)).status,
        422,
        JSON.stringify(body),
      );
    }
    assert.deepEqual(await snapshot(), before);

    const unknown = await kj.patch("/referrals/actions/999999999", {
      feedbackStatus: "x",
    });
    assert.equal(unknown.status, 404);
    for (const other of [unassigned, subUnits, turnedNfa]) {
      const res = await kj.patch(`/referrals/actions/${other.id}`, {
        feedbackStatus: "cubaan",
      });
      assert.equal(res.status, 404, other.id);
      assert.deepEqual(res.body, unknown.body);
    }
    const { rows } = await ctx.sql<{ feedback_status: string }>(
      "SELECT feedback_status FROM case_actions WHERE id = ANY($1)",
      [[unassigned.id, subUnits.id, turnedNfa.id]],
    );
    assert.ok(rows.every((r) => r.feedback_status === "Menunggu maklum balas"));
  });

  it("KJ and SUB_UNIT still get 403 on every /api/admin/* tree", async () => {
    const paths: [string, string][] = [
      ["GET", "/admin/complaints"],
      ["GET", "/admin/complaints/1"],
      ["POST", "/admin/complaints"],
      ["GET", "/admin/decisions"],
      ["GET", "/admin/decisions/1"],
      ["PATCH", `/admin/case-actions/${mine.id}`],
      ["PUT", `/admin/case-actions/${mine.id}/assignee`],
      ["GET", "/admin/jmm/meetings"],
      ["GET", "/admin/stats"],
      ["GET", "/admin/protection-requests"],
      ["GET", "/admin/staff"],
      ["POST", "/admin/staff"],
    ];
    for (const client of [kj, subUnit]) {
      for (const [method, path] of paths) {
        const res =
          method === "GET"
            ? await client.get(path)
            : method === "POST"
              ? await client.post(path, {})
              : method === "PUT"
                ? await client.put(path, {})
                : await client.patch(path, {});
        assert.equal(res.status, 403, `${method} ${path}`);
      }
    }
  });

  it("the referrals prefix is for KJ / SUB_UNIT only", async () => {
    for (const role of ["KUI", "PI", "ADMIN"] as const) {
      const client = await ctx.as(role);
      assert.equal((await client.get("/referrals/actions")).status, 403, role);
    }
    assert.equal((await ctx.anonymous.get("/referrals/actions")).status, 401);
  });
});
