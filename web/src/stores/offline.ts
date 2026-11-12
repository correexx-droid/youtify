import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { create } from "zustand";
import { downloadAudio } from "../lib/api";
import type { Library, Track } from "../lib/types";
import { canTranscode, compressTrack } from "../lib/transcode";
import { decodeYtfy, encodeYtfy, ytfyToBlob } from "../lib/ytfy";
import { useLibrary } from "./library";

/**
 * Offline songs. Playlists and Favorites can be marked for download; their songs are fetched one at a time,
 * compressed into YTFY files (lib/ytfy.ts, lib/transcode.ts) and kept in IndexedDB. Each song is stored once,
 * however many downloaded collections it is in, and removed when none of them holds it any more.
 */

export type PinKey = "favorites" | `playlist:${string}`;

export interface OfflineItem {
  id: string;
  title: string;
  artist: string;
  codec: "opus" | "raw";
  /** Bytes on this device. */
  stored: number;
  /** Bytes of the stream as downloaded. */
  original: number;
  bitrate: number;
  savedAt: number;
  /** Imported from the user's own file: kept as long as the library holds the song, never downloaded again. */
  local?: boolean;
  /** Downloaded and stored as-is; the compression pass still has to shrink it. */
  pendingCompress?: boolean;
}

export interface ActiveJob {
  id: string;
  title: string;
  phase: "download" | "compress";
  progress: number;
  /** Bytes received / expected (download). */
  received?: number;
  total?: number | null;
  startedAt?: number;
  /** Last time data arrived: a long gap means the connection hangs. */
  lastDataAt?: number;
  /** What's going on, in a few words ("waiting for YouTube", "retrying"…). */
  note?: string;
  /** Which source is being tried (1 = the song's own video, 2–3 = other uploads of the same song). */
  source?: number;
}

/** One source (YouTube video) gets this long before the next one is tried. */
const SONG_TIMEOUT_MS = 150_000;
/** A song is tried from up to this many sources: its own video, then other uploads of the same song. */
const MAX_SOURCES = 3;
/** Compressing one song may take this long on a slow phone before the original is simply kept. */
const COMPRESS_TIMEOUT_MS = 3 * 60_000;

function withTimeout<T>(job: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    job.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Compression levels for offline songs: Opus bitrate (0 = keep the download as it is). Savings vs. ~128 kbps. */
export const QUALITIES = [
  { id: "off", bitrate: 0, saving: 0 },
  { id: "high", bitrate: 96_000, saving: 25 },
  { id: "standard", bitrate: 64_000, saving: 50 },
  { id: "small", bitrate: 48_000, saving: 63 },
  { id: "max", bitrate: 32_000, saving: 75 },
] as const;
export type Quality = (typeof QUALITIES)[number]["id"];

const PINS_KEY = "youtify:offline-pins";
const WIFI_KEY = "youtify:offline-wifi-only";
const QUALITY_KEY = "youtify:offline-quality";

/** iOS plays through a native player that can't open in-page files, so offline songs aren't offered there. */
export const offlineSupported =
  typeof indexedDB !== "undefined" &&
  !(globalThis as { webkit?: { messageHandlers?: { musikeAudio?: unknown } } }).webkit?.messageHandlers?.musikeAudio;

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = "youtify-offline";
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files");
      req.result.createObjectStore("items", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(stores, mode);
        const req = run(t);
        t.oncomplete = () => resolve(req ? req.result : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error("IndexedDB aborted"));
      }),
  );
}

const putSong = (item: OfflineItem, file: Uint8Array) =>
  tx(["files", "items"], "readwrite", (t) => {
    t.objectStore("files").put(file, item.id);
    t.objectStore("items").put(item);
  });
const deleteSong = (id: string) =>
  tx(["files", "items"], "readwrite", (t) => {
    t.objectStore("files").delete(id);
    t.objectStore("items").delete(id);
  });
