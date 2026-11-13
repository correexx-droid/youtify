import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { Track } from "./types";

/**
 * Free, legal sources for songs YouTube didn't give: Audius (artists upload and stream their own music through
 * an open API) and the Internet Archive (only items with a Creative Commons or other free licence). Used by the
 * offline deep search after the YouTube sources are used up.
 */

export interface FreeSource {
  name: "Audius" | "Internet Archive";
  url: string;
  mime: string;
}

const APP = "YoutiFy";

type Bytes = { status: number; bytes: Uint8Array; headers: Record<string, string> };
const pcBytes = (globalThis as { __musikeFetchBytes?: (r: { url: string; headers: Record<string, string> }) => Promise<Bytes> })
  .__musikeFetchBytes;

/** Fetches from other sites on every platform (the phone apps can't use the page's fetch for them). */
async function get(url: string, timeout = 20_000): Promise<{ status: number; bytes: Uint8Array; type: string }> {
  if (pcBytes) {
    const r = await pcBytes({ url, headers: {} });
    const type = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    return { status: r.status, bytes: r.bytes, type };
  }
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ url, method: "GET", responseType: "arraybuffer", connectTimeout: 15_000, readTimeout: timeout });
    const type = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    const data = r.data as unknown;
    const bytes =
      typeof data === "string"
        ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new TextEncoder().encode(JSON.stringify(data));
    return { status: r.status, bytes, type };
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "" };
}

async function getJson<T>(url: string): Promise<T> {
  const r = await get(url);
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(new TextDecoder().decode(r.bytes)) as T;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]|feat\..*|ft\..*|official.*|lyrics?|audio|video/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Same song? Title words mostly present, the artist named somewhere, length close if both are known. */
function matches(track: Track, title: string, artist: string, seconds?: number): boolean {
  const want = norm(track.title).split(" ").filter((w) => w.length > 1);
  const have = new Set(norm(`${title} ${artist}`).split(" "));
  if (!want.length) return false;
  const hits = want.filter((w) => have.has(w)).length;
  if (hits / want.length < 0.8) return false;
  const who = norm(track.artist).split(" ")[0];
  if (who && !norm(`${artist} ${title}`).includes(who)) return false;
  if (track.duration && seconds && Math.abs(track.duration - seconds) > 20) return false;
  return true;
}

async function audius(track: Track): Promise<FreeSource[]> {
  const q = encodeURIComponent(`${track.artist} ${track.title}`);
  const { data } = await getJson<{ data?: { id: string; title: string; duration?: number; is_streamable?: boolean; user?: { name?: string } }[] }>(
    `https://api.audius.co/v1/tracks/search?query=${q}&app_name=${APP}`,
  );
  return (data ?? [])
    .filter((t) => t.is_streamable !== false && matches(track, t.title, t.user?.name ?? "", t.duration))
    .slice(0, 2)
    .map((t) => ({ name: "Audius", url: `https://api.audius.co/v1/tracks/${t.id}/stream?app_name=${APP}`, mime: "audio/mpeg" }));
}

async function archive(track: Track): Promise<FreeSource[]> {
  const words = (s: string) => norm(s).split(" ").filter(Boolean).join(" ");
  const q = encodeURIComponent(`title:(${words(track.title)}) AND creator:(${words(track.artist)}) AND mediatype:audio AND licenseurl:*`);
  const res = await getJson<{ response?: { docs?: { identifier: string }[] } }>(
    `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&rows=4&output=json`,
  );
  const out: FreeSource[] = [];
  for (const { identifier } of res.response?.docs ?? []) {
    const meta = await getJson<{ metadata?: { creator?: string | string[] }; files?: { name: string; format?: string; title?: string; length?: string }[] }>(
      `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
    ).catch(() => null);
    const creator = [meta?.metadata?.creator ?? ""].flat().join(" ");
    const file = meta?.files?.find(
      (f) => /mp3/i.test(f.format ?? "") && matches(track, f.title ?? f.name, creator, f.length ? Number.parseFloat(f.length) : undefined),
    );
    if (file) out.push({ name: "Internet Archive", url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`, mime: "audio/mpeg" });
    if (out.length >= 2) break;
  }
  return out;
}

/** Up to four free copies of the song, best guesses first. */
export async function freeSources(track: Track): Promise<FreeSource[]> {
  if (track.kind === "local") return [];
  const found = await Promise.all([audius(track).catch(() => []), archive(track).catch(() => [])]);
  return found.flat();
}

/** Downloads one free copy (a few MB at most; these sites send whole files). */
export async function downloadFree(src: FreeSource): Promise<{ bytes: Uint8Array; mime: string }> {
  const r = await get(src.url, 90_000);
  if (r.status >= 400 || r.bytes.length < 50_000) throw new Error(`${src.name}: HTTP ${r.status}`);
  const mime = r.type.split(";")[0]?.trim();
  return { bytes: r.bytes, mime: mime && mime.startsWith("audio/") ? mime : src.mime };
}
