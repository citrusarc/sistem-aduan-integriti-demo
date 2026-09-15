import { TEST_DATABASE_URL } from "./env.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { closePool, query } from "../db/client.js";
import { reset } from "../db/migrate.js";
import { hashPassword } from "../auth/password.js";
import { captureEmailsForTests, type EmailMessage } from "../notify/email.js";
import type { StaffRole } from "../types/enums.js";

export const TEST_PASSWORD = "kata-laluan-ujian-12345";

export type ApiResponse<T = unknown> = {
  status: number;
  body: { data?: T; error?: string } & Record<string, unknown>;
};

export type Client = {
  get<T = unknown>(path: string): Promise<ApiResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  delete<T = unknown>(path: string): Promise<ApiResponse<T>>;
};

export type TestContext = {
  anonymous: Client;
  as(role: StaffRole): Promise<Client>;
  /** Signs a complainant in through the real OTP flow, reading the emailed code. */
  complainant(email: string): Promise<Client>;
  /** A client sending exactly this Cookie header. */
  withCookie(cookie: string): Client;
  /** Every message passed to notifyByEmail() since the context started. */
  emails: EmailMessage[];
  /** Raw fetch against the API, for reading response headers. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  sql: typeof query;
  close(): Promise<void>;
};

/**
 * Fresh database (schema + every migration), one staff account per role, and
 * the real app on an ephemeral port. Requests go over HTTP so the auth gate,
 * validation, and error handler are all exercised as in production.
 */
export async function startTestContext(): Promise<TestContext> {
  await reset(TEST_DATABASE_URL, { log: () => {} });
  const emails = captureEmailsForTests();

  const passwordHash = await hashPassword(TEST_PASSWORD);
  const roles: StaffRole[] = ["KUI", "PI", "ADMIN", "KJ", "SUB_UNIT"];
  for (const role of roles) {
    await query(
      `INSERT INTO staff_users (full_name, role, email, password_hash, password_changed_at)
       VALUES ($1, $2, $3, $4, now())`,
      [`Ujian ${role}`, role, emailFor(role), passwordHash],
    );
  }

  const server: Server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const clientFor = (cookie?: string): Client => {
    const send = async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<ApiResponse<T>> => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { "Content-Type": "application/json" }),
          ...(cookie && { Cookie: cookie }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : {} };
    };
    return {
      get: (path) => send("GET", path),
      post: (path, body) => send("POST", path, body ?? {}),
      patch: (path, body) => send("PATCH", path, body ?? {}),
      put: (path, body) => send("PUT", path, body ?? {}),
      delete: (path) => send("DELETE", path),
    };
  };

  const sessions = new Map<StaffRole, Client>();
  const cookieFrom = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

  return {
    anonymous: clientFor(),
    withCookie: clientFor,
    emails,
    fetch: (path, init) => fetch(`${base}${path}`, init),
    async complainant(email) {
      const before = emails.length;
      const requested = await fetch(`${base}/complainant/auth/request-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (requested.status !== 202) {
        throw new Error(`Minta kod gagal: ${requested.status}`);
      }
      const message = emails
        .slice(before)
        .find((m) => m.to === email.toLowerCase());
      const code = message?.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) throw new Error(`Tiada kod dihantar kepada ${email}`);

      const verified = await fetch(`${base}/complainant/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (verified.status !== 200) {
        throw new Error(`Pengesahan kod gagal: ${verified.status}`);
      }
      return clientFor(cookieFrom(verified));
    },
    async as(role) {
      const cached = sessions.get(role);
      if (cached) return cached;

      const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailFor(role),
          password: TEST_PASSWORD,
        }),
      });
      if (res.status !== 200) {
        throw new Error(`Log masuk ${role} gagal: ${res.status}`);
      }
      const client = clientFor(cookieFrom(res));
      sessions.set(role, client);
      return client;
    },
    sql: query,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await closePool();
    },
  };
}

function emailFor(role: StaffRole): string {
  return `${role.toLowerCase()}@ujian.gov.my`;
}