const putItem = (item: OfflineItem) =>
  tx(["items"], "readwrite", (t) => {
    t.objectStore("items").put(item);
  });
const readFile = (id: string) => tx<Uint8Array | undefined>(["files"], "readonly", (t) => t.objectStore("files").get(id));
const readItems = () => tx<OfflineItem[]>(["items"], "readonly", (t) => t.objectStore("items").getAll());

// ---------------------------------------------------------------- Wi-Fi

/** On a phone, downloads wait for Wi-Fi (mobile data stays untouched) unless the user turns that off. */
const onPhone = Capacitor.isNativePlatform();

function readWifiOnly(): boolean {
  try {
    const v = localStorage.getItem(WIFI_KEY);
    return v === null ? onPhone : v === "1";
  } catch {
    return onPhone;
  }
}

/** "wifi", "cellular", "none" or "unknown" (PCs and browsers that don't say). */
let connection: "wifi" | "cellular" | "none" | "unknown" = "unknown";

function canDownloadNow(): boolean {
  if (!navigator.onLine || connection === "none") return false;
  if (!useOffline.getState().wifiOnly) return true;
  // Only a connection known to be mobile data is held back; Ethernet/unknown (PCs) count as fine.
  return connection !== "cellular";
}

const currentBitrate = (): number => QUALITIES.find((q) => q.id === useOffline.getState().quality)?.bitrate ?? 64_000;

/**
 * Other uploads of the same song on YouTube (topic channel, lyric video, other channels), for when the song's own
 * video won't download: similar length, not the same video.
 */
async function alternativeSources(track: Track): Promise<string[]> {
  try {
    const { lyricsQuery } = await import("../lib/lyrics");
    const { api } = await import("../lib/api");
    const q = lyricsQuery(track);
    const found = await api.search([q.artist, q.title].filter(Boolean).join(" "), "song");
    return found
      .filter((t) => t.id !== track.id && t.kind !== "local")
      .filter((t) => !track.duration || !t.duration || Math.abs(t.duration - track.duration) <= 20)
      .map((t) => t.id)
      .slice(0, MAX_SOURCES - 1);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- Store

function readPins(): PinKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is PinKey => typeof k === "string") : [];
  } catch {
    return [];
  }
}
function readQuality(): Quality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return QUALITIES.some((q) => q.id === v) ? (v as Quality) : "standard";
  } catch {
    return "standard";
  }
}

interface OfflineState {
  ready: boolean;
  items: Record<string, OfflineItem>;
  pins: PinKey[];
  quality: Quality;
  /** Download only over Wi-Fi (default on phones). */
  wifiOnly: boolean;
  /** True while downloads wait because the phone is on mobile data. */
  waitingForWifi: boolean;
  /** Songs waiting to be downloaded, in order. */
  queue: string[];
  active: ActiveJob | null;
  failed: Record<string, string>;
  /** Titles of skipped songs, for the downloads panel. */
  failedTitles: Record<string, string>;
  /** Songs saved in this session (for the progress counter). */
  doneThisRun: number;
  /** Downloads panel open. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  pin: (key: PinKey) => void;
  unpin: (key: PinKey) => void;
  /** Download button: (re)tries every song of the collection that isn't on the device yet, skipping failures. */
  download: (key: PinKey, tracks: Track[]) => void;
  /** Delete button: removes the collection's downloads, keeping songs another downloaded collection still holds. */
  removeDownloads: (key: PinKey) => void;
  /** Takes the songs that couldn't be downloaded out of the downloaded playlists (and Favorites). */
  removeSkipped: () => Promise<number>;
  setWifiOnly: (on: boolean) => void;
  setQuality: (q: Quality) => void;
  retryFailed: () => void;
  removeAll: () => Promise<void>;
}

