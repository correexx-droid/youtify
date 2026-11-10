/**
 * YTFY: YoutiFy's own file format for offline songs.
 *
 * Compression (see lib/transcode.ts for the audio side):
 *   1. The downloaded track (AAC or Opus, usually ~128 kbps) is decoded to PCM and re-encoded as Opus at the
 *      bitrate chosen in Settings (48/64/96 kbps). That is where most of the space goes.
 *   2. The audio packets are stored back to back without any container overhead. Their lengths, which a player
 *      needs to find the packets again, go into a size table compressed with an adaptive Rice code over the
 *      zig-zag deltas of consecutive sizes (VBR Opus packets differ by a few bytes from one to the next).
 *   3. A CRC-32 over the whole file catches damaged downloads.
 *
 * Decompression rebuilds a standard Ogg Opus stream (RFC 7845) in memory from those parts, which every engine
 * YoutiFy runs on (Chromium in the desktop app, Android's WebView, browsers) plays natively with seeking.
 *
 * When the platform can't re-encode (no WebCodecs), the original bytes are stored as-is ("raw").
 *
 * Layout, little-endian:
 *   "YTFY" u8 version u8 codec
 *   codec 1 (opus): u8 channels, u16 preSkip, u32 sourceRate, u32 bitrate, u32 totalSamples (48 kHz, without
 *                   pre-skip), u16 frameSamples (0 = per-packet durations follow), u32 packetCount,
 *                   u32 tableBytes, table (Rice: sizes, then durations when frameSamples is 0), packet bytes
 *   codec 2 (raw):  u8 mimeLength, mime (UTF-8), u32 byteLength, bytes
 *   u32 CRC-32 of everything before it
 */

export const YTFY_VERSION = 1;
const MAGIC = [0x59, 0x54, 0x46, 0x59]; // "YTFY"
const CODEC_OPUS = 1;
const CODEC_RAW = 2;

export interface OpusStream {
  channels: number;
  /** Samples (48 kHz) the decoder drops at the start: the encoder's look-ahead. */
  preSkip: number;
  sourceRate: number;
  bitrate: number;
  /** Real length of the song in 48 kHz samples, so the padded last packet is trimmed on playback. */
  totalSamples: number;
  packets: Uint8Array[];
  /** Length of each packet in 48 kHz samples. */
  durations: number[];
}

export type YtfyContent = ({ codec: "opus" } & OpusStream) | { codec: "raw"; mime: string; bytes: Uint8Array };

// ---------------------------------------------------------------- CRC-32 (IEEE, reflected, as in zip/png)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, end = data.length): number {
  let c = 0xffffffff;
  for (let i = 0; i < end; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- Bit I/O and adaptive Rice coding

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(value: number, bits: number) {
    for (let i = bits - 1; i >= 0; i--) this.bit((value >>> i) & 1);
  }
  bit(b: number) {
    this.acc = (this.acc << 1) | b;
    if (++this.n === 8) {
      this.bytes.push(this.acc);
      this.acc = 0;
      this.n = 0;
    }
  }
  finish(): Uint8Array {
    if (this.n) this.bytes.push(this.acc << (8 - this.n));
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  private pos = 0;
  constructor(private data: Uint8Array) {}
  bit(): number {
    const byte = this.data[this.pos >>> 3];
    if (byte === undefined) throw new Error("YTFY: size table ends early");
    const b = (byte >>> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return b;
  }
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) v = v * 2 + this.bit();
    return v;
  }
}

const zigzag = (v: number) => (v >= 0 ? v * 2 : -v * 2 - 1);
const unzigzag = (u: number) => (u & 1 ? -(u + 1) / 2 : u / 2);

/** Rice parameter that fits the running mean of recent values. */
function riceK(mean: number): number {
  let k = 0;
  while (k < 24 && 2 ** (k + 1) <= mean + 1) k++;
  return k;
}

// Quotients longer than this are written as an escape plus the raw 32-bit value (protects against huge jumps).
const ESCAPE = 32;

/**
 * Encodes integers as zig-zag deltas with an adaptive Rice code: the parameter follows an exponential moving
 * average of the recent values, so steady stretches cost a few bits per number.
 */
