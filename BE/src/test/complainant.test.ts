/**
 * §8 decisions 3, 4, 6 and 8 over the real HTTP API: portal submission with
 * contact details and anonymity, email-OTP login, a complainant's own
 * complaints (rules 2 and 9), protection requests, and rule 10 (no SMS).
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  startTestContext,
  type ApiResponse,
  type Client,
  type TestContext,
} from "./harness.js";
import { notifyByEmail } from "../notify/email.js";

const PUBLIC_COMPLAINT_KEYS = [
  "complaintDate",
  "complaintRefNo",
  "integrityCategory",
  "receivedDateUi",
  "status",
];
const COMPLAINANT_PROTECTION_KEYS = [
  "complaintRefNo",
  "createdAt",
  "id",
  "reason",
  "reviewedAt",
  "status",
];
const SIGNATORIES = [
  { roleCategory: "PENGERUSI", roleTitle: "KUI (Pengerusi)" },
  { roleCategory: "AHLI", roleTitle: "PI (Ahli 1)" },
];

type PublicComplaint = { complaintRefNo: string; status: string };
type ProtectionRequest = {
  id: string;
  complaintRefNo: string;
  status: string;
  reviewedAt: string | null;
  reviewedByName?: string | null;
  requestedByEmail?: string;
};

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

function sortedKeys(value: unknown): string[] {
  return Object.keys(value as object).sort();
}

async function submit(
  complainant: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<ApiResponse<PublicComplaint>> {
  seq += 1;
  return ctx.anonymous.post<PublicComplaint>("/complaints", {
    caseDescription: `Aduan portal ujian ${seq} ${"z".repeat(seq)}`,
    complainant,
    disclaimerAcknowledged: true,
    duplicateCheckAcknowledged: true,
    ...extra,
  });
}

async function submitAs(email: string): Promise<PublicComplaint> {
  return expectStatus(
    await submit({ particulars: `Pengadu ${email}`, contactEmail: email }),
    201,
  );
}

async function complaintId(refNo: string): Promise<string> {
  const { rows } = await ctx.sql<{ id: string }>(
    "SELECT id FROM complaints WHERE complaint_ref_no = $1",
    [refNo],
  );
  return rows[0]!.id;
}

async function decide(refNo: string, outcome: string, summary?: string) {
  expectStatus(
    await kui.post(`/admin/complaints/${await complaintId(refNo)}/decisions`, {
      decisionDate: "2026-05-01",
      outcome,
      summary,
      signatories: SIGNATORIES,
    }),
    201,
  );
}

async function countRows(sql: string, params: unknown[] = []) {
  const { rows } = await ctx.sql<{ n: number }>(sql, params);
  return rows[0]!.n;
}

const complaintCount = () =>
  countRows("SELECT count(*)::int AS n FROM complaints");

const refPath = (refNo: string) => encodeURIComponent(refNo);

async function requestCode(email: string) {
  return ctx.anonymous.post<{ message: string }>(
    "/complainant/auth/request-code",
    { email },
  );
}

function codesSentTo(email: string): string[] {
  return ctx.emails
    .filter((m) => m.to === email && m.subject.includes("Kod log masuk"))
    .map((m) => m.text.match(/\b(\d{6})\b/)![1]!);
}

const verify = (email: string, code: string) =>
  ctx.fetch("/complainant/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

const wrong = (code: string) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, "0");

before(async () => {
  ctx = await startTestContext();
  kui = await ctx.as("KUI");
});

after(async () => {
  await ctx.close();
});

describe("portal submission (§8 decision 3)", () => {
  it("named: stores contact details lower-cased, records the disclaimer, acknowledges by email", async () => {
    const created = expectStatus(
      await submit({
        particulars: "Siti Aminah",
        gradeLevel: "SOKONGAN",
        contactEmail: "  Siti.Aminah@Contoh.MY ",
        contactPhone: "+60 12-345 6789",
      }),
      201,
    );
    assert.deepEqual(sortedKeys(created), PUBLIC_COMPLAINT_KEYS);

    const { rows } = await ctx.sql<{
      particulars: string | null;
      contact_email: string;
      contact_phone: string;
      is_anonymous: boolean;
      disclaimer_acknowledged_at: Date | null;
    }>(
      `SELECT p.particulars, p.contact_email, p.contact_phone, p.is_anonymous,
              c.disclaimer_acknowledged_at
         FROM complaints c JOIN complainants p ON p.id = c.complainant_id
        WHERE c.complaint_ref_no = $1`,
      [created.complaintRefNo],
    );
    assert.equal(rows[0]?.particulars, "Siti Aminah");
    assert.equal(rows[0]?.contact_email, "siti.aminah@contoh.my");
    assert.equal(rows[0]?.contact_phone, "+60 12-345 6789");
    assert.equal(rows[0]?.is_anonymous, false);
    assert.ok(rows[0]?.disclaimer_acknowledged_at);

    const acks = ctx.emails.filter((m) => m.to === "siti.aminah@contoh.my");
    assert.equal(acks.length, 1);
    assert.ok(acks[0]!.subject.includes(created.complaintRefNo));
  });

  it("refuses a submission without the disclaimer acknowledged", async () => {
    const before = await complaintCount();
    const complainant = { particulars: "Ali", contactEmail: "ali@contoh.my" };
    for (const disclaimer of [undefined, false, "true"]) {
      const res = await submit(complainant, {
        disclaimerAcknowledged: disclaimer,
      });
      assert.equal(res.status, 422, JSON.stringify(res.body));
    }
    assert.equal(await complaintCount(), before);
  });

  it("anonymous: requires a contact email and stores no name or particulars", async () => {
    const before = await complaintCount();
    assert.equal((await submit({ isAnonymous: true })).status, 422);
    assert.equal(
      (
        await submit({
          isAnonymous: true,
          contactEmail: "tanpanama@contoh.my",
          particulars: "Nama Sebenar",
        })
      ).status,
      422,
    );
    assert.equal(await complaintCount(), before);

    const created = expectStatus(
      await submit({
        isAnonymous: true,
        contactEmail: "tanpanama@contoh.my",
        gradeLevel: "EKSEKUTIF",
      }),
      201,
    );
    const { rows } = await ctx.sql<{
      particulars: string | null;
      is_anonymous: boolean;
      contact_email: string;
    }>(
      `SELECT p.particulars, p.is_anonymous, p.contact_email
         FROM complaints c JOIN complainants p ON p.id = c.complainant_id
        WHERE c.complaint_ref_no = $1`,
      [created.complaintRefNo],
    );
    assert.deepEqual(rows[0], {
      particulars: null,
      is_anonymous: true,
      contact_email: "tanpanama@contoh.my",
    });
  });

  it("refuses a named submission with no name, a bad email, a bad phone, or no complainant block", async () => {
    const before = await complaintCount();
    for (const complainant of [
      { contactEmail: "tiada.nama@contoh.my" },
      { particulars: "Ali", contactEmail: "bukan-emel" },
      { particulars: "Ali", contactPhone: "telefon saya" },
    ]) {
      const res = await submit(complainant);
      assert.equal(res.status, 422, JSON.stringify(complainant));
    }
    assert.equal(
      (await submit(undefined as unknown as Record<string, unknown>)).status,
      422,
    );
    assert.equal(await complaintCount(), before);
  });
});

describe("complainant OTP login (§8 decision 4)", () => {
  it("an address with no complaints gets the same answer, no email, and no stored code", async () => {
    await submitAs("ada.aduan@contoh.my");
    const known = await requestCode("ada.aduan@contoh.my");
    const unknown = await requestCode("tiada.aduan@contoh.my");

    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(codesSentTo("ada.aduan@contoh.my").length, 1);
    assert.equal(
      ctx.emails.filter((m) => m.to === "tiada.aduan@contoh.my").length,
      0,
    );
    assert.equal(
      await countRows(
        "SELECT count(*)::int AS n FROM complainant_otp_codes WHERE email = $1",
        ["tiada.aduan@contoh.my"],
      ),
      0,
    );
  });

  it("emails a 6-digit code, stores only a hash, signs in once; reusing the code is refused", async () => {
    const email = "log.masuk@contoh.my";
    await submitAs(email);
    expectStatus(await requestCode(email), 202);
    const [code] = codesSentTo(email);
    assert.match(code!, /^\d{6}$/);

    const { rows } = await ctx.sql<{ code_hash: string }>(
      "SELECT code_hash FROM complainant_otp_codes WHERE email = $1",
      [email],
    );
    assert.ok(rows[0]!.code_hash.startsWith("scrypt$"));
    assert.ok(!rows[0]!.code_hash.includes(code!));

    assert.equal((await verify(email, wrong(code!))).status, 401);

    const ok = await verify(email, code!);
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.getSetCookie().join("\n");
    assert.match(setCookie, /aduan_csid=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.doesNotMatch(setCookie, /aduan_sid=/);

    const client = ctx.withCookie(
      ok.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    );
    const me = expectStatus<{ email: string }>(
      await client.get("/complainant/auth/me"),
      200,
    );
    assert.equal(me.email, email);

    const reused = await verify(email, code!);
    assert.equal(reused.status, 401, "a consumed code must not sign in again");
  });

  it("attempt limit: after 5 wrong guesses even the right code is refused", async () => {
    const email = "had.cubaan@contoh.my";
    await submitAs(email);
    expectStatus(await requestCode(email), 202);
    const [code] = codesSentTo(email);

    for (let i = 0; i < 5; i += 1) {
      assert.equal((await verify(email, wrong(code!))).status, 401);
    }
    assert.equal(
      await countRows(
        "SELECT attempt_count AS n FROM complainant_otp_codes WHERE email = $1",
        [email],
      ),
      5,
    );

    const right = await verify(email, code!);
    assert.equal(right.status, 401);
    const wrongBody = await (await verify(email, wrong(code!))).json();
    assert.deepEqual(
      await right.json(),
      wrongBody,
      "exhausted and wrong look identical",
    );
  });

  it("an expired code is refused", async () => {
    const email = "tamat.tempoh@contoh.my";
    await submitAs(email);
    expectStatus(await requestCode(email), 202);
    const [code] = codesSentTo(email);

    await ctx.sql(
      `UPDATE complainant_otp_codes
          SET created_at = now() - INTERVAL '11 minutes',
              expires_at = now() - INTERVAL '1 minute'
        WHERE email = $1`,
      [email],
    );
    assert.equal((await verify(email, code!)).status, 401);
  });

  it("re-requesting inside the cooldown sends nothing; a newer code supersedes the older one", async () => {
    const email = "kod.baharu@contoh.my";
    await submitAs(email);
    expectStatus(await requestCode(email), 202);
    expectStatus(await requestCode(email), 202);
    assert.equal(
      codesSentTo(email).length,
      1,
      "throttled request sends nothing",
    );

    await ctx.sql(
      `UPDATE complainant_otp_codes SET created_at = now() - INTERVAL '2 minutes'
        WHERE email = $1`,
      [email],
    );
    expectStatus(await requestCode(email), 202);
    const [first, second] = codesSentTo(email);
    assert.ok(first && second);

    if (first !== second) {
      assert.equal(await verify(email, first).then((r) => r.status), 401);
    }
    assert.equal(await verify(email, second).then((r) => r.status), 200);
  });

  it("matches the email case-insensitively", async () => {
    await submitAs("huruf.besar@contoh.my");
    const client = await ctx.complainant("HURUF.Besar@Contoh.MY");
    const me = expectStatus<{ email: string }>(
      await client.get("/complainant/auth/me"),
      200,
    );
    assert.equal(me.email, "huruf.besar@contoh.my");
  });

  it("logout and idle timeout end the session; staff and complainant cookies don't cross", async () => {
    const email = "keluar@contoh.my";
    await submitAs(email);

    const client = await ctx.complainant(email);
    expectStatus(await client.get("/complainant/auth/me"), 200);
    assert.equal((await client.post("/complainant/auth/logout")).status, 204);
    assert.equal((await client.get("/complainant/auth/me")).status, 401);
    assert.equal(
      await countRows(
        "SELECT count(*)::int AS n FROM complainant_sessions WHERE email = $1",
        [email],
      ),
      0,
    );

    await ctx.sql(
      `UPDATE complainant_otp_codes SET created_at = now() - INTERVAL '2 minutes' WHERE email = $1`,
      [email],
    );
    const idle = await ctx.complainant(email);
    await ctx.sql(
      `UPDATE complainant_sessions SET last_seen_at = now() - INTERVAL '31 minutes' WHERE email = $1`,
      [email],
    );
    assert.equal((await idle.get("/complainant/auth/me")).status, 401);

    await ctx.sql(
      `UPDATE complainant_otp_codes SET created_at = now() - INTERVAL '2 minutes' WHERE email = $1`,
      [email],
    );
    const fresh = await ctx.complainant(email);
    assert.equal((await kui.get("/complainant/complaints")).status, 401);
    assert.equal((await fresh.get("/admin/complaints")).status, 401);
    assert.equal((await fresh.get("/auth/me")).status, 401);
  });
});

describe("my complaints (rules 2 and 9)", () => {
  const A = "pengadu.a@contoh.my";
  const B = "pengadu.b@contoh.my";
  let a1: PublicComplaint;
  let aNfa: PublicComplaint;
  let aAnon: PublicComplaint;
  let b1: PublicComplaint;
  let clientA: Client;
  let clientB: Client;

  before(async () => {
    a1 = await submitAs(A);
    aNfa = await submitAs(A);
    aAnon = expectStatus(
      await submit({ isAnonymous: true, contactEmail: A }),
      201,
    );
    b1 = await submitAs(B);

    await decide(a1.complaintRefNo, "TINDAKAN_SPRM", "RINGKASAN-JMM-RAHSIA");
    await decide(aNfa.complaintRefNo, "NFA");
    expectStatus(
      await kui.post(
        `/admin/complaints/${await complaintId(a1.complaintRefNo)}/case-actions`,
        {
          actionTaken: "RUJUK_SPRM",
          uiRemarks: "CATATAN-UI-RAHSIA",
          psuActionNotes: "NOTA-PSU-RAHSIA",
        },
      ),
      201,
    );

    clientA = await ctx.complainant(A);
    clientB = await ctx.complainant(B);
  });

  it("lists only the complainant's own disclosable complaints, in the public-safe shape", async () => {
    const res = await clientA.get<PublicComplaint[]>("/complainant/complaints");
    const list = expectStatus(res, 200);

    assert.deepEqual(
      list.map((c) => c.complaintRefNo).sort(),
      [a1.complaintRefNo, aAnon.complaintRefNo].sort(),
    );
    for (const item of list) {
      assert.deepEqual(sortedKeys(item), PUBLIC_COMPLAINT_KEYS);
    }
    const raw = JSON.stringify(res.body);
    for (const secret of [
      "RINGKASAN-JMM-RAHSIA",
      "CATATAN-UI-RAHSIA",
      "NOTA-PSU-RAHSIA",
      "Aduan portal ujian",
      b1.complaintRefNo,
      aNfa.complaintRefNo,
    ]) {
      assert.ok(!raw.includes(secret), `leaked: ${secret}`);
    }

    const listB = expectStatus(
      await clientB.get<PublicComplaint[]>("/complainant/complaints"),
      200,
    );
    assert.deepEqual(
      listB.map((c) => c.complaintRefNo),
      [b1.complaintRefNo],
    );
  });

  it("detail: own complaint only; someone else's, NFA, and unknown answer identically", async () => {
    const own = await clientA.get<PublicComplaint>(
      `/complainant/complaints/${refPath(a1.complaintRefNo)}`,
    );
    const detail = expectStatus(own, 200);
    assert.deepEqual(sortedKeys(detail), PUBLIC_COMPLAINT_KEYS);
    assert.equal(detail.status, "DALAM_TINDAKAN");
    assert.ok(!JSON.stringify(own.body).includes("RAHSIA"));

    const unknown = await clientA.get(
      `/complainant/complaints/${refPath("UI/2099/99999")}`,
    );
    const others = await clientA.get(
      `/complainant/complaints/${refPath(b1.complaintRefNo)}`,
    );
    const nfa = await clientA.get(
      `/complainant/complaints/${refPath(aNfa.complaintRefNo)}`,
    );
    assert.equal(unknown.status, 404);
    for (const res of [others, nfa]) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, unknown.body);
    }
    assert.equal(
      (await ctx.anonymous.get("/complainant/complaints")).status,
      401,
    );
  });

  it("a re-tabled NFA case stays hidden, and an address whose only case is NFA gets no code", async () => {
    const meeting = expectStatus<{ id: string }>(
      await kui.post("/admin/jmm/meetings", {
        meetingNo: "JMM Portal 1/2026",
        meetingDate: "2026-06-01",
      }),
      201,
    );
    expectStatus(
      await kui.post(`/admin/jmm/meetings/${meeting.id}/items`, {
        complaintId: await complaintId(aNfa.complaintRefNo),
      }),
      201,
    );

    const list = expectStatus(
      await clientA.get<PublicComplaint[]>("/complainant/complaints"),
      200,
    );
    assert.ok(!list.some((c) => c.complaintRefNo === aNfa.complaintRefNo));
    assert.equal(
      (
        await clientA.get(
          `/complainant/complaints/${refPath(aNfa.complaintRefNo)}`,
        )
      ).status,
      404,
    );

    const onlyNfa = "hanya.nfa@contoh.my";
    const c = await submitAs(onlyNfa);
    await decide(c.complaintRefNo, "NFA");
    expectStatus(await requestCode(onlyNfa), 202);
    assert.equal(codesSentTo(onlyNfa).length, 0);
  });
});

describe("protection requests (§8 decision 6)", () => {
  const A = "lindung.a@contoh.my";
  const B = "lindung.b@contoh.my";
  let a1: PublicComplaint;
  let aNfa: PublicComplaint;
  let b1: PublicComplaint;
  let clientA: Client;
  let clientB: Client;
  const REASON = "Saya bimbang akan tindakan balas daripada pegawai terlibat.";

  before(async () => {
    a1 = await submitAs(A);
    aNfa = await submitAs(A);
    b1 = await submitAs(B);
    await decide(aNfa.complaintRefNo, "NFA");
    clientA = await ctx.complainant(A);
    clientB = await ctx.complainant(B);
  });

  it("a complainant files for their own complaint only", async () => {
    const created = expectStatus<ProtectionRequest>(
      await clientA.post("/complainant/protection-requests", {
        complaintRefNo: a1.complaintRefNo,
        reason: REASON,
      }),
      201,
    );
    assert.equal(created.status, "DITERIMA");
    assert.deepEqual(sortedKeys(created), COMPLAINANT_PROTECTION_KEYS);

    const unknown = await clientA.post("/complainant/protection-requests", {
      complaintRefNo: "UI/2099/99999",
      reason: REASON,
    });
    assert.equal(unknown.status, 404);
    for (const refNo of [b1.complaintRefNo, aNfa.complaintRefNo]) {
      const res = await clientA.post("/complainant/protection-requests", {
        complaintRefNo: refNo,
        reason: REASON,
      });
      assert.equal(res.status, 404, refNo);
      assert.deepEqual(res.body, unknown.body);
    }
    assert.equal(
      await countRows(
        `SELECT count(*)::int AS n FROM protection_requests p
           JOIN complaints c ON c.id = p.complaint_id
          WHERE c.complaint_ref_no = ANY($1)`,
        [[b1.complaintRefNo, aNfa.complaintRefNo]],
      ),
      0,
    );

    assert.equal(
      (
        await clientA.post("/complainant/protection-requests", {
          complaintRefNo: a1.complaintRefNo,
          reason: REASON,
        })
      ).status,
      409,
      "one pending request per complaint",
    );
    assert.equal(
      (
        await clientA.post("/complainant/protection-requests", {
          complaintRefNo: a1.complaintRefNo,
          reason: "pendek",
        })
      ).status,
      422,
    );
    for (const client of [ctx.anonymous, kui]) {
      assert.equal(
        (
          await client.post("/complainant/protection-requests", {
            complaintRefNo: a1.complaintRefNo,
            reason: REASON,
          })
        ).status,
        401,
      );
    }

    const listA = expectStatus<ProtectionRequest[]>(
      await clientA.get("/complainant/protection-requests"),
      200,
    );
    assert.deepEqual(
      listA.map((r) => r.complaintRefNo),
      [a1.complaintRefNo],
    );
    assert.deepEqual(
      expectStatus(await clientB.get("/complainant/protection-requests"), 200),
      [],
    );
  });

  it("KUI alone lists and reviews; review notes never reach the complainant; NFA drops the request from their view", async () => {
    for (const role of ["PI", "ADMIN", "KJ", "SUB_UNIT"] as const) {
      const staff = await ctx.as(role);
      assert.equal(
        (await staff.get("/admin/protection-requests")).status,
        403,
        role,
      );
      assert.equal(
        (
          await staff.post("/admin/protection-requests/1/review", {
            status: "DITOLAK",
          })
        ).status,
        403,
        role,
      );
    }
    assert.equal(
      (await ctx.anonymous.get("/admin/protection-requests")).status,
      401,
    );
    assert.equal((await clientA.get("/admin/protection-requests")).status, 401);

    const pending = expectStatus<ProtectionRequest[]>(
      await kui.get("/admin/protection-requests?status=DITERIMA"),
      200,
    );
    const request = pending.find((r) => r.complaintRefNo === a1.complaintRefNo);
    assert.ok(request);
    assert.equal(request.requestedByEmail, A);

    const reviewPath = `/admin/protection-requests/${request.id}/review`;
    assert.equal(
      (await kui.post(reviewPath, { status: "DITERIMA" })).status,
      422,
    );
    const reviewed = expectStatus<ProtectionRequest>(
      await kui.post(reviewPath, {
        status: "DILULUSKAN",
        reviewNotes: "NOTA-SEMAKAN-RAHSIA",
      }),
      200,
    );
    assert.equal(reviewed.status, "DILULUSKAN");
    assert.equal(reviewed.reviewedByName, "Ujian KUI");
    assert.ok(reviewed.reviewedAt);

    assert.equal(
      (await kui.post(reviewPath, { status: "DITOLAK" })).status,
      409,
    );
    assert.equal(
      (
        await kui.post("/admin/protection-requests/999999999/review", {
          status: "DITOLAK",
        })
      ).status,
      404,
    );

    const mine = await clientA.get<ProtectionRequest[]>(
      "/complainant/protection-requests",
    );
    const [own] = expectStatus(mine, 200);
    assert.equal(own?.status, "DILULUSKAN");
    assert.ok(own?.reviewedAt);
    assert.deepEqual(sortedKeys(own), COMPLAINANT_PROTECTION_KEYS);
    assert.ok(!JSON.stringify(mine.body).includes("NOTA-SEMAKAN-RAHSIA"));

    await decide(a1.complaintRefNo, "NFA");
    assert.deepEqual(
      expectStatus(await clientA.get("/complainant/protection-requests"), 200),
      [],
    );
  });
});

describe("rule 10: no SMS", () => {
  it("every outbound message went to an email address, and none carries a stored phone number", async () => {
    assert.ok(ctx.emails.length > 0);
    for (const message of ctx.emails) {
      assert.match(message.to, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }

    const { rows } = await ctx.sql<{ contact_phone: string }>(
      "SELECT contact_phone FROM complainants WHERE contact_phone IS NOT NULL",
    );
    assert.ok(rows.length > 0, "the suite stored at least one phone number");
    const phones = rows.map((r) => r.contact_phone.replace(/\D/g, ""));
    for (const message of ctx.emails) {
      const digits = JSON.stringify(message).replace(/\D/g, "");
      for (const phone of phones) {
        assert.ok(!digits.includes(phone), `phone ${phone} reached a message`);
      }
    }
  });

  it("notifyByEmail refuses a phone number as recipient", async () => {
    await assert.rejects(
      notifyByEmail({ to: "+60123456789", subject: "x", text: "x" }),
    );
    await assert.rejects(
      notifyByEmail({ to: "0123456789", subject: "x", text: "x" }),
    );
  });

  it("no SMS code path or dependency exists, and no module touches both the phone and the outbound channel", async () => {
    const srcDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test") await walk(full);
        } else if (entry.name.endsWith(".ts")) {
          files.push(full);
        }
      }
    };
    await walk(srcDir);
    assert.ok(files.length > 20);

    const SMS =
      /\b(sms|twilio|nexmo|vonage|messagebird|infobip|plivo|whatsapp)\b/i;
    for (const file of files) {
      // Code only: comments are allowed to say "no SMS".
      const source = (await readFile(file, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(source, SMS, path.relative(srcDir, file));
      if (/contact_?phone/i.test(source)) {
        assert.doesNotMatch(
          source,
          /notifyByEmail|notify\/email/,
          `${path.relative(srcDir, file)} handles the phone number and the outbound channel`,
        );
      }
    }

    const pkg = JSON.parse(
      await readFile(path.join(srcDir, "..", "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.deepEqual(
      deps.filter((d) => SMS.test(d)),
      [],
    );
  });
});
