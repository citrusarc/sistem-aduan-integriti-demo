import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { complaintRefNoSchema } from "../validation/common.js";
import { publicCreateComplaintSchema } from "../validation/complaints.js";
import { notifyByEmail } from "../notify/email.js";
import { config } from "../config.js";
import {
  recordSubmission,
  submissionAllowance,
} from "../middleware/rateLimit.js";
import { assessDuplicate } from "../duplicates/assess.js";
import {
  acceptFiles,
  inspectFiles,
  removeStoredFiles,
  requestBody,
  storeFiles,
  uploadedFiles,
} from "../attachments/files.js";
import {
  countRecentComplaintsForEmail,
  createComplaint,
  findDuplicateCandidates,
  getPubliclyDisclosableComplaintByRefNo,
  listStatusHistory,
} from "../db/queries/complaints.js";
import { toPublicComplaint, toStatusTimeline } from "../db/mappers.js";
import { malaysiaToday } from "../db/reportPeriod.js";

/**
 * PUBLIC portal API. Business rule 9: nothing from `jmm_decisions`, and no
 * `ui_remarks` / `psu_action_notes`, may leave through these handlers. Every
 * response here goes through `toPublicComplaint`, which allow-lists fields
 * rather than stripping them.
 */
export const publicComplaintsRouter: Router = Router();

/**
 * §8 decisions 3, 10 and 11 — the complainant block (named, or anonymous with
 * no details at all) and the disclaimer acknowledgement are required; see
 * publicCreateComplaintSchema.
 *
 * JSON, or multipart/form-data with the same JSON in `payload` and supporting
 * documents in `files`. Files are checked with the body but written to disk
 * only once the complaint is certain to be registered.
 */
publicComplaintsRouter.post(
  "/",
  submissionAllowance,
  acceptFiles,
  async (req, res) => {
    const parsed = publicCreateComplaintSchema.safeParse(requestBody(req));
    if (!parsed.success) {
      throw new HttpError(422, z.prettifyError(parsed.error));
    }

    const body = parsed.data;
    const files = uploadedFiles(req);
    // Type check (and, for anonymous complainants, metadata stripping) before
    // the duplicate check, so a bad file is reported on the first attempt.
    const checkedFiles = inspectFiles(files, {
      stripMetadata: body.complainant.isAnonymous,
    });

    /**
     * Business rule 5 — never silently register a possible repeat as new.
     * A portal submission that matches an existing case is held and returned to
     * the caller as 409 with the candidates, rather than inserted.
     */
    if (!body.duplicateCheckAcknowledged) {
      const candidates = await findDuplicateCandidates({
        accusedParticulars: body.accusedParticulars,
        accusedDepartment: body.accusedDepartment,
        accused2Particulars: body.accused2Particulars,
        accused2Department: body.accused2Department,
        caseDescription: body.caseDescription,
        excludeNfa: true,
      });

      if (candidates.length) {
        /**
         * Only a count crosses this boundary. Returning the matched reference
         * numbers would let anyone probe for the existence and subject of other
         * people's complaints by submitting guesses — the admin duplicate-check
         * endpoint is where staff see the actual candidates.
         */
        res.status(409).json({
          error: "Aduan ini mungkin pertindihan dengan aduan sedia ada",
          possibleDuplicateCount: candidates.length,
        });
        return;
      }
    }

    // The portal is the "Sistem Aduan Integriti" channel on both the Masterlist
    // and the Lampiran 2 lists, and a submission reaches the unit the moment
    // it's made — so it's dated, received and filed under today. When the
    // incident happened is the complainant's own `incidentDate`.
    const contactEmail = body.complainant.contactEmail ?? null;

    // §8 decision 16: always registered; a likely repeat is only flagged for
    // staff. Scored against every case, NFA included — the result never leaves
    // the Integrity Unit, and nothing in the response depends on it.
    const suspicion = await assessDuplicate({
      ...body,
      contactEmail: body.complainant.isAnonymous ? null : contactEmail,
    });
    // Counted before the insert, so this complaint isn't in its own count.
    const recentForAddress = contactEmail
      ? await countRecentComplaintsForEmail(contactEmail, 24)
      : 0;

    const today = malaysiaToday();
    const attachments = await storeFiles(checkedFiles);
    let complaint;
    try {
      complaint = await createComplaint({
        ...body,
        sourceChannel: "SAI",
        receivedVia: "SISTEM_ADUAN_INTEGRITI",
        complaintDate: today.date,
        receivedDateUi: today.date,
        reportYear: today.reportYear,
        reportMonth: today.reportMonth,
        disclaimerAcknowledged: true,
        // DOKUMEN SOKONGAN: ADA when something was attached. The portal doesn't
        // ask; without files it isn't stated (NULL), not TIADA.
        hasSupportingDocuments: attachments.length ? true : null,
        attachments,
        suspectedDuplicate: suspicion,
      });
    } catch (err) {
      await removeStoredFiles(attachments);
      throw err;
    }

    recordSubmission(req);

    /**
     * Acknowledgement with the reference number, by email only (rule 10) — and
     * only when there is an email. A phone number is never contacted.
     *
     * §8 decision 16: held back when this address already sent a likely repeat,
     * or has had its daily allowance of acknowledgements — the form can't be
     * used to flood an inbox, including someone else's. The response is the
     * same either way: saying why would tell anyone typing an address whether
     * that address has filed complaints.
     */
    const holdBack = !contactEmail
      ? null
      : suspicion?.sameSender
        ? `pendua kepada ${suspicion.complaintRefNo} daripada e-mel yang sama`
        : recentForAddress >= config.portal.ackEmailsPerAddressPerDay
          ? `had ${config.portal.ackEmailsPerAddressPerDay} e-mel pengesahan sehari dicapai`
          : null;
    if (contactEmail && holdBack) {
      console.log(
        `[Aduan] Pengesahan ${complaint.complaint_ref_no} tidak dihantar ke ${contactEmail}: ${holdBack}.`,
      );
    } else if (contactEmail) {
      void notifyByEmail({
        to: contactEmail,
        subject: `Aduan diterima: ${complaint.complaint_ref_no}`,
        text: [
          "Aduan anda telah diterima oleh Unit Integriti.",
          "",
          `No. rujukan: ${complaint.complaint_ref_no}`,
          "",
          "Simpan nombor rujukan ini untuk menyemak status aduan anda.",
        ].join("\n"),
      }).catch((err: unknown) => {
        // The complaint is registered and the reference number is in the
        // response; a failed acknowledgement must not turn that into an error.
        console.error("Gagal menghantar pengesahan aduan:", err);
      });
    }

    res.status(201).json({ data: toPublicComplaint(complaint) });
  },
);

publicComplaintsRouter.get("/:refNo", async (req, res) => {
  const parsed = complaintRefNoSchema.safeParse(req.params.refNo);
  if (!parsed.success) {
    throw new HttpError(400, "No. rujukan tidak sah");
  }

  /**
   * Business rule 2 — an NFA complaint is filtered out at the query layer and
   * is answered here exactly like a reference number that does not exist. The
   * two cases must stay indistinguishable: a different message would itself
   * disclose that an NFA decision was made.
   */
  const complaint = await getPubliclyDisclosableComplaintByRefNo(parsed.data);
  if (!complaint) {
    throw new HttpError(404, "Aduan tidak dijumpai");
  }

  // §8 decision 13: status and time per step, nothing else.
  const history = await listStatusHistory(complaint.id);
  res.json({
    data: {
      ...toPublicComplaint(complaint),
      timeline: toStatusTimeline(history),
    },
  });
});
