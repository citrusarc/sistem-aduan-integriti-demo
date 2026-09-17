import { createHash, randomBytes, randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";
import { query, withTransaction } from "../db/client.js";

/**
 * Slider image captcha for staff sign-in — §8 decision 14 (g).
 *
 * The server draws a random picture, cuts a square piece out of it, and keeps
 * the piece's x position. The browser gets both images and the piece's y; the
 * person slides the piece into the gap. Only a slide within TOLERANCE of the
 * stored x earns a one-time pass token, and /auth/login refuses to check a
 * password without one.
 *
 * Everything is generated here with node:zlib — no image library, no external
 * captcha service (the system runs locally). It is a speed bump for scripted
 * password guessing on top of the lockout, not a guarantee against a
 * determined bot.
 */

export const CAPTCHA_WIDTH = 320;
export const CAPTCHA_HEIGHT = 160;
export const CAPTCHA_PIECE = 48;
const TOLERANCE = 6;
const MAX_ATTEMPTS = 3;
const CHALLENGE_TTL_MINUTES = 3;
const PASS_TTL_MINUTES = 3;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// ─── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA pixels -> PNG data URL. */
function toPngDataUrl(rgba: Uint8Array, width: number, height: number): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // no filter
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      row + 1,
    );
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

// ─── Picture ─────────────────────────────────────────────────────────────────

/** Unpredictable: decides where the gap is. */
const rand = (min: number, max: number) => randomInt(min, max + 1);
/** Decoration only (colours, noise) — Math.random is fine and far faster. */
const fast = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));

function drawBackground(): Uint8Array {
  const w = CAPTCHA_WIDTH;
  const h = CAPTCHA_HEIGHT;
  const px = new Uint8Array(w * h * 4);
  const from = [fast(20, 120), fast(60, 160), fast(110, 200)];
  const to = [fast(150, 240), fast(110, 210), fast(40, 140)];
  const circles = Array.from({ length: 14 }, () => ({
    x: fast(0, w),
    y: fast(0, h),
    r: fast(10, 48),
    color: [fast(0, 255), fast(0, 255), fast(0, 255)],
    alpha: fast(25, 60) / 100,
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x / w) * 0.7 + (y / h) * 0.3;
      let rgb = from.map((c, i) => c + (to[i]! - c) * t);
      for (const circle of circles) {
        const dx = x - circle.x;
        const dy = y - circle.y;
        if (dx * dx + dy * dy <= circle.r * circle.r) {
          rgb = rgb.map(
            (c, i) => c * (1 - circle.alpha) + circle.color[i]! * circle.alpha,
          );
        }
      }
      const noise = fast(-10, 10);
      const o = (y * w + x) * 4;
      px[o] = Math.max(0, Math.min(255, rgb[0]! + noise));
      px[o + 1] = Math.max(0, Math.min(255, rgb[1]! + noise));
      px[o + 2] = Math.max(0, Math.min(255, rgb[2]! + noise));
      px[o + 3] = 255;
    }
  }
  return px;
}

function cutPiece(
  background: Uint8Array,
  left: number,
  top: number,
): { withGap: Uint8Array; piece: Uint8Array } {
  const w = CAPTCHA_WIDTH;
  const size = CAPTCHA_PIECE;
  const withGap = new Uint8Array(background);
  const piece = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((top + y) * w + (left + x)) * 4;
      const dst = (y * size + x) * 4;
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      for (let i = 0; i < 3; i++) {
        const value = background[src + i]!;
        // The piece: the picture, with a bright rim so it reads as a tile.
        piece[dst + i] = edge ? 250 : value;
        // The gap: darkened, with a light outline.
        withGap[src + i] = edge ? 235 : Math.round(value * 0.45);
      }
      piece[dst + 3] = 255;
    }
  }
  return { withGap, piece };
}

// ─── Challenges ──────────────────────────────────────────────────────────────

export type CaptchaChallenge = {
  challengeToken: string;
  width: number;
  height: number;
  pieceSize: number;
  pieceY: number;
  background: string;
  piece: string;
};

export async function createCaptcha(): Promise<CaptchaChallenge> {
  const pieceY = rand(8, CAPTCHA_HEIGHT - CAPTCHA_PIECE - 8);
  const targetX = rand(CAPTCHA_PIECE + 24, CAPTCHA_WIDTH - CAPTCHA_PIECE - 8);
  const { withGap, piece } = cutPiece(drawBackground(), targetX, pieceY);
  const challengeToken = randomBytes(24).toString("base64url");

  await query(
    `INSERT INTO staff_captcha_challenges (id, target_x, expires_at)
     VALUES ($1, $2, now() + ($3::int * INTERVAL '1 minute'))`,
    [sha256(challengeToken), targetX, CHALLENGE_TTL_MINUTES],
  );
  await query(
    `DELETE FROM staff_captcha_challenges WHERE created_at < now() - INTERVAL '1 day'`,
  );

  return {
    challengeToken,
    width: CAPTCHA_WIDTH,
    height: CAPTCHA_HEIGHT,
    pieceSize: CAPTCHA_PIECE,
    pieceY,
    background: toPngDataUrl(withGap, CAPTCHA_WIDTH, CAPTCHA_HEIGHT),
    piece: toPngDataUrl(piece, CAPTCHA_PIECE, CAPTCHA_PIECE),
  };
}

export type CaptchaResult =
  { solved: true; passToken: string } | { solved: false; retry: boolean };

/**
 * One slide. Right: a pass token, valid once for a few minutes. Wrong: counts
 * an attempt; after MAX_ATTEMPTS (or once expired) the challenge is dead and
 * the browser must fetch a new picture.
 */
export async function solveCaptcha(
  challengeToken: string,
  x: number,
): Promise<CaptchaResult> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      target_x: number;
      attempt_count: number;
    }>(
      `SELECT target_x, attempt_count
         FROM staff_captcha_challenges
        WHERE id = $1 AND expires_at > now() AND pass_token_hash IS NULL
          AND attempt_count < $2
        FOR UPDATE`,
      [sha256(challengeToken), MAX_ATTEMPTS],
    );
    const row = rows[0];
    if (!row) return { solved: false, retry: false } as const;

    if (Math.abs(x - row.target_x) <= TOLERANCE) {
      const passToken = randomBytes(24).toString("base64url");
      await client.query(
        `UPDATE staff_captcha_challenges
            SET pass_token_hash = $2,
                pass_expires_at = now() + ($3::int * INTERVAL '1 minute')
          WHERE id = $1`,
        [sha256(challengeToken), sha256(passToken), PASS_TTL_MINUTES],
      );
      return { solved: true, passToken } as const;
    }

    await client.query(
      `UPDATE staff_captcha_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`,
      [sha256(challengeToken)],
    );
    return {
      solved: false,
      retry: row.attempt_count + 1 < MAX_ATTEMPTS,
    } as const;
  });
}

/** Spends a pass token. False if unknown, expired or already used. */
export async function consumeCaptchaPass(passToken: string): Promise<boolean> {
  const result = await query(
    `UPDATE staff_captcha_challenges
        SET consumed_at = now()
      WHERE pass_token_hash = $1 AND consumed_at IS NULL AND pass_expires_at > now()`,
    [sha256(passToken)],
  );
  return (result.rowCount ?? 0) > 0;
}
