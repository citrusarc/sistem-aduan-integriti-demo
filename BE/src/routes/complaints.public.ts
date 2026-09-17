import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { complaintRefNoSchema } from "../validation/common.js";
import { publicCreateComplaintSchema } from "../validation/complaints.js";
import { notifyByEmail } from "../notify/email.js";
import {
  createComplaint,
  findDuplicateCandidates,
  getPubliclyDisclosableComplaintByRefNo,
} from "../db/queries/complaints.js";
import { toPublicComplaint } from "../db/mappers.js";
import { malaysiaToday } from "../db/reportPeriod.js";

/**
 * PUBLIC portal API. Business rule 9: nothing from `jmm_decisions`, and no
 * `ui_remarks` / `psu_action_notes`, may leave through these handlers. Every
 * response here goes through `toPublicComplaint`, which allow-lists fields
 * rather than stripping them.
 */
export const publicComplaintsRouter: Router = Router();

/**
 * §8 decision 3 — the complainant block (named, or anonymous with a contact
 * email) and the disclaimer acknowledgement are required; see
 * publicCreateComplaintSchema.
 */
publicComplaintsRouter.post("/", async (req, res) => {
  const parsed = publicCreateComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(422, z.prettifyError(parsed.error));
  }

  const body = parsed.data;

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
  const today = malaysiaToday();
  const complaint = await createComplaint({
    ...body,
    sourceChannel: "SAI",
    receivedVia: "SISTEM_ADUAN_INTEGRITI",
    complaintDate: today.date,
    receivedDateUi: today.date,
    reportYear: today.reportYear,
    reportMonth: today.reportMonth,
    disclaimerAcknowledged: true,
  });

  // Acknowledgement with the reference number, by email only (rule 10) — and
  // only when there is an email. A phone number is never contacted.
  const contactEmail = body.complainant.contactEmail;
  if (contactEmail) {
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
});

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

  res.json({ data: toPublicComplaint(complaint) });
});
