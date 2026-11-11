import { DatabaseIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Cover, type CoverKind } from "../components/Cover";
import { NamePlaylistDialog } from "../components/Dialogs";
import { ImportFilesButton } from "../components/ImportFiles";
import { ImportPlaylistButton, PlaylistLinkField } from "../components/ImportPlaylist";
import { PageHeader } from "../components/Page";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { IconButton } from "../components/IconButton";
import { playlistContextMenu, PlaylistMenuButton } from "../components/PlaylistMenu";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";

function Entry({
  to,
  name,
  kind,
  tracks,
  sub,
  playlistId,
}: {
  to: string;
  name: string;
  kind: CoverKind;
  tracks: Track[];
  sub: string;
  /** Playlists get a menu (right-click, or the ⋮ button). */
  playlistId?: string;
}) {
  return (
    <li className="group/entry relative">
      <Link
        to={to}
        onContextMenu={playlistId ? playlistContextMenu(playlistId) : undefined}
        className="group flex items-center gap-3 rounded-[16px] p-2 transition-colors hover:bg-surface-2 md:flex-col md:items-stretch md:gap-3 md:p-3"
      >
        <Cover
          kind={kind}
          tracks={tracks}
          iconSize={26}
          className="size-16 shrink-0 rounded-[12px] md:aspect-square md:size-auto md:w-full md:rounded-[14px] md:shadow-[0_12px_32px_rgb(0_0_0/0.3)]"
        />
        <span className={playlistId ? "min-w-0 pr-10 md:pr-0" : "min-w-0"}>
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-sm text-fg-2">{sub}</span>
        </span>
      </Link>
      {playlistId && (
        // Always visible on phones; on wide screens it shows on hover (right-click works too).
        <PlaylistMenuButton
          id={playlistId}
          name={name}
          className="absolute top-1/2 right-1 -translate-y-1/2 md:top-5 md:right-5 md:translate-y-0 md:bg-bg/70 md:text-fg md:opacity-0 md:backdrop-blur md:group-hover/entry:opacity-100 md:focus-visible:opacity-100"
        />
      )}
    </li>
  );
}

export default function Library() {
  const { favorites, playlists, history, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const navigate = useNavigate();
  const t = useT();

  return (
    <div className="pb-8">
      <PageHeader
        title={t.nav.library}
        actions={
          <>
          <ImportFilesButton className="max-sm:px-3 max-sm:[&>span]:hidden" />
          <ImportPlaylistButton className="max-sm:px-3 max-sm:[&>span]:hidden" />
          <IconButton label={t.library.backup} onClick={() => setSettingsOpen(true)}>
            <DatabaseIcon size={20} />
          </IconButton>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-10 items-center gap-1.5 rounded-full bg-accent pr-4 pl-3 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97]"
          >
            <PlusIcon size={18} weight="bold" /> <span className="hidden sm:inline">{t.nav.newPlaylist}</span>
            <span className="sm:hidden">{t.library.newShort}</span>
          </button>
          </>
        }
      />

      <PlaylistLinkField className="px-4 pt-3 pb-2 md:max-w-2xl md:px-6" />

      <ul className="grid grid-cols-1 gap-1 px-2 pt-2 md:grid-cols-3 md:gap-2 md:px-4 lg:grid-cols-4 2xl:grid-cols-6">
        <Entry to={paths.favorites} name={t.nav.favorites} kind="favorites" tracks={favorites} sub={t.common.tracks(favorites.length)} />
        <Entry to={paths.history} name={t.nav.recentlyPlayed} kind="history" tracks={history} sub={t.common.tracks(history.length)} />
        {playlists.map((p) => (
          <Entry
            key={p.id}
            to={paths.playlist(p.id)}
            name={p.name}
            kind="playlist"
            tracks={p.tracks}
            sub={t.library.playlistSub(p.tracks.length)}
            playlistId={p.id}
          />
        ))}
      </ul>

      {playlists.length === 0 && (
        <p className="px-4 pt-6 text-sm text-fg-2 md:px-6">
          {t.library.noPlaylists}
        </p>
      )}


      <NamePlaylistDialog
        open={creating}
        title={t.nav.newPlaylist}
        action={t.library.create}
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const p = await createPlaylist(name);
          setCreating(false);
          if (p) navigate(paths.playlist(p.id));
        }}
      />
    </div>
  );
}
