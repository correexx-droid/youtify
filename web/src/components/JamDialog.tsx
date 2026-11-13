import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import {
  canHost,
  jamCommand,
  jamSearch,
  joinJam,
  leaveJam,
  newJamPin,
  parseJamLink,
  startJam,
  stopJam,
  useJam,
  type JamTrack,
} from "../lib/jam";
import { toast } from "../stores/ui";
import { Modal } from "./Modal";

/** Small bar above the queue: opens the jam dialog and shows a running jam. */
export function JamBar() {
  const t = useT();
  const hosting = useJam((s) => s.hosting);
  const joined = useJam((s) => s.joined);
  const guests = useJam((s) => Object.values(s.guests).filter((g) => Date.now() - g.seen < 20_000).length);
  const open = useJam((s) => s.setDialogOpen);
  return (
    <button
      type="button"
      onClick={() => open(true)}
      className={cn(
        "mx-1 mb-2 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold ring-1 ring-line transition-colors",
        hosting || joined ? "bg-accent text-accent-ink" : "bg-surface-1 text-fg-2 hover:bg-surface-3 hover:text-fg",
      )}
    >
      <UsersThreeIcon size={18} />
      <span className="flex-1">
        {hosting ? `${t.jam.running} · PIN ${hosting.pin} · ${t.jam.guests(guests)}` : joined ? t.jam.connectedTo(joined.base.replace("http://", "")) : t.jam.title}
      </span>
    </button>
  );
}

const field = "w-full rounded-xl bg-surface-1 px-3 py-2 text-sm ring-1 ring-line outline-none focus:ring-accent";
const btn = "rounded-full px-4 py-2 text-sm font-semibold transition-colors";

export function JamDialog() {
  const t = useT();
  const open = useJam((s) => s.dialogOpen);
  const setOpen = useJam((s) => s.setDialogOpen);
  const hosting = useJam((s) => s.hosting);
  const joined = useJam((s) => s.joined);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.jam.title}>
      {hosting ? <HostView /> : joined ? <GuestView /> : <StartView />}
    </Modal>
  );
}

function StartView() {
  const t = useT();
  const error = useJam((s) => s.remoteError);
  const [address, setAddress] = useState(() => localStorage.getItem("youtify:jam-address") ?? "");
  const [pin, setPin] = useState("");
  const [name, setName] = useState(() => localStorage.getItem("youtify:jam-name") ?? "");
  const [busy, setBusy] = useState(false);

  // A pasted guest link fills in address and PIN.
  const onAddress = (v: string) => {
    const link = parseJamLink(v);
    if (link && /[/?]/.test(v)) {
      setAddress(link.address);
      if (link.pin) setPin(link.pin);
    } else setAddress(v);
  };

  async function join() {
    setBusy(true);
    localStorage.setItem("youtify:jam-address", address);
    localStorage.setItem("youtify:jam-name", name);
    await joinJam(address, pin, name);
    setBusy(false);
  }

  async function host() {
    setBusy(true);
    try {
      await startJam();
    } catch {
      toast(t.jam.startFailed, "error");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">{t.jam.intro}</p>
      {canHost ? (
        <div className="flex flex-col gap-1">
          <button type="button" disabled={busy} onClick={() => void host()} className={cn(btn, "bg-accent text-accent-ink")}>
            {t.jam.start}
          </button>
          <p className="text-center text-xs text-fg-3">{t.jam.startHint}</p>
        </div>
      ) : (
        <p className="text-xs text-fg-3">{t.jam.cantHost}</p>
      )}
      <div className="flex flex-col gap-2 rounded-[16px] bg-surface-2 p-3 ring-1 ring-line">
        <span className="text-sm font-semibold">{t.jam.join}</span>
        <input className={field} value={address} onChange={(e) => onAddress(e.target.value)} placeholder={t.jam.address} inputMode="url" />
        <div className="flex gap-2">
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.jam.yourName} maxLength={30} />
          <input
            className={cn(field, "w-24")}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder={t.jam.pin}
            inputMode="numeric"
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          type="button"
          disabled={busy || !address || pin.length !== 4}
          onClick={() => void join()}
          className={cn(btn, "self-end bg-surface-4 text-fg disabled:opacity-50")}
        >
          {busy ? t.jam.connecting : t.jam.connect}
        </button>
      </div>
    </div>
  );
}

