/**
 * §8 decision 14 over the real HTTP API: password rules, slider captcha, MFA
 * by emailed code, blocking after 5 failures, password expiry (ADMIN-set
 * period), first-login change of an ADMIN-set password, and "Lupa kata
 * laluan".
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

let ctx: TestContext;
let admin: Client;
let seq = 0;

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

const json = async (res: Response) =>
  (await res.json()) as { data?: Record<string, unknown>; error?: string };

const post = (path: string, body: unknown) =>
  ctx.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** An active account with a known, current password and no change pending. */
async function account(role = "PI"): Promise<{ id: string; email: string }> {
  seq += 1;
  const email = `keselamatan${seq}@ujian.gov.my`;
  const created = expectStatus<{ id: string }>(
    await admin.post("/admin/staff", {
      email,
      fullName: `Staf Keselamatan ${seq}`,
      role,
      password: TEST_PASSWORD,
    }),
    201,
  );
  await ctx.sql(
    "UPDATE staff_users SET must_change_password = false WHERE id = $1",
    [created.id],
  );
  return { id: created.id, email };
}

const lastCodeTo = (email: string) =>
  ctx.emails
    .filter((m) => m.to === email)
    .at(-1)
    ?.text.match(/\b(\d{6})\b/)?.[1];

before(async () => {
  ctx = await startTestContext();
  admin = await ctx.as("ADMIN");
});

after(async () => {
  await ctx.close();
});

describe("(b) password rules", () => {
  it("needs 12+ characters with upper, lower, digit and special — everywhere a password is set", async () => {
    const weak: [string, RegExp][] = [
      ["Pendek-1", /12 aksara/],
      ["tiadahurufbesar-123", /huruf besar/],
      ["TIADAHURUFKECIL-123", /huruf kecil/],
      ["Tiada-Nombor-Sama", /nombor/],
      ["TiadaAksaraKhas123", /aksara khas/],
    ];
    const target = await account();
    for (const [password, reason] of weak) {
      const created = await admin.post("/admin/staff", {
        email: `lemah${seq++}@ujian.gov.my`,
        fullName: "Lemah",
        role: "PI",
        password,
      });
      assert.equal(created.status, 422, password);
      assert.match(created.body.error ?? "", reason);

      const reset = await admin.post(`/admin/staff/${target.id}/password`, {
        password,
      });
      assert.equal(reset.status, 422, password);
    }

    const { client } = await ctx.staffLogin(target.email, TEST_PASSWORD);
    const changed = await client!.post("/auth/password", {
      currentPassword: TEST_PASSWORD,
      newPassword: "tiadahurufbesar-123",
    });
    assert.equal(changed.status, 422);
    // Nor the same password again.
    const same = await client!.post("/auth/password", {
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
    });
    assert.equal(same.status, 422);
  });
});

