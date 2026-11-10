import { config } from "./config.js";
import { msg, type Lang } from "./i18n.js";
import { text, toTrack, withClient } from "./search.js";
import { HttpError, type Track } from "./types.js";

/**
 * Reads a playlist someone pasted, to copy it into a new YoutiFy playlist.
 * - YouTube / YouTube Music playlists: their tracks, ready to play.
 * - Spotify playlists, albums and tracks: titles and artists only (Spotify's audio isn't playable here), which the
 *   app then looks up on YouTube one by one. Read from Spotify's public embed page, so no Spotify account is needed.
 */

export interface LinkQuery {
  title: string;
  artist: string;
  /** Seconds, when the source says, so the best-matching YouTube result can be picked. */
  duration: number;
}

export type LinkImport =
  | { source: "youtube"; name: string; tracks: Track[] }
  | { source: "spotify"; name: string; queries: LinkQuery[] };

const MAX_TRACKS = 500;
const YT_LIST = /^[\w-]{10,64}$/;
const SPOTIFY = /(?:open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track)[/:]([A-Za-z0-9]{10,40})/;

export function parseLink(raw: string): { kind: "youtube"; id: string } | { kind: "spotify"; type: string; id: string } | null {
  const input = raw.trim();
  const sp = SPOTIFY.exec(input);
  if (sp) return { kind: "spotify", type: sp[1]!, id: sp[2]! };
  try {
    const url = new URL(input);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname)) return null;
    const list = url.searchParams.get("list");
    return list && YT_LIST.test(list) ? { kind: "youtube", id: list } : null;
  } catch {
    // A bare playlist ID ("PL…", "OLAK5uy_…") works too.
    return /^(PL|OL|UU|FL|LL)[\w-]{10,62}$/.test(input) ? { kind: "youtube", id: input } : null;
  }
}

/** "3:55" or "1:02:03" → seconds. */
function clock(v: string): number {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(v)) return 0;
  return v.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** YouTube's newer playlist rows ("LockupView") carry the video id, title, channel and length in other places. */
function lockupTrack(item: any): Track | null {
  if (item?.type !== "LockupView" || item.content_type !== "VIDEO") return null;
  const id = String(item.content_id ?? "");
  if (!/^[\w-]{11}$/.test(id)) return null;
  const rows: any[] = item.metadata?.metadata?.metadata_rows ?? [];
  const artist = text(rows[0]?.metadata_parts?.[0]?.text?.text).replace(/\s*-\s*Topic$/i, "");
  const badges: any[] = (item.content_image?.overlays ?? []).flatMap((o: any) => o?.badges ?? []);
  const duration = badges.map((b) => clock(text(b?.text))).find((n) => n > 0) ?? 0;
  return {
    id,
    title: text(item.metadata?.title?.text ?? item.metadata?.title) || "Untitled",
    artist,
    duration,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    art: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    kind: "video",
  };
}

async function youtubePlaylist(id: string, lang: Lang): Promise<LinkImport> {
  return withClient(async (yt) => {
    let page: any = await yt.getPlaylist(id);
    const name = text(page?.info?.title) || "YouTube playlist";
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (let round = 0; round < 30; round++) {
      for (const item of page?.items ?? page?.videos ?? []) {
        const track = lockupTrack(item) ?? toTrack(item, "song");
        if (track && !seen.has(track.id)) {
          seen.add(track.id);
          tracks.push(track);
        }
      }
      if (tracks.length >= MAX_TRACKS || !page?.has_continuation) break;
      page = await page.getContinuation();
    }
    return { source: "youtube" as const, name, tracks: tracks.slice(0, MAX_TRACKS) };
  }, lang);
}

async function spotify(type: string, id: string): Promise<LinkImport> {
  const doFetch = config.fetch ?? fetch;
  const res = await doFetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Accept-Language": "en",
    },
  });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, msg("importFailed"));
  const html = await res.text();
  const json = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) throw new HttpError(502, msg("importFailed"));
  const data = JSON.parse(json);
  const entity = data?.props?.pageProps?.state?.data?.entity ?? data?.props?.pageProps?.entity;
  if (!entity) throw new HttpError(502, msg("importFailed"));
  const name = text(entity.name) || text(entity.title) || "Spotify";
  const list: any[] = Array.isArray(entity.trackList) ? entity.trackList : [entity];
  const queries = list
    .map((t): LinkQuery => ({
      title: text(t.title ?? t.name).trim(),
      artist: text(t.subtitle ?? (t.artists ?? []).map((a: any) => a?.name).join(", ")).replace(/ /g, " ").trim(),
      duration: Math.round((Number(t.duration ?? t.duration_ms ?? 0) || 0) / 1000),
    }))
    .filter((q) => q.title)
    .slice(0, MAX_TRACKS);
  return { source: "spotify", name, queries };
}

export async function readPlaylistLink(url: string, lang: Lang): Promise<LinkImport> {
  const link = parseLink(url);
  if (!link) throw new HttpError(400, msg("importBadLink"));
  let result: LinkImport;
  try {
    result = link.kind === "youtube" ? await youtubePlaylist(link.id, lang) : await spotify(link.type, link.id);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, msg("importFailed"));
  }
  const size = result.source === "youtube" ? result.tracks.length : result.queries.length;
  if (!size) throw new HttpError(404, msg("importEmpty"));
  return result;
}
