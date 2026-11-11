import type { Track } from "./types";

/**
 * Reading the user's own audio files (MP3, M4A, FLAC, WAV, OGG, Opus…) for import:
 * title, artist, album and cover from the tags, the length, and a stable id from the file's contents.
 */

export const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.oga,.opus,.wma,.aiff,.aif";

export interface FileTags {
  title?: string;
  artist?: string;
  album?: string;
  cover?: { mime: string; data: Uint8Array };
}

// ---------------------------------------------------------------- ID3v2 (MP3)

function syncsafe(b: Uint8Array, i: number) {
  return ((b[i]! & 0x7f) << 21) | ((b[i + 1]! & 0x7f) << 14) | ((b[i + 2]! & 0x7f) << 7) | (b[i + 3]! & 0x7f);
}

function decodeText(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const enc = bytes[0];
  const body = bytes.subarray(1);
  let text: string;
  if (enc === 1 || enc === 2) {
    // UTF-16 with BOM (1) or big-endian without (2).
    let le = enc === 1;
    let start = 0;
    if (body[0] === 0xff && body[1] === 0xfe) (le = true), (start = 2);
    else if (body[0] === 0xfe && body[1] === 0xff) (le = false), (start = 2);
    text = new TextDecoder(le ? "utf-16le" : "utf-16be").decode(body.subarray(start));
  } else if (enc === 3) text = new TextDecoder("utf-8").decode(body);
  else text = new TextDecoder("latin1").decode(body);
  return text.replace(/\0+$/g, "").split("\0")[0]!.trim();
}

/** End of a terminated string in an ID3 frame (one zero byte, or two for UTF-16). */
function stringEnd(b: Uint8Array, from: number, wide: boolean): number {
  if (!wide) {
    let i = from;
    while (i < b.length && b[i] !== 0) i++;
    return i;
  }
  let i = from;
  while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2;
  return i;
}

