import { CheckCircleIcon, FileAudioIcon, MusicNotesPlusIcon, UploadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { create } from "zustand";
import { useT } from "../i18n";
import { cn, formatBytes } from "../lib/format";
import { AUDIO_ACCEPT } from "../lib/localImport";
import { paths } from "../lib/routes";
import { useLibrary } from "../stores/library";
import { importLocalFiles, offlineSupported, type ImportProgress } from "../stores/offline";
import { Modal } from "./Modal";

/** The playlist imported files land in (created on first import). */
export const MY_MUSIC = "Meine Musik";

type Phase =
  | { step: "idle" }
  | { step: "working"; progress: ImportProgress }
  | { step: "done"; playlistId: string; added: number; failed: string[]; saved: number }
  | { step: "error" };

interface State {
  open: boolean;
  phase: Phase;
  setOpen: (open: boolean) => void;
  run: (files: File[]) => Promise<void>;
}

export const useImportFiles = create<State>((set, get) => ({
  open: false,
  phase: { step: "idle" },
  setOpen: (open) => {
    if (open && (get().phase.step === "done" || get().phase.step === "error")) set({ phase: { step: "idle" } });
    set({ open });
  },
  run: async (files) => {
    const audio = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|aiff?)$/i.test(f.name));
    if (!audio.length) return;
    set({ phase: { step: "working", progress: { index: 0, total: audio.length, name: audio[0]!.name, phase: "read", progress: 0 } } });
    try {
      const result = await importLocalFiles(audio, (progress) => set({ phase: { step: "working", progress } }));
      if (!result.tracks.length) throw new Error("none");
      const lib = useLibrary.getState();
      let playlist = lib.playlists.find((p) => p.name === MY_MUSIC);
      if (playlist) await lib.addToPlaylist(playlist.id, result.tracks);
      else playlist = (await lib.createPlaylist(MY_MUSIC, result.tracks)) ?? undefined;
      if (!playlist) throw new Error("playlist");
      set({
        phase: {
          step: "done",
          playlistId: playlist.id,
          added: result.tracks.length,
          failed: result.failed,
          saved: Math.max(0, result.original - result.stored),
        },
      });
    } catch {
      set({ phase: { step: "error" } });
    }
  },
}));

export function ImportFilesButton({ className }: { className?: string }) {
  const t = useT();
  const setOpen = useImportFiles((s) => s.setOpen);
  if (!offlineSupported) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={t.importFiles.title}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-full bg-surface-2 pr-4 pl-3 text-sm font-semibold text-fg ring-1 ring-line transition-[background-color,transform] hover:bg-surface-3 active:scale-[0.97]",
        className,
      )}
    >
      <MusicNotesPlusIcon size={18} weight="bold" /> <span>{t.importFiles.button}</span>
    </button>
  );
}

export function ImportFilesDialog() {
  const t = useT();
  const { open, phase, setOpen, run } = useImportFiles();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = phase.step === "working";

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.importFiles.title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-2">{t.importFiles.body(MY_MUSIC)}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={AUDIO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void run(files);
          }}
        />

        {phase.step !== "done" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) void run([...e.dataTransfer.files]);
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded-[18px] border-2 border-dashed px-4 py-8 text-center transition-colors disabled:opacity-60",
              dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent/60 hover:bg-surface-3/40",
            )}
          >
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-ink">
              <UploadSimpleIcon size={24} weight="bold" />
            </span>
            <span className="text-sm font-semibold">{t.importFiles.pick}</span>
            <span className="text-xs text-fg-3">MP3 · M4A · FLAC · WAV · OGG · Opus</span>
          </button>
        )}

        {phase.step === "working" && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 truncate text-sm text-fg-2">
              <FileAudioIcon size={16} className="shrink-0" />
              <span className="truncate">
                {t.importFiles.working(phase.progress.index + 1, phase.progress.total, phase.progress.name)}
              </span>
            </p>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-4">
              <span
                className="block h-full rounded-full bg-accent transition-[width]"
                style={{
                  width: `${((phase.progress.index + (phase.progress.phase === "compress" ? 0.2 + phase.progress.progress * 0.8 : 0.1)) / phase.progress.total) * 100}%`,
                }}
              />
            </span>
            <p className="text-xs text-fg-3">{t.importFiles.keepsGoing}</p>
          </div>
        )}

        {phase.step === "error" && (
          <p className="flex items-start gap-2 text-sm text-danger">
            <WarningCircleIcon size={18} className="mt-0.5 shrink-0" /> {t.importFiles.failed}
          </p>
        )}

        {phase.step === "done" && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircleIcon size={20} weight="fill" className="text-accent-text" /> {t.importFiles.done(phase.added, MY_MUSIC)}
            </p>
            {phase.saved > 0 && <p className="text-sm text-accent-text">{t.importFiles.saved(formatBytes(phase.saved))}</p>}
            {phase.failed.length > 0 && (
              <p className="text-xs text-danger">
                {t.importFiles.skipped(phase.failed.length)}: {phase.failed.slice(0, 5).join(", ")}
                {phase.failed.length > 5 && " …"}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => useImportFiles.setState({ phase: { step: "idle" } })}
                className="h-11 rounded-full bg-surface-3 text-sm font-semibold text-fg hover:bg-surface-4"
              >
                {t.importFiles.more}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(paths.playlist(phase.playlistId));
                }}
                className="h-11 rounded-full bg-accent text-sm font-semibold text-accent-ink"
              >
                {t.importFiles.open}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
