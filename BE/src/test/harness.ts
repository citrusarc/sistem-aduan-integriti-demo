import { TEST_DATABASE_URL } from "./env.js";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { closePool, query } from "../db/client.js";
import { reset } from "../db/migrate.js";
import { hashPassword } from "../auth/password.js";
import { captureEmailsForTests, type EmailMessage } from "../notify/email.js";
import type { StaffRole } from "../types/enums.js";

/** Meets §8 decision 14 (b): upper, lower, digit, special, 12+. */
export const TEST_PASSWORD = "Kata-Laluan-Ujian-12345";

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
  /** multipart/form-data, as the browser sends a submission with files. */
  postForm<T = unknown>(path: string, form: FormData): Promise<ApiResponse<T>>;
  /** The raw response, for downloads and headers. */
  raw(path: string): Promise<Response>;
};

/**
 * The outcome of the full staff sign-in (captcha -> password -> emailed code).
 * `status` is the HTTP status of the step that ended it.
 */
export type StaffLoginResult = {
  status: number;
  error?: string;
  client?: Client;
  /** Password expired or set by ADMIN: no session until it's replaced. */
  changeToken?: string;
};

export type TestContext = {
  anonymous: Client;
  /**
   * Signs staff in like the browser: solves the captcha (reading the answer
   * from the database), posts the password, reads the emailed code. With
   * `newPassword`, completes a required password change too.
   */
  staffLogin(
    email: string,
    password: string,
    options?: { newPassword?: string },
  ): Promise<StaffLoginResult>;
  /** A fresh captcha pass token, for /auth/login or /auth/forgot-password. */
  captchaToken(): Promise<string>;
  as(role: StaffRole): Promise<Client>;
  /**
   * A signed-in PENGADU account for `email` (§8 decision 15): registers it
   * through the real flow (captcha, emailed code) with TEST_PASSWORD, or signs
   * it in if it already exists.
   */
  complainant(email: string): Promise<Client>;
  /** POST /auth/register with a solved captcha. The raw response. */
  register(input: {
    email: string;
    fullName: string;
    password?: string;
  }): Promise<Response>;
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
      async postForm<T>(path: string, form: FormData) {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: cookie ? { Cookie: cookie } : {},
          body: form,
        });
        const text = await res.text();
        return {
          status: res.status,
          body: text ? JSON.parse(text) : {},
        } as ApiResponse<T>;
      },
      raw: (path) =>
        fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} }),
    };
  };

  const sessions = new Map<StaffRole, Client>();
  const cookieFrom = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie && { Cookie: cookie }),
      },
      body: JSON.stringify(body),
    });

  async function captchaToken(): Promise<string> {
    const challenge = (await (await fetch(`${base}/auth/captcha`)).json()) as {
      data: { challengeToken: string };
    };
    const { rows } = await query<{ target_x: number }>(
      "SELECT target_x FROM staff_captcha_challenges WHERE id = $1",
      [
        createHash("sha256")
          .update(challenge.data.challengeToken)
          .digest("hex"),
      ],
    );
    const solved = await post("/auth/captcha/verify", {
      challengeToken: challenge.data.challengeToken,
      x: rows[0]!.target_x,
    });
    const body = (await solved.json()) as { data: { captchaToken: string } };
    return body.data.captchaToken;
  }

  async function register(input: {
    email: string;
    fullName: string;
    password?: string;
  }): Promise<Response> {
    return post("/auth/register", {
      email: input.email,
      fullName: input.fullName,
      password: input.password ?? TEST_PASSWORD,
      captchaToken: await captchaToken(),
    });
  }

  async function staffLogin(
    email: string,
    password: string,
    options: { newPassword?: string } = {},
  ): Promise<StaffLoginResult> {
    const before = emails.length;
    const login = await post("/auth/login", {
      email,
      password,
      captchaToken: await captchaToken(),
    });
    const loginBody = (await login.json()) as {
      data?: { mfaToken: string };
      error?: string;
    };
    if (login.status !== 200) {
      return { status: login.status, error: loginBody.error };
    }
    const code = emails
      .slice(before)
      .filter((m) => m.to.toLowerCase() === email.toLowerCase())
      .at(-1)
      ?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`Tiada kod MFA dihantar kepada ${email}`);

    const verified = await post("/auth/login/verify", {
      mfaToken: loginBody.data!.mfaToken,
      code,
    });
    const verifiedBody = (await verified.json()) as {
      data?: { passwordChangeRequired?: boolean; changeToken?: string };
      error?: string;
    };
    if (verified.status !== 200) {
      return { status: verified.status, error: verifiedBody.error };
    }
    if (verifiedBody.data?.passwordChangeRequired) {
      const changeToken = verifiedBody.data.changeToken!;
      if (!options.newPassword) return { status: 200, changeToken };
      const changed = await post("/auth/password/expired", {
        changeToken,
        newPassword: options.newPassword,
      });
      if (changed.status !== 200) {
        const body = (await changed.json()) as { error?: string };
        return { status: changed.status, error: body.error };
      }
      return { status: 200, client: clientFor(cookieFrom(changed)) };
    }
    return { status: 200, client: clientFor(cookieFrom(verified)) };
  }

  return {
    anonymous: clientFor(),
    staffLogin,
    captchaToken,
    withCookie: clientFor,
    emails,
    fetch: (path, init) => fetch(`${base}${path}`, init),
    register,
    async complainant(email) {
      const before = emails.length;
      const registered = await register({
        email,
        fullName: `Pengadu ${email}`,
      });
      if (registered.status !== 202) {
        throw new Error(`Pendaftaran gagal: ${registered.status}`);
      }
      const { data } = (await registered.json()) as {
        data: { verifyToken: string };
      };
      const code = emails
        .slice(before)
        .filter((m) => m.to === email.toLowerCase())
        .at(-1)
        ?.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) {
        // Already registered: no code, just a notice. Sign in instead.
        const login = await staffLogin(email, TEST_PASSWORD);
        if (!login.client) {
          throw new Error(`Log masuk ${email} gagal: ${login.status}`);
        }
        return login.client;
      }
      const verified = await post("/auth/register/verify", {
        verifyToken: data.verifyToken,
        code,
      });
      if (verified.status !== 200) {
        throw new Error(`Pengesahan pendaftaran gagal: ${verified.status}`);
      }
      return clientFor(cookieFrom(verified));
    },
    async as(role) {
      const cached = sessions.get(role);
      if (cached) return cached;

      const result = await staffLogin(emailFor(role), TEST_PASSWORD);
      if (!result.client) {
        throw new Error(
          `Log masuk ${role} gagal: ${result.status} ${result.error ?? ""}`,
        );
      }
      sessions.set(role, result.client);
      return result.client;
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
