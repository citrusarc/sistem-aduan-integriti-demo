/**
 * §8 decision 16 over the real HTTP API: likely repeats are registered and
 * flagged, acknowledgement emails aren't sprayed, staff confirm PENDUA, and
 * rule 2 still holds for a repeat of an NFA case.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  startTestContext,
  type ApiResponse,
  type Client,
  type TestContext,
} from "./harness.js";
import { config } from "../config.js";
import { resetSubmissionCounts } from "../middleware/rateLimit.js";
import {
  contentTokens,
  cosine,
  idfFrom,
  identifiers,
} from "../duplicates/similarity.js";

let ctx: TestContext;
let kui: Client;

const BRIBE_A =
  "Pegawai di Jabatan Kerja Raya Kuantan menerima rasuah RM 5,000 daripada kontraktor Syarikat Maju Jaya untuk meluluskan tender jalan Felda Lepar.";
const BRIBE_A_REWORDED =
  "Saya ingin melaporkan pegawai JKR Kuantan yang mengambil suapan RM5000 dari Syarikat Maju Jaya supaya tender jalan di Felda Lepar diluluskan.";
const BRIBE_OTHER =
  "Pegawai kastam di Johor Bahru menerima rasuah daripada penyeludup rokok di pelabuhan Pasir Gudang.";
const SPENDING_OTHER =
  "Ketua unit di pejabat tanah Seremban membelanjakan wang jabatan untuk makan malam keluarga dan meminta rasuah daripada pemohon lesen.";

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

type Created = { complaintRefNo: string; status: string };
type Detail = {
  id: string;
  status: string;
  suspectedDuplicate: {
    id: string;
    complaintRefNo: string;
    score: number;
    reasons: string[];
  } | null;
  duplicateOf: { id: string; complaintRefNo: string } | null;
  timeline: { status: string }[];
};

async function submit(body: {
  caseDescription: string;
  email?: string;
  accused?: string;
  anonymous?: boolean;
}) {
  return ctx.anonymous.post<Created>("/complaints", {
    caseDescription: body.caseDescription,
    accusedParticulars: body.accused,
    complainant: body.anonymous
      ? { isAnonymous: true }
      : {
          particulars: "Pengadu Ujian",
          contactEmail: body.email,
          nationality: "WARGANEGARA",
          icNo: "900101145678",
        },
    disclaimerAcknowledged: true,
    duplicateCheckAcknowledged: true,
  });
}

async function idOf(refNo: string) {
  const { rows } = await ctx.sql<{ id: string }>(
    "SELECT id FROM complaints WHERE complaint_ref_no = $1",
    [refNo],
  );
  return rows[0]!.id;
}

const acksTo = (email: string) =>
  ctx.emails.filter(
    (m) => m.to === email && m.subject.startsWith("Aduan diterima"),
  ).length;

before(async () => {
  ctx = await startTestContext();
  kui = await ctx.as("KUI");
});

after(async () => {
  config.portal.submissionsPerIpPerHour = 0;
  config.portal.ackEmailsPerAddressPerDay = 1000;
  await ctx.close();
});

describe("similarity ignores what kind of complaint it is", () => {
  it("scores a reworded report of one incident above two unrelated bribery complaints", () => {
    const docs = [BRIBE_A, BRIBE_A_REWORDED, BRIBE_OTHER, SPENDING_OTHER].map(
      contentTokens,
    );
    const idf = idfFrom(docs);
    const same = cosine(docs[0]!, docs[1]!, idf);
    const unrelated = cosine(docs[0]!, docs[2]!, idf);
    const unrelated2 = cosine(docs[2]!, docs[3]!, idf);
    assert.ok(same > 0.4, `same incident: ${same}`);
    assert.ok(unrelated < 0.15, `different bribery: ${unrelated}`);
    assert.ok(unrelated2 < 0.15, `different misconduct: ${unrelated2}`);
    // "rasuah", "belanja", "pegawai" never count as evidence.
    for (const tokens of docs) {
      assert.ok(
        !tokens.some((t) => ["rasuah", "belanja", "pegawai"].includes(t)),
      );
    }
    assert.deepEqual([...identifiers(BRIBE_A)], ["rm5000"]);
    assert.deepEqual([...identifiers(BRIBE_A_REWORDED)], ["rm5000"]);
  });
});

describe("portal: always registered, flagged, and not an email cannon", () => {
  beforeEach(() => {
    config.portal.submissionsPerIpPerHour = 0;
    config.portal.ackEmailsPerAddressPerDay = 1000;
    resetSubmissionCounts();
  });

  it("a resubmission from the same email is registered, flagged for staff, and not acknowledged again", async () => {
    const email = "ulang.hantar@contoh.my";
    const first = expectStatus(
      await submit({
        caseDescription: BRIBE_A,
        email,
        accused: "Encik Razak Hamid",
      }),
      201,
    );
    assert.equal(acksTo(email), 1);

    const second = await submit({
      caseDescription: BRIBE_A_REWORDED,
      email,
      accused: "Razak bin Hamid",
    });
    const created = expectStatus(second, 201);
    // The public response says nothing about the suspicion.
    assert.deepEqual(Object.keys(created).sort(), [
      "complaintDate",
      "complaintRefNo",
      "integrityCategory",
      "receivedDateUi",
      "status",
    ]);
    assert.equal(created.status, "BARU");
    assert.equal(acksTo(email), 1, "no second acknowledgement");

    const detail = expectStatus<Detail>(
      await kui.get(`/admin/complaints/${await idOf(created.complaintRefNo)}`),
      200,
    );
    assert.equal(
      detail.suspectedDuplicate?.complaintRefNo,
      first.complaintRefNo,
    );
    assert.ok(detail.suspectedDuplicate!.score >= 0.5);
    assert.ok(
      detail.suspectedDuplicate!.reasons.some((r) => r.includes("e-mel")),
      JSON.stringify(detail.suspectedDuplicate),
    );

    const flagged = expectStatus<{ complaintRefNo: string }[]>(
      await kui.get("/admin/complaints?suspectedDuplicate=true"),
      200,
    );
    assert.ok(flagged.some((c) => c.complaintRefNo === created.complaintRefNo));
    assert.ok(!flagged.some((c) => c.complaintRefNo === first.complaintRefNo));
  });

  it("an unrelated complaint in the same category is not flagged", async () => {
    const email = "tidak.berkaitan@contoh.my";
    expectStatus(await submit({ caseDescription: BRIBE_OTHER, email }), 201);
    const other = expectStatus(
      await submit({
        caseDescription: SPENDING_OTHER,
        email: "lain@contoh.my",
      }),
      201,
    );
    const detail = expectStatus<Detail>(
      await kui.get(`/admin/complaints/${await idOf(other.complaintRefNo)}`),
      200,
    );
    assert.equal(detail.suspectedDuplicate, null);
  });

  it("caps acknowledgements per address per day; the complaints are still registered", async () => {
    config.portal.ackEmailsPerAddressPerDay = 2;
    const email = "banyak.aduan@contoh.my";
    // Three unrelated matters, so none is held back as a repeat.
    for (const caseDescription of [
      "Kenderaan jabatan dipakai ke Langkawi untuk percutian keluarga",
      "Stor alat tulis Bangsar kehilangan komputer riba tanpa laporan",
      "Klinik Taman Melati mengutip caj tambahan daripada warga emas",
    ]) {
      expectStatus(await submit({ caseDescription, email }), 201);
    }
    assert.equal(acksTo(email), 2);
    const { rows } = await ctx.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM complaints c
         JOIN complainants p ON p.id = c.complainant_id
        WHERE p.contact_email = $1`,
      [email],
    );
    assert.equal(rows[0]!.n, 3);
  });

  it("limits registrations per IP per hour; refused and duplicate-prompted attempts don't count", async () => {
    config.portal.submissionsPerIpPerHour = 2;
    // A 422 doesn't use the allowance.
    assert.equal(
      (
        await ctx.anonymous.post("/complaints", {
          caseDescription: "tanpa penafian",
          complainant: { isAnonymous: true },
        })
      ).status,
      422,
    );
    expectStatus(
      await submit({ caseDescription: "Aduan had satu Alfa", anonymous: true }),
      201,
    );
    expectStatus(
      await submit({ caseDescription: "Aduan had dua Bravo", anonymous: true }),
      201,
    );
    const third = await submit({
      caseDescription: "Aduan had tiga Charlie",
      anonymous: true,
    });
    assert.equal(third.status, 429);
  });
});

describe("staff confirm or dismiss (PENDUA)", () => {
  let original: string;
  let repeat: string;

  before(async () => {
    config.portal.submissionsPerIpPerHour = 0;
    original = await idOf(
      expectStatus(
        await submit({
          caseDescription:
            "Penyelewengan geran Kampung Sungai Lembing oleh penghulu",
          email: "asal@contoh.my",
        }),
        201,
      ).complaintRefNo,
    );
    repeat = await idOf(
      expectStatus(
        await submit({
          caseDescription:
            "Geran Kampung Sungai Lembing diselewengkan penghulu",
          email: "asal@contoh.my",
        }),
        201,
      ).complaintRefNo,
    );
  });

  it("confirms BARU -> PENDUA pointing at the original; nothing else moves it; undo returns BARU", async () => {
    assert.equal(
      (
        await kui.post(`/admin/complaints/${repeat}/duplicate`, {
          duplicateOfId: repeat,
        })
      ).status,
      422,
    );
    const marked = expectStatus<{ status: string; duplicateOfId: string }>(
      await kui.post(`/admin/complaints/${repeat}/duplicate`, {
        duplicateOfId: original,
      }),
      200,
    );
    assert.equal(marked.status, "PENDUA");
    assert.equal(marked.duplicateOfId, original);

    const detail = expectStatus<Detail>(
      await kui.get(`/admin/complaints/${repeat}`),
      200,
    );
    assert.equal(detail.duplicateOf?.id, original);
    assert.equal(detail.suspectedDuplicate, null, "the suspicion is decided");
    assert.deepEqual(
      detail.timeline.map((t) => t.status),
      ["BARU", "PENDUA"],
    );

    // A repeat can't itself be the original of another.
    assert.equal(
      (
        await kui.post(`/admin/complaints/${original}/duplicate`, {
          duplicateOfId: repeat,
        })
      ).status,
      422,
    );
    // PENDUA is never tabled or decided.
    const meeting = expectStatus<{ id: string }>(
      await kui.post("/admin/jmm/meetings", {
        meetingNo: "JMM Pendua 1/2026",
        meetingDate: "2026-07-01",
      }),
      201,
    );
    assert.equal(
      (
        await kui.post(`/admin/jmm/meetings/${meeting.id}/items`, {
          complaintId: repeat,
        })
      ).status,
      409,
    );
    // A status key on PATCH is still refused.
    assert.equal(
      (await kui.patch(`/admin/complaints/${repeat}`, { status: "BARU" }))
        .status,
      400,
    );

    const undone = expectStatus<{
      status: string;
      duplicateOfId: string | null;
    }>(await kui.delete(`/admin/complaints/${repeat}/duplicate`), 200);
    assert.equal(undone.status, "BARU");
    assert.equal(undone.duplicateOfId, null);
    assert.equal(
      (await kui.delete(`/admin/complaints/${repeat}/duplicate`)).status,
      409,
    );
  });

  it("dismissing the suspicion clears it without moving status", async () => {
    const other = await idOf(
      expectStatus(
        await submit({
          caseDescription:
            "Geran Kampung Sungai Lembing diselewengkan oleh penghulu kampung",
          email: "asal@contoh.my",
        }),
        201,
      ).complaintRefNo,
    );
    const before = expectStatus<Detail>(
      await kui.get(`/admin/complaints/${other}`),
      200,
    );
    assert.ok(before.suspectedDuplicate);
    const dismissed = expectStatus<{
      status: string;
      suspectedDuplicateOfId: string | null;
    }>(await kui.delete(`/admin/complaints/${other}/duplicate-suspicion`), 200);
    assert.equal(dismissed.status, "BARU");
    assert.equal(dismissed.suspectedDuplicateOfId, null);
  });

  it("only from BARU: a decided complaint can't be marked", async () => {
    await kui.post(`/admin/complaints/${original}/decisions`, {
      decisionDate: "2026-07-02",
      outcome: "TINDAKAN_SPRM",
      signatories: [
        { roleCategory: "PENGERUSI", roleTitle: "KUI" },
        { roleCategory: "AHLI", roleTitle: "PI" },
      ],
    });
    assert.equal(
      (
        await kui.post(`/admin/complaints/${original}/duplicate`, {
          duplicateOfId: repeat,
        })
      ).status,
      409,
    );
  });

  it("rule 2: a repeat of an NFA case is not disclosed publicly", async () => {
    const nfaRef = expectStatus(
      await submit({
        caseDescription: "Kes rahsia Bukit Tinggi Nfa",
        email: "nfa@contoh.my",
      }),
      201,
    ).complaintRefNo;
    const nfaId = await idOf(nfaRef);
    expectStatus(
      await kui.post(`/admin/complaints/${nfaId}/decisions`, {
        decisionDate: "2026-07-03",
        outcome: "NFA",
        signatories: [
          { roleCategory: "PENGERUSI", roleTitle: "KUI" },
          { roleCategory: "AHLI", roleTitle: "PI" },
        ],
      }),
      201,
    );
    const repeatRef = expectStatus(
      await submit({
        caseDescription: "Kes Bukit Tinggi lagi",
        email: "lain.nfa@contoh.my",
      }),
      201,
    ).complaintRefNo;
    const track = () =>
      ctx.anonymous.get(`/complaints/${encodeURIComponent(repeatRef)}`);
    assert.equal((await track()).status, 200);

    expectStatus(
      await kui.post(`/admin/complaints/${await idOf(repeatRef)}/duplicate`, {
        duplicateOfId: nfaId,
      }),
      200,
    );
    const hidden = await track();
    const unknown = await ctx.anonymous.get(
      `/complaints/${encodeURIComponent("UI/2099/99999")}`,
    );
    assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, unknown.body);
  });
});
