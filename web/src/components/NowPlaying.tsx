import {
  CaretDownIcon,
  MagnifyingGlassIcon,
  MicrophoneStageIcon,
  QueueIcon,
  RadioIcon,
  VideoCameraSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer, useStatusText } from "../player/player";
import { useUi, type PanelTab } from "../stores/ui";
import { Artwork } from "./Artwork";
import { FavoriteButton, ModeSwitch, Scrubber, Transport } from "./Controls";
import { IconButton } from "./IconButton";
import { LyricsCard, LyricsView } from "./Lyrics";
import { QueueList } from "./Queue";
import { SLOT, VideoSlot } from "./Video";

/** Artwork or the live video, with a soft ambient glow from the cover behind it. */
function Stage({ track, slot, className }: { track: Track; slot: number; className?: string }) {
  const t = useT();
  const showsVideo = usePlayer((s) => s.mediaKind === "video");
  const aspect = usePlayer((s) => s.videoAspect);
  // In Video mode on a song: say we're looking for its clip, or that it has none.
  const note = usePlayer((s) =>
    s.preferVideo ? (s.videoNote ?? (s.statusText === "findingClip" ? s.statusText : null)) : null,
  );
  if (showsVideo) {
    const portrait = aspect < 1;
    return (
      <div className="flex justify-center">
        <VideoSlot
          priority={slot}
          expandable
          className={cn("rounded-[16px]", portrait ? "h-[min(52dvh,560px)]" : "w-full")}
          style={{ aspectRatio: Math.min(16 / 9, Math.max(9 / 16, aspect)) }}
        />
      </div>
    );
  }
  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)}>
      <img
        src={track.thumb}
        alt=""
        aria-hidden="true"
        className="absolute inset-[6%] h-[88%] w-[88%] scale-110 rounded-full object-cover opacity-70 blur-3xl saturate-150"
      />
      <Artwork
        src={track.art}
        fallback={track.thumb}
        alt={t.nowPlaying.coverOf(track.title)}
        iconSize={48}
        className="relative size-full rounded-[22px] ring-1 ring-white/10 shadow-[0_28px_70px_rgb(40_10_80/0.6)]"
      />
      {note && (
        <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-full bg-black/65 px-3 py-2 text-center text-[13px] font-medium text-white backdrop-blur-md">
          {note === "findingClip" ? (
            <MagnifyingGlassIcon size={16} className="shrink-0" />
          ) : (
            <VideoCameraSlashIcon size={16} className="shrink-0" />
          )}{" "}
          {note === "findingClip" ? t.player.status.findingClip : t.player.noClip}
        </span>
      )}
    </div>
  );
}

function TrackHeading({ track, large = false }: { track: Track; large?: boolean }) {
  const statusText = useStatusText();
  const status = usePlayer((s) => s.status);
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 className={cn("truncate font-semibold tracking-tight", large ? "text-[22px] leading-tight" : "text-lg")}>{track.title}</h2>
        <p className={cn("truncate", large ? "text-base" : "text-sm", status === "error" ? "text-danger" : "text-fg-2")}>
          {statusText ?? [track.artist, track.album].filter(Boolean).join(" · ")}
        </p>
      </div>
      <FavoriteButton track={track} size={large ? "lg" : "md"} />
    </div>
  );
}

