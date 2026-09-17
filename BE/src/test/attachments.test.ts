/**
 * §8 decision 10 over the real HTTP API: supporting documents on a portal
 * submission and on a staff case file. Content typing, metadata stripping for
 * anonymous complainants, nothing written for a refused request, Integrity
 * Unit-only download, and nothing crossing the public boundary (rule 9).
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  startTestContext,
  type ApiResponse,
  type Client,
  type TestContext,
} from "./harness.js";

let ctx: TestContext;
let kui: Client;
let seq = 0;

const UPLOAD_DIR = () => process.env.UPLOAD_DIR!;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n", "latin1");

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** JFIF + an EXIF segment carrying a fake GPS string + a comment + scan data. */
const JPEG_WITH_EXIF = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
  segment(0xe1, Buffer.from("Exif\0\0GPS-3.1390N-101.6869E", "latin1")),
  segment(0xfe, Buffer.from("Kamera Pengadu", "latin1")),
  Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
]);

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    length,
    Buffer.from(type, "latin1"),
    data,
    Buffer.alloc(4),
  ]);
}

const PNG_WITH_TEXT = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", Buffer.alloc(13)),
  pngChunk("tEXt", Buffer.from("Author\0Nama Pengadu", "latin1")),
  pngChunk("IDAT", Buffer.from([1, 2, 3])),
  pngChunk("IEND", Buffer.alloc(0)),
]);

const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("....[Content_Types].xml....word/document.xml....", "latin1"),
]);
const DOCM = Buffer.concat([
  DOCX,
  Buffer.from("word/vbaProject.bin", "latin1"),
]);

type File = { name: string; bytes: Buffer };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data as T;
}

function form(payload: unknown, files: File[]): FormData {
  const data = new FormData();
  data.append("payload", JSON.stringify(payload));
  for (const f of files) data.append("files", new Blob([f.bytes]), f.name);
  return data;
}

function portalPayload(
  complainant: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return {
    caseDescription: `Aduan dengan dokumen ${seq} ${"d".repeat(seq)}`,
    hasSupportingDocuments: true,
    // A named portal complainant must identify themselves (§8 decision 12).
    complainant: complainant.isAnonymous
      ? complainant
      : { nationality: "WARGANEGARA", icNo: "900101145678", ...complainant },
    disclaimerAcknowledged: true,
    duplicateCheckAcknowledged: true,
    ...extra,
  };
}

const storedFiles = () => readdir(UPLOAD_DIR()).catch(() => [] as string[]);

async function complaintCount(): Promise<number> {
  const { rows } = await ctx.sql<{ n: string }>(
    "SELECT count(*) AS n FROM complaints",
  );
  return Number(rows[0]?.n);
}

type StoredRow = {
  id: string;
  complaint_id: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  uploaded_by_staff_id: string | null;
};

async function attachmentsOf(refNo: string): Promise<StoredRow[]> {
  const { rows } = await ctx.sql<StoredRow>(
    `SELECT a.id, a.complaint_id, a.storage_key, a.original_name, a.mime_type,
            a.uploaded_by_staff_id
       FROM complaint_attachments a JOIN complaints c ON c.id = a.complaint_id
      WHERE c.complaint_ref_no = $1
      ORDER BY a.id`,
    [refNo],
  );
  return rows;
}

const onDisk = (row: StoredRow) =>
  readFile(path.join(UPLOAD_DIR(), row.storage_key));

before(async () => {
  ctx = await startTestContext();
  kui = await ctx.as("KUI");
});

after(async () => {
  await ctx.close();
});

// ─── Portal ──────────────────────────────────────────────────────────────────

