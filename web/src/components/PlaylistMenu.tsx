import { DotsThreeVerticalIcon, PencilSimpleIcon, PlayIcon, ShareNetworkIcon, ShuffleIcon, TrashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { create } from "zustand";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { useT } from "../i18n";
import { cn, shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { Cover } from "./Cover";
import { NamePlaylistDialog } from "./Dialogs";
import { Modal } from "./Modal";
import { sharePlaylist } from "./ShareDialog";

/**
 * Actions for a playlist in the sidebar and the library: right-click on a PC, the ⋮ button on a phone.
 * Play, shuffle, rename, delete.
 */

interface MenuState {
  menu: { id: string; x: number; y: number } | null;
  renaming: string | null;
  deleting: string | null;
  open: (id: string, x: number, y: number) => void;
  close: () => void;
}

const usePlaylistMenu = create<MenuState>((set) => ({
  menu: null,
  renaming: null,
  deleting: null,
  open: (id, x, y) => set({ menu: { id, x, y } }),
  close: () => set({ menu: null }),
}));

/** onContextMenu handler: opens the menu where the user right-clicked. */
export function playlistContextMenu(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    usePlaylistMenu.getState().open(id, e.clientX, e.clientY);
  };
}

/** The ⋮ button next to a playlist. */
export function PlaylistMenuButton({ id, name, className }: { id: string; name: string; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t.playlistMenu.actionsFor(name)}
      title={t.playlistMenu.more}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        usePlaylistMenu.getState().open(id, r.left, r.bottom + 4);
      }}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full text-fg-2 transition-[background-color,color,opacity] hover:bg-surface-3 hover:text-fg",
        className,
      )}
    >
      <DotsThreeVerticalIcon size={22} weight="bold" />
    </button>
  );
}

function Item({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition-colors md:py-2 md:text-sm",
        "hover:bg-surface-3 focus-visible:bg-surface-3",
        danger ? "text-danger" : "text-fg",
      )}
    >
      <span className={cn("shrink-0", danger ? "text-danger" : "text-fg-2")}>{icon}</span>
      {children}
    </button>
  );
}

/** Mounted once in App: the menu itself plus its rename and delete dialogs. */
export function PlaylistMenu() {
  const { menu, renaming, deleting, close } = usePlaylistMenu();
  const playlists = useLibrary((s) => s.playlists);
  const isMd = useMediaQuery(MD);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();

  const playlist = menu ? playlists.find((p) => p.id === menu.id) : undefined;
  const renameTarget = renaming ? playlists.find((p) => p.id === renaming) : undefined;
  const deleteTarget = deleting ? playlists.find((p) => p.id === deleting) : undefined;

  useLayoutEffect(() => {
    if (!menu || !isMd || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    setPos({
      left: Math.max(12, Math.min(menu.x, window.innerWidth - width - 12)),
      top: menu.y + height > window.innerHeight - 12 ? Math.max(12, menu.y - height) : menu.y,
    });
  }, [menu, isMd]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const content = playlist && (
    <div role="menu" aria-label={t.playlistMenu.actionsFor(playlist.name)} className="flex flex-col">
      <Item icon={<PlayIcon size={18} />} onClick={run(() => playlist.tracks.length && usePlayer.getState().playList(playlist.tracks, 0))}>
        {t.common.play}
      </Item>
      <Item
        icon={<ShuffleIcon size={18} />}
        onClick={run(() => playlist.tracks.length && usePlayer.getState().playList(shuffled(playlist.tracks), 0))}
      >
        {t.collection.shuffle}
      </Item>
      <Item icon={<ShareNetworkIcon size={18} />} onClick={run(() => sharePlaylist(playlist.name, playlist.tracks))}>
        {t.share.action}
      </Item>
      <div className="mx-3 my-1 h-px bg-line" />
      <Item icon={<PencilSimpleIcon size={18} />} onClick={run(() => usePlaylistMenu.setState({ renaming: playlist.id }))}>
        {t.collection.rename}
      </Item>
      <Item danger icon={<TrashIcon size={18} />} onClick={run(() => usePlaylistMenu.setState({ deleting: playlist.id }))}>
        {t.collection.deletePlaylist}
      </Item>
    </div>
  );

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {menu && playlist && (
            <div className="fixed inset-0 z-50" onContextMenu={(e) => e.preventDefault()}>
              <motion.div
                className={cn("absolute inset-0", isMd ? "bg-transparent" : "bg-scrim")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={close}
              />
              {isMd ? (
                <motion.div
                  ref={box}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  style={pos}
                  className="absolute w-60 origin-top-left rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
                >
                  {content}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 420, damping: 40 }}
                  className="island safe-bottom absolute inset-x-0 bottom-0 rounded-b-none"
                >
                  <div className="island-core p-2">
                    <div className="mx-auto mt-1 mb-2 h-1 w-9 rounded-full bg-surface-4" />
                    <div className="flex items-center gap-3 px-3 pb-3">
                      <Cover kind="playlist" tracks={playlist.tracks} iconSize={20} className="size-12 rounded-[10px]" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{playlist.name}</p>
                        <p className="truncate text-sm text-fg-2">{t.common.tracks(playlist.tracks.length)}</p>
                      </div>
                    </div>
                    {content}
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <NamePlaylistDialog
        open={!!renameTarget}
        initial={renameTarget?.name ?? ""}
        title={t.collection.renameTitle}
        action={t.collection.save}
        onClose={() => usePlaylistMenu.setState({ renaming: null })}
        onSubmit={async (name) => {
          if (renameTarget) await useLibrary.getState().renamePlaylist(renameTarget.id, name);
          usePlaylistMenu.setState({ renaming: null });
        }}
      />

      <Modal open={!!deleteTarget} onClose={() => usePlaylistMenu.setState({ deleting: null })} title={t.collection.deleteTitle}>
        {deleteTarget && (
          <>
            <p className="text-sm text-fg-2">{t.collection.deleteBody(deleteTarget.name, deleteTarget.tracks.length)}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => usePlaylistMenu.setState({ deleting: null })}
                className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = deleteTarget.id;
                  usePlaylistMenu.setState({ deleting: null });
                  // Leave the playlist's own page if it is the one being deleted.
                  if (location.pathname === paths.playlist(id)) navigate(paths.library);
                  void useLibrary.getState().deletePlaylist(id);
                }}
                className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
              >
                {t.collection.delete}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
