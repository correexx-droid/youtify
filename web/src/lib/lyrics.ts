import type { Track } from "./types";

/**
 * Song lyrics from the open web, looked up straight from the app (both services allow cross-origin requests):
 * - LRCLIB (lrclib.net): free, no key, often with time-synced lines (LRC).
 * - lyrics.ovh as a fallback for plain text.
 */

export interface LyricLine {
  /** Seconds from the start of the song. */
  time: number;
  text: string;
}

export interface Lyrics {
  /** Time-synced lines, when the source has them. */
  synced: LyricLine[] | null;
  /** Plain text, one line per row. */
  plain: string | null;
  instrumental: boolean;
  source: "LRCLIB" | "lyrics.ovh";
}

/** Noise YouTube titles carry that lyric databases don't: "(Official Video)", "[HD]", "ft. X", "| Live at…". */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(official|video|audio|lyric|lyrics|visualizer|hd|hq|4k|remaster(ed)?|live|mv|clip)[^)\]]*[)\]]/gi, "")
    .replace(/\s*[([]\s*(ft|feat)\.?[^)\]]*[)\]]/gi, "")
    .replace(/\s+(ft|feat)\.?\s.*$/i, "")
    .replace(/\s*[|｜].*$/, "")
    .replace(/["“”]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanArtist(artist: string): string {
  return artist
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .split(/\s*(,|&|\bx\b|\bfeat\.?|\bft\.?)\s*/i)[0]!
    .trim();
}

/** Artist and song title to look up. Music videos often read "Artist - Song" with the channel as the artist. */
export function lyricsQuery(track: Pick<Track, "title" | "artist">): { artist: string; title: string } {
  const raw = cleanTitle(track.title);
  const dash = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: cleanArtist(dash[1]!), title: cleanTitle(dash[2]!) };
  return { artist: cleanArtist(track.artist), title: raw };
}

/** Parses LRC text: "[01:23.45] line", also several stamps on one line. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = row.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      out.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

interface LrclibHit {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fromLrclib(hit: LrclibHit): Lyrics | null {
  const synced = hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : null;
  const plain = hit.plainLyrics?.trim() || null;
  if (!synced?.length && !plain && !hit.instrumental) return null;
  return { synced: synced?.length ? synced : null, plain, instrumental: hit.instrumental, source: "LRCLIB" };
}

const LRCLIB = "https://lrclib.net/api";

async function lrclib(artist: string, title: string, duration: number): Promise<Lyrics | null> {
  const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
  // Exact match first (artist + title + length within a couple of seconds).
  if (artist && duration > 0) {
    const hit = await getJson<LrclibHit>(
      `${LRCLIB}/get?${qs({ artist_name: artist, track_name: title, duration: String(Math.round(duration)) })}`,
    );
    const got = hit && fromLrclib(hit);
    if (got) return got;
  }
  // Then a search, preferring synced results whose length is closest to the track's.
  const hits =
    (await getJson<LrclibHit[]>(`${LRCLIB}/search?${qs(artist ? { track_name: title, artist_name: artist } : { q: title })}`)) ??
    [];
  const more = hits.length ? [] : ((await getJson<LrclibHit[]>(`${LRCLIB}/search?${qs({ q: `${artist} ${title}`.trim() })}`)) ?? []);
  const ranked = [...hits, ...more]
    .filter((h) => h.syncedLyrics || h.plainLyrics || h.instrumental)
    .map((h) => {
      const off = duration > 0 && h.duration ? Math.abs(h.duration - duration) : 0;
      return { h, score: off + (h.syncedLyrics ? 0 : 4) };
    })
    .filter(({ h }) => !(duration > 0 && h.duration && Math.abs(h.duration - duration) > 20))
    .sort((a, b) => a.score - b.score);
  for (const { h } of ranked) {
    const got = fromLrclib(h);
    if (got) return got;
  }
  return null;
}

async function lyricsOvh(artist: string, title: string): Promise<Lyrics | null> {
  if (!artist || !title) return null;
  const res = await getJson<{ lyrics?: string }>(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
  );
  const text = res?.lyrics?.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return text ? { synced: null, plain: text, instrumental: false, source: "lyrics.ovh" } : null;
}

const cache = new Map<string, Promise<Lyrics | null>>();

/** Lyrics for a track, or null when none of the sources has them. Results (and misses) are cached per session. */
export function findLyrics(track: Track): Promise<Lyrics | null> {
  const key = track.id;
  const hit = cache.get(key);
  if (hit) return hit;
  const { artist, title } = lyricsQuery(track);
  const job = (async () => {
    const got = (await lrclib(artist, title, track.duration)) ?? (await lyricsOvh(artist, title));
    return got;
  })();
  cache.set(key, job);
  // A miss is retried the next time (it may have been the network), a hit stays.
  void job.then((got) => {
    if (!got) cache.delete(key);
  });
  return job;
}

/** Index of the line being sung at `position`, or -1 before the first one. */
export function activeLine(lines: LyricLine[], position: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.time <= position + 0.15) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
