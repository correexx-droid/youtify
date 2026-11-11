import { CheckCircleIcon, DownloadSimpleIcon, TrashIcon, WarningCircleIcon, WifiHighIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n";
import { cn, formatBytes } from "../lib/format";
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
          download(pinKey, tracks);
          if (!complete) toast(t.offline.pinned(name));
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
        <div role="radiogroup" aria-label={t.offline.quality} className="grid grid-cols-3 gap-1 rounded-full bg-surface-1 p-1 ring-1 ring-line">
          {QUALITIES.map((q) => (
            <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={s.quality === q.id}
              onClick={() => s.setQuality(q.id as Quality)}
              className={cn(
                "h-9 rounded-full px-2 text-[12px] font-semibold transition-colors",
                s.quality === q.id ? "bg-accent text-accent-ink" : "text-fg-2 hover:text-fg",
              )}
            >
              {t.offline.qualities[q.id]}
            </button>
          ))}
        </div>
      </div>

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
          <p className="mt-2 flex items-center gap-2 text-xs text-danger">
            <WarningCircleIcon size={15} /> {t.offline.failed(s.failed)}
            <button type="button" onClick={s.retryFailed} className="font-semibold underline underline-offset-2">
              {t.offline.retry}
            </button>
          </p>
        )}
      </div>

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