export const useOffline = create<OfflineState>((set, get) => ({
  ready: false,
  items: {},
  pins: readPins(),
  quality: readQuality(),
  wifiOnly: readWifiOnly(),
  waitingForWifi: false,
  queue: [],
  active: null,
  failed: {},
  failedTitles: {},
  doneThisRun: 0,
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  pin: (key) => {
    if (get().pins.includes(key)) return;
    const pins = [...get().pins, key];
    savePins(pins);
    set({ pins });
    // Ask the browser not to clear these files when space runs low.
    void navigator.storage?.persist?.().catch(() => {});
    sync();
  },
  unpin: (key) => {
    const pins = get().pins.filter((k) => k !== key);
    savePins(pins);
    set({ pins });
    sync();
  },
  download: (key, tracks) => {
    // Songs that failed before get another chance; the ones that fail again are skipped.
    const ids = new Set(tracks.map((t) => t.id));
    set((s) => ({ failed: Object.fromEntries(Object.entries(s.failed).filter(([id]) => !ids.has(id))) }));
    if (!get().pins.includes(key)) {
      const pins = [...get().pins, key];
      savePins(pins);
      set({ pins });
      void navigator.storage?.persist?.().catch(() => {});
    }
    sync();
  },
  removeDownloads: (key) => {
    const pins = get().pins.filter((k) => k !== key);
    savePins(pins);
    set({ pins });
    // sync() deletes every song no remaining downloaded collection (or own import) needs.
    sync();
  },
  removeSkipped: async () => {
    const failed = new Set(Object.keys(get().failed));
    const lib = useLibrary.getState();
    let removed = 0;
    for (const key of get().pins) {
      if (key === "favorites") {
        for (const t of lib.favorites.filter((f) => failed.has(f.id))) {
          await lib.toggleFavorite(t);
          removed++;
        }
      } else {
        const p = lib.playlists.find((pl) => `playlist:${pl.id}` === key);
        for (const t of p?.tracks.filter((tr) => failed.has(tr.id)) ?? []) {
          await lib.removeFromPlaylist(p!.id, t.id);
          removed++;
        }
      }
    }
    set({ failed: {}, failedTitles: {} });
    return removed;
  },
  setWifiOnly: (wifiOnly) => {
    try {
      localStorage.setItem(WIFI_KEY, wifiOnly ? "1" : "0");
    } catch {
      /* private mode */
    }
    set({ wifiOnly });
    sync();
  },
  setQuality: (quality) => {
    try {
      localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      /* private mode */
    }
    set({ quality });
  },
  retryFailed: () => {
    set({ failed: {}, failedTitles: {} });
    sync();
  },
  removeAll: async () => {
    savePins([]);
    set({ pins: [], queue: [], failed: {} });
    const ids = Object.keys(get().items);
    for (const id of ids) await deleteSong(id).catch(() => {});
    set({ items: {} });
  },
}));

function savePins(pins: PinKey[]) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* private mode */
  }
}

export const pinKeyFor = (kind: "favorites" | "playlist", id?: string): PinKey | null =>
  kind === "favorites" ? "favorites" : id ? `playlist:${id}` : null;

/** Tracks of a collection, as the library holds them now. */
function tracksOf(lib: Pick<Library, "favorites" | "playlists">, key: PinKey): Track[] | null {
  if (key === "favorites") return lib.favorites;
  return lib.playlists.find((p) => `playlist:${p.id}` === key)?.tracks ?? null;
}

/** Ids of every song anywhere in the library (favorites, playlists, history). */
function libraryIds(): Set<string> {
  const lib = useLibrary.getState();
  const ids = new Set<string>();
  for (const t of lib.favorites) ids.add(t.id);
  for (const t of lib.history) ids.add(t.id);
  for (const p of lib.playlists) for (const t of p.tracks) ids.add(t.id);
  return ids;
}

