/**
 * `npm run db:seed` produces what BE/README.md promises, through the real
 * business rules, and can be run again after a reset — but never on top of
 * existing data.
 */
import { TEST_DATABASE_URL } from "./env.js";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import { closePool, query } from "../db/client.js";
import { reset } from "../db/migrate.js";
import {
  SEED_COMPLAINANTS,
  SEED_STAFF,
  SeedError,
  seedDatabase,
} from "../db/seed.js";
import { STAFF_ROLE } from "../types/enums.js";

const quiet = { log: () => {} };

async function rows<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await query<T>(sql, params)).rows;
}

before(async () => {
  await reset(TEST_DATABASE_URL, quiet);
  await seedDatabase(quiet);
});

after(async () => {
  await closePool();
});

describe("db:seed", () => {
  it("one staff account per role", async () => {
    const staff = await rows<{ role: string; is_active: boolean }>(
      "SELECT role::text, is_active FROM staff_users ORDER BY role",
    );
    assert.deepEqual(staff.map((s) => s.role).sort(), [...STAFF_ROLE].sort());
    assert.ok(staff.every((s) => s.is_active));
  });

  it("about 30 complaints across all five statuses", async () => {
    const byStatus = await rows<{ status: string; n: number }>(
      "SELECT status::text, count(*)::int AS n FROM complaints GROUP BY 1",
    );
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
    for (const status of [
      "BARU",
      "MENUNGGU_JMM",
      "DALAM_TINDAKAN",
      "SELESAI",
      "NFA",
    ]) {
      assert.ok((counts[status] ?? 0) >= 3, `${status}: ${counts[status]}`);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.ok(total >= 25 && total <= 35, `total ${total}`);
  });

  it("one open meeting with an agenda and one closed meeting with every item decided", async () => {
    const meetings = await rows<{
      status: string;
      items: number;
      undecided: number;
    }>(
      `SELECT m.status::text,
              (SELECT count(*)::int FROM jmm_meeting_items i WHERE i.meeting_id = m.id) AS items,
              (SELECT count(*)::int FROM jmm_meeting_items i
                WHERE i.meeting_id = m.id
                  AND NOT EXISTS (SELECT 1 FROM jmm_decisions d
                                   WHERE d.meeting_id = m.id AND d.complaint_id = i.complaint_id)
              ) AS undecided
         FROM jmm_meetings m`,
    );
    const open = meetings.filter((m) => m.status === "DIJADUALKAN");
    const closed = meetings.filter((m) => m.status === "SELESAI");
    assert.equal(open.length, 1);
    assert.equal(closed.length, 1);
    assert.ok(open[0]!.items > 0);
    assert.ok(closed[0]!.items > 0);
    assert.equal(closed[0]!.undecided, 0);

    // Every MENUNGGU_JMM complaint is on the open meeting.
    const stranded = await rows(
      `SELECT 1 FROM complaints c
        WHERE c.status = 'MENUNGGU_JMM'
          AND NOT EXISTS (SELECT 1 FROM jmm_meeting_items i
                            JOIN jmm_meetings m ON m.id = i.meeting_id
                           WHERE i.complaint_id = c.id AND m.status = 'DIJADUALKAN')`,
    );
    assert.equal(stranded.length, 0);
  });

  it("signed and unsigned decisions, including NFA", async () => {
    const decisions = await rows<{ nfa: boolean; fully_signed: boolean }>(
      `SELECT d.outcome = 'NFA' AS nfa,
              NOT EXISTS (SELECT 1 FROM jmm_decision_signatories s
                           WHERE s.jmm_decision_id = d.id AND s.signed_at IS NULL) AS fully_signed
         FROM jmm_decisions d`,
    );
    assert.ok(decisions.some((d) => d.fully_signed));
    assert.ok(decisions.some((d) => !d.fully_signed));
    assert.ok(decisions.some((d) => d.nfa && d.fully_signed));
    assert.ok(decisions.some((d) => d.nfa && !d.fully_signed));
  });

  it("case actions referred to KJ and SUB_UNIT", async () => {
    const referred = await rows<{ role: string; n: number }>(
      `SELECT u.role::text, count(*)::int AS n
         FROM case_actions a JOIN staff_users u ON u.id = a.assigned_to_staff_id
        GROUP BY 1`,
    );
    const roles = Object.fromEntries(referred.map((r) => [r.role, r.n]));
    assert.ok((roles.KJ ?? 0) > 0);
    assert.ok((roles.SUB_UNIT ?? 0) > 0);
    assert.deepEqual(Object.keys(roles).sort(), ["KJ", "SUB_UNIT"]);
  });

  it("an anonymous complainant and an identified complainant with a contact email", async () => {
    const anonymous = await rows<{ particulars: string | null }>(
      "SELECT particulars FROM complainants WHERE is_anonymous AND contact_email = $1",
      [SEED_COMPLAINANTS.anonymous],
    );
    assert.ok(anonymous.length > 0);
    assert.ok(anonymous.every((a) => a.particulars === null));

    const identified = await rows<{ particulars: string | null }>(
      "SELECT particulars FROM complainants WHERE NOT is_anonymous AND contact_email = $1",
      [SEED_COMPLAINANTS.identified],
    );
    assert.ok(identified.length > 0);
    assert.ok(identified.every((c) => c.particulars));
  });

  it("a protection request in each status", async () => {
    const requests = await rows<{ status: string }>(
      "SELECT status::text FROM protection_requests",
    );
    assert.deepEqual(requests.map((r) => r.status).sort(), [
      "DILULUSKAN",
      "DITERIMA",
      "DITOLAK",
    ]);
  });

  it("the printed passwords sign in, and the seeded KJ inbox hides the NFA referral", async () => {
    const server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    try {
      const cookies = new Map<string, string>();
      for (const account of SEED_STAFF) {
        const res = await fetch(`${base}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: account.email,
            password: account.password,
          }),
        });
        assert.equal(res.status, 200, account.email);
        cookies.set(
          account.role,
          res.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
        );
      }

      const inbox = await fetch(`${base}/referrals/actions`, {
        headers: { Cookie: cookies.get("KJ")! },
      });
      const { data } = (await inbox.json()) as { data: { id: string }[] };

      const assignedToKj = await rows<{ id: string; nfa: boolean }>(
        `SELECT a.id, (c.status = 'NFA') AS nfa
           FROM case_actions a
           JOIN complaints c ON c.id = a.complaint_id
           JOIN staff_users u ON u.id = a.assigned_to_staff_id
          WHERE u.role = 'KJ'`,
      );
      assert.ok(
        assignedToKj.some((a) => a.nfa),
        "seed includes a referral on a later-NFA case",
      );
      assert.deepEqual(
        data.map((a) => a.id).sort(),
        assignedToKj
          .filter((a) => !a.nfa)
          .map((a) => a.id)
          .sort(),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses to seed a database that already has data, and runs again after a reset", async () => {
    await assert.rejects(seedDatabase(quiet), SeedError);

    await reset(TEST_DATABASE_URL, quiet);
    const summary = await seedDatabase(quiet);
    assert.equal(summary.complaints, 30);
  });
});
