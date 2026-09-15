import { config } from "../config.js";

/**
 * notifyByEmail() — the ONE outbound channel in this system. CLAUDE.md §6
 * business rule 10 / §8 decision 8.
 *
 * Email only. There is no SMS channel, provider, or fallback, and there must
 * never be one: `complainants.contact_phone` exists for staff to dial by hand,
 * and nothing in code sends to it. This function refuses anything that isn't
 * an email address, so a phone number can't be routed through it by mistake.
 *
 * Locally, a message is printed to the BE console (that's where complainants'
 * OTP codes show up during development). In production it refuses to run
 * until a real mail transport is wired in here — printing OTP codes into
 * production logs would be a credential leak.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

const EMAIL_ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

let captured: EmailMessage[] | undefined;

export async function notifyByEmail(message: EmailMessage): Promise<void> {
  if (!EMAIL_ADDRESS.test(message.to)) {
    throw new Error("notifyByEmail: penerima mesti alamat e-mel");
  }

  if (captured) {
    captured.push({ ...message });
    return;
  }

  if (config.isProduction) {
    throw new Error(
      "notifyByEmail: tiada pengangkutan e-mel dikonfigurasi untuk produksi",
    );
  }

  console.log(
    [
      "",
      "──────── E-MEL (tempatan, tidak dihantar) ────────",
      `Kepada : ${message.to}`,
      `Subjek : ${message.subject}`,
      "",
      message.text,
      "──────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}

/**
 * Tests only: from now on, messages are collected in the returned array instead
 * of printed. Refuses outside NODE_ENV=test so it can't silently swallow real
 * mail.
 */
export function captureEmailsForTests(): EmailMessage[] {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("captureEmailsForTests hanya untuk NODE_ENV=test");
  }
  captured = [];
  return captured;
}