function PanelBody({ tab, slot }: { tab: PanelTab; slot: number }) {
  const track = usePlayer(selectCurrent);
  const startRadio = usePlayer((s) => s.startRadio);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const t = useT();
  const openPanel = useUi((s) => s.openPanel);

  if (tab === "queue") return <QueueList />;
  if (!track) {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.nowPlaying.playSomething}</p>;
  }
  const nextUp = queue[index + 1];
  return (
    <div className="flex flex-col gap-5 px-1 pb-4">
      <Stage track={track} slot={slot} />
      <TrackHeading track={track} />
      <ModeSwitch />
      <LyricsCard track={track} onOpen={() => openPanel("lyrics")} />
      <button
        type="button"
        onClick={() => void startRadio(track)}
        className="flex h-11 items-center justify-center gap-2 rounded-full bg-surface-3/70 text-sm font-medium ring-1 ring-line transition-colors hover:bg-surface-4 hover:ring-accent/40 active:scale-[0.98]"
      >
        <RadioIcon size={18} /> {t.nowPlaying.startRadio}
      </button>
      {nextUp && (
        <div className="rounded-[16px] bg-surface-3/50 p-3 ring-1 ring-line">
          <p className="pb-2 text-xs font-medium text-fg-3">{t.nowPlaying.upNext}</p>
          <div className="flex items-center gap-3">
            <Artwork src={nextUp.thumb} className="size-10 rounded-[8px]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{nextUp.title}</p>
              <p className="truncate text-xs text-fg-2">{nextUp.artist}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelTabs({ tab, onTab }: { tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const t = useT();
  return (
    <div role="tablist" className="flex gap-1 rounded-full bg-surface-1/70 p-1 ring-1 ring-line">
      {(
        [
          ["playing", t.nowPlaying.tabPlaying],
          ["lyrics", t.nowPlaying.tabLyrics],
          ["queue", t.nowPlaying.tabQueue],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
            tab === id ? "accent-glow bg-accent text-accent-ink" : "text-fg-2 hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The panel's scrolling body. Lyrics scroll on their own (they follow the song), so they get the full height. */
function PanelContent({ tab }: { tab: PanelTab }) {
  const track = usePlayer(selectCurrent);
  const t = useT();
  if (tab === "lyrics") {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        {track ? (
          <LyricsView key={track.id} track={track} className="flex-1" />
        ) : (
          <p className="px-2 py-16 text-center text-sm text-fg-2">{t.nowPlaying.playSomething}</p>
        )}
      </div>
    );
  }
  return (
    <div className="scroll-area flex-1 overflow-y-auto px-2">
      <PanelBody tab={tab} slot={SLOT.panel} />
    </div>
  );
}

/** Docked right column (≥1280px). */
export function SidePanel() {
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const togglePanel = useUi((s) => s.togglePanel);
  const t = useT();
  return (
    <aside className="island hidden w-[360px] shrink-0 xl:flex" aria-label={t.nowPlaying.panel}>
      <div className="island-core flex w-full flex-col overflow-hidden">
        <div className="flex h-16 items-center justify-between px-3">
          <PanelTabs tab={tab} onTab={openPanel} />
          <IconButton label={t.nowPlaying.closePanel} size="sm" onClick={() => togglePanel(tab)}>
            <XIcon size={18} />
          </IconButton>
        </div>
        <PanelContent tab={tab} />
      </div>
    </aside>
  );
}

/** Same content as an overlay drawer for tablets and small laptops (768-1279px). */
export function PanelDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const close = useUi((s) => s.closePanel);
  const reduce = useReducedMotion();
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 hidden md:block xl:hidden">
          <motion.div className="absolute inset-0 bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.aside
            aria-label={t.nowPlaying.panel}
            data-escape-closes
            initial={reduce ? { opacity: 0 } : { x: "105%" }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "105%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="island drawer-top absolute right-2 bottom-2 flex w-[380px] max-w-[calc(100vw-16px)]"
          >
            <div className="island-core flex w-full flex-col overflow-hidden">
              <div className="flex h-16 items-center justify-between px-3">
                <PanelTabs tab={tab} onTab={openPanel} />
                <IconButton label={t.common.close} size="sm" onClick={close}>
                  <XIcon size={18} />
                </IconButton>
              </div>
              <PanelContent tab={tab} />
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Full-screen Now Playing for phones. Drag down (or Back) to close. */
export function NowPlayingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const track = usePlayer(selectCurrent);
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const [view, setView] = useState<"player" | "queue" | "lyrics">("player");
  const t = useT();

  return createPortal(
    <AnimatePresence onExitComplete={() => setView("player")}>
      {open && track && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t.nowPlaying.title}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.9 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 700) onClose();
          }}
          className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg md:hidden"
        >
          <img
            src={track.thumb}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-2/3 w-full scale-125 object-cover opacity-40 blur-3xl saturate-150"
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-accent/15 via-bg/75 to-bg" />

          <div className="overlay-top relative flex min-h-0 flex-1 flex-col px-5">
            <div className="flex h-14 touch-none items-center justify-between" onPointerDown={(e) => drag.start(e)}>
              <IconButton label={t.common.close} onClick={onClose} className="-ml-2 text-fg">
                <CaretDownIcon size={24} />
              </IconButton>
              <div className="mx-auto mt-0 h-1 w-10 rounded-full bg-fg-3/50" />
              <div className="-mr-2 flex items-center">
                <IconButton
                  label={view === "lyrics" ? t.nowPlaying.backToPlayer : t.nowPlaying.showLyrics}
                  active={view === "lyrics"}
                  onClick={() => setView(view === "lyrics" ? "player" : "lyrics")}
                >
                  <MicrophoneStageIcon size={22} weight={view === "lyrics" ? "fill" : "regular"} />
                </IconButton>
                <IconButton
                  label={view === "queue" ? t.nowPlaying.backToPlayer : t.nowPlaying.showQueue}
                  active={view === "queue"}
                  onClick={() => setView(view === "queue" ? "player" : "queue")}
                >
                  <QueueIcon size={22} />
                </IconButton>
              </div>
            </div>

            {view === "queue" ? (
              <div className="scroll-area -mx-3 flex-1 overflow-y-auto pb-6">
                <QueueList />
              </div>
            ) : view === "lyrics" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-3">
                  <Artwork src={track.thumb} className="size-12 shrink-0 rounded-[10px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{track.title}</p>
                    <p className="truncate text-sm text-fg-2">{track.artist}</p>
                  </div>
                  <FavoriteButton track={track} size="md" />
                </div>
                <LyricsView key={track.id} track={track} large className="-mx-2 flex-1" />
                <Scrubber touch />
                <div className="flex justify-center">
                  <Transport />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-evenly gap-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
                <div className="touch-none" onPointerDown={(e) => drag.start(e)}>
                  <Stage track={track} slot={SLOT.sheet} className="max-w-[min(100%,46dvh)]" />
                </div>
                <div className="flex flex-col gap-4">
                  <TrackHeading track={track} large />
                  <Scrubber touch />
                  <Transport big />
                  <ModeSwitch className="justify-center" />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
