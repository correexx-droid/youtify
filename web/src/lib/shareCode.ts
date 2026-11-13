/**
 * YoutiFy share codes: a playlist or song as a short text, e.g. "YTF1AQZSb2NrIDIK…".
 *
 * Only what can't be looked up again goes in: the playlist name and the YouTube video ids. An 11-character id
 * is 64 bits, so each song takes 8 bytes (about 11 characters of code) instead of the ~200 characters its
 * title, artist and links would need. The receiver fetches titles and artists itself.
 *
 * Layout (then base64url): u8 version<<4 | kind (0 playlist, 1 songs), varint name length, name (UTF-8),
 * varint count, 8 bytes per id.
 */

const PREFIX = "YTF1";
const VERSION = 1;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface SharePayload {
  kind: "playlist" | "songs";
  name: string;
  ids: string[];
}

const VIDEO_ID = /^[A-Za-z0-9_-]{10}[AEIMQUYcgkosw048]$/;

function idToBytes(id: string): Uint8Array {
  // 11 base64url chars = 66 bits; the last char of a YouTube id only uses its top 4 bits, so 64 bits remain.
  let v = 0n;
  for (const ch of id) v = (v << 6n) | BigInt(B64.indexOf(ch));
  v >>= 2n;
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bytesToId(b: Uint8Array): string {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  v <<= 2n;
  let s = "";
  for (let i = 0; i < 11; i++) {
    s = B64[Number(v & 63n)]! + s;
    v >>= 6n;
  }
  return s;
}

function varint(n: number, out: number[]) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
}

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.ceil(((Math.min(3, bytes.length - i)) * 8) / 6);
    for (let k = 0; k < chars; k++) s += B64[(n >> (18 - 6 * k)) & 63];
  }
  return s;
}

function fromB64url(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9_-]/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) n = (n << 6) | (k < chunk.length ? B64.indexOf(chunk[k]!) : 0);
    const bytes = Math.floor((chunk.length * 6) / 8);
    for (let k = 0; k < bytes; k++) out.push((n >> (16 - 8 * k)) & 0xff);
  }
  return Uint8Array.from(out);
}

/** Only YouTube songs can be shared (own imported files stay on the device). */
export const shareableIds = (ids: string[]) => ids.filter((id) => VIDEO_ID.test(id));

export function encodeShare(p: SharePayload): string {
  const ids = shareableIds(p.ids);
  const name = new TextEncoder().encode(p.name.slice(0, 120));
  const head: number[] = [(VERSION << 4) | (p.kind === "songs" ? 1 : 0)];
  varint(name.length, head);
  head.push(...name);
  varint(ids.length, head);
  const out = new Uint8Array(head.length + ids.length * 8);
  out.set(head);
  ids.forEach((id, i) => out.set(idToBytes(id), head.length + i * 8));
  return PREFIX + toB64url(out);
}

/** Finds a share code in any text (the code alone, or a youtify:// link that carries it). */
export function findShareCode(text: string): string | null {
  return /YTF1[A-Za-z0-9_-]{4,}/.exec(text)?.[0] ?? null;
}

export function decodeShare(text: string): SharePayload | null {
  const code = findShareCode(text);
  if (!code) return null;
  try {
    const b = fromB64url(code.slice(PREFIX.length));
    let p = 0;
    const read = () => {
      let n = 0;
      let shift = 0;
      for (;;) {
        const x = b[p++];
        if (x === undefined) throw new Error("short");
        n |= (x & 0x7f) << shift;
        if (!(x & 0x80)) return n;
        shift += 7;
      }
    };
    const head = b[p++]!;
    if (head >> 4 !== VERSION) return null;
    const nameLen = read();
    const name = new TextDecoder().decode(b.subarray(p, p + nameLen));
    p += nameLen;
    const count = read();
    if (count > 5000 || p + count * 8 > b.length) return null;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(bytesToId(b.subarray(p + i * 8, p + i * 8 + 8)));
    return { kind: head & 1 ? "songs" : "playlist", name, ids };
  } catch {
    return null;
  }
}

/** A link other YoutiFy apps open directly (Android), or paste into the link field. */
export const shareLink = (code: string) => `youtify://share/${code}`;
