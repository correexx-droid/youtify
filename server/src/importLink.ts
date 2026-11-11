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
  | {
      source: "spotify";
      name: string;
      queries: LinkQuery[];
      /** True when only Spotify's public preview was read and the playlist may hold more than these songs. */
      partial?: boolean;
    };

/** The user's own Spotify app (developer.spotify.com): lets the official Web API read whole playlists. */
export interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
}

const MAX_TRACKS = 5000;
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
    for (let round = 0; round < 250; round++) {
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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const doFetch: typeof fetch = (input, init) => (config.fetch ?? fetch)(input, init);

// ---------------------------------------------------------------- Official Web API (with the user's own app keys)

const tokens = new Map<string, { token: string; until: number }>();

async function spotifyToken(c: SpotifyCredentials): Promise<string> {
  const key = c.clientId;
  const cached = tokens.get(key);
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const res = await doFetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new HttpError(401, msg("spotifyKeys"));
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(key, { token: body.access_token, until: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

async function spotifyApi(type: string, id: string, c: SpotifyCredentials): Promise<LinkImport> {
  const token = await spotifyToken(c);
  const get = async (url: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2) * 1000));
        continue;
      }
      if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, msg("importFailed"));
      return (await res.json()) as any;
    }
    throw new HttpError(502, msg("importFailed"));
  };
  const toQuery = (t: any): LinkQuery | null =>
    t?.name
      ? {
          title: String(t.name),
          artist: (t.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(", "),
          duration: Math.round((Number(t.duration_ms) || 0) / 1000),
        }
      : null;
  const api = "https://api.spotify.com/v1";
  if (type === "track") {
    const t = await get(`${api}/tracks/${id}`);
    return { source: "spotify", name: text(t.name) || "Spotify", queries: [toQuery(t)!].filter(Boolean) };
  }
  const head = await get(`${api}/${type === "album" ? "albums" : "playlists"}/${id}?fields=name`);
  const queries: LinkQuery[] = [];
  let next: string | null =
    type === "album"
      ? `${api}/albums/${id}/tracks?limit=50`
      : `${api}/playlists/${id}/tracks?limit=100&fields=next,items(track(name,duration_ms,artists(name)))`;
  while (next && queries.length < MAX_TRACKS) {
    const page = await get(next);
    for (const item of page.items ?? []) {
      const q = toQuery(type === "album" ? item : item?.track);
      if (q) queries.push(q);
    }
    next = page.next ?? null;
  }
  return { source: "spotify", name: text(head.name) || "Spotify", queries };
}

// ---------------------------------------------------------------- Public embed page (no account)

async function spotify(type: string, id: string): Promise<LinkImport> {
  const res = await doFetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
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
  // The public page lists at most 100 songs of a playlist.
  return { source: "spotify", name, queries, partial: type === "playlist" && list.length >= 100 };
}

/** Song links copied out of the Spotify app (select all songs, copy): every link is read on its own. */
const SPOTIFY_TRACKS = /(?:open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/g;

export function trackLinks(text: string): string[] {
  return [...new Set([...text.matchAll(SPOTIFY_TRACKS)].map((m) => m[1]!))].slice(0, MAX_TRACKS);
}

async function spotifyTrackList(ids: string[], c: SpotifyCredentials | null): Promise<LinkImport> {
  const queries: (LinkQuery | null)[] = new Array(ids.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      try {
        const r = c ? await spotifyApi("track", ids[i]!, c) : await spotify("track", ids[i]!);
        queries[i] = r.source === "spotify" ? (r.queries[0] ?? null) : null;
      } catch {
        queries[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  return { source: "spotify", name: "Spotify-Import", queries: queries.filter((q): q is LinkQuery => !!q) };
}

export async function readPlaylistLink(url: string, lang: Lang, keys?: SpotifyCredentials | null): Promise<LinkImport> {
  const creds = keys?.clientId && keys.clientSecret ? keys : null;
  const songs = trackLinks(url);
  const link = songs.length > 1 ? null : parseLink(url);
  if (!link && songs.length < 2) throw new HttpError(400, msg("importBadLink"));
  let result: LinkImport;
  try {
    if (!link) result = await spotifyTrackList(songs, creds);
    else if (link.kind === "youtube") result = await youtubePlaylist(link.id, lang);
    else if (creds) result = await spotifyApi(link.type, link.id, creds);
    else result = await spotify(link.type, link.id);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, msg("importFailed"));
  }
  const size = result.source === "youtube" ? result.tracks.length : result.queries.length;
  if (!size) throw new HttpError(404, msg("importEmpty"));
  return result;
}
