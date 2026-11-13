import { ArchiveIcon, CheckCircleIcon, DownloadSimpleIcon, TrashIcon, WarningCircleIcon, WifiHighIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n";
import { cn, formatBytes } from "../lib/format";
import { StorageLocation } from "./StorageLocation";
import type { Track } from "../lib/types";
import {
  collectionProgress,
  offlineSupported,
  offlineTotals,
  QUALITIES,
  reencodes,
  useOffline,
  type PinKey,
  type Quality,
} from "../stores/offline";
import { toast } from "../stores/ui";
import { Modal } from "./Modal";

/**
 * Download and delete buttons on a playlist or Favorites page. Download fetches every song that isn't on the device
 * yet (songs that fail are skipped and tried again on the next press); new songs added later follow automatically.
 * Delete removes this collection's downloads but keeps songs another downloaded collection still holds.
 */
export function DownloadButton({ pinKey, name, tracks }: { pinKey: PinKey; name: string; tracks: Track[] }) {
  const t = useT();
  const pinned = useOffline((s) => s.pins.includes(pinKey));
  const items = useOffline((s) => s.items);
  const failedMap = useOffline((s) => s.failed);
  const waitingForWifi = useOffline((s) => s.waitingForWifi);
  const download = useOffline((s) => s.download);
  const removeDownloads = useOffline((s) => s.removeDownloads);
  const [confirm, setConfirm] = useState(false);
  if (!offlineSupported) return null;
  const { done, total } = collectionProgress(tracks, items);
  const failed = tracks.filter((tr) => failedMap[tr.id] && !items[tr.id]).length;
  const complete = total > 0 && done === total;
  const running = pinned && !complete && done + failed < total;
  const pct = total ? done / total : 0;

  const label = complete
    ? t.offline.downloaded
    : running
      ? waitingForWifi
        ? t.offline.waitingWifi
        : t.offline.downloading(done, total)
      : failed && pinned
        ? t.offline.retryMissing(total - done)
        : t.offline.download;

  return (
    <>
      <button
        type="button"
        aria-label={complete ? t.offline.downloaded : t.offline.downloadX(name)}
        title={failed ? t.offline.skipped(failed) : label}
        disabled={!tracks.length}
        onClick={() => {
          // While it runs, the button shows what's happening; otherwise it (re)starts the missing songs.
          if (running) return useOffline.getState().setPanelOpen(true);
          download(pinKey, tracks);
          if (!complete) {
            toast(t.offline.pinned(name));
            useOffline.getState().setPanelOpen(true);
          }
        }}
        className={cn(
          "flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 transition-[background-color,transform] active:scale-[0.97] disabled:opacity-40",
          pinned || done ? "bg-accent-soft text-accent-text ring-accent/40" : "bg-surface-2 text-fg-2 ring-line hover:bg-surface-3 hover:text-fg",
        )}
      >
        {running ? (
          waitingForWifi ? (
            <WifiHighIcon size={18} weight="bold" />
          ) : (
            <svg viewBox="0 0 20 20" className="size-[18px] -rotate-90" aria-hidden="true">
              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${pct * 50.27} 50.27`}
              />
            </svg>
          )
        ) : complete ? (
          <CheckCircleIcon size={19} weight="fill" />
        ) : (
          <DownloadSimpleIcon size={18} weight="bold" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </button>
      {(pinned || done > 0) && (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          aria-label={t.offline.removeDownloadsX(name)}
          title={t.offline.removeDownloads}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-2 ring-1 ring-line transition-colors hover:bg-danger/15 hover:text-danger"
        >
          <TrashIcon size={18} />
        </button>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t.offline.removeDownloadsTitle}>
        <p className="text-sm text-fg-2">{t.offline.removeDownloadsBody(name)}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(false)} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirm(false);
              removeDownloads(pinKey);
              toast(t.offline.unpinned(name));
            }}
            className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
          >
            {t.collection.delete}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Small mark next to a song that plays from the device. */
export function OfflineMark({ id }: { id: string }) {
  const t = useT();
  const saved = useOffline((s) => !!s.items[id]);
  if (!saved) return null;
  return (
    <span title={t.offline.badge} aria-label={t.offline.badge} className="grid size-[15px] shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
      <DownloadSimpleIcon size={10} weight="bold" />
    </span>
  );
}

/** Settings: what's stored, how much the compression saved, quality of new downloads. */
export function OfflineSection() {
  const t = useT();
  const s = useOffline(
    useShallow((st) => ({
      items: st.items,
      quality: st.quality,
      active: st.active,
      queue: st.queue.length,
      failed: Object.keys(st.failed).length,
      setQuality: st.setQuality,
      wifiOnly: st.wifiOnly,
      setWifiOnly: st.setWifiOnly,
      waitingForWifi: st.waitingForWifi,
      retryFailed: st.retryFailed,
      removeAll: st.removeAll,
    })),
  );
  const [confirm, setConfirm] = useState(false);
  if (!offlineSupported) return null;
  const totals = offlineTotals(s.items);
  const pct = totals.original ? Math.round((totals.saved / totals.original) * 100) : 0;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <DownloadSimpleIcon size={14} /> {t.offline.title}
      </h3>
      <p className="text-sm text-fg-2">{t.offline.body}</p>
      {!reencodes() && <p className="text-xs text-fg-3">{t.offline.noReencode}</p>}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-3">{t.offline.quality}</span>
        <div role="radiogroup" aria-label={t.offline.quality} className="flex flex-col gap-1 rounded-[16px] bg-surface-1 p-1 ring-1 ring-line">
          {QUALITIES.map((q) => (
            <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={s.quality === q.id}
              onClick={() => s.setQuality(q.id as Quality)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left text-sm transition-colors",
                s.quality === q.id ? "bg-accent text-accent-ink" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
              )}
            >
              <span className="font-semibold">{t.offline.qualities[q.id]}</span>
              <span className={cn("text-xs", s.quality === q.id ? "opacity-90" : "text-fg-3")}>
                {q.bitrate ? t.offline.qualityHint(q.bitrate / 1000, q.saving) : t.offline.qualityOff}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-3">{t.offline.qualityNote}</p>
      </div>

      <StorageLocation />

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[16px] bg-surface-1 px-4 py-3 ring-1 ring-line">
        <span className="flex items-center gap-2 text-sm">
          <WifiHighIcon size={18} className="text-fg-2" /> {t.offline.wifiOnly}
        </span>
        <input
          type="checkbox"
          checked={s.wifiOnly}
          onChange={(e) => s.setWifiOnly(e.target.checked)}
          className="size-5 accent-[var(--accent)]"
        />
      </label>

      <div className="flex flex-col gap-1 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
        {totals.count ? (
          <>
            <p className="text-sm font-medium">{t.offline.stored(totals.count, formatBytes(totals.stored))}</p>
            {totals.saved > 0 && <p className="text-sm text-accent-text">{t.offline.saved(formatBytes(totals.saved), pct)}</p>}
          </>
        ) : (
          <p className="text-sm text-fg-2">{t.offline.nothingYet}</p>
        )}
        {s.active && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="truncate text-xs text-fg-2">
              {t.offline.saving(s.active.title)} · {s.active.phase === "download" ? t.offline.phaseDownload : t.offline.phaseCompress}
              {s.queue > 1 && <> · {t.offline.queued(s.queue - 1)}</>}
            </p>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-4">
              <span
                className="block h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round((s.active.phase === "download" ? s.active.progress * 0.5 : 0.5 + s.active.progress * 0.5) * 100)}%` }}
              />
            </span>
          </div>
        )}
        {!s.active && s.queue > 0 && (s.waitingForWifi || !navigator.onLine) && (
          <p className="mt-1 text-xs text-fg-3">{s.waitingForWifi ? t.offline.waitingWifiLong(s.queue) : t.offline.waitingOnline}</p>
        )}
        {s.failed > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="flex items-center gap-2 text-xs text-danger">
              <WarningCircleIcon size={15} /> {t.offline.failed(s.failed)}
              <button type="button" onClick={s.retryFailed} className="font-semibold underline underline-offset-2">
                {t.offline.retry}
              </button>
            </p>
            <RemoveSkippedButton />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => useOffline.getState().setPanelOpen(true)}
        className="h-10 self-start rounded-full bg-surface-1 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3"
      >
        {t.offline.showDetails}
      </button>

      {totals.count > 0 &&
        (confirm ? (
          <div className="flex items-center justify-between gap-2 rounded-[16px] bg-surface-1 p-3 ring-1 ring-danger/40">
            <span className="text-sm text-fg-2">{t.offline.removeAllConfirm}</span>
            <span className="flex gap-1">
              <button type="button" onClick={() => setConfirm(false)} className="h-9 rounded-full px-3 text-sm text-fg-2 hover:text-fg">
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setConfirm(false);
                  await s.removeAll();
                  toast(t.offline.removedAll);
                }}
                className="h-9 rounded-full bg-danger px-4 text-sm font-semibold text-white"
              >
                {t.collection.delete}
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-full bg-surface-1 text-sm font-medium text-danger ring-1 ring-line hover:bg-surface-3"
          >
            <TrashIcon size={17} /> {t.offline.removeAll}
          </button>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------- Download progress: indicator and panel

function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

function useDownloadStatus() {
  return useOffline(
    useShallow((s) => ({
      active: s.active,
      queue: s.queue.filter((id) => !s.items[id] && !s.failed[id] && id !== s.active?.id).length,
      compressing: Object.values(s.items).filter((i) => i.pendingCompress).length,
      skipped: Object.keys(s.failed).length,
      doneThisRun: s.doneThisRun,
      waitingForWifi: s.waitingForWifi,
    })),
  );
}

/** Small pill above the player while songs are downloading or compressing; opens the panel. */
export function DownloadIndicator() {
  const t = useT();
  const st = useDownloadStatus();
  const setPanelOpen = useOffline((s) => s.setPanelOpen);
  if (!offlineSupported) return null;
  const busy = !!st.active || st.queue > 0 || st.compressing > 0;
  if (!busy && !st.waitingForWifi) return null;
  const pct = st.active ? Math.round(st.active.progress * 100) : 0;
  const text = st.waitingForWifi
    ? t.offline.waitingWifi
    : st.active?.phase === "compress"
      ? t.offline.pillCompress(st.compressing, pct)
      : t.offline.pillDownload(st.doneThisRun + 1, st.doneThisRun + st.queue + (st.active ? 1 : 0), pct);
  return (
    <button
      type="button"
      onClick={() => setPanelOpen(true)}
      className="fixed right-3 bottom-[calc(150px+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-full bg-surface-2/95 py-2 pr-4 pl-2.5 text-xs font-semibold shadow-[0_8px_28px_rgb(0_0_0/0.45)] ring-1 ring-accent/40 backdrop-blur md:right-4 md:bottom-[112px]"
    >
      <span className="relative grid size-7 place-items-center rounded-full bg-accent text-accent-ink">
        {st.waitingForWifi ? (
          <WifiHighIcon size={15} weight="bold" />
        ) : st.active?.phase === "compress" ? (
          <ArchiveIcon size={15} weight="bold" />
        ) : (
          <DownloadSimpleIcon size={15} weight="bold" className="animate-bounce" />
        )}
      </span>
      {text}
    </button>
  );
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/** Everything about the downloads: current song with speed and stall detection, counters, skipped songs. */
export function DownloadsPanel() {
  const t = useT();
  const open = useOffline((s) => s.panelOpen);
  const setPanelOpen = useOffline((s) => s.setPanelOpen);
  const st = useDownloadStatus();
  const failed = useOffline((s) => s.failed);
  const failedTitles = useOffline((s) => s.failedTitles);
  const retryFailed = useOffline((s) => s.retryFailed);
  useTick(open && !!st.active);
  const a = st.active;
  const now = Date.now();
  const stalledFor = a?.phase === "download" && a.lastDataAt ? Math.floor((now - a.lastDataAt) / 1000) : 0;
  const elapsed = a?.startedAt ? Math.max(1, (now - a.startedAt) / 1000) : 1;
  const speed = a?.received ? a.received / elapsed : 0;
  const reason = (r: string) =>
    r === "timeout" ? t.offline.reasonTimeout : /HTTP 403|HTTP 410/.test(r) ? t.offline.reasonRefused : /HTTP/.test(r) ? r : t.offline.reasonOther;

  return (
    <Modal open={open} onClose={() => setPanelOpen(false)} title={t.offline.panelTitle}>
      <div className="flex flex-col gap-4">
        {a ? (
          <div className="flex flex-col gap-2 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
            <p className="text-xs font-semibold tracking-[0.12em] text-accent-text uppercase">
              {a.phase === "download" ? t.offline.phaseDownloadTitle : t.offline.phaseCompressTitle}
              {a.phase === "download" && a.deep && <span className="ml-2 normal-case">· {t.offline.deepSearch}</span>}
              {a.phase === "download" && (a.source ?? 1) > 1 && !a.deep && <span className="ml-2 normal-case">· {t.offline.source(a.source!, a.sources ?? 3)}</span>}
              {a.phase === "download" && a.deep && a.source && <span className="ml-1 normal-case">{t.offline.source(a.source, a.sources ?? 10)}</span>}
            </p>
            <p className="truncate font-semibold">{a.title}</p>
            <span className="h-2 overflow-hidden rounded-full bg-surface-4">
              <span
                className={cn("block h-full rounded-full bg-accent transition-[width]", a.phase === "download" && !a.total && "w-1/3 animate-pulse")}
                style={a.total || a.phase === "compress" ? { width: `${Math.round(a.progress * 100)}%` } : undefined}
              />
            </span>
            <p className="text-xs text-fg-2">
              {a.phase === "download"
                ? a.note === "searching"
                  ? t.offline.deepSearching
                  : a.note?.startsWith("free:")
                  ? t.offline.freeSource(a.note.slice(5))
                  : (a.note === "resolving" || a.note === "alternative") && !a.received
                  ? a.note === "alternative"
                    ? t.offline.tryingAlternative
                    : t.offline.resolving
                  : `${mb(a.received ?? 0)}${a.total ? ` / ${mb(a.total)}` : ""} · ${Math.round(speed / 1024)} KB/s`
                : t.offline.compressing(Math.round(a.progress * 100))}
            </p>
            {stalledFor >= 10 && (
              <p className="flex items-center gap-1.5 text-xs text-danger">
                <WarningCircleIcon size={14} /> {t.offline.stalled(stalledFor)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-2">{st.waitingForWifi ? t.offline.waitingWifiLong(st.queue) : t.offline.idle}</p>
        )}

        <ul className="grid grid-cols-2 gap-2 text-sm">
          {[
            [t.offline.statDone, st.doneThisRun],
            [t.offline.statWaiting, st.queue],
            [t.offline.statCompress, st.compressing],
            [t.offline.statSkipped, st.skipped],
          ].map(([label, n]) => (
            <li key={label as string} className="rounded-[14px] bg-surface-1 px-3 py-2 ring-1 ring-line">
              <span className="block text-lg font-bold">{n}</span>
              <span className="text-xs text-fg-2">{label}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-3">{t.offline.orderHint}</p>

        {st.skipped > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{t.offline.skippedTitle}</p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
              {Object.entries(failed).map(([id, r]) => (
                <li key={id} className="flex justify-between gap-3 rounded-lg bg-surface-1 px-3 py-1.5">
                  <span className="truncate">{failedTitles[id] ?? id}</span>
                  <span className="shrink-0 text-danger">{reason(r)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={retryFailed}
                className="h-10 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink"
              >
                {t.offline.retrySkipped}
              </button>
              <RemoveSkippedButton />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Takes the songs that couldn't be downloaded out of the downloaded playlists, after asking. */
function RemoveSkippedButton() {
  const t = useT();
  const count = useOffline((s) => Object.keys(s.failed).length);
  const removeSkipped = useOffline((s) => s.removeSkipped);
  const [confirm, setConfirm] = useState(false);
  if (!count) return null;
  return confirm ? (
    <span className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface-1 p-2 text-xs ring-1 ring-danger/40">
      <span className="px-1 text-fg-2">{t.offline.removeSkippedConfirm(count)}</span>
      <button type="button" onClick={() => setConfirm(false)} className="h-8 rounded-full px-3 text-fg-2 hover:text-fg">
        {t.common.cancel}
      </button>
      <button
        type="button"
        onClick={async () => {
          setConfirm(false);
          const n = await removeSkipped();
          toast(t.offline.removedSkipped(n));
        }}
        className="h-8 rounded-full bg-danger px-3 font-semibold text-white"
      >
        {t.offline.removeSkippedYes}
      </button>
    </span>
  ) : (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      className="flex h-10 items-center gap-2 self-start rounded-full bg-surface-1 px-4 text-sm font-medium text-danger ring-1 ring-line hover:bg-danger/10"
    >
      <TrashIcon size={16} /> {t.offline.removeSkipped(count)}
    </button>
  );
}
