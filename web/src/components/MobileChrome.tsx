import { BooksIcon, HouseIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { NavLink, useNavigate } from "react-router";
import { cn } from "../lib/format";
import { useT } from "../i18n";
import { NOW_PLAYING_HASH, paths } from "../lib/routes";
import { selectCurrent, usePlayer, useStatusText } from "../player/player";
import { Artwork } from "./Artwork";
import { PlayPauseIcon } from "./Controls";

const tabs = [
  { to: paths.home, key: "home", Icon: HouseIcon, end: true },
  { to: paths.search, key: "search", Icon: MagnifyingGlassIcon, end: false },
  { to: paths.library, key: "library", Icon: BooksIcon, end: false },
] as const;

export function TabBar() {
  const t = useT();
  return (
    <nav
      aria-label={t.nav.main}
      className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface-1/80 backdrop-blur-2xl"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-3">
        {tabs.map(({ to, key, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive ? "text-accent-text" : "text-fg-3",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "absolute top-0 h-[3px] w-10 rounded-b-full bg-accent shadow-[0_0_14px_rgb(168_85_247/0.8)] transition-transform duration-300 ease-out-expo",
                      isActive ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                  <Icon size={24} weight={isActive ? "fill" : "regular"} />
                  {t.nav[key]}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function MiniPlayer() {
  const track = usePlayer(selectCurrent);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const status = usePlayer((s) => s.status);
  const statusText = useStatusText();
  const toggle = usePlayer((s) => s.toggle);
  const t = useT();
  const navigate = useNavigate();
  if (!track) return null;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="fixed inset-x-2 bottom-[calc(72px+env(safe-area-inset-bottom))] z-20">
      <div className="island p-1! shadow-[0_10px_30px_rgb(40_10_80/0.5)]">
        <div className="island-core relative flex h-14 items-center gap-3 overflow-hidden pr-1 pl-1.5">
          <button
            type="button"
            onClick={() => navigate({ hash: NOW_PLAYING_HASH })}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-label={t.player.openNowPlaying(track.title)}
          >
            <Artwork src={track.thumb} className="size-11 rounded-[10px]" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{track.title}</span>
              <span className={cn("block truncate text-xs", status === "error" ? "text-danger" : "text-fg-2")}>
                {statusText ?? track.artist}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={status === "playing" ? t.common.pause : t.common.play}
            className="accent-glow grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink active:scale-90"
          >
            <PlayPauseIcon size={20} />
          </button>
          <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-surface-4">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>
    </div>
  );
}
