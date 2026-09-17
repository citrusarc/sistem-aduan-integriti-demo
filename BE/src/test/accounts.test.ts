/**
 * §8 decision 13 over the real HTTP API: first-run ADMIN setup, complainant
 * registration by email OTP, and the public status timeline.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  startTestContext,
  type ApiResponse,
  type Client,
  type TestContext,
} from "./harness.js";

let ctx: TestContext;
let seq = 0;

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

const cookieFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

const codeIn = (text: string) => text.match(/\b(\d{6})\b/)?.[1];

before(async () => {
  ctx = await startTestContext();
});

after(async () => {
  await ctx.close();
});

// ─── First-run setup ─────────────────────────────────────────────────────────

describe("first-run ADMIN setup", () => {
  const setup = (body: Record<string, unknown>) =>
    ctx.fetch("/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("is open only while no staff account exists, and signs the new ADMIN in", async () => {
    // The harness creates one account per role; setup must be closed.
    assert.deepEqual(
      expectStatus(await ctx.anonymous.get("/auth/setup"), 200),
      { setupRequired: false },
    );
    const closed = await setup({
      email: "penceroboh@contoh.my",
      fullName: "Penceroboh",
      password: "Kata-Laluan-Panjang-9",
    });
    assert.equal(closed.status, 409);

    // A brand-new installation: no staff at all.
    await ctx.sql("DELETE FROM staff_sessions");
    await ctx.sql("DELETE FROM staff_users");
    assert.deepEqual(
      expectStatus(await ctx.anonymous.get("/auth/setup"), 200),
      { setupRequired: true },
    );

    assert.equal(
      (
        await setup({
          email: "admin@contoh.my",
          fullName: "Admin",
          password: "pendek",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await setup({
          email: "bukan-emel",
          fullName: "Admin",
          password: "Kata-Laluan-Panjang-9",
        })
      ).status,
      422,
    );

    // Two at once: exactly one wins.
    const results = await Promise.all(
      ["pertama@contoh.my", "kedua@contoh.my"].map((email) =>
        setup({
          email,
          fullName: "Pentadbir Pertama",
          password: "Kata-Laluan-Panjang-9",
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    const winner = results.find((r) => r.status === 201)!;
    const body = (await winner.json()) as { data: { role: string } };
    assert.equal(body.data.role, "ADMIN");

    // The cookie it set is a working ADMIN session.
    const admin: Client = ctx.withCookie(cookieFrom(winner));
    const me = expectStatus<{ role: string }>(await admin.get("/auth/me"), 200);
    assert.equal(me.role, "ADMIN");
    expectStatus(await admin.get("/admin/staff"), 200);

    const { rows } = await ctx.sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM staff_users",
    );
    assert.equal(rows[0]?.n, 1);
    assert.deepEqual(
      expectStatus(await ctx.anonymous.get("/auth/setup"), 200),
      { setupRequired: false },
    );
  });
});

// ─── Complainant registration ────────────────────────────────────────────────

describe("complainant registration", () => {
  const register = (email: string, fullName: string) =>
    ctx.anonymous.post<{ message: string }>("/complainant/auth/register", {
      email,
      fullName,
    });

  const verify = (email: string, code: string) =>
    ctx.fetch("/complainant/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });

  const lastCodeTo = (email: string) => {
    const message = ctx.emails.filter((m) => m.to === email).at(-1);
    return message ? codeIn(message.text) : undefined;
  };

  it("registers with name and email, verified by the emailed code, with no complaint needed", async () => {
    const email = "baharu.daftar@contoh.my";

    // Before registering, a login code isn't sent.
    const before = ctx.emails.length;
    expectStatus(
      await ctx.anonymous.post("/complainant/auth/request-code", { email }),
      202,
    );
    assert.equal(ctx.emails.length, before);

    expectStatus(
      await register(" Baharu.Daftar@Contoh.MY ", "Aminah Baharu"),
      202,
    );
    const code = lastCodeTo(email);
    assert.ok(code, "a registration code is emailed");

    const verified = await verify(email, code!);
    assert.equal(verified.status, 200);
    const session = (await verified.json()) as {
      data: { email: string; fullName: string };
    };
    assert.deepEqual(
      { email: session.data.email, fullName: session.data.fullName },
      { email, fullName: "Aminah Baharu" },
    );

    const complainant = ctx.withCookie(cookieFrom(verified));
    const me = expectStatus<{ fullName: string }>(
      await complainant.get("/complainant/auth/me"),
      200,
    );
    assert.equal(me.fullName, "Aminah Baharu");
    assert.deepEqual(
      expectStatus(await complainant.get("/complainant/complaints"), 200),
      [],
    );

    // Signing in later works without any complaint.
    const sent = ctx.emails.length;
    await ctx.sql(
      "UPDATE complainant_otp_codes SET created_at = now() - INTERVAL '2 minutes' WHERE email = $1",
      [email],
    );
    expectStatus(
      await ctx.anonymous.post("/complainant/auth/request-code", { email }),
      202,
    );
    assert.equal(ctx.emails.length, sent + 1);
  });

  it("an unverified sign-up can't sign in, and a verified account can't be renamed by re-registering", async () => {
    const pending = "belum.sah@contoh.my";
    expectStatus(await register(pending, "Belum Sah"), 202);
    const sent = ctx.emails.length;
    await ctx.sql(
      "UPDATE complainant_otp_codes SET created_at = now() - INTERVAL '2 minutes' WHERE email = $1",
      [pending],
    );
    expectStatus(
      await ctx.anonymous.post("/complainant/auth/request-code", {
        email: pending,
      }),
      202,
    );
    assert.equal(ctx.emails.length, sent, "no login code before verifying");

    const email = "sudah.sah@contoh.my";
    await register(email, "Nama Asal");
    assert.equal((await verify(email, lastCodeTo(email)!)).status, 200);
    await ctx.sql(
      "UPDATE complainant_otp_codes SET created_at = now() - INTERVAL '2 minutes' WHERE email = $1",
      [email],
    );
    expectStatus(await register(email, "Nama Penyamar"), 202);
    const { rows } = await ctx.sql<{ full_name: string }>(
      "SELECT full_name FROM complainant_accounts WHERE email = $1",
      [email],
    );
    assert.equal(rows[0]?.full_name, "Nama Asal");
  });

  it("refuses a missing name or a bad email", async () => {
    assert.equal((await register("ok@contoh.my", " ")).status, 422);
    assert.equal((await register("bukan-emel", "Nama Betul")).status, 422);
  });
});

// ─── Status timeline ─────────────────────────────────────────────────────────

describe("status timeline (public)", () => {
  let kui: Client;
  before(async () => {
    // The setup test above removed the harness's staff; add a KUI back.
    await ctx.sql(
      `INSERT INTO staff_users (full_name, role, email, password_hash, password_changed_at)
       SELECT 'Ujian KUI 2', 'KUI', 'kui2@ujian.my', password_hash, now()
         FROM staff_users WHERE role = 'ADMIN' LIMIT 1`,
    );
    const login = await ctx.staffLogin(
      "kui2@ujian.my",
      "Kata-Laluan-Panjang-9",
    );
    assert.ok(login.client, JSON.stringify(login));
    kui = login.client;
  });

  type Timeline = { status: string; changedAt: string }[];

  async function submit(email: string) {
    seq += 1;
    return expectStatus<{ complaintRefNo: string }>(
      await ctx.anonymous.post("/complaints", {
        caseDescription: `Aduan garis masa ${seq} ${"t".repeat(seq * 3)}`,
        complainant: {
          particulars: "Pengadu Garis Masa",
          contactEmail: email,
          nationality: "WARGANEGARA",
          icNo: "900101145678",
        },
        disclaimerAcknowledged: true,
        duplicateCheckAcknowledged: true,
      }),
      201,
    );
  }

  const idOf = async (refNo: string) =>
    (
      await ctx.sql<{ id: string }>(
        "SELECT id FROM complaints WHERE complaint_ref_no = $1",
        [refNo],
      )
    ).rows[0]!.id;

  const track = async (refNo: string) =>
    ctx.anonymous.get<{ timeline: Timeline }>(
      `/complaints/${encodeURIComponent(refNo)}`,
    );

  it("records every status entered, and shows only status and time", async () => {
    const { complaintRefNo } = await submit("garis.masa@contoh.my");
    const id = await idOf(complaintRefNo);

    const meeting = expectStatus<{ id: string }>(
      await kui.post("/admin/jmm/meetings", {
        meetingNo: `JMM Garis Masa ${seq}`,
        meetingDate: "2026-04-01",
      }),
      201,
    );
    const addItem = () =>
      kui.post(`/admin/jmm/meetings/${meeting.id}/items`, { complaintId: id });

    expectStatus(await addItem(), 201);
    // Taken off the agenda and put back: both steps are recorded.
    expectStatus(
      await kui.delete(`/admin/jmm/meetings/${meeting.id}/items/${id}`),
      200,
    );
    expectStatus(await addItem(), 201);
    expectStatus(
      await kui.post(`/admin/complaints/${id}/decisions`, {
        decisionDate: "2026-04-01",
        outcome: "TINDAKAN_SPRM",
        meetingId: meeting.id,
        summary: "RINGKASAN-RAHSIA",
        signatories: [
          { roleCategory: "PENGERUSI", roleTitle: "KUI" },
          { roleCategory: "AHLI", roleTitle: "PI" },
        ],
      }),
      201,
    );
    expectStatus(await kui.post(`/admin/complaints/${id}/close`), 200);

    const tracked = expectStatus(await track(complaintRefNo), 200);
    assert.deepEqual(
      tracked.timeline.map((t) => t.status),
      [
        "BARU",
        "MENUNGGU_JMM",
        "BARU",
        "MENUNGGU_JMM",
        "DALAM_TINDAKAN",
        "SELESAI",
      ],
    );
    for (const entry of tracked.timeline) {
      assert.deepEqual(Object.keys(entry).sort(), ["changedAt", "status"]);
    }
    assert.ok(!JSON.stringify(tracked).includes("RINGKASAN-RAHSIA"));

    // The complainant's own view carries the same timeline; the list doesn't.
    const verifyEmail = "garis.masa@contoh.my";
    const requested = await ctx.anonymous.post(
      "/complainant/auth/request-code",
      {
        email: verifyEmail,
      },
    );
    assert.equal(requested.status, 202);
    const code = codeIn(
      ctx.emails.filter((m) => m.to === verifyEmail).at(-1)!.text,
    )!;
    const verified = await ctx.fetch("/complainant/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verifyEmail, code }),
    });
    const complainant = ctx.withCookie(cookieFrom(verified));
    const own = expectStatus<{ timeline: Timeline }>(
      await complainant.get(
        `/complainant/complaints/${encodeURIComponent(complaintRefNo)}`,
      ),
      200,
    );
    assert.deepEqual(own.timeline, tracked.timeline);
    const list = expectStatus<Record<string, unknown>[]>(
      await complainant.get("/complainant/complaints"),
      200,
    );
    assert.ok(list.every((c) => !("timeline" in c)));
  });

  it("an NFA complaint has no public timeline at all", async () => {
    const { complaintRefNo } = await submit("nfa.masa@contoh.my");
    const id = await idOf(complaintRefNo);
    expectStatus(
      await kui.post(`/admin/complaints/${id}/decisions`, {
        decisionDate: "2026-04-02",
        outcome: "NFA",
        signatories: [
          { roleCategory: "PENGERUSI", roleTitle: "KUI" },
          { roleCategory: "AHLI", roleTitle: "PI" },
        ],
      }),
      201,
    );
    assert.equal((await track(complaintRefNo)).status, 404);

    // Staff still see the full history on the case file.
    const detail = expectStatus<{ timeline: Timeline }>(
      await kui.get(`/admin/complaints/${id}`),
      200,
    );
    assert.deepEqual(
      detail.timeline.map((t) => t.status),
      ["BARU", "NFA"],
    );
  });
});
