/**
 * §8 decisions 13 and 15 over the real HTTP API: one registration and sign-in
 * for everybody, roles and permissions, the initial ADMIN, and the public
 * status timeline.
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
import { config } from "../config.js";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../auth/permissions.js";
import { INTEGRITY_UNIT_ROLES } from "../auth/roles.js";
import { STAFF_ROLE } from "../types/enums.js";

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

type SignedIn = {
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
  isIntegrityUnit: boolean;
  hasConsole: boolean;
};

before(async () => {
  ctx = await startTestContext();
});

after(async () => {
  await ctx.close();
});

const lastCodeTo = (email: string) => {
  const message = ctx.emails
    .filter((m) => m.to === email.toLowerCase())
    .at(-1);
  return message ? codeIn(message.text) : undefined;
};

async function registerAndVerify(email: string, fullName: string) {
  const registered = await ctx.register({ email, fullName });
  assert.equal(registered.status, 202);
  const { data } = (await registered.json()) as {
    data: { verifyToken: string };
  };
  return ctx.fetch("/auth/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verifyToken: data.verifyToken,
      code: lastCodeTo(email),
    }),
  });
}

// ─── Roles and permissions ───────────────────────────────────────────────────

describe("permissions (§8 decision 15)", () => {
  it("only Integrity Unit roles hold a permission that reaches NFA cases or internal notes", () => {
    const internal = ["complaints.manage", "jmm.manage", "reports.view"];
    for (const role of STAFF_ROLE) {
      const isUnit = (INTEGRITY_UNIT_ROLES as readonly string[]).includes(role);
      for (const permission of internal) {
        assert.equal(
          ROLE_PERMISSIONS[role].includes(permission as never),
          isUnit,
          `${role} / ${permission}`,
        );
      }
      assert.ok(ROLE_PERMISSIONS[role].includes("portal.use"));
    }
    assert.deepEqual(ROLE_PERMISSIONS.PENGADU, ["portal.use"]);
    assert.ok(ROLE_PERMISSIONS.ADMIN.every((p) => PERMISSIONS.includes(p)));
  });
});

// ─── Registration ────────────────────────────────────────────────────────────

describe("registration (§8 decision 15)", () => {
  it("registers name + email + password, verified by the emailed code, as PENGADU", async () => {
    const email = "baharu.daftar@contoh.my";
    const verified = await registerAndVerify(
      " Baharu.Daftar@Contoh.MY ".trim(),
      "Aminah Baharu",
    );
    assert.equal(verified.status, 200);
    const session = ((await verified.json()) as { data: SignedIn }).data;
    assert.equal(session.email, email);
    assert.equal(session.fullName, "Aminah Baharu");
    assert.equal(session.role, "PENGADU");
    assert.deepEqual(session.permissions, ["portal.use"]);
    assert.equal(session.hasConsole, false);
    assert.equal(session.isIntegrityUnit, false);

    const me = ctx.withCookie(cookieFrom(verified));
    assert.equal(
      expectStatus<SignedIn>(await me.get("/auth/me"), 200).role,
      "PENGADU",
    );
    assert.deepEqual(
      expectStatus(await me.get("/complainant/complaints"), 200),
      [],
    );

    // Later sign-ins are the same steps as staff: captcha, password, code.
    const login = await ctx.staffLogin(email, TEST_PASSWORD);
    assert.ok(login.client, JSON.stringify(login));
  });

  it("applies the staff password policy and needs a captcha", async () => {
    const weak = await ctx.register({
      email: "lemah@contoh.my",
      fullName: "Kata Lemah",
      password: "pendek",
    });
    assert.equal(weak.status, 422);
    const noUpper = await ctx.register({
      email: "lemah@contoh.my",
      fullName: "Kata Lemah",
      password: "tiada-huruf-besar-123",
    });
    assert.equal(noUpper.status, 422);
    assert.equal(
      (
        await ctx.register({
          email: "bukan-emel",
          fullName: "Nama Betul",
        })
      ).status,
      422,
    );
    const noCaptcha = await ctx.anonymous.post("/auth/register", {
      email: "tanpa.captcha@contoh.my",
      fullName: "Tanpa Captcha",
      password: TEST_PASSWORD,
    });
    assert.equal(noCaptcha.status, 400);
  });

  it("an unverified sign-up can't sign in; re-registering it replaces the password", async () => {
    const email = "belum.sah@contoh.my";
    assert.equal(
      (await ctx.register({ email, fullName: "Belum Sah" })).status,
      202,
    );
    const wrong = await ctx.staffLogin(email, "Salah-Kata-Laluan-99");
    assert.equal(wrong.status, 401);
    const right = await ctx.staffLogin(email, TEST_PASSWORD);
    assert.equal(right.status, 403, "said only after a correct password");

    const other = "Kata-Laluan-Lain-4567!";
    assert.equal(
      (await ctx.register({ email, fullName: "Belum Sah", password: other }))
        .status,
      202,
    );
    assert.equal((await ctx.staffLogin(email, TEST_PASSWORD)).status, 401);
  });

  it("re-registering a verified address changes nothing and answers the same", async () => {
    const email = "sudah.sah@contoh.my";
    assert.equal((await registerAndVerify(email, "Nama Asal")).status, 200);

    const before = ctx.emails.length;
    const again = await ctx.register({
      email,
      fullName: "Nama Penyamar",
      password: "Kata-Penyamar-9999!",
    });
    assert.equal(again.status, 202);
    const body = (await again.json()) as {
      data: { verifyToken: string; sentTo: string; message: string };
    };
    assert.deepEqual(Object.keys(body.data).sort(), [
      "message",
      "sentTo",
      "verifyToken",
    ]);
    // The owner is told; no code is sent, and no code can satisfy the token.
    const notice = ctx.emails.slice(before).find((m) => m.to === email);
    assert.ok(notice && !codeIn(notice.text));
    const guess = await ctx.anonymous.post("/auth/register/verify", {
      verifyToken: body.data.verifyToken,
      code: "123456",
    });
    assert.equal(guess.status, 401);

    const { rows } = await ctx.sql<{ full_name: string }>(
      "SELECT full_name FROM staff_users WHERE email = $1",
      [email],
    );
    assert.equal(rows[0]?.full_name, "Nama Asal");
    assert.ok((await ctx.staffLogin(email, TEST_PASSWORD)).client);
  });

  it("a PENGADU is refused by every console and referral API", async () => {
    const pengadu = await ctx.complainant("pengadu.biasa@contoh.my");
    for (const path of [
      "/admin/complaints",
      "/admin/decisions",
      "/admin/jmm/meetings",
      "/admin/stats",
      "/admin/protection-requests",
      "/admin/staff",
      "/admin/settings/security",
      "/referrals/actions",
    ]) {
      assert.equal((await pengadu.get(path)).status, 403, path);
    }
  });

  it("ADMIN gives a registered account a role; it applies on the next request", async () => {
    const email = "bakal.pi@contoh.my";
    const user = await ctx.complainant(email);
    assert.equal((await user.get("/admin/complaints")).status, 403);

    const admin = await ctx.as("ADMIN");
    const accounts = expectStatus<
      { id: string; email: string; role: string }[]
    >(await admin.get("/admin/staff"), 200);
    const account = accounts.find((a) => a.email === email)!;
    assert.equal(account.role, "PENGADU");
    expectStatus(
      await admin.put(`/admin/staff/${account.id}/role`, { role: "PI" }),
      200,
    );
    expectStatus(await user.get("/admin/complaints"), 200);
  });
});

// ─── Initial ADMIN ───────────────────────────────────────────────────────────

describe("initial ADMIN (§8 decision 15)", () => {
  after(() => {
    config.initialAdminEmail = null;
  });

  it("INITIAL_ADMIN_EMAIL becomes ADMIN by proving the address, only while no active ADMIN exists", async () => {
    config.initialAdminEmail = "badrul@contoh.my";

    // An active ADMIN exists (the harness's): registering stays PENGADU.
    const first = await registerAndVerify("badrul@contoh.my", "Badrul");
    assert.equal(
      ((await first.json()) as { data: SignedIn }).data.role,
      "PENGADU",
    );

    // No active ADMIN any more: the next sign-in (password + code) promotes.
    await ctx.sql(
      "UPDATE staff_users SET is_active = FALSE WHERE role = 'ADMIN'",
    );
    const other = await ctx.complainant("orang.lain@contoh.my");
    assert.equal(
      expectStatus<SignedIn>(await other.get("/auth/me"), 200).role,
      "PENGADU",
      "another address is never promoted",
    );
    const login = await ctx.staffLogin("badrul@contoh.my", TEST_PASSWORD);
    assert.ok(login.client);
    const me = expectStatus<SignedIn>(await login.client.get("/auth/me"), 200);
    assert.equal(me.role, "ADMIN");
    assert.ok(me.permissions.includes("users.manage"));
    expectStatus(await login.client.get("/admin/staff"), 200);

    // Now there is an ADMIN: nothing else gets promoted.
    const again = await ctx.complainant("orang.ketiga@contoh.my");
    assert.equal(
      expectStatus<SignedIn>(await again.get("/auth/me"), 200).role,
      "PENGADU",
    );
    await ctx.sql(
      "UPDATE staff_users SET is_active = TRUE WHERE email = 'admin@ujian.gov.my'",
    );
  });
});

// ─── Status timeline ─────────────────────────────────────────────────────────

describe("status timeline (public)", () => {
  let kui: Client;
  before(async () => {
    kui = await ctx.as("KUI");
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
    const complainant = await ctx.complainant("garis.masa@contoh.my");
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
