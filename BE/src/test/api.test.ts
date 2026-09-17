/**
 * §8 decisions 1 and 2 over the real HTTP API, against a freshly migrated test
 * database: every status transition (and every refused one), meetings and
 * agendas, decision linking and the decision log, stats, and the role gate.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  startTestContext,
  type ApiResponse,
  type Client,
  type TestContext,
} from "./harness.js";
import type { ComplaintStatus, JmmOutcome } from "../types/enums.js";

type Complaint = {
  id: string;
  complaintRefNo: string;
  status: ComplaintStatus;
  statusChangedAt: string;
};
type AgendaItem = {
  agendaOrder: number;
  hasDecision: boolean;
  complaint: { id: string; status: ComplaintStatus };
};
type Meeting = {
  id: string;
  meetingNo: string;
  venue: string | null;
  status: "DIJADUALKAN" | "SELESAI";
  items: AgendaItem[];
};
type Decision = {
  id: string;
  meetingId: string | null;
  outcome: JmmOutcome;
  decisionDate: string;
  complaintStatus: ComplaintStatus;
  signatories: { id: string }[];
};
type LogEntry = Decision & {
  complaintRefNo: string;
  meetingNo: string | null;
  finalized: boolean;
};
type Bucket = { value: string | null; count: number };
type Stats = {
  total: number;
  byStatus: Bucket[];
  byIntegrityCategory: Bucket[];
  bySector: Bucket[];
  bySourceChannel: Bucket[];
  byMonth: { month: string; count: number }[];
};

const SIGNATORIES = [
  { roleCategory: "PENGERUSI", roleTitle: "KUI (Pengerusi)" },
  { roleCategory: "AHLI", roleTitle: "PI (Ahli 1)" },
];

let ctx: TestContext;
let kui: Client;
let seq = 0;

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

function expectRefused(res: ApiResponse, status: number) {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  assert.equal(typeof res.body.error, "string");
}

async function newComplaint(
  fields: Record<string, unknown> = {},
): Promise<Complaint> {
  seq += 1;
  return expectStatus<Complaint>(
    await kui.post("/admin/complaints", {
      caseDescription: `Aduan ujian nombor ${seq} ${"x".repeat(seq)}`,
      receivedDateUi: "2026-03-10",
      duplicateCheckAcknowledged: true,
      ...fields,
    }),
    201,
  );
}

async function getComplaint(id: string): Promise<Complaint> {
  return expectStatus<Complaint>(await kui.get(`/admin/complaints/${id}`), 200);
}

async function statusOf(id: string): Promise<ComplaintStatus> {
  return (await getComplaint(id)).status;
}

async function storedStatus(id: string): Promise<ComplaintStatus> {
  const { rows } = await ctx.sql<{ status: ComplaintStatus }>(
    "SELECT status FROM complaints WHERE id = $1",
    [id],
  );
  return rows[0]!.status;
}

async function newMeeting(): Promise<Meeting> {
  seq += 1;
  return expectStatus<Meeting>(
    await kui.post("/admin/jmm/meetings", {
      meetingNo: `JMM Bil. ${seq}/2026`,
      meetingDate: "2026-04-01",
      venue: "Bilik Mesyuarat Integriti",
    }),
    201,
  );
}

const addItem = (
  meetingId: string,
  complaintId: string,
  agendaOrder?: number,
) =>
  kui.post<Meeting>(`/admin/jmm/meetings/${meetingId}/items`, {
    complaintId,
    agendaOrder,
  });

const removeItem = (meetingId: string, complaintId: string) =>
  kui.delete<Meeting>(`/admin/jmm/meetings/${meetingId}/items/${complaintId}`);

const decide = (
  complaintId: string,
  outcome: JmmOutcome,
  opts: { meetingId?: string; decisionDate?: string } = {},
) =>
  kui.post<Decision>(`/admin/complaints/${complaintId}/decisions`, {
    decisionDate: opts.decisionDate ?? "2026-04-01",
    outcome,
    meetingId: opts.meetingId,
    signatories: SIGNATORIES,
  });

const closeCase = (id: string) =>
  kui.post<Complaint>(`/admin/complaints/${id}/close`);

async function decisionCount(complaintId: string): Promise<number> {
  const { rows } = await ctx.sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM jmm_decisions WHERE complaint_id = $1",
    [complaintId],
  );
  return rows[0]!.n;
}

before(async () => {
  ctx = await startTestContext();
  kui = await ctx.as("KUI");
});

after(async () => {
  await ctx.close();
});

describe("status transitions", () => {
  it("a new complaint is BARU — admin and public — and responses carry no statusReliable", async () => {
    const admin = await newComplaint();
    assert.equal(admin.status, "BARU");
    assert.ok(admin.statusChangedAt);
    assert.equal(await storedStatus(admin.id), "BARU");

    const created = expectStatus<Record<string, unknown>>(
      await ctx.anonymous.post("/complaints", {
        caseDescription: "Aduan awam ujian status baru yang unik sekali",
        complainant: { particulars: "Pengadu Awam" },
        disclaimerAcknowledged: true,
        duplicateCheckAcknowledged: true,
      }),
      201,
    );
    assert.equal(created.status, "BARU");
    assert.equal("statusReliable" in created, false);

    const tracked = expectStatus<Record<string, unknown>>(
      await ctx.anonymous.get(
        `/complaints/${encodeURIComponent(String(created.complaintRefNo))}`,
      ),
      200,
    );
    assert.equal(tracked.status, "BARU");
    assert.equal("statusReliable" in tracked, false);
  });

  it("BARU -> MENUNGGU_JMM on agenda add; back to BARU on removal", async () => {
    const c = await newComplaint();
    const m1 = await newMeeting();
    const m2 = await newMeeting();

    const added = expectStatus<Meeting>(await addItem(m1.id, c.id), 201);
    assert.equal(added.items[0]?.complaint.status, "MENUNGGU_JMM");
    const queued = await getComplaint(c.id);
    assert.equal(queued.status, "MENUNGGU_JMM");
    assert.notEqual(queued.statusChangedAt, c.statusChangedAt);

    // Invalid: already on this meeting; on another open meeting.
    expectRefused(await addItem(m1.id, c.id), 409);
    expectRefused(await addItem(m2.id, c.id), 409);
    assert.equal(await statusOf(c.id), "MENUNGGU_JMM");

    expectStatus(await removeItem(m1.id, c.id), 200);
    assert.equal(await statusOf(c.id), "BARU");
    assert.equal(await storedStatus(c.id), "BARU");

    // Invalid: not on the agenda any more.
    expectRefused(await removeItem(m1.id, c.id), 404);
    assert.equal(await statusOf(c.id), "BARU");
  });

  it("close case is refused from BARU and MENUNGGU_JMM", async () => {
    const c = await newComplaint();
    expectRefused(await closeCase(c.id), 409);
    assert.equal(await statusOf(c.id), "BARU");

    const m = await newMeeting();
    expectStatus(await addItem(m.id, c.id), 201);
    expectRefused(await closeCase(c.id), 409);
    assert.equal(await statusOf(c.id), "MENUNGGU_JMM");
  });

  it("MENUNGGU_JMM -> DALAM_TINDAKAN on a decision recorded against its meeting", async () => {
    const c = await newComplaint();
    const m = await newMeeting();
    const other = await newMeeting();
    expectStatus(await addItem(m.id, c.id), 201);

    // Invalid: queued, but the decision names no meeting / a different one.
    expectRefused(await decide(c.id, "TINDAKAN_SPRM"), 409);
    expectRefused(
      await decide(c.id, "TINDAKAN_SPRM", { meetingId: other.id }),
      409,
    );
    assert.equal(await statusOf(c.id), "MENUNGGU_JMM");
    assert.equal(
      await decisionCount(c.id),
      0,
      "a refused decision must roll back",
    );

    const decision = expectStatus<Decision>(
      await decide(c.id, "TINDAKAN_SPRM", { meetingId: m.id }),
      201,
    );
    assert.equal(decision.complaintStatus, "DALAM_TINDAKAN");
    assert.equal(decision.meetingId, m.id);
    assert.equal(await statusOf(c.id), "DALAM_TINDAKAN");

    // Invalid: a decided item is part of the meeting's record.
    expectRefused(await removeItem(m.id, c.id), 409);
    assert.equal(await statusOf(c.id), "DALAM_TINDAKAN");
  });

  it("BARU -> DALAM_TINDAKAN -> SELESAI, and SELESAI is terminal", async () => {
    const c = await newComplaint();
    const m = await newMeeting();

    expectStatus(await decide(c.id, "TINDAKAN_SPRM"), 201);
    assert.equal(await statusOf(c.id), "DALAM_TINDAKAN");

    const closed = expectStatus<Complaint>(await closeCase(c.id), 200);
    assert.equal(closed.status, "SELESAI");
    assert.equal(await storedStatus(c.id), "SELESAI");

    // Invalid from SELESAI: close again, re-table, record a decision, PATCH status.
    expectRefused(await closeCase(c.id), 409);
    expectRefused(await addItem(m.id, c.id), 409);
    const before = await decisionCount(c.id);
    expectRefused(await decide(c.id, "NFA"), 409);
    assert.equal(await decisionCount(c.id), before);
    expectRefused(
      await kui.patch(`/admin/complaints/${c.id}`, { status: "BARU" }),
      400,
    );
    assert.equal(await statusOf(c.id), "SELESAI");
  });

  it("BARU -> NFA; NFA cannot be closed; re-tabling and removal restore NFA; NFA stays confidential", async () => {
    const c = await newComplaint();
    const m = await newMeeting();

    const decision = expectStatus<Decision>(await decide(c.id, "NFA"), 201);
    assert.equal(decision.complaintStatus, "NFA");
    assert.equal(await statusOf(c.id), "NFA");

    expectRefused(await closeCase(c.id), 409);
    assert.equal(await statusOf(c.id), "NFA");

    const unknown = await ctx.anonymous.get(
      `/complaints/${encodeURIComponent("UI/2099/99999")}`,
    );
    const hidden = await ctx.anonymous.get(
      `/complaints/${encodeURIComponent(c.complaintRefNo)}`,
    );
    assert.equal(hidden.status, 404);
    assert.deepEqual(
      hidden.body,
      unknown.body,
      "NFA must be indistinguishable from unknown (rule 2)",
    );

    expectStatus(await addItem(m.id, c.id), 201);
    assert.equal(await statusOf(c.id), "MENUNGGU_JMM");
    assert.equal(
      (
        await ctx.anonymous.get(
          `/complaints/${encodeURIComponent(c.complaintRefNo)}`,
        )
      ).status,
      404,
    );

    expectStatus(await removeItem(m.id, c.id), 200);
    assert.equal(await statusOf(c.id), "NFA");

    expectStatus(await addItem(m.id, c.id), 201);
    const retabled = expectStatus<Decision>(
      await decide(c.id, "TINDAKAN_BAHAGIAN_JABATAN_AGENSI", {
        meetingId: m.id,
      }),
      201,
    );
    assert.equal(retabled.complaintStatus, "DALAM_TINDAKAN");
    assert.equal(
      (
        await ctx.anonymous.get(
          `/complaints/${encodeURIComponent(c.complaintRefNo)}`,
        )
      ).status,
      404,
      "a case once decided NFA stays confidential after re-tabling",
    );
  });

  it("DALAM_TINDAKAN re-tabled and removed returns to DALAM_TINDAKAN; same-status decisions keep status_changed_at; DALAM_TINDAKAN -> NFA", async () => {
    const c = await newComplaint();
    const m = await newMeeting();

    expectStatus(await decide(c.id, "TINDAKAN_SPRM"), 201);
    const first = await getComplaint(c.id);
    assert.equal(first.status, "DALAM_TINDAKAN");

    expectStatus(await decide(c.id, "PENUBUHAN_JKSD"), 201);
    const second = await getComplaint(c.id);
    assert.equal(second.status, "DALAM_TINDAKAN");
    assert.equal(second.statusChangedAt, first.statusChangedAt);

    expectStatus(await addItem(m.id, c.id), 201);
    assert.equal(await statusOf(c.id), "MENUNGGU_JMM");
    expectStatus(await removeItem(m.id, c.id), 200);
    assert.equal(await statusOf(c.id), "DALAM_TINDAKAN");

    expectStatus(await decide(c.id, "NFA"), 201);
    assert.equal(await statusOf(c.id), "NFA");
  });

  it("concurrent agenda adds for one complaint: exactly one succeeds", async () => {
    const c = await newComplaint();
    const [a, b] = await Promise.all([newMeeting(), newMeeting()]);

    const results = await Promise.all([
      addItem(a.id, c.id),
      addItem(b.id, c.id),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);

    const { rows } = await ctx.sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM jmm_meeting_items WHERE complaint_id = $1",
      [c.id],
    );
    assert.equal(rows[0]!.n, 1);
    assert.equal(await statusOf(c.id), "MENUNGGU_JMM");
  });

  it("missing and malformed ids", async () => {
    const m = await newMeeting();
    expectRefused(await closeCase("999999999"), 404);
    expectRefused(await closeCase("abc"), 400);
    expectRefused(await decide("999999999", "NFA"), 404);
    expectRefused(await addItem(m.id, "999999999"), 404);
    const c = await newComplaint();
    expectRefused(await addItem("999999999", c.id), 404);
    assert.equal(await statusOf(c.id), "BARU");
  });
});

describe("meetings", () => {
  it("create, list, detail, update; duplicate numbers and bad input refused", async () => {
    const m = await newMeeting();
    assert.equal(m.status, "DIJADUALKAN");
    assert.deepEqual(m.items, []);

    expectRefused(
      await kui.post("/admin/jmm/meetings", {
        meetingNo: m.meetingNo,
        meetingDate: "2026-05-01",
      }),
      409,
    );
    expectRefused(
      await kui.post("/admin/jmm/meetings", {
        meetingNo: "JMM tarikh salah",
        meetingDate: "01/05/2026",
      }),
      422,
    );

    const updated = expectStatus<Meeting>(
      await kui.patch(`/admin/jmm/meetings/${m.id}`, {
        venue: "Bilik Gerakan",
      }),
      200,
    );
    assert.equal(updated.venue, "Bilik Gerakan");

    const other = await newMeeting();
    expectRefused(
      await kui.patch(`/admin/jmm/meetings/${other.id}`, {
        meetingNo: m.meetingNo,
      }),
      409,
    );
    expectRefused(
      await kui.patch(`/admin/jmm/meetings/${m.id}`, { status: "SELESAI" }),
      400,
    );

    const open = expectStatus<Meeting[]>(
      await kui.get("/admin/jmm/meetings?status=DIJADUALKAN"),
      200,
    );
    assert.ok(open.some((x) => x.id === m.id));
    assert.ok(open.every((x) => x.status === "DIJADUALKAN"));
    const closed = expectStatus<Meeting[]>(
      await kui.get("/admin/jmm/meetings?status=SELESAI"),
      200,
    );
    assert.ok(!closed.some((x) => x.id === m.id));

    expectRefused(
      await kui.get("/admin/jmm/meetings?from=2026-05-01&to=2026-04-01"),
      400,
    );
    expectRefused(await kui.get("/admin/jmm/meetings/999999999"), 404);
    expectStatus(await kui.get(`/admin/jmm/meetings/${m.id}`), 200);
  });

  it("agenda: insert at a position, removal compacts, reorder must be an exact permutation", async () => {
    const m = await newMeeting();
    const [c1, c2, c3] = [
      await newComplaint(),
      await newComplaint(),
      await newComplaint(),
    ];

    expectStatus(await addItem(m.id, c1.id), 201);
    expectStatus(await addItem(m.id, c2.id), 201);
    const withC3 = expectStatus<Meeting>(await addItem(m.id, c3.id, 1), 201);
    assert.deepEqual(
      withC3.items.map((i) => [i.agendaOrder, i.complaint.id]),
      [
        [1, c3.id],
        [2, c1.id],
        [3, c2.id],
      ],
    );

    const removed = expectStatus<Meeting>(await removeItem(m.id, c1.id), 200);
    assert.deepEqual(
      removed.items.map((i) => [i.agendaOrder, i.complaint.id]),
      [
        [1, c3.id],
        [2, c2.id],
      ],
    );

    const reordered = expectStatus<Meeting>(
      await kui.put(`/admin/jmm/meetings/${m.id}/items/order`, {
        complaintIds: [c2.id, c3.id],
      }),
      200,
    );
    assert.deepEqual(
      reordered.items.map((i) => i.complaint.id),
      [c2.id, c3.id],
    );

    for (const complaintIds of [[c2.id], [c2.id, c2.id], [c2.id, c1.id]]) {
      expectRefused(
        await kui.put(`/admin/jmm/meetings/${m.id}/items/order`, {
          complaintIds,
        }),
        422,
      );
    }
  });

  it("closing: refused with an undecided item; afterwards the meeting is read-only", async () => {
    const m = await newMeeting();
    const decided = await newComplaint();
    const deferred = await newComplaint();
    expectStatus(await addItem(m.id, decided.id), 201);
    expectStatus(await addItem(m.id, deferred.id), 201);
    expectStatus(
      await decide(decided.id, "TINDAKAN_TATATERTIB", { meetingId: m.id }),
      201,
    );

    const refused = await kui.post(`/admin/jmm/meetings/${m.id}/close`);
    expectRefused(refused, 409);
    assert.match(
      String(refused.body.error),
      new RegExp(deferred.complaintRefNo.replaceAll("/", "\\/")),
    );

    expectStatus(await removeItem(m.id, deferred.id), 200);
    assert.equal(await statusOf(deferred.id), "BARU");

    const closed = expectStatus<Meeting>(
      await kui.post(`/admin/jmm/meetings/${m.id}/close`),
      200,
    );
    assert.equal(closed.status, "SELESAI");

    expectRefused(await kui.post(`/admin/jmm/meetings/${m.id}/close`), 409);
    expectRefused(await addItem(m.id, deferred.id), 409);
    expectRefused(await removeItem(m.id, decided.id), 409);
    expectRefused(
      await kui.put(`/admin/jmm/meetings/${m.id}/items/order`, {
        complaintIds: [decided.id],
      }),
      409,
    );
    expectRefused(
      await kui.patch(`/admin/jmm/meetings/${m.id}`, { venue: "Lain" }),
      409,
    );
    assert.equal(await statusOf(deferred.id), "BARU");

    // Deferred item tabled at a later meeting.
    const next = await newMeeting();
    expectStatus(await addItem(next.id, deferred.id), 201);
    assert.equal(await statusOf(deferred.id), "MENUNGGU_JMM");

    // A form signed after the sitting can still be recorded against it.
    const late = expectStatus<Decision>(
      await decide(decided.id, "TINDAKAN_TATATERTIB", { meetingId: m.id }),
      201,
    );
    assert.equal(late.complaintStatus, "DALAM_TINDAKAN");
  });
});

describe("decisions", () => {
  it("link and unlink a decision to a meeting; refused off-agenda and once signed", async () => {
    const c = await newComplaint();
    const m = await newMeeting();
    const elsewhere = await newMeeting();
    expectStatus(await addItem(m.id, c.id), 201);
    const d = expectStatus<Decision>(
      await decide(c.id, "UTK_MAKLUMAN_KSU", { meetingId: m.id }),
      201,
    );

    const unlinked = expectStatus<Decision>(
      await kui.put(`/admin/decisions/${d.id}/meeting`, { meetingId: null }),
      200,
    );
    assert.equal(unlinked.meetingId, null);

    expectRefused(
      await kui.put(`/admin/decisions/${d.id}/meeting`, {
        meetingId: elsewhere.id,
      }),
      422,
    );
    expectRefused(
      await kui.put(`/admin/decisions/${d.id}/meeting`, {
        meetingId: "999999999",
      }),
      422,
    );
    expectRefused(
      await kui.put("/admin/decisions/999999999/meeting", { meetingId: m.id }),
      404,
    );

    const relinked = expectStatus<Decision>(
      await kui.put(`/admin/decisions/${d.id}/meeting`, { meetingId: m.id }),
      200,
    );
    assert.equal(relinked.meetingId, m.id);

    for (const s of d.signatories) {
      expectStatus(
        await kui.post(`/admin/decisions/${d.id}/sign`, { signatoryId: s.id }),
        200,
      );
    }
    expectRefused(
      await kui.put(`/admin/decisions/${d.id}/meeting`, { meetingId: null }),
      409,
    );
  });

  it("a slot can only be signed through its own decision", async () => {
    const a = expectStatus<Decision>(
      await decide((await newComplaint()).id, "TINDAKAN_SPRM"),
      201,
    );
    const b = expectStatus<Decision>(
      await decide((await newComplaint()).id, "TINDAKAN_SPRM"),
      201,
    );

    // b's slot through a's URL: refused, and b's slot stays unsigned.
    expectRefused(
      await kui.post(`/admin/decisions/${a.id}/sign`, {
        signatoryId: b.signatories[0]!.id,
      }),
      409,
    );
    const { rows } = await ctx.sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM jmm_decision_signatories WHERE jmm_decision_id = $1 AND signed_at IS NOT NULL",
      [b.id],
    );
    assert.equal(rows[0]!.n, 0);

    expectStatus(
      await kui.post(`/admin/decisions/${b.id}/sign`, {
        signatoryId: b.signatories[0]!.id,
      }),
      200,
    );
  });

  it("decision log filters by outcome, date range, and meeting", async () => {
    const m = await newMeeting();
    const a = await newComplaint();
    const b = await newComplaint();
    expectStatus(await addItem(m.id, a.id), 201);
    const onMeeting = expectStatus<Decision>(
      await decide(a.id, "NFA", {
        meetingId: m.id,
        decisionDate: "2026-06-15",
      }),
      201,
    );
    const offMeeting = expectStatus<Decision>(
      await decide(b.id, "TINDAKAN_SPRM", { decisionDate: "2026-02-01" }),
      201,
    );

    const nfa = expectStatus<LogEntry[]>(
      await kui.get("/admin/decisions?outcome=NFA"),
      200,
    );
    assert.ok(nfa.length > 0 && nfa.every((d) => d.outcome === "NFA"));
    assert.ok(nfa.some((d) => d.id === onMeeting.id));

    const june = expectStatus<LogEntry[]>(
      await kui.get("/admin/decisions?from=2026-06-01&to=2026-06-30"),
      200,
    );
    assert.ok(
      june.every(
        (d) => d.decisionDate >= "2026-06-01" && d.decisionDate <= "2026-06-30",
      ),
    );
    assert.ok(june.some((d) => d.id === onMeeting.id));
    assert.ok(!june.some((d) => d.id === offMeeting.id));

    const byMeeting = expectStatus<LogEntry[]>(
      await kui.get(`/admin/decisions?meetingId=${m.id}`),
      200,
    );
    assert.deepEqual(
      byMeeting.map((d) => d.id),
      [onMeeting.id],
    );
    assert.equal(byMeeting[0]?.meetingNo, m.meetingNo);
    assert.equal(byMeeting[0]?.complaintRefNo, a.complaintRefNo);
    assert.equal(byMeeting[0]?.finalized, false);

    expectRefused(await kui.get("/admin/decisions?outcome=RUJUK_PENGADU"), 400);
    expectRefused(
      await kui.get("/admin/decisions?from=2026-07-01&to=2026-06-01"),
      400,
    );
  });
});

describe("reference numbers", () => {
  it("concurrent registrations all succeed with distinct, consecutive numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? kui : ctx.anonymous).post<Complaint>(
          i % 2 ? "/admin/complaints" : "/complaints",
          {
            caseDescription: `Aduan serentak ${i} ${"r".repeat(i * 5)} ${seq++}`,
            complainant: {
              isAnonymous: true,
              contactEmail: `serentak${i}@ujian.my`,
            },
            disclaimerAcknowledged: true,
            duplicateCheckAcknowledged: true,
          },
        ),
      ),
    );
    const refs = results.map(
      (r) => expectStatus<Complaint>(r, 201).complaintRefNo,
    );
    assert.equal(new Set(refs).size, refs.length);
  });

  it("a portal submission is filed as SAI, received today, and can't set the unit's own fields", async () => {
    const created = expectStatus<{ complaintRefNo: string }>(
      await ctx.anonymous.post("/complaints", {
        caseDescription: `Aduan portal medan dalaman ${seq++} ${"p".repeat(seq)}`,
        complainant: { particulars: "Pengadu Portal" },
        disclaimerAcknowledged: true,
        duplicateCheckAcknowledged: true,
        // None of these may be chosen by the public:
        sourceChannel: "EMEL",
        receivedVia: "EMEL_FAKSIMILI",
        complaintDate: "2020-01-01",
        receivedDateUi: "2020-01-01",
        reportYear: 2020,
        reportMonth: "JANUARI",
        sector: "PEROLEHAN",
        infoClassification: "JENAYAH",
        directedTo: "AGENSI",
      }),
      201,
    );
    const { rows } = await ctx.sql<Record<string, string | number | null>>(
      `SELECT source_channel::text, received_via::text, complaint_date,
              received_date_ui, report_year, report_month,
              sector::text, info_classification::text, directed_to::text,
              to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS today
         FROM complaints WHERE complaint_ref_no = $1`,
      [created.complaintRefNo],
    );
    const row = rows[0]!;
    assert.equal(row.source_channel, "SAI");
    assert.equal(row.received_via, "SISTEM_ADUAN_INTEGRITI");
    assert.equal(row.complaint_date, row.today);
    assert.equal(row.received_date_ui, row.today);
    assert.equal(row.report_year, Number(String(row.today).slice(0, 4)));
    assert.notEqual(row.report_month, null);
    assert.deepEqual(
      [row.sector, row.info_classification, row.directed_to],
      [null, null, null],
    );
  });
});

describe("BORANG ADUAN/ MAKLUMAT (Lampiran 2)", () => {
  it("staff registration stores every form field and the case file returns them", async () => {
    const created = await newComplaint({
      receivedVia: "SURAT_LAYANG",
      accusedParticulars: "Pegawai Lampiran Satu",
      accusedDepartment: "Bahagian Pertama",
      accusedPosition: "Penolong Pegawai",
      accused2Particulars: "Pegawai Lampiran Dua",
      accused2Department: "Syarikat Kedua Sdn Bhd",
      accused2Position: "Pengurus",
      incidentDate: "2026-02-14",
      incidentTime: "14:30",
      hasSupportingDocuments: true,
      complainant: {
        complainantCategory: "ORANG_AWAM",
        particulars: "Pengadu Lampiran",
        icNo: "900101-14-5678",
        passportNo: "a1234567",
        age: 36,
        gender: "PEREMPUAN",
        race: "Melayu",
        nationality: "Malaysia",
        contactEmail: "lampiran2@contoh.my",
        contactPhone: "012-3456789",
        contactPhone2: "03-88889999",
        postalAddress: "No. 1, Jalan Contoh, 62000 Putrajaya",
        occupation: "Kontraktor",
        employer: "Syarikat Contoh",
      },
    });
    const detail = expectStatus<Record<string, unknown>>(
      await kui.get(`/admin/complaints/${created.id}`),
      200,
    );
    assert.equal(detail.receivedVia, "SURAT_LAYANG");
    assert.equal(detail.accusedPosition, "Penolong Pegawai");
    assert.equal(detail.accused2Particulars, "Pegawai Lampiran Dua");
    assert.equal(detail.accused2Department, "Syarikat Kedua Sdn Bhd");
    assert.equal(detail.accused2Position, "Pengurus");
    assert.equal(detail.incidentDate, "2026-02-14");
    assert.equal(detail.incidentTime, "14:30");
    assert.equal(detail.hasSupportingDocuments, true);
    const complainant = detail.complainant as Record<string, unknown>;
    assert.equal(complainant.icNo, "900101145678");
    assert.equal(complainant.passportNo, "A1234567");
    assert.equal(complainant.age, 36);
    assert.equal(complainant.gender, "PEREMPUAN");
    assert.equal(complainant.complainantCategory, "ORANG_AWAM");
    assert.equal(complainant.contactPhone2, "03-88889999");
    assert.equal(complainant.employer, "Syarikat Contoh");

    const updated = expectStatus<Record<string, unknown>>(
      await kui.patch(`/admin/complaints/${created.id}`, {
        receivedVia: "TELEFON",
        incidentTime: null,
        hasSupportingDocuments: false,
      }),
      200,
    );
    assert.equal(updated.receivedVia, "TELEFON");
    assert.equal(updated.incidentTime, null);
    assert.equal(updated.hasSupportingDocuments, false);

    // No complainant block -> null, not an empty object.
    const bare = await newComplaint();
    const bareDetail = expectStatus<Record<string, unknown>>(
      await kui.get(`/admin/complaints/${bare.id}`),
      200,
    );
    assert.equal(bareDetail.complainant, null);
  });

  it("refuses malformed form fields", async () => {
    for (const fields of [
      { receivedVia: "SAI" },
      { incidentTime: "25:00" },
      { complainant: { particulars: "A", icNo: "12345" } },
      { complainant: { particulars: "A", age: 200 } },
      { complainant: { particulars: "A", gender: "L" } },
      { complainant: { particulars: "A", contactPhone2: "tiada" } },
    ]) {
      const res = await kui.post("/admin/complaints", {
        caseDescription: "Aduan medan tidak sah",
        duplicateCheckAcknowledged: true,
        ...fields,
      });
      assert.equal(res.status, 422, JSON.stringify(fields));
    }
  });

  it("the duplicate check matches the second accused person against either slot", async () => {
    await newComplaint({
      receivedDateUi: null,
      accusedParticulars: "Zulkarnain Tohmahan Kedua",
    });
    const res = await kui.post("/admin/complaints", {
      caseDescription: "Aduan lain sama sekali tentang perkara berbeza",
      accused2Particulars: "Zulkarnain Tohmahan Kedua",
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
  });
});

describe("complaint list status filter", () => {
  it("returns only complaints in the requested status", async () => {
    const c = await newComplaint();
    expectStatus(await decide(c.id, "NFA"), 201);

    for (const status of ["BARU", "NFA", "DALAM_TINDAKAN"] as const) {
      const rows = expectStatus<Complaint[]>(
        await kui.get(`/admin/complaints?status=${status}&limit=200`),
        200,
      );
      assert.ok(
        rows.every((r) => r.status === status),
        status,
      );
    }
    const nfa = expectStatus<Complaint[]>(
      await kui.get("/admin/complaints?status=NFA&limit=200"),
      200,
    );
    assert.ok(nfa.some((r) => r.id === c.id));

    expectRefused(await kui.get("/admin/complaints?status=DITUTUP"), 400);
  });

  it("filters by period on the received date, falling back to the complaint date", async () => {
    const received = await newComplaint({ receivedDateUi: "2026-11-10" });
    const byComplaintDate = await newComplaint({
      receivedDateUi: null,
      complaintDate: "2026-11-30",
    });
    const outside = await newComplaint({ receivedDateUi: "2026-12-01" });
    // received_date_ui wins over complaint_date when both are set.
    const overridden = await newComplaint({
      receivedDateUi: "2026-12-02",
      complaintDate: "2026-11-15",
    });

    const rows = expectStatus<Complaint[]>(
      await kui.get(
        "/admin/complaints?from=2026-11-01&to=2026-11-30&limit=200",
      ),
      200,
    );
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(received.id));
    assert.ok(ids.includes(byComplaintDate.id));
    assert.ok(!ids.includes(outside.id));
    assert.ok(!ids.includes(overridden.id));

    expectRefused(
      await kui.get("/admin/complaints?from=2026-12-01&to=2026-11-01"),
      400,
    );
    expectRefused(await kui.get("/admin/complaints?from=Mac"), 400);
  });
});

describe("stats", () => {
  it("counts match the stored data, zero-filled, with year/month filters", async () => {
    await newComplaint({
      receivedDateUi: "2025-12-31",
      integrityCategory: "RASUAH",
      sector: "PEROLEHAN",
      sourceChannel: "EMEL",
    });

    const all = expectStatus<Stats>(await kui.get("/admin/stats"), 200);
    const { rows } = await ctx.sql<{ status: string; n: number }>(
      "SELECT status::text, count(*)::int AS n FROM complaints GROUP BY 1",
    );
    const expected = new Map(rows.map((r) => [r.status, r.n]));
    assert.equal(all.byStatus.length, 5, "every status bucket present");
    for (const bucket of all.byStatus) {
      assert.equal(
        bucket.count,
        expected.get(bucket.value!) ?? 0,
        String(bucket.value),
      );
    }
    assert.equal(
      all.total,
      [...expected.values()].reduce((a, b) => a + b, 0),
    );
    const dimensions: { count: number }[][] = [
      all.byIntegrityCategory,
      all.bySector,
      all.bySourceChannel,
      all.byMonth,
    ];
    for (const dimension of dimensions) {
      assert.equal(
        dimension.reduce((sum, b) => sum + b.count, 0),
        all.total,
      );
    }

    const y2026 = expectStatus<Stats>(
      await kui.get("/admin/stats?year=2026"),
      200,
    );
    const y2025 = expectStatus<Stats>(
      await kui.get("/admin/stats?year=2025"),
      200,
    );
    assert.equal(y2026.byMonth.length, 12);
    assert.equal(y2026.total + y2025.total, all.total);
    assert.equal(
      y2025.byIntegrityCategory.find((b) => b.value === "RASUAH")?.count,
      1,
    );
    assert.equal(y2025.byMonth.find((b) => b.month === "2025-12")?.count, 1);

    const march = expectStatus<Stats>(
      await kui.get("/admin/stats?year=2026&month=3"),
      200,
    );
    assert.deepEqual(
      march.byMonth.map((b) => b.month),
      ["2026-03"],
    );
    assert.equal(march.byMonth[0]?.count, march.total);

    expectRefused(await kui.get("/admin/stats?month=3"), 400);
    expectRefused(await kui.get("/admin/stats?year=1999"), 400);
    expectRefused(await kui.get("/admin/stats?year=2026&month=13"), 400);
  });
});

describe("Integrity Unit gate", () => {
  const paths = [
    "/admin/stats",
    "/admin/jmm/meetings",
    "/admin/decisions",
    "/admin/complaints?status=NFA",
  ];

  it("KJ and SUB_UNIT get 403, anonymous 401, PI and ADMIN 200", async () => {
    for (const role of ["KJ", "SUB_UNIT"] as const) {
      const client = await ctx.as(role);
      for (const path of paths) expectRefused(await client.get(path), 403);
      expectRefused(
        await client.post("/admin/jmm/meetings", {
          meetingNo: "X",
          meetingDate: "2026-01-01",
        }),
        403,
      );
    }
    for (const path of paths) expectRefused(await ctx.anonymous.get(path), 401);
    for (const role of ["PI", "ADMIN"] as const) {
      const client = await ctx.as(role);
      for (const path of paths) expectStatus(await client.get(path), 200);
    }
  });
});
