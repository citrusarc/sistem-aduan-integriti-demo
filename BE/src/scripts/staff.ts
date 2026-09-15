/**
 * Staff account management from the terminal. ADMIN staff can do the same over
 * HTTP (/api/admin/staff); both go through the functions in src/auth/store.ts.
 * This is how the first ADMIN gets in.
 *
 *   npm run staff -- create <email> <role> "<full name>"
 *   npm run staff -- set-role <email> <role>
 *   npm run staff -- set-password <email>
 *   npm run staff -- deactivate <email>
 *   npm run staff -- activate <email>
 *   npm run staff -- list
 *
 * Passwords are read from a hidden prompt, or from stdin when piped — never
 * from argv, where they'd land in shell history and `ps` output.
 */
import { createInterface } from "node:readline";
import { closePool } from "../db/client.js";
import { checkPasswordPolicy, hashPassword } from "../auth/password.js";
import {
  createStaffAccount,
  findStaffIdByEmail,
  listStaffAccounts,
  setPassword,
  setStaffActive,
  setStaffRole,
} from "../auth/store.js";
import { STAFF_ROLE, type StaffRole } from "../types/enums.js";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let muted = false;
  // Suppress echo of typed characters while leaving the prompt visible.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (
    s: string,
  ) => {
    if (!muted) process.stdout.write(s);
  };

  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, resolve);
    muted = true;
  });
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function promptNewPassword(): Promise<string> {
  const password = await readPassword("Kata laluan baharu: ");
  const policyError = checkPasswordPolicy(password);
  if (policyError) fail(policyError);

  if (process.stdin.isTTY) {
    const confirm = await readPassword("Sahkan kata laluan: ");
    if (confirm !== password) fail("Kata laluan tidak sepadan");
  }
  return password;
}

async function findStaffId(email: string): Promise<string> {
  const id = await findStaffIdByEmail(email);
  if (!id) fail(`Tiada staf dengan e-mel ${email}`);
  return id;
}

function parseRole(role: string | undefined): StaffRole {
  if (!role || !(STAFF_ROLE as readonly string[]).includes(role)) {
    fail(`Peranan tidak sah. Pilih salah satu: ${STAFF_ROLE.join(", ")}`);
  }
  return role as StaffRole;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "create": {
      const [email, role, ...nameParts] = args;
      const fullName = nameParts.join(" ").trim();
      if (!email || !role || !fullName) {
        fail('Guna: create <email> <role> "<full name>"');
      }
      const account = await createStaffAccount({
        email,
        fullName,
        role: parseRole(role),
        passwordHash: await hashPassword(await promptNewPassword()),
      });
      console.log(
        `✔ Staf dicipta: ${email} (${account.role}), id ${account.id}`,
      );
      break;
    }

    case "set-role": {
      const [email, role] = args;
      if (!email) fail("Guna: set-role <email> <role>");
      const account = await setStaffRole(
        await findStaffId(email),
        parseRole(role),
      );
      console.log(`✔ Peranan ${email} kini ${account.role}`);
      break;
    }

    case "set-password": {
      const [email] = args;
      if (!email) fail("Guna: set-password <email>");
      const id = await findStaffId(email);
      // Also clears any lockout, and signs the person out everywhere.
      await setPassword(id, await hashPassword(await promptNewPassword()));
      console.log(`✔ Kata laluan ditetapkan; semua sesi ${email} ditamatkan`);
      break;
    }

    case "deactivate": {
      const [email] = args;
      if (!email) fail("Guna: deactivate <email>");
      await setStaffActive(await findStaffId(email), false);
      console.log(`✔ ${email} dinyahaktifkan; semua sesi ditamatkan`);
      break;
    }

    case "activate": {
      const [email] = args;
      if (!email) fail("Guna: activate <email>");
      await setStaffActive(await findStaffId(email), true);
      console.log(`✔ ${email} diaktifkan`);
      break;
    }

    case "list": {
      const rows = await listStaffAccounts();
      console.table(
        rows.map((r) => ({
          email: r.email,
          role: r.role,
          full_name: r.full_name,
          is_active: r.is_active,
          has_password: r.has_password,
          locked: r.locked,
        })),
      );
      break;
    }

    default:
      fail(
        "Arahan: create | set-role | set-password | deactivate | activate | list",
      );
  }
}

main()
  .catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  })
  .finally(() => closePool());
