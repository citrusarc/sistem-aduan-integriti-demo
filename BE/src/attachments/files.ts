import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request, RequestHandler } from "express";
import multer from "multer";
import { config } from "../config.js";
import { HttpError } from "../middleware/error-handler.js";

/**
 * Supporting documents (DOKUMEN SOKONGAN) — CLAUDE.md §8 decision 10.
 *
 * The ONLY code that reads upload bytes or touches UPLOAD_DIR. Files are:
 *   - typed by their content, never by the client's filename or MIME header
 *   - written under a random name, so nothing from the request reaches a path
 *   - written only after validation and the duplicate check have passed, so a
 *     refused submission leaves nothing on disk
 *   - stripped of image metadata (EXIF: camera, time, GPS) when the complainant
 *     is anonymous. Named complaints keep it — for them it may be evidence.
 */

export const ALLOWED_TYPES = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
} as const;

export type AttachmentMime = keyof typeof ALLOWED_TYPES;

export type PreparedAttachment = {
  storageKey: string;
  originalName: string;
  mimeType: AttachmentMime;
  sizeBytes: number;
  sha256: string;
};

export function uploadDir(): string {
  return path.resolve(config.uploads.dir);
}

/** A storage key is a UUID we generated; anything else never reaches a path. */
export function storedPath(storageKey: string): string {
  if (!/^[0-9a-f-]{36}$/.test(storageKey)) {
    throw new Error("storage key tidak sah");
  }
  return path.join(uploadDir(), storageKey);
}

const parseFiles = multer({
  storage: multer.memoryStorage(),
  // Busboy's default decodes filenames as latin1; Malay names may not be ASCII.
  defParamCharset: "utf8",
  limits: {
    fileSize: config.uploads.maxFileBytes,
    files: config.uploads.maxFilesPerRequest,
    // `payload` (the JSON body) is the only field.
    fields: 1,
    fieldSize: 1024 * 1024,
    parts: config.uploads.maxFilesPerRequest + 1,
  },
}).array("files", config.uploads.maxFilesPerRequest);

const maxMb = () => Math.round(config.uploads.maxFileBytes / (1024 * 1024));

/**
 * Parses multipart/form-data into req.files (in memory, size-capped). Any
 * other content type passes through untouched, so JSON callers keep working.
 */
export const acceptFiles: RequestHandler = (req, res, next) => {
  parseFiles(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `Setiap fail mesti tidak melebihi ${maxMb()} MB`
          : err.code === "LIMIT_FILE_COUNT" ||
              err.code === "LIMIT_UNEXPECTED_FILE"
            ? `Maksimum ${config.uploads.maxFilesPerRequest} fail setiap kali`
            : "Muat naik fail tidak sah";
      return next(
        new HttpError(err.code === "LIMIT_FILE_SIZE" ? 413 : 422, message),
      );
    }
    next(err);
  });
};

/**
 * The request body, whichever way it came: JSON as usual, or multipart with
 * the JSON in a `payload` field alongside `files`.
 */
export function requestBody(req: Request): unknown {
  if (!req.is("multipart/form-data")) return req.body;
  const payload = (req.body as { payload?: unknown } | undefined)?.payload;
  if (typeof payload !== "string") {
    throw new HttpError(422, "Medan payload diperlukan bersama fail");
  }
  try {
    return JSON.parse(payload);
  } catch {
    throw new HttpError(400, "Medan payload bukan JSON yang sah");
  }
}

export function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