/** Every track some downloaded collection holds. */
function wantedTracks(): Map<string, Track> {
  const lib = useLibrary.getState();
  const out = new Map<string, Track>();
  for (const key of useOffline.getState().pins) for (const t of tracksOf(lib, key) ?? []) if (!out.has(t.id)) out.set(t.id, t);
  return out;
}

/** How far a collection is: songs saved / songs in it. */
export function collectionProgress(tracks: Track[], items: Record<string, OfflineItem>) {
  const done = tracks.filter((t) => items[t.id]).length;
  return { done, total: tracks.length };
}

let syncing = false;
let syncAgain = false;

/** Brings the device in line with the downloaded collections: fetch what's missing, delete what nobody needs. */
function sync() {
  if (!offlineSupported || !useOffline.getState().ready) return;
  const lib = useLibrary.getState();
  const state = useOffline.getState();
  const wanted = wantedTracks();

  // A playlist that no longer exists isn't downloaded any more.
  if (lib.status === "ready") {
    const pins = state.pins.filter((k) => tracksOf(lib, k) !== null);
    if (pins.length !== state.pins.length) {
      savePins(pins);
      useOffline.setState({ pins });
    }
    // Only clean up once the library is really loaded, or an empty first render would wipe everything.
    const everywhere = libraryIds();
    for (const [id, item] of Object.entries(state.items)) {
      if (item.local ? !everywhere.has(id) : !wanted.has(id)) {
        void deleteSong(id).catch(() => {});
        useOffline.setState((s) => {
          const items = { ...s.items };
          delete items[id];
          return { items };
        });
      }
    }
  }

  const queue = [...wanted.keys()].filter((id) => !id.startsWith("lo_") && !state.items[id] && !state.failed[id]);
  useOffline.setState(queue.length ? { queue } : { queue, waitingForWifi: false });
  void work(wanted);
}

async function work(wanted: Map<string, Track>) {
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    for (;;) {
      const s = useOffline.getState();
      const id = s.queue.find((q) => !s.items[q] && !s.failed[q]);
      if (!id) break;
      if (!canDownloadNow()) {
        useOffline.setState({ waitingForWifi: navigator.onLine && connection !== "none" });
        break;
      }
      useOffline.setState({ waitingForWifi: false });
      const track = wantedTracks().get(id) ?? wanted.get(id);
      if (!track) {
        useOffline.setState((st) => ({ queue: st.queue.filter((q) => q !== id) }));
        continue;
      }
      await saveOne(track);
      useOffline.setState((st) => ({ queue: st.queue.filter((q) => q !== id) }));
    }
    // Everything downloaded: now shrink the songs that are still stored as downloaded (first download, then compress).
    for (;;) {
      if (syncAgain) break;
      const pending = Object.values(useOffline.getState().items).find((i) => i.pendingCompress);
      if (!pending) break;
      await compressOne(pending);
    }
  } finally {
    syncing = false;
    useOffline.setState({ active: null });
    if (syncAgain) {
      syncAgain = false;
      sync();
    }
  }
}

async function compressOne(item: OfflineItem) {
  const job: ActiveJob = { id: item.id, title: item.title, phase: "compress", progress: 0, startedAt: Date.now() };
  useOffline.setState({ active: job });
  let done: OfflineItem = { ...item, pendingCompress: false };
  try {
    const file = await readFile(item.id);
    if (!file) throw new Error("missing");
    const raw = decodeYtfy(file instanceof Uint8Array ? file : new Uint8Array(file as ArrayBuffer));
    if (raw.codec !== "raw") throw new Error("already compressed");
    const bitrate = currentBitrate();
    if (!bitrate) throw new Error("compression off");
    const result = await withTimeout(
      compressTrack(raw.bytes, raw.mime, bitrate, (f) => useOffline.setState({ active: { ...job, progress: f } })),
      COMPRESS_TIMEOUT_MS,
      "compress timeout",
    );
    if (result.codec === "opus" && result.file.length < file.length) {
      done = { ...done, codec: "opus", stored: result.file.length, bitrate };
      if (!useOffline.getState().items[item.id]) return;
      await putSong(done, result.file);
    } else await putItem(done);
  } catch {
    // Compression didn't work out (slow phone, unusual format): the song stays playable as downloaded.
    await putItem(done).catch(() => {});
  }
  if (useOffline.getState().items[item.id]) useOffline.setState((s) => ({ items: { ...s.items, [item.id]: done } }));
}