function HostView() {
  const t = useT();
  const hosting = useJam((s) => s.hosting)!;
  const guestList = useJam((s) => s.guests);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const active = Object.values(guestList).filter((g) => Date.now() - g.seen < 20_000);
  const links = hosting.ips.map((ip) => `http://${ip}:${hosting.port}/?pin=${hosting.pin}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 rounded-[16px] bg-surface-2 p-4 text-center ring-1 ring-line">
        <span className="text-xs text-fg-3">{t.jam.pin}</span>
        <span className="text-4xl font-bold tracking-[0.3em] text-accent-text">{hosting.pin}</span>
        {hosting.ips.map((ip) => (
          <span key={ip} className="font-mono text-lg">
            {ip}:{hosting.port}
          </span>
        ))}
      </div>
      {links.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-2">{t.jam.shareHow}</p>
          {links.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => void navigator.clipboard?.writeText(l).then(() => toast(t.jam.copied))}
              className="flex items-center gap-2 rounded-xl bg-surface-1 px-3 py-2 text-left font-mono text-xs break-all ring-1 ring-line hover:bg-surface-3"
            >
              <CopyIcon size={14} className="shrink-0" /> {l}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-danger">{t.jam.noNetwork}</p>
      )}
      <div>
        <p className="text-sm font-semibold">{t.jam.guests(active.length)}</p>
        {active.length > 0 && <p className="text-sm text-fg-2">{active.map((g) => g.name).join(", ")}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" title={t.jam.newPinHint} onClick={newJamPin} className={cn(btn, "bg-surface-3 text-fg")}>
          {t.jam.newPin}
        </button>
        <button type="button" onClick={() => void stopJam()} className={cn(btn, "bg-danger text-white")}>
          {t.jam.stop}
        </button>
      </div>
    </div>
  );
}

function Row({ track, children }: { track: JamTrack; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <img src={track.thumb} alt="" className="size-10 shrink-0 rounded-lg bg-surface-3 object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-fg-2">
          {track.artist}
          {track.duration ? ` · ${formatTime(track.duration)}` : ""}
        </p>
      </div>
      {children}
    </li>
  );
}

const iconBtn = "grid size-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg disabled:opacity-30";

function GuestView() {
  const t = useT();
  const s = useJam((st) => st.remote);
  const error = useJam((st) => st.remoteError);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<JamTrack[]>([]);
  const [searching, setSearching] = useState(false);

  async function find() {
    if (!q.trim()) return;
    setSearching(true);
    setResults(await jamSearch(q).catch(() => []));
    setSearching(false);
  }

  const first = s?.queue[0]?.i ?? 0;
  const last = s?.queue.at(-1)?.i ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="rounded-[16px] bg-surface-2 p-3 ring-1 ring-line">
        {s?.current ? (
          <Row track={s.current} />
        ) : (
          <p className="text-sm text-fg-2">{t.jam.nothing}</p>
        )}
        <div className="mt-2 flex items-center justify-center gap-3">
          <button type="button" aria-label="prev" className={iconBtn} onClick={() => void jamCommand({ op: "prev" })}>
            <SkipBackIcon size={20} weight="fill" />
          </button>
          <button
            type="button"
            aria-label={s?.playing ? "pause" : "play"}
            className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink"
            onClick={() => void jamCommand({ op: "toggle" })}
          >
            {s?.playing ? <PauseIcon size={22} weight="fill" /> : <PlayIcon size={22} weight="fill" />}
          </button>
          <button type="button" aria-label="next" className={iconBtn} onClick={() => void jamCommand({ op: "next" })}>
            <SkipForwardIcon size={20} weight="fill" />
          </button>
        </div>
        {s && <p className="mt-1 text-center text-xs text-fg-3">{t.jam.guests(s.guests)}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void find()}
            placeholder={t.jam.search}
          />
          <button type="button" aria-label={t.jam.search} onClick={() => void find()} className={cn(iconBtn, "size-10 bg-surface-3")}>
            <MagnifyingGlassIcon size={18} className={searching ? "animate-pulse" : ""} />
          </button>
        </div>
        {results.length > 0 && (
          <ul className="max-h-60 overflow-y-auto">
            {results.map((r) => (
              <Row key={r.id} track={r}>
                <button
                  type="button"
                  className={cn(btn, "bg-surface-3 px-3 py-1 text-xs")}
                  onClick={() => {
                    void jamCommand({ op: "playNext", track: r });
                    setResults((list) => list.filter((x) => x !== r));
                  }}
                >
                  {t.jam.playNext}
                </button>
                <button
                  type="button"
                  aria-label={t.jam.add}
                  title={t.jam.add}
                  className={cn(iconBtn, "bg-accent text-accent-ink hover:bg-accent")}
                  onClick={() => {
                    void jamCommand({ op: "add", track: r });
                    setResults((list) => list.filter((x) => x !== r));
                  }}
                >
                  <PlusIcon size={16} weight="bold" />
                </button>
              </Row>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold">{t.jam.upNext}</p>
        {s && s.queue.length ? (
          <ul className="max-h-72 overflow-y-auto">
            {s.queue.map(({ i, track }) => (
              <Row key={`${track.id}-${i}`} track={track}>
                <button type="button" aria-label={t.jam.up} disabled={i <= first} className={iconBtn} onClick={() => void jamCommand({ op: "move", i, id: track.id, to: i - 1 })}>
                  <ArrowUpIcon size={16} />
                </button>
                <button type="button" aria-label={t.jam.down} disabled={i >= last} className={iconBtn} onClick={() => void jamCommand({ op: "move", i, id: track.id, to: i + 1 })}>
                  <ArrowDownIcon size={16} />
                </button>
                <button type="button" aria-label={t.jam.remove} className={iconBtn} onClick={() => void jamCommand({ op: "remove", i, id: track.id })}>
                  <XIcon size={16} />
                </button>
              </Row>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-2">{t.jam.empty}</p>
        )}
      </div>

      <button type="button" onClick={leaveJam} className={cn(btn, "self-end bg-surface-3 text-fg")}>
        {t.jam.leave}
      </button>
    </div>
  );
}
