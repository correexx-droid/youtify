import { FolderOpenIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { availableStores, describeStore, pcFs, prepareStore, type StoreId } from "../lib/fileStores";
import { cn, formatBytes } from "../lib/format";
import { currentStore, downloadsOutside, moveDownloads, setCurrentStore } from "../stores/offline";
import { toast } from "../stores/ui";
import { Modal } from "./Modal";

/** Settings: shows where downloads are saved, lets the user pick another place and offers to move existing songs. */
export function StorageLocation() {
  const t = useT();
  const [store, setStore] = useState<StoreId>(currentStore);
  const [path, setPath] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ count: number; bytes: number } | null>(null);
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  const places = availableStores();

  useEffect(() => {
    let live = true;
    void describeStore(store).then((p) => live && setPath(p));
    return () => {
      live = false;
    };
  }, [store]);

  async function pick(next: StoreId) {
    if (next === store) return;
    if (!(await prepareStore(next))) return toast(t.storage.noAccess, "error");
    setCurrentStore(next);
    setStore(next);
    const outside = await downloadsOutside(next);
    if (outside.count) setAsk(outside);
  }

  async function chooseFolder() {
    const current = store.startsWith("dir:") ? store.slice(4) : await pcFs!.defaultDir();
    const dir = await pcFs!.choose(current);
    if (dir) await pick(`dir:${dir}`);
  }

  async function move() {
    setAsk(null);
    setMoving({ done: 0, total: 0 });
    const r = await moveDownloads(store, (done, total) => setMoving({ done, total }));
    setMoving(null);
    if (r.moved) toast(t.storage.moved(r.moved));
    if (r.failed) toast(t.storage.moveFailed(r.failed), "error");
  }

  const kind = store.startsWith("dir:") ? "dir" : (store as "app" | "doc" | "ext");
  const hint = kind === "app" ? t.storage.appHint : kind === "doc" ? t.storage.docHint : kind === "ext" ? t.storage.extHint : null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-3">{t.storage.title}</span>
      {places.length > 1 && (
        <div role="radiogroup" aria-label={t.storage.title} className="flex flex-col gap-1 rounded-[16px] bg-surface-1 p-1 ring-1 ring-line">
          {places.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={kind === p}
              disabled={!!moving}
              onClick={() => void (p === "dir" ? chooseFolder() : pick(p))}
              className={cn(
                "flex items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left text-sm font-semibold transition-colors",
                kind === p ? "bg-accent text-accent-ink" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
              )}
            >
              {t.storage.places[p]}
              {p === "dir" && <FolderOpenIcon size={16} />}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-[16px] bg-surface-1 px-4 py-3 ring-1 ring-line">
        <p className="text-xs text-fg-3">{t.storage.where}</p>
        <p className="mt-0.5 text-sm font-medium break-all">{path ?? t.storage.places[kind]}</p>
        {hint && <p className="mt-1 text-xs text-fg-3">{hint}</p>}
        {kind === "dir" && (
          <button type="button" onClick={() => void chooseFolder()} className="mt-2 text-sm font-semibold text-accent-text hover:underline">
            {t.storage.change}
          </button>
        )}
        {moving && <p className="mt-2 text-sm text-accent-text">{t.storage.moving(moving.done, moving.total)}</p>}
      </div>

      <Modal open={!!ask} onClose={() => setAsk(null)} title={t.storage.moveTitle}>
        {ask && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg-2">{t.storage.moveBody(ask.count, formatBytes(ask.bytes))}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAsk(null)} className="rounded-full px-4 py-2 text-sm font-semibold text-fg-2 hover:bg-surface-3">
                {t.storage.keep}
              </button>
              <button type="button" onClick={() => void move()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
                {t.storage.move}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
