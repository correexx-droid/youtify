import { ArrowLineUpIcon, CaretDownIcon, CaretUpIcon, DotsSixVerticalIcon, QueueIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { usePlayer } from "../player/player";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";

/** How many upcoming songs the list shows (the queue itself can be longer). */
const SHOWN = 50;

export function QueueList({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const live = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const clearUpcoming = usePlayer((s) => s.clearUpcoming);
  const autoRadio = usePlayer((s) => s.autoRadio);
  const setAutoRadio = usePlayer((s) => s.setAutoRadio);
  const moveInQueue = usePlayer((s) => s.moveInQueue);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const current = queue[index];
  const upcoming = queue.slice(index + 1);

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-[14px] bg-surface-3 text-fg-3">
          <QueueIcon size={26} />
        </span>
        <p className="font-medium">{t.queue.emptyTitle}</p>
        <p className="max-w-[28ch] text-sm text-fg-2">{t.queue.emptyBody}</p>
      </div>
    );
  }

  const shown = upcoming.slice(0, SHOWN);
  const first = index + 1;

  // Dragging by the handle: the row under the finger/pointer becomes the drop target.
  const onHandleDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from: i, over: i });
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-qi]");
    if (el) setDrag({ ...drag, over: Number(el.dataset.qi) });
    // Near the edges of the list, keep scrolling.
    const box = listRef.current?.closest(".scroll-area");
    if (box) {
      const r = box.getBoundingClientRect();
      if (e.clientY < r.top + 40) box.scrollBy(0, -12);
      else if (e.clientY > r.bottom - 40) box.scrollBy(0, 12);
    }
  };
  const onHandleUp = () => {
    if (drag && drag.over !== drag.from) moveInQueue(drag.from, drag.over);
    setDrag(null);
  };

  const row = (i: number, isCurrent: boolean) => {
    const track = queue[i]!;
    const dragging = drag?.from === i;
    const dropHere = drag && drag.over === i && drag.from !== i;
    return (
      <li
        key={`${track.id}-${i}`}
        data-qi={isCurrent ? undefined : i}
        className={cn(
          "group relative flex items-center gap-2 rounded-xl px-1.5 py-1.5 hover:bg-surface-3",
          dragging && "bg-surface-3 opacity-60",
          dropHere && (drag!.from > i ? "shadow-[inset_0_2px_0_var(--accent)]" : "shadow-[inset_0_-2px_0_var(--accent)]"),
        )}
      >
        <button type="button" onClick={() => jumpTo(i)} className="absolute inset-0 rounded-xl" aria-label={t.common.playX(track.title)} />
        {!isCurrent && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={t.queue.dragX(track.title)}
            title={t.queue.drag}
            onPointerDown={onHandleDown(i)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={() => setDrag(null)}
            className="relative z-10 grid h-10 w-6 shrink-0 cursor-grab touch-none place-items-center text-fg-3 hover:text-fg active:cursor-grabbing"
          >
            <DotsSixVerticalIcon size={18} weight="bold" />
          </span>
        )}
        <Artwork src={track.thumb} className="pointer-events-none size-10 rounded-[8px]" />
        <div className="pointer-events-none min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", isCurrent ? "text-accent-text" : "text-fg")}>
            {!isCurrent && <span className="mr-1.5 font-mono text-xs text-fg-3">{i - index}</span>}
            {track.title}
          </p>
          <p className="truncate text-xs text-fg-2">{track.artist}</p>
        </div>
        {isCurrent ? (
          <Equalizer live={live} className="mr-2" />
        ) : (
          <>
            <span className="pointer-events-none font-mono text-xs text-fg-3 tabular-nums group-hover:hidden max-md:hidden">
              {track.duration ? formatTime(track.duration) : ""}
            </span>
            <span className="relative z-10 hidden items-center group-hover:flex max-md:flex">
              {i > first && (
                <>
                  <button
                    type="button"
                    onClick={() => moveInQueue(i, first)}
                    aria-label={t.queue.toTopX(track.title)}
                    title={t.queue.toTop}
                    className="grid size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg max-sm:hidden"
                  >
                    <ArrowLineUpIcon size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveInQueue(i, i - 1)}
                    aria-label={t.queue.upX(track.title)}
                    title={t.queue.up}
                    className="grid size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg"
                  >
                    <CaretUpIcon size={16} weight="bold" />
                  </button>
                </>
              )}
              {i < queue.length - 1 && (
                <button
                  type="button"
                  onClick={() => moveInQueue(i, i + 1)}
                  aria-label={t.queue.downX(track.title)}
                  title={t.queue.down}
                  className="grid size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg"
                >
                  <CaretDownIcon size={16} weight="bold" />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={t.queue.removeX(track.title)}
                title={t.queue.remove}
                className="grid size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg"
              >
                <XIcon size={16} />
              </button>
            </span>
          </>
        )}
      </li>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", compact ? "" : "pb-4")}>
      <section>
        <h3 className="px-2 pb-1.5 text-xs font-medium text-fg-3">{t.queue.nowPlaying}</h3>
        <ul>{row(index, true)}</ul>
      </section>

      <section>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h3 className="text-xs font-medium text-fg-3">
            {t.queue.upNext} <span className="font-mono">{upcoming.length}</span>
          </h3>
          {upcoming.length > 0 && (
            <button type="button" onClick={clearUpcoming} className="text-xs font-medium text-fg-2 hover:text-fg">
              {t.queue.clear}
            </button>
          )}
        </div>
        {upcoming.length ? (
          <>
            <ul ref={listRef} className={cn(drag && "select-none")}>
              {shown.map((_, k) => row(first + k, false))}
            </ul>
            {upcoming.length > SHOWN && <p className="px-2 pt-2 text-xs text-fg-3">{t.queue.more(upcoming.length - SHOWN)}</p>}
          </>
        ) : (
          <p className="px-2 text-sm text-fg-2">
            {t.queue.nothingQueued} {autoRadio ? t.queue.radioContinues : ""}
          </p>
        )}
      </section>

      <label className="mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-1 px-3 py-2.5 ring-1 ring-line">
        <span>
          <span className="block text-sm font-medium">{t.queue.autoRadio}</span>
          <span className="block text-xs text-fg-2">{t.queue.autoRadioBody}</span>
        </span>
        <input
          type="checkbox"
          checked={autoRadio}
          onChange={(e) => setAutoRadio(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            autoRadio ? "bg-accent" : "bg-surface-4",
          )}
        >
          <span
            className={cn(
              "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
              autoRadio ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
            )}
          />
        </span>
      </label>
    </div>
  );
}