async function saveOne(track: Track) {
  const startedAt = Date.now();
  let job: ActiveJob = {
    id: track.id,
    title: track.title,
    phase: "download",
    progress: 0,
    received: 0,
    total: null,
    startedAt,
    lastDataAt: startedAt,
    note: "resolving",
  };
  const update = (patch: Partial<ActiveJob>) => {
    job = { ...job, ...patch };
    useOffline.setState({ active: job });
  };
  update({});
  try {
    // The song's own video first; if that fails, up to two other uploads of the same song.
    let result: { bytes: Uint8Array; mime: string } | null = null;
    let lastError: Error = new Error("failed");
    let sources: string[] = [track.id];
    for (let n = 0; n < MAX_SOURCES && !result; n++) {
      if (n === 1) sources = [track.id, ...(await alternativeSources(track))];
      const source = sources[n];
      if (!source) break;
      update({ source: n + 1, received: 0, total: null, progress: 0, lastDataAt: Date.now(), note: n ? "alternative" : "resolving" });
      try {
        const got = await withTimeout(
          downloadAudio(source, (done, total) =>
            update({ received: done, total, progress: total ? Math.min(1, done / total) : 0, lastDataAt: Date.now(), note: undefined }),
          ),
          SONG_TIMEOUT_MS,
          "timeout",
        );
        if (got.bytes.length) result = got;
        else lastError = new Error("empty download");
      } catch (e) {
        lastError = e as Error;
      }
    }
    if (!result) throw lastError;
    const { bytes, mime } = result;
    // Still wanted after the download? (It may have been removed from the playlist meanwhile.)
    if (!wantedTracks().has(track.id)) return;
    // Stored as downloaded right away (playable offline now); the compression pass shrinks it afterwards.
    const file = encodeYtfy({ codec: "raw", mime, bytes });
    const item: OfflineItem = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      codec: "raw",
      stored: file.length,
      original: bytes.length,
      bitrate: 0,
      savedAt: Date.now(),
      pendingCompress: canTranscode() && currentBitrate() > 0,
    };
    await putSong(item, file);
    useOffline.setState((s) => ({ items: { ...s.items, [track.id]: item }, doneThisRun: s.doneThisRun + 1 }));
  } catch (e) {
    const message = (e as Error).message || "failed";
    useOffline.setState((s) => ({
      failed: { ...s.failed, [track.id]: message },
      failedTitles: { ...s.failedTitles, [track.id]: `${track.title}${track.artist ? ` – ${track.artist}` : ""}` },
    }));
  }
}

// ---------------------------------------------------------------- Own audio files

export interface ImportProgress {
  index: number;
  total: number;
  name: string;
  phase: "read" | "compress";
  progress: number;
}

export interface ImportOutcome {
  tracks: Track[];
  failed: string[];
  stored: number;
  original: number;
}

/**
 * Imports audio files from the device (MP3, M4A, FLAC, WAV, OGG…): tags and cover from the file, the audio
 * compressed into a YTFY file like downloaded songs. Returns the new tracks; the caller files them in a playlist.
 */