describe("portal submission with documents (§8 decision 10)", () => {
  it("anonymous: stores the files, strips image metadata, returns only public fields", async () => {
    const created = expectStatus<Record<string, unknown>>(
      await ctx.anonymous.postForm(
        "/complaints",
        form(portalPayload({ isAnonymous: true }), [
          { name: "gambar.jpg", bytes: JPEG_WITH_EXIF },
          { name: "tangkap layar.png", bytes: PNG_WITH_TEXT },
          { name: "../../surat.pdf", bytes: PDF },
        ]),
      ),
      201,
    );
    assert.deepEqual(Object.keys(created).sort(), [
      "complaintDate",
      "complaintRefNo",
      "integrityCategory",
      "receivedDateUi",
      "status",
    ]);

    const rows = await attachmentsOf(created.complaintRefNo as string);
    assert.deepEqual(
      rows.map((r) => [r.original_name, r.mime_type, r.uploaded_by_staff_id]),
      [
        ["gambar.jpg", "image/jpeg", null],
        ["tangkap layar.png", "image/png", null],
        // No path survives from the client's filename.
        ["surat.pdf", "application/pdf", null],
      ],
    );

    const [jpeg, png, pdf] = await Promise.all(rows.map(onDisk));
    assert.ok(!jpeg!.includes("GPS-3.1390N"), "EXIF must be stripped");
    assert.ok(
      !jpeg!.includes("Kamera Pengadu"),
      "JPEG comment must be stripped",
    );
    assert.ok(jpeg!.includes("JFIF"), "JFIF header is kept");
    assert.ok(!png!.includes("Nama Pengadu"), "PNG text must be stripped");
    assert.ok(png!.includes("IDAT"), "image data is kept");
    assert.ok(pdf!.equals(PDF), "PDFs are stored as sent");

    const { rows: flags } = await ctx.sql<{
      has_supporting_documents: boolean;
    }>(
      "SELECT has_supporting_documents FROM complaints WHERE complaint_ref_no = $1",
      [created.complaintRefNo],
    );
    assert.equal(flags[0]?.has_supporting_documents, true);

    // The portal has no ADA/TIADA question: without files it isn't stated.
    const plain = expectStatus<{ complaintRefNo: string }>(
      await ctx.anonymous.post(
        "/complaints",
        portalPayload({ isAnonymous: true }, { hasSupportingDocuments: true }),
      ),
      201,
    );
    const { rows: plainFlags } = await ctx.sql<{
      has_supporting_documents: boolean | null;
    }>(
      "SELECT has_supporting_documents FROM complaints WHERE complaint_ref_no = $1",
      [plain.complaintRefNo],
    );
    assert.equal(plainFlags[0]?.has_supporting_documents, null);

    // Tracking shows the public shape plus the status timeline, no document fields.
    const tracked = expectStatus<Record<string, unknown>>(
      await ctx.anonymous.get(
        `/complaints/${encodeURIComponent(created.complaintRefNo as string)}`,
      ),
      200,
    );
    assert.deepEqual(Object.keys(tracked).sort(), [
      "complaintDate",
      "complaintRefNo",
      "integrityCategory",
      "receivedDateUi",
      "status",
      "timeline",
    ]);
  });

  it("named: image metadata is kept — for them it may be evidence", async () => {
    const created = expectStatus<{ complaintRefNo: string }>(
      await ctx.anonymous.postForm(
        "/complaints",
        form(portalPayload({ particulars: "Pengadu Bernama" }), [
          { name: "bukti.jpg", bytes: JPEG_WITH_EXIF },
          { name: "laporan.docx", bytes: DOCX },
        ]),
      ),
      201,
    );
    const rows = await attachmentsOf(created.complaintRefNo);
    assert.ok((await onDisk(rows[0]!)).equals(JPEG_WITH_EXIF));
    assert.equal(
      rows[1]?.mime_type,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("refuses, and writes nothing, for a bad type, a macro document, too many files, or TIADA", async () => {
    const before = await complaintCount();
    const filesBefore = (await storedFiles()).length;

    const refusals: [FormData, number][] = [
      // Named .pdf, but not a PDF.
      [
        form(portalPayload({ isAnonymous: true }), [
          { name: "surat.pdf", bytes: Buffer.from("MZ executable") },
        ]),
        422,
      ],
      [
        form(portalPayload({ isAnonymous: true }), [
          { name: "makro.docx", bytes: DOCM },
        ]),
        422,
      ],
      // One good file with one bad one: the whole request is refused.
      [
        form(portalPayload({ isAnonymous: true }), [
          { name: "ok.pdf", bytes: PDF },
          { name: "skrip.html", bytes: Buffer.from("<script>") },
        ]),
        422,
      ],
      [
        form(
          portalPayload({ isAnonymous: true }),
          Array.from({ length: 6 }, (_, i) => ({
            name: `${i}.pdf`,
            bytes: PDF,
          })),
        ),
        422,
      ],
      [
        form(portalPayload({ isAnonymous: true }), [
          {
            name: "besar.pdf",
            bytes: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]),
          },
        ]),
        413,
      ],
      // Validation still runs on the payload.
      [
        form(portalPayload({ isAnonymous: true, particulars: "Nama" }), [
          { name: "surat.pdf", bytes: PDF },
        ]),
        422,
      ],
    ];
    for (const [body, status] of refusals) {
      const res = await ctx.anonymous.postForm("/complaints", body);
      assert.equal(res.status, status, JSON.stringify(res.body));
    }

    assert.equal(await complaintCount(), before);
    assert.equal((await storedFiles()).length, filesBefore);
  });

  it("a possible duplicate (409) writes no files", async () => {
    const accused = { accusedParticulars: "Encik Pendua Dokumen Unik" };
    const description =
      "Penyelewengan peruntukan bengkel oleh pegawai yang sama";
    expectStatus(
      await ctx.anonymous.postForm(
        "/complaints",
        form(
          portalPayload(
            { isAnonymous: true },
            { ...accused, caseDescription: description },
          ),
          [{ name: "a.pdf", bytes: PDF }],
        ),
      ),
      201,
    );
    const filesBefore = (await storedFiles()).length;
    const res = await ctx.anonymous.postForm(
      "/complaints",
      form(
        portalPayload(
          { isAnonymous: true },
          {
            ...accused,
            caseDescription: description,
            duplicateCheckAcknowledged: false,
          },
        ),
        [{ name: "b.pdf", bytes: PDF }],
      ),
    );
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal((await storedFiles()).length, filesBefore);
  });
});

// ─── Staff ───────────────────────────────────────────────────────────────────

describe("case file documents (Integrity Unit only)", () => {
  let complaintId: string;
  let attachmentId: string;

  before(async () => {
    const created = expectStatus<{ complaintRefNo: string }>(
      await ctx.anonymous.postForm(
        "/complaints",
        form(portalPayload({ particulars: "Pengadu Muat Turun" }), [
          { name: "Laporan Ujian — Julai.pdf", bytes: PDF },
        ]),
      ),
      201,
    );
    const rows = await attachmentsOf(created.complaintRefNo);
    complaintId = rows[0]!.complaint_id;
    attachmentId = rows[0]!.id;
  });

  it("the case file lists documents without storage details", async () => {
    const detail = expectStatus<{ attachments: Record<string, unknown>[] }>(
      await kui.get(`/admin/complaints/${complaintId}`),
      200,
    );
    assert.equal(detail.attachments.length, 1);
    assert.deepEqual(Object.keys(detail.attachments[0]!).sort(), [
      "createdAt",
      "id",
      "mimeType",
      "originalName",
      "sizeBytes",
      "uploadedBy",
    ]);
    assert.equal(detail.attachments[0]!.uploadedBy, null);
  });

  it("downloads as an attachment, never inline", async () => {
    const res = await kui.raw(
      `/admin/complaints/${complaintId}/attachments/${attachmentId}/download`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.match(
      res.headers.get("content-disposition") ?? "",
      /filename\*=UTF-8''Laporan%20Ujian%20%E2%80%94%20Julai\.pdf/,
    );
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF));

    // Another complaint's id in the URL doesn't reach this file.
    const other = await kui.raw(
      `/admin/complaints/${Number(complaintId) + 999}/attachments/${attachmentId}/download`,
    );
    assert.equal(other.status, 404);
  });

  it("is refused outside the Integrity Unit", async () => {
    const url = `/admin/complaints/${complaintId}/attachments/${attachmentId}/download`;
    assert.equal((await ctx.anonymous.raw(url)).status, 401);
    for (const role of ["KJ", "SUB_UNIT"] as const) {
      assert.equal((await (await ctx.as(role)).raw(url)).status, 403);
    }
    const upload = form({}, [{ name: "x.pdf", bytes: PDF }]);
    assert.equal(
      (
        await ctx.anonymous.postForm(
          `/admin/complaints/${complaintId}/attachments`,
          upload,
        )
      ).status,
      401,
    );
  });

  it("staff can add documents to an existing case", async () => {
    const data = new FormData();
    data.append("files", new Blob([PNG_WITH_TEXT]), "emel-pengadu.png");
    const added = expectStatus<{ originalName: string; uploadedBy: unknown }[]>(
      await kui.postForm(`/admin/complaints/${complaintId}/attachments`, data),
      201,
    );
    assert.equal(added.length, 2);
    assert.equal(added[1]?.originalName, "emel-pengadu.png");
    assert.ok(added[1]?.uploadedBy);

    const none = await kui.postForm(
      `/admin/complaints/${complaintId}/attachments`,
      new FormData(),
    );
    assert.equal(none.status, 422);
    const missing = new FormData();
    missing.append("files", new Blob([PDF]), "x.pdf");
    assert.equal(
      (await kui.postForm("/admin/complaints/999999/attachments", missing))
        .status,
      404,
    );
  });
});
