import { ArrowClockwiseIcon, MicrophoneStageIcon, WaveformIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { activeLine, findLyrics, type Lyrics } from "../lib/lyrics";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";

type State = { status: "loading" } | { status: "ready"; lyrics: Lyrics | null };

/** Looks up the lyrics of `track` and keeps the result for as long as it is the current track. */
export function useLyrics(track: Track | null) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!track) return;
    let live = true;
    setState({ status: "loading" });
    findLyrics(track).then(
      (lyrics) => live && setState({ status: "ready", lyrics }),
      () => live && setState({ status: "ready", lyrics: null }),
    );
    return () => {
      live = false;
    };
    // Only the identity of the song matters.
  }, [track?.id, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

function Message({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent-text">{icon}</span>
      <p className="max-w-[30ch] text-sm text-fg-2">{text}</p>
      {action}
    </div>
  );
}

/** Full lyrics view: synced lines follow the song (tap one to jump there); plain lyrics just scroll. */
export function LyricsView({ track, className, large = false }: { track: Track; className?: string; large?: boolean }) {
  const t = useT();
  const { state, retry } = useLyrics(track);
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const box = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const lyrics = state.status === "ready" ? state.lyrics : null;
  const lines = lyrics?.synced ?? null;
  const current = lines ? activeLine(lines, position) : -1;

  // Keep the sung line in the middle, unless the listener is reading elsewhere (they get it back after a few seconds).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || current < 0 || userScrolled) return;
    const row = el.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!row) return;
    el.scrollTo({ top: row.offsetTop - el.clientHeight / 2 + row.clientHeight / 2, behavior: "smooth" });
  }, [current, userScrolled]);

  useEffect(() => {
    if (!userScrolled) return;
    const id = setTimeout(() => setUserScrolled(false), 3500);
    return () => clearTimeout(id);
  }, [userScrolled]);

  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
    setUserScrolled(false);
  }, [track.id]);

  const markUserScroll = () => setUserScrolled(true);

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <div className="flex flex-col gap-4 px-2 py-6" aria-label={t.lyrics.searching}>
        <p className="text-sm text-fg-3">{t.lyrics.searching}</p>
        {[78, 62, 88, 54, 70, 46, 82].map((w, i) => (
          <span key={i} className="skeleton h-5 rounded-full" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  } else if (!lyrics) {
    body = (
      <Message
        icon={<MicrophoneStageIcon size={26} />}
        text={t.lyrics.notFound}
        action={
          <button
            type="button"
            onClick={retry}
            className="flex h-9 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-4"
          >
            <ArrowClockwiseIcon size={16} /> {t.lyrics.retry}
          </button>
        }
      />
    );
  } else if (lyrics.instrumental && !lines && !lyrics.plain) {
    body = <Message icon={<WaveformIcon size={26} />} text={t.lyrics.instrumental} />;
  } else if (lines) {
    body = (
      <ol className={cn("flex flex-col gap-1 py-[35%]", large ? "px-1" : "px-2")}>
        {lines.map((line, i) => (
          <li key={i} data-line={i}>
            <button
              type="button"
              onClick={() => {
                seek(line.time);
                setUserScrolled(false);
              }}
              data-state={i === current ? "active" : i < current ? "past" : "next"}
              className={cn(
                "lyric-line w-full rounded-[12px] px-2 py-1.5 text-left font-bold tracking-tight text-fg-2 hover:bg-surface-3/60",
                large ? "text-[26px] leading-[1.25]" : "text-xl leading-snug",
                !line.text && "text-fg-3",
              )}
            >
              {line.text || "♪"}
            </button>
          </li>
        ))}
      </ol>
    );
  } else {
    body = (
      <div className={cn("py-4 font-semibold whitespace-pre-line text-fg-2", large ? "px-1 text-xl leading-relaxed" : "px-2 text-[17px] leading-relaxed")}>
        {lyrics.plain}
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <div
        ref={box}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        className="scroll-area relative min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_88%,transparent)]"
      >
        {body}
      </div>
      {lyrics && (
        <p className="flex shrink-0 items-center justify-between gap-2 px-2 pt-2 pb-1 text-[11px] text-fg-3">
          <span>{t.lyrics.source(lyrics.source)}</span>
          {lines && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-text">{t.lyrics.synced}</span>
          )}
        </p>
      )}
    </div>
  );
}

/** Small preview on the Now Playing tab: the line being sung and the next one, or the first lines. */
export function LyricsCard({ track, onOpen }: { track: Track; onOpen: () => void }) {
  const t = useT();
  const { state } = useLyrics(track);
  const position = usePlayer((s) => s.position);
  if (state.status === "ready" && !state.lyrics) return null;
  const lyrics = state.status === "ready" ? state.lyrics : null;
  let preview: string[] = [];
  if (lyrics?.synced) {
    const i = Math.max(0, activeLine(lyrics.synced, position));
    preview = lyrics.synced
      .slice(i, i + 3)
      .map((l) => l.text)
      .filter(Boolean);
  } else if (lyrics?.plain) {
    preview = lyrics.plain.split("\n").filter(Boolean).slice(0, 3);
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative overflow-hidden rounded-[18px] bg-linear-to-br from-accent/35 via-surface-3 to-surface-2 p-4 text-left ring-1 ring-line transition-[box-shadow] hover:ring-accent/50"
    >
      <span className="flex items-center justify-between pb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] text-accent-text uppercase">
          <MicrophoneStageIcon size={14} weight="fill" /> {t.lyrics.title}
        </span>
        <span className="text-xs font-medium text-fg-2 group-hover:text-fg">{t.nowPlaying.showLyrics} →</span>
      </span>
      {state.status === "loading" ? (
        <span className="flex flex-col gap-2">
          <span className="skeleton h-4 w-3/4 rounded-full" />
          <span className="skeleton h-4 w-1/2 rounded-full" />
        </span>
      ) : lyrics?.instrumental && !preview.length ? (
        <span className="text-sm text-fg-2">{t.lyrics.instrumental}</span>
      ) : (
        <span className="flex flex-col gap-0.5">
          {preview.map((line, i) => (
            <span key={i} className={cn("truncate font-bold", i === 0 ? "text-[17px] text-fg" : "text-[15px] text-fg-2/80")}>
              {line}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
