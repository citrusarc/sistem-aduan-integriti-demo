/**
 * §8 decision 7 over the real HTTP API: ADMIN-only staff management, and that
 * deactivation, password resets, and role changes take effect immediately.
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

type Account = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  hasPassword: boolean;
};

let ctx: TestContext;
let admin: Client;

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

/** Full sign-in (captcha, password, emailed code); the client when a session opened. */
async function login(email: string, password: string) {
  const result = await ctx.staffLogin(email, password);
  return {
    status: result.status,
    changeRequired: Boolean(result.changeToken),
    client: result.client ?? ctx.anonymous,
  };
}

/**
 * ADMIN-created accounts must replace their password at first login (§8
 * decision 14). Tests about other behaviour skip that step here; the
 * password-security tests cover it.
 */
async function createAccount(email: string, role: string): Promise<Account> {
  const account = expectStatus<Account>(
    await admin.post("/admin/staff", {
      email,
      fullName: `Staf ${role}`,
      role,
      password: TEST_PASSWORD,
    }),
    201,
  );
  await ctx.sql(
    "UPDATE staff_users SET must_change_password = false WHERE id = $1",
    [account.id],
  );
  return account;
}

before(async () => {
  ctx = await startTestContext();
  admin = await ctx.as("ADMIN");
});

after(async () => {
  await ctx.close();
});

describe("staff management is ADMIN only", () => {
  it("every other role gets 403 on every endpoint; anonymous gets 401", async () => {
    const target = await createAccount("sasaran@ujian.gov.my", "PSU");
    const calls: [string, string, unknown?][] = [
      ["GET", "/admin/staff"],
      [
        "POST",
        "/admin/staff",
        {
          email: "x@ujian.gov.my",
          fullName: "X",
          role: "KUI",
          password: TEST_PASSWORD,
        },
      ],
      ["PUT", `/admin/staff/${target.id}/role`, { role: "KUI" }],
      [
        "POST",
        `/admin/staff/${target.id}/password`,
        { password: TEST_PASSWORD },
      ],
      ["POST", `/admin/staff/${target.id}/deactivate`],
      ["POST", `/admin/staff/${target.id}/activate`],
    ];

    for (const role of ["KUI", "PI", "KJ", "SUB_UNIT"] as const) {
      const client = await ctx.as(role);
      for (const [method, path, body] of calls) {
        const res =
          method === "GET"
            ? await client.get(path)
            : method === "PUT"
              ? await client.put(path, body)
              : await client.post(path, body);
        assert.equal(res.status, 403, `${role} ${method} ${path}`);
      }
    }
    for (const [method, path, body] of calls) {
      const res =
        method === "GET"
          ? await ctx.anonymous.get(path)
          : method === "PUT"
            ? await ctx.anonymous.put(path, body)
            : await ctx.anonymous.post(path, body);
      assert.equal(res.status, 401, `anonymous ${method} ${path}`);
    }

    const unchanged = await ctx.sql<{ role: string; is_active: boolean }>(
      "SELECT role::text, is_active FROM staff_users WHERE id = $1",
      [target.id],
    );
    assert.deepEqual(unchanged.rows[0], { role: "PSU", is_active: true });
    assert.equal(
      (
        await ctx.sql(
          "SELECT 1 FROM staff_users WHERE email = 'x@ujian.gov.my'",
        )
      ).rowCount,
      0,
    );
  });
});