function readId3(b: Uint8Array): FileTags {
  const tags: FileTags = {};
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return tags; // "ID3"
  const major = b[3]!;
  const flags = b[5]!;
  const size = syncsafe(b, 6);
  let pos = 10;
  const end = Math.min(b.length, 10 + size);
  if (flags & 0x40) pos += major === 4 ? syncsafe(b, pos) : ((b[pos]! << 24) | (b[pos + 1]! << 16) | (b[pos + 2]! << 8) | b[pos + 3]!) + 4;
  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const head = v22 ? 6 : 10;
  while (pos + head <= end) {
    const id = String.fromCharCode(...b.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = v22
      ? (b[pos + 3]! << 16) | (b[pos + 4]! << 8) | b[pos + 5]!
      : major === 4
        ? syncsafe(b, pos + 4)
        : ((b[pos + 4]! << 24) | (b[pos + 5]! << 16) | (b[pos + 6]! << 8) | b[pos + 7]!) >>> 0;
    const data = b.subarray(pos + head, Math.min(end, pos + head + len));
    pos += head + len;
    if (!len) continue;
    if (id === "TIT2" || id === "TT2") tags.title ||= decodeText(data);
    else if (id === "TPE1" || id === "TP1") tags.artist ||= decodeText(data);
    else if (id === "TALB" || id === "TAL") tags.album ||= decodeText(data);
    else if ((id === "APIC" || id === "PIC") && !tags.cover) {
      const enc = data[0]!;
      let i = 1;
      let mime: string;
      if (v22) {
        const fmt = String.fromCharCode(...data.subarray(1, 4)).toLowerCase();
        mime = fmt === "png" ? "image/png" : "image/jpeg";
        i = 4;
      } else {
        const m = stringEnd(data, 1, false);
        mime = new TextDecoder("latin1").decode(data.subarray(1, m)) || "image/jpeg";
        if (!mime.includes("/")) mime = `image/${mime.toLowerCase()}`;
        i = m + 1;
      }
      i += 1; // picture type
      const wide = enc === 1 || enc === 2;
      i = stringEnd(data, i, wide) + (wide ? 2 : 1); // description
      if (i < data.length) tags.cover = { mime, data: data.subarray(i) };
    }
  }
  return tags;
}

/** ID3v1 at the end of the file: the fallback for old MP3s. */
function readId3v1(b: Uint8Array): FileTags {
  if (b.length < 128) return {};
  const t = b.subarray(b.length - 128);
  if (t[0] !== 0x54 || t[1] !== 0x41 || t[2] !== 0x47) return {}; // "TAG"
  const field = (from: number, len: number) => new TextDecoder("latin1").decode(t.subarray(from, from + len)).replace(/\0.*$/s, "").trim();
  return { title: field(3, 30), artist: field(33, 30), album: field(63, 30) };
}

// ---------------------------------------------------------------- Vorbis comments (FLAC, OGG, Opus)

function readVorbisComments(b: Uint8Array): FileTags {
  const tags: FileTags = {};
  // Look for the comment header of OGG ("\x03vorbis" / "OpusTags") or a FLAC VORBIS_COMMENT block by scanning.
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tryAt = (at: number) => {
    if (at + 8 > b.length) return false;
    const vendorLen = view.getUint32(at, true);
    let p = at + 4 + vendorLen;
    if (vendorLen > 4096 || p + 4 > b.length) return false;
    const count = view.getUint32(p, true);
    p += 4;
    if (count > 1000) return false;
    for (let k = 0; k < count && p + 4 <= b.length; k++) {
      const len = view.getUint32(p, true);
      p += 4;
      if (len > b.length - p) return false;
      const entry = new TextDecoder().decode(b.subarray(p, p + len));
      p += len;
      const eq = entry.indexOf("=");
      if (eq < 0) continue;
      const key = entry.slice(0, eq).toUpperCase();
      const value = entry.slice(eq + 1).trim();
      if (key === "TITLE") tags.title ||= value;
      else if (key === "ARTIST") tags.artist ||= value;
      else if (key === "ALBUM") tags.album ||= value;
    }
    return true;
  };
  const head = b.subarray(0, Math.min(b.length, 256 * 1024));
  const find = (sig: number[]) => {
    outer: for (let i = 0; i + sig.length < head.length; i++) {
      for (let j = 0; j < sig.length; j++) if (head[i + j] !== sig[j]) continue outer;
      return i;
    }
    return -1;
  };
  const opus = find([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // OpusTags
  if (opus >= 0 && tryAt(opus + 8)) return tags;
  const vorbis = find([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // \x03vorbis
  if (vorbis >= 0 && tryAt(vorbis + 7)) return tags;
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) {
    // "fLaC" then metadata blocks: type 4 is VORBIS_COMMENT, type 6 PICTURE.
    let p = 4;
    for (let n = 0; n < 64 && p + 4 <= b.length; n++) {
      const last = b[p]! & 0x80;
      const type = b[p]! & 0x7f;
      const len = (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!;
      const body = p + 4;
      if (type === 4) tryAt(body);
      if (type === 6 && !tags.cover && body + 32 < b.length) {
        let q = body + 4;
        const mimeLen = view.getUint32(q);
        const mime = new TextDecoder("latin1").decode(b.subarray(q + 4, q + 4 + mimeLen));
        q += 4 + mimeLen;
        q += 4 + view.getUint32(q) + 16; // description + width/height/depth/colours
        const dataLen = view.getUint32(q);
        tags.cover = { mime: mime || "image/jpeg", data: b.subarray(q + 4, q + 4 + dataLen) };
      }
      p = body + len;
      if (last) break;
    }
  }
  return tags;
}

// ---------------------------------------------------------------- MP4 (M4A, AAC)

function readMp4(b: Uint8Array): FileTags {
  const tags: FileTags = {};
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const walk = (from: number, to: number, depth: number) => {
    let p = from;
    while (p + 8 <= to && depth < 8) {
      let size = view.getUint32(p);
      const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
      if (size === 1 && p + 16 <= to) size = Number(view.getBigUint64(p + 8));
      if (size < 8 || p + size > to) break;
      const body = p + 8;
      if (type === "moov" || type === "udta" || type === "ilst" || type === "trak" || type === "mdia") walk(body, p + size, depth + 1);
      else if (type === "meta") walk(body + 4, p + size, depth + 1);
      else if (["©nam", "©ART", "©alb", "covr"].includes(type)) {
        // child "data" atom: size, "data", 4 bytes type, 4 bytes locale, payload
        const d = body;
        if (String.fromCharCode(...b.subarray(d + 4, d + 8)) === "data") {
          const kind = view.getUint32(d + 8) & 0xffffff;
          const payload = b.subarray(d + 16, d + view.getUint32(d));
          if (type === "covr") tags.cover ||= { mime: kind === 14 ? "image/png" : "image/jpeg", data: payload };
          else {
            const text = new TextDecoder().decode(payload).trim();
            if (type === "©nam") tags.title ||= text;
            if (type === "©ART") tags.artist ||= text;
            if (type === "©alb") tags.album ||= text;
          }
        }
      }
      p += size;
    }
  };
  // "©" is 0xA9; String.fromCharCode maps it right.
  walk(0, b.length, 0);
  return tags;
}

export function readTags(bytes: Uint8Array): FileTags {
  const id3 = readId3(bytes);
  if (id3.title || id3.artist) return { ...readId3v1(bytes), ...id3 };
  const v1 = readId3v1(bytes);
  if (v1.title) return { ...v1, cover: id3.cover };
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return readMp4(bytes); // ....ftyp
  return readVorbisComments(bytes);
}

// ---------------------------------------------------------------- Helpers

/** "Artist - Title.mp3" → both; otherwise the file name is the title. Leading track numbers go. */
export function guessFromName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").replace(/^\s*\d{1,3}[\s.\-_)]+/, "").trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1]!.trim(), title: m[2]!.trim() } : { title: base || name, artist: "" };
}

/** Stable id for a file: the same song imported twice is recognised. */
export async function localId(bytes: Uint8Array): Promise<string> {
  const sample = bytes.length > 4 * 1024 * 1024 ? new Uint8Array([...bytes.subarray(0, 2 * 1024 * 1024), ...bytes.subarray(-2 * 1024 * 1024)]) : bytes;
  const len = new TextEncoder().encode(String(bytes.length));
  const data = new Uint8Array(sample.length + len.length);
  data.set(sample);
  data.set(len, sample.length);
  if (crypto?.subtle) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return "lo_" + [...hash.subarray(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  // FNV-1a fallback (http pages without WebCrypto).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i]!, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ data[i]!, 0x5bd1e995) >>> 0;
  }
  return "lo_" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** The cover shrunk to a small JPEG, as a data URL the library can keep. */
export async function coverThumb(cover: FileTags["cover"]): Promise<string> {
  if (!cover?.data.length) return "";
  try {
    const bitmap = await createImageBitmap(new Blob([cover.data as BlobPart], { type: cover.mime }));
    const size = 300;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
    bitmap.close();
    for (const q of [0.82, 0.7, 0.55]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length <= 58_000) return url;
    }
    return "";
  } catch {
    return "";
  }
}

export function mimeFor(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    aiff: "audio/aiff",
    aif: "audio/aiff",
  };
  return map[ext ?? ""] ?? "audio/mpeg";
}

export type { Track };