/** Content sniffing. The client's filename and Content-Type are not trusted. */
function detectType(buf: Buffer): AttachmentMime | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  // DOCX is a ZIP; entry names are stored uncompressed, so they're findable.
  // A macro-enabled document (vbaProject.bin) is refused.
  if (
    buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
    buf.includes("[Content_Types].xml") &&
    buf.includes("word/document.xml") &&
    !buf.includes("vbaProject.bin")
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

/**
 * JPEG: drops APP1 (EXIF, XMP), APP3–APP13 (incl. IPTC) and APP15, and COM
 * segments. Keeps APP0 (JFIF), APP2 (ICC colour) and APP14 (Adobe colour
 * transform), which the image needs to render correctly. EXIF orientation
 * goes with APP1, so a phone photo may open rotated — the price of dropping
 * its GPS position.
 */
function stripJpeg(buf: Buffer): Buffer {
  const keep = new Set([0xe0, 0xe2, 0xee]);
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw new Error("JPEG rosak");
    const marker = buf[pos + 1];
    if (marker === undefined) throw new Error("JPEG rosak");
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    // Start of scan: compressed data to the end, no more metadata segments.
    if (marker === 0xda) {
      parts.push(buf.subarray(pos));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) throw new Error("JPEG rosak");
    const end = pos + 2 + buf.readUInt16BE(pos + 2);
    if (end > buf.length) throw new Error("JPEG rosak");
    const isMetadata =
      (marker >= 0xe1 && marker <= 0xef && !keep.has(marker)) ||
      marker === 0xfe;
    if (!isMetadata) parts.push(buf.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(parts);
}

/** PNG: drops text chunks, EXIF and the modification time. */
function stripPng(buf: Buffer): Buffer {
  const drop = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("latin1");
    const end = pos + 12 + length;
    if (end > buf.length) throw new Error("PNG rosak");
    if (!drop.has(type)) parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(parts);
}

/** Keeps what staff need to recognise the file; nothing that could be a path. */
function cleanName(name: string, mime: AttachmentMime): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|?*:]/g, "")
    .trim();
  const fallback = `dokumen.${ALLOWED_TYPES[mime].toLowerCase()}`;
  if (!base || base === "." || base === "..") return fallback;
  if (base.length <= 150) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 150 - ext.length) + ext;
}

/**
 * Checks every file first, so one bad file refuses the whole request before
 * anything is written. Throws HttpError(422) naming the file.
 */
export function inspectFiles(
  files: Express.Multer.File[],
  { stripMetadata }: { stripMetadata: boolean },
): { name: string; mime: AttachmentMime; bytes: Buffer }[] {
  return files.map((file) => {
    const mime = detectType(file.buffer);
    if (!mime) {
      throw new HttpError(
        422,
        `Jenis fail tidak dibenarkan: ${file.originalname}. Hanya PDF, JPG, PNG atau DOCX.`,
      );
    }
    let bytes = file.buffer;
    if (stripMetadata && (mime === "image/jpeg" || mime === "image/png")) {
      try {
        bytes = mime === "image/jpeg" ? stripJpeg(bytes) : stripPng(bytes);
      } catch {
        throw new HttpError(422, `Fail imej rosak: ${file.originalname}`);
      }
    }
    return { name: cleanName(file.originalname, mime), mime, bytes };
  });
}

/** Writes checked files under random names. Undo with removeStoredFiles. */
export async function storeFiles(
  checked: ReturnType<typeof inspectFiles>,
): Promise<PreparedAttachment[]> {
  if (!checked.length) return [];
  await mkdir(uploadDir(), { recursive: true, mode: 0o700 });
  const stored: PreparedAttachment[] = [];
  try {
    for (const file of checked) {
      const storageKey = randomUUID();
      await writeFile(storedPath(storageKey), file.bytes, {
        flag: "wx",
        mode: 0o600,
      });
      stored.push({
        storageKey,
        originalName: file.name,
        mimeType: file.mime,
        sizeBytes: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
      });
    }
  } catch (err) {
    await removeStoredFiles(stored);
    throw err;
  }
  return stored;
}

/** Best effort: used when the database refuses after the files were written. */
export async function removeStoredFiles(
  files: readonly PreparedAttachment[],
): Promise<void> {
  await Promise.all(
    files.map((f) =>
      unlink(storedPath(f.storageKey)).catch((err: unknown) => {
        console.error("Gagal memadam fail muat naik yatim:", f.storageKey, err);
      }),
    ),
  );
}