describe("ADMIN staff operations", () => {
  it("lists accounts without password hashes", async () => {
    const res = await admin.get<Account[]>("/admin/staff");
    const accounts = expectStatus(res, 200);
    assert.ok(accounts.length >= 5);
    assert.ok(accounts.every((a) => a.hasPassword));
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("scrypt$"));
    assert.ok(!raw.toLowerCase().includes("password_hash"));
    assert.ok(!raw.includes("passwordHash"));
  });

  it("creates an account that can sign in; refuses weak passwords, bad roles, and taken emails", async () => {
    const created = await createAccount("baharu@ujian.gov.my", "PSU");
    assert.equal(created.role, "PSU");
    assert.equal(created.isActive, true);
    assert.equal(
      (await login("baharu@ujian.gov.my", TEST_PASSWORD)).status,
      200,
    );

    const bad = [
      {
        email: "lemah@ujian.gov.my",
        fullName: "Lemah",
        role: "PSU",
        password: "pendek",
      },
      {
        email: "peranan@ujian.gov.my",
        fullName: "Peranan",
        role: "SUPERADMIN",
        password: TEST_PASSWORD,
      },
      {
        email: "bukan-emel",
        fullName: "Emel",
        role: "PSU",
        password: TEST_PASSWORD,
      },
    ];
    for (const body of bad) {
      assert.equal(
        (await admin.post("/admin/staff", body)).status,
        422,
        body.email,
      );
    }
    assert.equal(
      (
        await admin.post("/admin/staff", {
          email: "BAHARU@ujian.gov.my",
          fullName: "Pendua",
          role: "PI",
          password: TEST_PASSWORD,
        })
      ).status,
      409,
    );
  });

  it("a role change applies on the account's very next request", async () => {
    const account = await createAccount("tukar.peranan@ujian.gov.my", "PSU");
    const { client } = await login(account.email, TEST_PASSWORD);
    expectStatus(await client.get("/admin/complaints"), 200);

    const changed = expectStatus<Account>(
      await admin.put(`/admin/staff/${account.id}/role`, { role: "KJ" }),
      200,
    );
    assert.equal(changed.role, "KJ");
    assert.equal((await client.get("/admin/complaints")).status, 403);
    expectStatus(await client.get("/referrals/actions"), 200);

    assert.equal(
      (await admin.put(`/admin/staff/${account.id}/role`, { role: "ROOT" }))
        .status,
      422,
    );
    assert.equal(
      (await admin.put("/admin/staff/999999999/role", { role: "PI" })).status,
      404,
    );
  });

  it("password reset: old password stops working and existing sessions are signed out", async () => {
    const account = await createAccount("reset@ujian.gov.my", "PI");
    const { client } = await login(account.email, TEST_PASSWORD);
    expectStatus(await client.get("/auth/me"), 200);

    const newPassword = "Kata-Laluan-Baharu-67890";
    assert.equal(
      (
        await admin.post(`/admin/staff/${account.id}/password`, {
          password: "pendek",
        })
      ).status,
      422,
    );
    expectStatus(
      await admin.post(`/admin/staff/${account.id}/password`, {
        password: newPassword,
      }),
      200,
    );

    assert.equal((await client.get("/auth/me")).status, 401);
    assert.equal((await login(account.email, TEST_PASSWORD)).status, 401);
    // ADMIN set it, so the owner must replace it before getting a session.
    const afterReset = await login(account.email, newPassword);
    assert.equal(afterReset.status, 200);
    assert.equal(afterReset.changeRequired, true);
    assert.equal(
      (
        await admin.post("/admin/staff/999999999/password", {
          password: newPassword,
        })
      ).status,
      404,
    );
  });

  it("deactivated staff are signed out immediately and cannot sign in until reactivated", async () => {
    const account = await createAccount("nyahaktif@ujian.gov.my", "KJ");
    const first = await login(account.email, TEST_PASSWORD);
    const second = await login(account.email, TEST_PASSWORD);
    expectStatus(await first.client.get("/referrals/actions"), 200);
    expectStatus(await second.client.get("/auth/me"), 200);

    const deactivated = expectStatus<Account>(
      await admin.post(`/admin/staff/${account.id}/deactivate`),
      200,
    );
    assert.equal(deactivated.isActive, false);

    assert.equal((await first.client.get("/referrals/actions")).status, 401);
    assert.equal((await second.client.get("/auth/me")).status, 401);
    const sessions = await ctx.sql(
      "SELECT 1 FROM staff_sessions WHERE staff_id = $1",
      [account.id],
    );
    assert.equal(sessions.rowCount, 0);
    assert.equal((await login(account.email, TEST_PASSWORD)).status, 401);

    expectStatus(await admin.post(`/admin/staff/${account.id}/activate`), 200);
    const again = await login(account.email, TEST_PASSWORD);
    assert.equal(again.status, 200);
    expectStatus(await again.client.get("/referrals/actions"), 200);
  });

  it("refuses to leave the system without an active ADMIN", async () => {
    const { rows } = await ctx.sql<{ id: string }>(
      "SELECT id FROM staff_users WHERE role = 'ADMIN'",
    );
    const onlyAdmin = rows[0]!.id;
    assert.equal(rows.length, 1);

    assert.equal(
      (await admin.post(`/admin/staff/${onlyAdmin}/deactivate`)).status,
      409,
    );
    assert.equal(
      (await admin.put(`/admin/staff/${onlyAdmin}/role`, { role: "KUI" }))
        .status,
      409,
    );
    expectStatus(await admin.get("/admin/staff"), 200);

    const second = await createAccount("admin.kedua@ujian.gov.my", "ADMIN");
    expectStatus(await admin.post(`/admin/staff/${second.id}/deactivate`), 200);
    assert.equal(
      (await admin.post(`/admin/staff/${onlyAdmin}/deactivate`)).status,
      409,
    );
    expectStatus(await admin.post(`/admin/staff/${second.id}/activate`), 200);

    // With a second active ADMIN, the first may step down.
    const demoted = expectStatus<Account>(
      await admin.put(`/admin/staff/${onlyAdmin}/role`, { role: "KUI" }),
      200,
    );
    assert.equal(demoted.role, "KUI");
    assert.equal((await admin.get("/admin/staff")).status, 403);
  });
});
