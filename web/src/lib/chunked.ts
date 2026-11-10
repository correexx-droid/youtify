/** One ranged request: the bytes it got, the file's total size (from Content-Range) and its type. */
export interface RangePart {
  status: number;
  bytes: Uint8Array;
  total: number | null;
  mime: string;
}

export type RangeFetcher = (start: number, end: number) => Promise<RangePart>;

// YouTube serves big unranged requests slowly or cuts them off; 1 MiB pieces download at full speed.
const CHUNK = 1 << 20;

/** Downloads a whole stream in ranged pieces, retrying each piece a couple of times. */
export async function downloadInChunks(
  get: RangeFetcher,
  onProgress?: (done: number, total: number | null) => void,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const parts: Uint8Array[] = [];
  let size = 0;
  let total: number | null = null;
  let mime = "audio/mp4";
  for (;;) {
    let part: RangePart | null = null;
    for (let attempt = 0; attempt < 3 && !part; attempt++) {
      try {
        const p = await get(size, size + CHUNK - 1);
        if (p.status === 200 || p.status === 206) part = p;
        else if (p.status === 416) part = { ...p, bytes: new Uint8Array(0) };
        else throw new Error(`HTTP ${p.status}`);
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (!part) throw new Error("download failed");
    mime = part.mime || mime;
    total ??= part.total;
    if (part.bytes.length) {
      parts.push(part.bytes);
      size += part.bytes.length;
    }
    onProgress?.(size, total);
    // A 200 is the whole file at once; otherwise stop at the total or at a short (last) piece.
    if (part.status === 200 || !part.bytes.length || (total !== null ? size >= total : part.bytes.length < CHUNK)) break;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, mime };
}

export function totalFromContentRange(value: string | null | undefined): number | null {
  const m = value ? /\/(\d+)\s*$/.exec(value) : null;
  return m ? Number(m[1]) : null;
}