export function riceEncode(values: number[]): Uint8Array {
  const w = new BitWriter();
  let prev = 0;
  let mean = 16;
  for (const v of values) {
    const u = zigzag(v - prev);
    prev = v;
    const k = riceK(mean);
    const q = Math.floor(u / 2 ** k);
    if (q >= ESCAPE) {
      for (let i = 0; i < ESCAPE; i++) w.bit(1);
      w.write(u, 32);
    } else {
      for (let i = 0; i < q; i++) w.bit(1);
      w.bit(0);
      if (k) w.write(u % 2 ** k, k);
    }
    mean += (u - mean) / 16;
  }
  return w.finish();
}

export function riceDecode(data: Uint8Array, count: number): number[] {
  const r = new BitReader(data);
  const out: number[] = new Array(count);
  let prev = 0;
  let mean = 16;
  for (let i = 0; i < count; i++) {
    const k = riceK(mean);
    let q = 0;
    while (q < ESCAPE && r.bit()) q++;
    const u = q === ESCAPE ? r.read(32) : q * 2 ** k + (k ? r.read(k) : 0);
    prev += unzigzag(u);
    out[i] = prev;
    mean += (u - mean) / 16;
  }
  return out;
}

// ---------------------------------------------------------------- Byte I/O

class Out {
  private parts: Uint8Array[] = [];
  private head = new DataView(new ArrayBuffer(16));
  size = 0;
  u8(v: number) {
    this.head.setUint8(0, v);
    this.push(new Uint8Array(this.head.buffer.slice(0, 1)));
  }
  u16(v: number) {
    this.head.setUint16(0, v, true);
    this.push(new Uint8Array(this.head.buffer.slice(0, 2)));
  }
  u32(v: number) {
    this.head.setUint32(0, v >>> 0, true);
    this.push(new Uint8Array(this.head.buffer.slice(0, 4)));
  }
  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.size += bytes.length;
  }
  /** Joins the parts and appends the CRC-32 of the result. */
  finish(): Uint8Array {
    const out = new Uint8Array(this.size + 4);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    new DataView(out.buffer).setUint32(at, crc32(out, at), true);
    return out;
  }
}

