import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { checkPasswordPolicy, hashPassword } from "../auth/password.js";
import {
  createStaffAccount,
  getSecuritySettings,
  getStaffAccount,
  listStaffAccounts,
  setPassword,
  setStaffActive,
  setStaffRole,
  unlockStaffAccount,
  updateSecuritySettings,
  type SecuritySettingsRow,
} from "../auth/store.js";
import { idSchema } from "../validation/common.js";
import {
  createStaffSchema,
  resetStaffPasswordSchema,
  setStaffRoleSchema,
} from "../validation/staff.js";
import { toStaffAccount } from "../db/mappers.js";

/**
 * Staff account management — §8 decision 7. ADMIN ONLY: narrower than the
 * Integrity Unit gate, so KUI, PI and the rest get 403 as well. Everything goes
 * through src/auth/store.ts, the same functions `npm run staff` uses.
 *
 * Staff change their OWN password at POST /api/auth/password, not here.
 */
export const adminStaffRouter: Router = Router();
adminStaffRouter.use(requirePermission("users.manage"));

async function accountOr404(id: string) {
  const account = await getStaffAccount(id);
  if (!account) throw new HttpError(404, "Akaun staf tidak dijumpai");
  return account;
}

adminStaffRouter.get("/", async (_req, res) => {
  res.json({ data: (await listStaffAccounts()).map(toStaffAccount) });
});

adminStaffRouter.post("/", async (req, res) => {
  const parsed = createStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const policyError = checkPasswordPolicy(parsed.data.password);
  if (policyError) throw new HttpError(422, policyError);

  const account = await createStaffAccount({
    email: parsed.data.email,
    fullName: parsed.data.fullName,
    role: parsed.data.role,
    passwordHash: await hashPassword(parsed.data.password),
    // §8 decision 14 (c): ADMIN knows this password, so the owner replaces it.
    mustChangePassword: true,
  });
  res.status(201).json({ data: toStaffAccount(account) });
});

/** Takes effect on the account's next request. 409 if it would leave no active ADMIN. */
adminStaffRouter.put("/:id/role", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = setStaffRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const account = await setStaffRole(id, parsed.data.role);
  res.json({ data: toStaffAccount(account) });
});

/**
 * Sets a new password, clears any block, and signs the account out
 * everywhere — except the ADMIN's own current session when resetting their
 * own account. Someone else's account must replace the password at its next
 * login (§8 decision 14 (c)).
 */
adminStaffRouter.post("/:id/password", async (req, res) => {
  const id = idSchema.parse(req.params.id);

  const parsed = resetStaffPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }
  const policyError = checkPasswordPolicy(parsed.data.password);
  if (policyError) throw new HttpError(422, policyError);

  await accountOr404(id);
  const own = id === req.user!.id;
  await setPassword(
    id,
    await hashPassword(parsed.data.password),
    own ? req.sessionToken : undefined,
    !own,
  );
  res.json({ data: toStaffAccount(await accountOr404(id)) });
});

/** Signs the account out immediately. 409 if it would leave no active ADMIN. */
adminStaffRouter.post("/:id/deactivate", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const account = await setStaffActive(id, false);
  res.json({ data: toStaffAccount(account) });
});

/** §8 decision 14 (d): lifts a block from 5 failed passwords. */
adminStaffRouter.post("/:id/unlock", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const account = await unlockStaffAccount(id);
  if (!account) throw new HttpError(404, "Akaun staf tidak dijumpai");
  res.json({ data: toStaffAccount(account) });
});

adminStaffRouter.post("/:id/activate", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const account = await setStaffActive(id, true);
  res.json({ data: toStaffAccount(account) });
});

/**
 * Security settings — §8 decision 14 (c). ADMIN only. The password expiry
 * period applies from each account's next login.
 */
export const adminSettingsRouter: Router = Router();
adminSettingsRouter.use(requirePermission("security.manage"));

function toSecuritySettings(row: SecuritySettingsRow) {
  return {
    passwordMaxAgeDays: row.password_max_age_days,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  };
}

adminSettingsRouter.get("/security", async (_req, res) => {
  res.json({ data: toSecuritySettings(await getSecuritySettings()) });
});

adminSettingsRouter.put("/security", async (req, res) => {
  const parsed = z
    .object({
      passwordMaxAgeDays: z
        .number()
        .int("Tempoh mesti nombor bulat")
        .min(1, "Tempoh sekurang-kurangnya 1 hari")
        .max(3650, "Tempoh tidak boleh melebihi 3650 hari"),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }
  const row = await updateSecuritySettings(
    parsed.data.passwordMaxAgeDays,
    req.user!.id,
  );
  console.log(
    `[Tetapan] Tempoh luput kata laluan: ${row.password_max_age_days} hari (oleh ${req.user!.email})`,
  );
  res.json({ data: toSecuritySettings(row) });
});