export async function importLocalFiles(files: File[], onProgress?: (p: ImportProgress) => void): Promise<ImportOutcome> {
  const { readTags, guessFromName, localId, coverThumb, mimeFor } = await import("../lib/localImport");
  const bitrate = currentBitrate();
  const out: ImportOutcome = { tracks: [], failed: [], stored: 0, original: 0 };
  for (const [index, file] of files.entries()) {
    const report = (phase: ImportProgress["phase"], progress: number) =>
      onProgress?.({ index, total: files.length, name: file.name, phase, progress });
    try {
      report("read", 0);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = await localId(bytes);
      const tags = readTags(bytes);
      const guess = guessFromName(file.name);
      const thumb = await coverThumb(tags.cover);
      const existing = useOffline.getState().items[id];
      let duration = 0;
      if (!existing) {
        report("compress", 0);
        const result = await compressTrack(bytes, mimeFor(file), bitrate, (f) => report("compress", f));
        duration = result.duration ?? (await probeDuration(file));
        const item: OfflineItem = {
          id,
          title: tags.title || guess.title,
          artist: tags.artist || guess.artist,
          codec: result.codec,
          stored: result.file.length,
          original: bytes.length,
          bitrate: result.codec === "opus" ? bitrate : 0,
          savedAt: Date.now(),
          local: true,
        };
        await putSong(item, result.file);
        useOffline.setState((s) => ({ items: { ...s.items, [id]: item } }));
        out.stored += result.file.length;
        out.original += bytes.length;
      } else {
        duration = await probeDuration(file);
      }
      out.tracks.push({
        id,
        title: tags.title || guess.title,
        artist: tags.artist || guess.artist,
        album: tags.album || undefined,
        duration: Math.round(duration),
        thumb,
        art: thumb,
        kind: "local",
      });
    } catch {
      out.failed.push(file.name);
    }
  }
  return out;
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v) ? v : 0);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    a.src = url;
  });
}

// ---------------------------------------------------------------- Playback

let currentUrl: string | null = null;

/** Whether a song can play from this device. */
export const isOffline = (id: string) => !!useOffline.getState().items[id];

/** A playable URL for a downloaded song (decompressed in memory), or null when it isn't saved. */
export async function offlineUrl(id: string): Promise<string | null> {
  if (!isOffline(id)) return null;
  const file = await readFile(id).catch(() => undefined);
  if (!file) return null;
  let blob: Blob;
  try {
    blob = ytfyToBlob(file instanceof Uint8Array ? file : new Uint8Array(file as ArrayBuffer));
  } catch {
    // A damaged file: drop it so the next sync downloads it again.
    await deleteSong(id).catch(() => {});
    useOffline.setState((s) => {
      const items = { ...s.items };
      delete items[id];
      return { items };
    });
    sync();
    return null;
  }
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  return currentUrl;
}

/** Totals for Settings. */
export function offlineTotals(items: Record<string, OfflineItem>) {
  let stored = 0;
  let original = 0;
  const list = Object.values(items);
  for (const i of list) {
    stored += i.stored;
    original += i.original;
  }
  return { count: list.length, stored, original, saved: Math.max(0, original - stored) };
}

export const reencodes = canTranscode;

// ---------------------------------------------------------------- Start

if (offlineSupported) {
  readItems()
    .then((list) => {
      const items: Record<string, OfflineItem> = {};
      for (const i of list) items[i.id] = i;
      useOffline.setState({ items, ready: true });
      sync();
    })
    .catch(() => useOffline.setState({ ready: true }));
  // Follow the library: songs added to a downloaded playlist are fetched, removed ones deleted.
  useLibrary.subscribe((s, prev) => {
    if (s.favorites !== prev.favorites || s.playlists !== prev.playlists || s.status !== prev.status) sync();
  });
  addEventListener("online", () => sync());
  // Know whether the phone is on Wi-Fi or mobile data, and continue when Wi-Fi comes back.
  void Network.getStatus()
    .then((st) => {
      connection = st.connected ? (st.connectionType as typeof connection) : "none";
      sync();
    })
    .catch(() => {});
  void Network.addListener("networkStatusChange", (st) => {
    connection = st.connected ? (st.connectionType as typeof connection) : "none";
    sync();
  }).catch(() => {});
}