describe("(g) slider captcha", () => {
  it("login needs a solved, unused captcha before the password is checked", async () => {
    const { email } = await account();
    const failuresBefore = await failures(email);

    assert.equal(
      (await post("/auth/login", { email, password: "Salah-Kata-Laluan-1" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post("/auth/login", {
          email,
          password: "Salah-Kata-Laluan-1",
          captchaToken: "bukan-token-yang-sah",
        })
      ).status,
      400,
    );
    // Refused before the password: no failure was counted.
    assert.equal(await failures(email), failuresBefore);

    const token = await ctx.captchaToken();
    assert.equal(
      (
        await post("/auth/login", {
          email,
          password: TEST_PASSWORD,
          captchaToken: token,
        })
      ).status,
      200,
    );
    // Single use.
    assert.equal(
      (
        await post("/auth/login", {
          email,
          password: TEST_PASSWORD,
          captchaToken: token,
        })
      ).status,
      400,
    );
  });

  it("a wrong slide is refused, and three wrong slides kill the picture", async () => {
    const challenge = await json(await ctx.fetch("/auth/captcha"));
    const data = challenge.data as {
      challengeToken: string;
      background: string;
      piece: string;
      pieceY: number;
    };
    assert.match(data.background, /^data:image\/png;base64,/);
    assert.match(data.piece, /^data:image\/png;base64,/);
    assert.ok(!("targetX" in data), "the answer never leaves the server");

    for (const expectedRetry of [true, true, false]) {
      const res = await post("/auth/captcha/verify", {
        challengeToken: data.challengeToken,
        x: 0,
      });
      assert.equal(res.status, 422);
      assert.equal(
        ((await json(res)) as { retry?: boolean }).retry,
        expectedRetry,
      );
    }
  });
});

async function failures(email: string): Promise<number> {
  const { rows } = await ctx.sql<{ n: number }>(
    "SELECT failed_login_count AS n FROM staff_users WHERE email = $1",
    [email],
  );
  return rows[0]!.n;
}

describe("(a) MFA by emailed code", () => {
  it("a correct password alone opens no session; the emailed code does", async () => {
    const { email } = await account();
    const login = await post("/auth/login", {
      email,
      password: TEST_PASSWORD,
      captchaToken: await ctx.captchaToken(),
    });
    assert.equal(login.status, 200);
    assert.equal(
      login.headers.getSetCookie().length,
      0,
      "no session cookie yet",
    );
    const body = (await json(login)).data as {
      mfaToken: string;
      sentTo: string;
    };
    assert.match(body.sentTo, /^k\*+@ujian\.gov\.my$/);

    const code = lastCodeTo(email)!;
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) {
      assert.equal(
        (
          await post("/auth/login/verify", {
            mfaToken: body.mfaToken,
            code: wrong,
          })
        ).status,
        401,
      );
    }
    // Five wrong codes exhaust it: even the right one is refused now.
    assert.equal(
      (await post("/auth/login/verify", { mfaToken: body.mfaToken, code }))
        .status,
      401,
    );

    const ok = await ctx.staffLogin(email, TEST_PASSWORD);
    assert.ok(ok.client);
    expectStatus(await ok.client.get("/auth/me"), 200);
  });
});

describe("(d) blocking after 5 failed passwords", () => {
  it("blocks until ADMIN unlocks; the block shows only after a correct password", async () => {
    const { id, email } = await account();
    for (let i = 0; i < 5; i++) {
      const res = await ctx.staffLogin(email, "Salah-Kata-Laluan-1");
      assert.equal(res.status, 401);
    }
    const blocked = await ctx.staffLogin(email, TEST_PASSWORD);
    assert.equal(blocked.status, 423);
    assert.match(blocked.error ?? "", /disekat/);

    // A day later it is still blocked: not a timed lockout.
    const { rows } = await ctx.sql<{ locked_until: string }>(
      "SELECT locked_until::text FROM staff_users WHERE id = $1",
      [id],
    );
    assert.equal(rows[0]?.locked_until, "infinity");

    const listed = expectStatus<{ id: string; locked: boolean }[]>(
      await admin.get("/admin/staff"),
      200,
    );
    assert.equal(listed.find((a) => a.id === id)?.locked, true);

    for (const role of ["KUI", "PI"] as const) {
      assert.equal(
        (await (await ctx.as(role)).post(`/admin/staff/${id}/unlock`)).status,
        403,
      );
    }
    const unlocked = expectStatus<{ locked: boolean }>(
      await admin.post(`/admin/staff/${id}/unlock`),
      200,
    );
    assert.equal(unlocked.locked, false);
    assert.ok((await ctx.staffLogin(email, TEST_PASSWORD)).client);
  });
});

describe("(c) password expiry and first-login change", () => {
  it("an expired password must be replaced before a session; the period is ADMIN's to set", async () => {
    const { id, email } = await account();
    await ctx.sql(
      "UPDATE staff_users SET password_changed_at = now() - INTERVAL '200 days' WHERE id = $1",
      [id],
    );

    const pending = await ctx.staffLogin(email, TEST_PASSWORD);
    assert.equal(pending.status, 200);
    assert.ok(pending.changeToken && !pending.client);

    for (const newPassword of [TEST_PASSWORD, "lemah-sangat-1"]) {
      const res = await post("/auth/password/expired", {
        changeToken: pending.changeToken,
        newPassword,
      });
      assert.equal(res.status, 422, newPassword);
    }
    // A refused attempt doesn't spend the token.
    const changed = await post("/auth/password/expired", {
      changeToken: pending.changeToken,
      newPassword: "Kata-Laluan-Diperbaharui-1",
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.headers.getSetCookie().length > 0, true);
    assert.equal(
      (
        await post("/auth/password/expired", {
          changeToken: pending.changeToken,
          newPassword: "Kata-Laluan-Lain-Pula-2",
        })
      ).status,
      401,
    );
    assert.ok(
      (await ctx.staffLogin(email, "Kata-Laluan-Diperbaharui-1")).client,
    );

    // ADMIN lengthens the period: a 200-day-old password is valid again.
    const other = await account();
    await ctx.sql(
      "UPDATE staff_users SET password_changed_at = now() - INTERVAL '200 days' WHERE id = $1",
      [other.id],
    );
    assert.deepEqual(
      expectStatus<{ passwordMaxAgeDays: number }>(
        await admin.get("/admin/settings/security"),
        200,
      ).passwordMaxAgeDays,
      180,
    );
    for (const bad of [0, 3651, 1.5, "90"]) {
      assert.equal(
        (
          await admin.put("/admin/settings/security", {
            passwordMaxAgeDays: bad,
          })
        ).status,
        422,
        String(bad),
      );
    }
    assert.equal(
      (
        await (
          await ctx.as("KUI")
        ).put("/admin/settings/security", {
          passwordMaxAgeDays: 365,
        })
      ).status,
      403,
    );
    expectStatus(
      await admin.put("/admin/settings/security", { passwordMaxAgeDays: 365 }),
      200,
    );
    assert.ok((await ctx.staffLogin(other.email, TEST_PASSWORD)).client);
    expectStatus(
      await admin.put("/admin/settings/security", { passwordMaxAgeDays: 180 }),
      200,
    );
  });

  it("a password ADMIN set must be replaced at the owner's first login", async () => {
    seq += 1;
    const email = `baharu.keselamatan${seq}@ujian.gov.my`;
    const created = expectStatus<{ passwordChangeRequired: boolean }>(
      await admin.post("/admin/staff", {
        email,
        fullName: "Staf Baharu",
        role: "PSU",
        password: TEST_PASSWORD,
      }),
      201,
    );
    assert.equal(created.passwordChangeRequired, true);
    const first = await ctx.staffLogin(email, TEST_PASSWORD, {
      newPassword: "Kata-Laluan-Sendiri-7",
    });
    assert.ok(first.client);
    assert.ok((await ctx.staffLogin(email, "Kata-Laluan-Sendiri-7")).client);
  });
});

describe("(l) Lupa kata laluan", () => {
  it("resets by emailed code, unblocks the account, and signs out every session", async () => {
    const { id, email } = await account();
    const session = (await ctx.staffLogin(email, TEST_PASSWORD)).client!;
    for (let i = 0; i < 5; i++)
      await ctx.staffLogin(email, "Salah-Kata-Laluan-1");
    assert.equal((await ctx.staffLogin(email, TEST_PASSWORD)).status, 423);

    // Unknown email: same answer, a token, no email.
    const sentBefore = ctx.emails.length;
    const unknown = await post("/auth/forgot-password", {
      email: "tiada.siapa@ujian.gov.my",
      captchaToken: await ctx.captchaToken(),
    });
    assert.equal(unknown.status, 200);
    const unknownBody = (await json(unknown)).data as {
      resetToken: string;
      message: string;
    };
    assert.equal(ctx.emails.length, sentBefore);

    assert.equal(
      (await post("/auth/forgot-password", { email })).status,
      422,
      "captcha required",
    );
    const requested = await post("/auth/forgot-password", {
      email,
      captchaToken: await ctx.captchaToken(),
    });
    const body = (await json(requested)).data as {
      resetToken: string;
      message: string;
    };
    assert.equal(body.message, unknownBody.message);
    const code = lastCodeTo(email)!;
    assert.ok(code);

    // No code can satisfy the unknown email's token.
    assert.equal(
      (
        await post("/auth/reset-password", {
          resetToken: unknownBody.resetToken,
          code,
          newPassword: "Kata-Laluan-Set-Semula-1",
        })
      ).status,
      401,
    );
    // A weak or unchanged password is refused without spending the code.
    for (const newPassword of ["lemah", TEST_PASSWORD]) {
      assert.equal(
        (
          await post("/auth/reset-password", {
            resetToken: body.resetToken,
            code,
            newPassword,
          })
        ).status,
        422,
      );
    }
    assert.equal(
      (
        await post("/auth/reset-password", {
          resetToken: body.resetToken,
          code,
          newPassword: "Kata-Laluan-Set-Semula-1",
        })
      ).status,
      204,
    );

    assert.equal((await session.get("/auth/me")).status, 401);
    const { rows } = await ctx.sql<{ locked_until: Date | null; n: number }>(
      "SELECT locked_until, failed_login_count AS n FROM staff_users WHERE id = $1",
      [id],
    );
    assert.deepEqual(rows[0], { locked_until: null, n: 0 });
    assert.equal((await ctx.staffLogin(email, TEST_PASSWORD)).status, 401);
    assert.ok((await ctx.staffLogin(email, "Kata-Laluan-Set-Semula-1")).client);
  });
});
