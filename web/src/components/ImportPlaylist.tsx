import { CheckCircleIcon, CopyIcon, LinkIcon, SpotifyLogoIcon, WarningCircleIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { create } from "zustand";
import { useT } from "../i18n";
import { api, type LinkQuery } from "../lib/api";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { useLibrary } from "../stores/library";
import { Modal } from "./Modal";

/**
 * "Copy playlist": paste a Spotify or YouTube playlist link and get the same songs as a new YoutiFy playlist.
 * YouTube playlists come over as they are; Spotify songs are looked up on YouTube one by one, picking the result
 * whose length is closest to the original.
 */

const CONCURRENCY = 3;

type Phase =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "matching"; source: "spotify"; name: string; done: number; total: number }
  | { step: "done"; playlistId: string; name: string; found: number; total: number; missing: string[] }
  | { step: "error"; message: string };

interface ImportState {
  open: boolean;
  url: string;
  phase: Phase;
  setOpen: (open: boolean) => void;
  setUrl: (url: string) => void;
  start: () => Promise<void>;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The YouTube result that best fits a Spotify song: title words present, artist named, length close. */
function bestMatch(q: LinkQuery, options: Track[]): Track | null {
  if (!options.length) return null;
  const wantTitle = words(q.title).split(" ").filter(Boolean);
  const wantArtist = words(q.artist.split(",")[0] ?? "");
  let best: Track | null = null;
  let bestScore = -Infinity;
  options.slice(0, 6).forEach((o, rank) => {
    const title = words(o.title);
    const artist = words(o.artist);
    const titleHits = wantTitle.filter((w) => title.includes(w)).length / Math.max(1, wantTitle.length);
    const artistHit = wantArtist && (artist.includes(wantArtist) || title.includes(wantArtist)) ? 1 : 0;
    const off = q.duration && o.duration ? Math.abs(q.duration - o.duration) : 10;
    const score = titleHits * 4 + artistHit * 3 - Math.min(off, 60) / 6 - rank * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  });
  return best;
}

async function matchAll(queries: LinkQuery[], onDone: (n: number) => void): Promise<{ tracks: (Track | null)[] }> {
  const tracks: (Track | null)[] = new Array(queries.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < queries.length) {
      const i = next++;
      const q = queries[i]!;
      const term = [q.title, q.artist.split(",")[0]].filter(Boolean).join(" ");
      try {
        tracks[i] = bestMatch(q, await api.search(term, "song"));
      } catch {
        tracks[i] = null;
      }
      onDone(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queries.length) }, worker));
  return { tracks };
}

export const useImport = create<ImportState>((set, get) => ({
  open: false,
  url: "",
  phase: { step: "idle" },
  setOpen: (open) => {
    const { phase } = get();
    // Closing keeps a running import going; reopening after it ended starts fresh.
    if (open && (phase.step === "done" || phase.step === "error")) set({ phase: { step: "idle" }, url: "" });
    set({ open });
  },
  setUrl: (url) => set({ url }),
  start: async () => {
    const url = get().url.trim();
    if (!url) return;
    set({ phase: { step: "reading" } });
    try {
      const link = await api.readPlaylistLink(url);
      let tracks: Track[];
      let total: number;
      const missing: string[] = [];
      if (link.source === "youtube") {
        tracks = link.tracks;
        total = link.tracks.length;
      } else {
        total = link.queries.length;
        set({ phase: { step: "matching", source: "spotify", name: link.name, done: 0, total } });
        const { tracks: found } = await matchAll(link.queries, (done) =>
          set({ phase: { step: "matching", source: "spotify", name: link.name, done, total } }),
        );
        const seen = new Set<string>();
        tracks = [];
        found.forEach((t, i) => {
          if (!t) missing.push([link.queries[i]!.title, link.queries[i]!.artist].filter(Boolean).join(" – "));
          else if (!seen.has(t.id)) {
            seen.add(t.id);
            tracks.push(t);
          }
        });
      }
      if (!tracks.length) throw new Error("empty");
      const playlist = await useLibrary.getState().createPlaylist(link.name, tracks);
      if (!playlist) throw new Error("create");
      set({ phase: { step: "done", playlistId: playlist.id, name: playlist.name, found: tracks.length, total, missing } });
    } catch (e) {
      set({ phase: { step: "error", message: (e as Error).message } });
    }
  },
}));

export function ImportPlaylistButton({ className }: { className?: string }) {
  const t = useT();
  const setOpen = useImport((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={t.importLink.title}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-full bg-surface-2 pr-4 pl-3 text-sm font-semibold text-fg ring-1 ring-line transition-[background-color,transform] hover:bg-surface-3 active:scale-[0.97]",
        className,
      )}
    >
      <CopyIcon size={18} weight="bold" /> <span>{t.importLink.button}</span>
    </button>
  );
}

export function ImportPlaylistDialog() {
  const t = useT();
  const { open, url, phase, setOpen, setUrl, start } = useImport();
  const navigate = useNavigate();
  const [touched, setTouched] = useState(false);
  const busy = phase.step === "reading" || phase.step === "matching";
  const looksLikeLink = /spotify|youtu|^(PL|OL)[\w-]{10,}/i.test(url.trim());

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.importLink.title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-2">{t.importLink.body}</p>

        {phase.step !== "done" && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (looksLikeLink && !busy) void start();
            }}
          >
            <label className="flex h-12 items-center gap-2 rounded-full bg-surface-1 px-4 ring-1 ring-line focus-within:ring-accent">
              <LinkIcon size={18} className="shrink-0 text-fg-3" />
              <input
                autoFocus
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.importLink.placeholder}
                aria-label={t.importLink.placeholder}
                inputMode="url"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
              />
            </label>
            <div className="flex items-center gap-3 text-xs text-fg-3">
              <span className="flex items-center gap-1">
                <SpotifyLogoIcon size={16} weight="fill" /> Spotify
              </span>
              <span className="flex items-center gap-1">
                <YoutubeLogoIcon size={16} weight="fill" /> YouTube / YouTube Music
              </span>
            </div>
            {touched && url && !looksLikeLink && <p className="text-sm text-danger">{t.importLink.notALink}</p>}
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              <CopyIcon size={18} weight="bold" /> {busy ? t.importLink.working : t.importLink.copy}
            </button>
          </form>
        )}

        {phase.step === "reading" && <p className="text-sm text-fg-2">{t.importLink.reading}</p>}
        {phase.step === "matching" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-2">{t.importLink.matching(phase.name, phase.done, phase.total)}</p>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-4">
              <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
            </span>
            <p className="text-xs text-fg-3">{t.importLink.keepsGoing}</p>
          </div>
        )}
        {phase.step === "error" && (
          <p className="flex items-start gap-2 text-sm text-danger">
            <WarningCircleIcon size={18} className="mt-0.5 shrink-0" />
            {phase.message === "empty" || phase.message === "create" ? t.importLink.failed : phase.message}
          </p>
        )}
        {phase.step === "done" && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircleIcon size={20} weight="fill" className="text-accent-text" /> {t.importLink.done(phase.name, phase.found, phase.total)}
            </p>
            {phase.missing.length > 0 && (
              <details className="rounded-[14px] bg-surface-1 p-3 text-sm ring-1 ring-line">
                <summary className="cursor-pointer text-fg-2">{t.importLink.missing(phase.missing.length)}</summary>
                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-fg-3">
                  {phase.missing.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(paths.playlist(phase.playlistId));
              }}
              className="h-11 rounded-full bg-accent text-sm font-semibold text-accent-ink"
            >
              {t.importLink.open}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