class In {
  private view: DataView;
  pos = 0;
  constructor(private data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  private need(n: number) {
    if (this.pos + n > this.data.length - 4) throw new Error("YTFY: file is truncated");
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  bytes(n: number) {
    this.need(n);
    const v = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

// ---------------------------------------------------------------- Container

export function encodeYtfy(content: YtfyContent): Uint8Array {
  const o = new Out();
  o.push(Uint8Array.from(MAGIC));
  o.u8(YTFY_VERSION);
  if (content.codec === "raw") {
    const mime = new TextEncoder().encode(content.mime.slice(0, 200));
    o.u8(CODEC_RAW);
    o.u8(mime.length);
    o.push(mime);
    o.u32(content.bytes.length);
    o.push(content.bytes);
    return o.finish();
  }
  const { packets, durations } = content;
  if (packets.length !== durations.length) throw new Error("YTFY: one duration per packet");
  const fixed = durations.length > 0 && durations.every((d) => d === durations[0]) ? durations[0]! : 0;
  const sizes = packets.map((p) => p.length);
  const table = riceEncode(fixed ? sizes : [...sizes, ...durations]);
  o.u8(CODEC_OPUS);
  o.u8(content.channels);
  o.u16(content.preSkip);
  o.u32(content.sourceRate);
  o.u32(content.bitrate);
  o.u32(content.totalSamples);
  o.u16(fixed);
  o.u32(packets.length);
  o.u32(table.length);
  o.push(table);
  for (const p of packets) o.push(p);
  return o.finish();
}

export function decodeYtfy(file: Uint8Array): YtfyContent {
  if (file.length < 10 || MAGIC.some((b, i) => file[i] !== b)) throw new Error("YTFY: not a YoutiFy offline file");
  const stored = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(file.length - 4, true);
  if (crc32(file, file.length - 4) !== stored) throw new Error("YTFY: file is damaged (checksum mismatch)");
  const r = new In(file);
  r.pos = 4;
  const version = r.u8();
  if (version > YTFY_VERSION) throw new Error("YTFY: made by a newer YoutiFy");
  const codec = r.u8();
  if (codec === CODEC_RAW) {
    const mime = new TextDecoder().decode(r.bytes(r.u8()));
    return { codec: "raw", mime, bytes: r.bytes(r.u32()) };
  }
  if (codec !== CODEC_OPUS) throw new Error("YTFY: unknown codec");
  const channels = r.u8();
  const preSkip = r.u16();
  const sourceRate = r.u32();
  const bitrate = r.u32();
  const totalSamples = r.u32();
  const fixed = r.u16();
  const count = r.u32();
  const table = riceDecode(r.bytes(r.u32()), fixed ? count : count * 2);
  const sizes = table.slice(0, count);
  const durations = fixed ? new Array<number>(count).fill(fixed) : table.slice(count);
  const packets = sizes.map((n) => {
    if (n < 0) throw new Error("YTFY: bad size table");
    return r.bytes(n);
  });
  return { codec: "opus", channels, preSkip, sourceRate, bitrate, totalSamples, packets, durations };
}

// ---------------------------------------------------------------- Ogg Opus (RFC 3533 + RFC 7845)

// Ogg uses the non-reflected CRC-32 with polynomial 0x04c11db7 and no final xor.
const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(data: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < data.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ data[i]!) & 0xff]!) >>> 0;
  return c;
}

const SERIAL = 0x59544659;

function oggPage(packets: Uint8Array[], granule: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error("Ogg: too many segments on one page");
  const body = packets.reduce((s, p) => s + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + body);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  v.setUint8(4, 0);
  v.setUint8(5, flags);
  // 64-bit granule position (songs stay far below 2^32 samples, but keep the high word right).
  v.setUint32(6, granule % 2 ** 32, true);
  v.setUint32(10, Math.floor(granule / 2 ** 32), true);
  v.setUint32(14, SERIAL, true);
  v.setUint32(18, seq, true);
  v.setUint32(22, 0, true);
  v.setUint8(26, lacing.length);
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, at);
    at += p.length;
  }
  v.setUint32(22, oggCrc(page), true);
  return page;
}

function opusHead(channels: number, preSkip: number, sourceRate: number): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set(new TextEncoder().encode("OpusHead"), 0);
  v.setUint8(8, 1);
  v.setUint8(9, channels);
  v.setUint16(10, preSkip, true);
  v.setUint32(12, sourceRate, true);
  v.setInt16(16, 0, true);
  v.setUint8(18, 0); // mapping family 0: mono or stereo
  return h;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("YoutiFy");
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  const v = new DataView(t.buffer);
  t.set(new TextEncoder().encode("OpusTags"), 0);
  v.setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  v.setUint32(12 + vendor.length, 0, true);
  return t;
}

/** Builds a playable Ogg Opus file from the stored packets. */
export function toOggOpus(s: OpusStream): Uint8Array {
  const pages: Uint8Array[] = [
    oggPage([opusHead(s.channels, s.preSkip, s.sourceRate)], 0, 0, 0x02),
    oggPage([opusTags()], 0, 1, 0x00),
  ];
  const end = s.preSkip + s.totalSamples;
  let granule = 0;
  let seq = 2;
  let batch: Uint8Array[] = [];
  let segments = 0;
  const flush = (last: boolean) => {
    if (!batch.length) return;
    pages.push(oggPage(batch, last ? Math.min(granule, end) : granule, seq++, last ? 0x04 : 0x00));
    batch = [];
    segments = 0;
  };
  s.packets.forEach((p, i) => {
    const segs = Math.floor(p.length / 255) + 1;
    // About one second of audio per page keeps seeking precise and pages well under the 255-segment limit.
    if (segments + segs > 255 || batch.length >= 50) flush(false);
    batch.push(p);
    segments += segs;
    granule += s.durations[i]!;
  });
  flush(true);
  const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Decompresses a YTFY file into something an audio element plays. */
export function ytfyToBlob(file: Uint8Array): Blob {
  const c = decodeYtfy(file);
  if (c.codec === "raw") return new Blob([c.bytes as BlobPart], { type: c.mime });
  return new Blob([toOggOpus(c) as BlobPart], { type: "audio/ogg; codecs=opus" });
}
