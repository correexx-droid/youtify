import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { create } from "zustand";
import { getT } from "../i18n";
import { usePlayer } from "../player/player";
import { toast } from "../stores/ui";
import { api } from "./api";
import { JAM_GUEST_HTML } from "./jamGuestPage";
import type { Track } from "./types";

/**
 * Jam sessions: one YoutiFy (the host) plays, everyone else in the same network sees what is playing and
 * controls the queue: add, remove, reorder, play/pause, skip. The host runs a small HTTP server in the local
 * network (Android: JamServerPlugin.java; PC programs: jamBridge.ts) and answers its requests here. Guests join
 * from YoutiFy or from any browser (the server also serves a guest page). Every call needs the session PIN.
 */

export const JAM_PORT = 4190;

export interface JamTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumb: string;
  kind: Track["kind"];
}

export interface JamState {
  host: string;
  current: JamTrack | null;
  playing: boolean;
  position: number;
  duration: number;
  /** Upcoming songs with their place in the host's queue. */
  queue: { i: number; track: JamTrack }[];
  guests: number;
}

export type JamCommand =
  | { op: "add" | "playNext"; track: JamTrack }
  | { op: "remove"; i: number; id: string }
  | { op: "move"; i: number; id: string; to: number }
  | { op: "jump"; i: number; id: string }
  | { op: "toggle" | "next" | "prev" };

interface Request {
  rid: string;
  method: string;
  url: string;
  body: string;
  remote?: string;
}
interface Response {
  status: number;
  type: string;
  body: string;
}

interface PcJam {
  start(port?: number): Promise<{ port: number; ips: string[] }>;
  stop(): Promise<void>;
  respond(r: Response & { rid: string }): Promise<void>;
  call(req: { url: string; method: string; body?: string }): Promise<{ status: number; body: string }>;
  onRequest(cb: (req: Request) => void): () => void;
}
interface AndroidJam {
  start(o: { port: number }): Promise<{ port: number; ips: string[] }>;
  stop(): Promise<void>;
  respond(r: Response & { rid: string }): Promise<void>;
  addListener(event: "request", cb: (req: Request) => void): Promise<PluginListenerHandle>;
}

const pcJam = (globalThis as { youtifyJam?: PcJam }).youtifyJam ?? null;
const isAndroid = Capacitor.getPlatform() === "android";
const androidJam = isAndroid ? registerPlugin<AndroidJam>("JamServer") : null;

/** Hosting needs a server: the Android app and the PC programs have one, a browser tab doesn't. */
export const canHost = !!pcJam || !!androidJam;

// ---------------------------------------------------------------- shared state

interface Guest {
  name: string;
  seen: number;
}

interface JamStore {
  /** This device hosts: address and PIN to show. */
  hosting: { port: number; ips: string[]; pin: string } | null;
  guests: Record<string, Guest>;
  /** This device is a guest in someone else's jam. */
  joined: { base: string; pin: string; name: string } | null;
  remote: JamState | null;
  remoteError: string | null;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

export const useJam = create<JamStore>((set) => ({
  hosting: null,
  guests: {},
  joined: null,
  remote: null,
  remoteError: null,
  dialogOpen: false,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}));

const mini = (t: Track): JamTrack => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, thumb: t.thumb, kind: t.kind });

/** A track sent by a guest: only plain YouTube ids and short texts get into the queue. */
function cleanTrack(raw: unknown): Track | null {
  const t = raw as Partial<JamTrack> | null;
  if (!t || typeof t.id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(t.id)) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const thumb = text(t.thumb, 500);
  const safeThumb = /^https:\/\/[a-z0-9.-]+\.(ytimg|googleusercontent|ggpht)\.com\//.test(thumb) ? thumb : `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`;
  return {
    id: t.id,
    title: text(t.title, 200) || t.id,
    artist: text(t.artist, 200),
    duration: typeof t.duration === "number" && t.duration > 0 && t.duration < 86_400 ? t.duration : 0,
    thumb: safeThumb,
    art: safeThumb,
    kind: t.kind === "video" ? "video" : "song",
  };
}

// ---------------------------------------------------------------- host

let stopListening: (() => void) | null = null;

function newPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 10_000;
  return String(n).padStart(4, "0");
}

function hostState(): JamState {
  const p = usePlayer.getState();
  const current = p.queue[p.index] ?? null;
  const now = Date.now();
  const guests = Object.values(useJam.getState().guests).filter((g) => now - g.seen < 20_000).length;
  return {
    host: getT().jam.hostName,
    current: current ? mini(current) : null,
    playing: p.status === "playing" || p.status === "loading",
    position: Math.round(p.position),
    duration: Math.round(p.duration),
    queue: p.queue.slice(p.index + 1, p.index + 51).map((t, n) => ({ i: p.index + 1 + n, track: mini(t) })),
    guests,
  };
}

/** Finds a guest's song in the queue: at the index they saw, or wherever it moved since. */
function locate(i: unknown, id: unknown): number {
  const p = usePlayer.getState();
  if (typeof id !== "string") return -1;
  if (typeof i === "number" && p.queue[i]?.id === id && i > p.index) return i;
  return p.queue.findIndex((t, n) => n > p.index && t.id === id);
}

function seen(guest: unknown, name: unknown): string {
  const id = typeof guest === "string" ? guest.slice(0, 40) : "";
  if (!id) return getT().jam.someone;
  const label = (typeof name === "string" && name.trim().slice(0, 30)) || getT().jam.someone;
  const known = useJam.getState().guests[id];
  if (!known) toast(getT().jam.guestJoined(label));
  useJam.setState((s) => ({ guests: { ...s.guests, [id]: { name: label, seen: Date.now() } } }));
  return label;
}

function run(cmd: JamCommand & Record<string, unknown>, who: string): string | null {
  const p = usePlayer.getState();
  const t = getT().jam;
  switch (cmd.op) {
    case "add":
    case "playNext": {
      const track = cleanTrack(cmd.track);
      if (!track) return "bad track";
      if (!p.queue[p.index]) p.playTrack(track);
      else if (cmd.op === "add") p.addToQueue(track);
      else p.playNext(track);
      toast(t.guestAdded(who, track.title));
      return null;
    }
    case "remove": {
      const at = locate(cmd.i, cmd.id);
      if (at < 0) return "not found";
      p.removeAt(at);
      return null;
    }
    case "move": {
      const at = locate(cmd.i, cmd.id);
      const to = Number(cmd.to);
      if (at < 0 || !Number.isInteger(to) || to <= p.index || to >= p.queue.length) return "not found";
      p.moveInQueue(at, to);
      return null;
    }
    case "jump": {
      const at = locate(cmd.i, cmd.id);
      if (at < 0) return "not found";
      p.jumpTo(at);
      return null;
    }
    case "toggle":
      p.toggle();
      return null;
    case "next":
      p.next();
      return null;
    case "prev":
      p.prev();
      return null;
    default:
      return "unknown";
  }
}

const json = (status: number, body: unknown): Response => ({ status, type: "application/json", body: JSON.stringify(body) });

async function handle(req: Request): Promise<Response> {
  const hosting = useJam.getState().hosting;
  if (!hosting) return json(503, { error: "no jam" });
  const url = new URL(req.url, "http://jam");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return { status: 200, type: "text/html", body: JAM_GUEST_HTML };
  }
  if (req.method === "GET" && url.pathname === "/jam/hello") return json(200, { app: "YoutiFy", jam: 1 });

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = JSON.parse(req.body || "{}");
    } catch {
      return json(400, { error: "bad json" });
    }
  }
  const pin = String(body.pin ?? url.searchParams.get("pin") ?? "");
  if (pin !== hosting.pin) return json(403, { error: "pin" });
  const who = seen(body.guest ?? url.searchParams.get("guest"), body.name ?? url.searchParams.get("name"));

  if (req.method === "GET" && url.pathname === "/jam/state") return json(200, hostState());
  if (req.method === "GET" && url.pathname === "/jam/search") {
    const q = (url.searchParams.get("q") ?? "").slice(0, 120).trim();
    if (!q) return json(200, []);
    const found = await api.search(q, "song").catch(() => [] as Track[]);
    return json(200, found.slice(0, 20).map(mini));
  }
  if (req.method === "POST" && url.pathname === "/jam/cmd") {
    const err = run(body as JamCommand & Record<string, unknown>, who);
    return err ? json(400, { error: err }) : json(200, hostState());
  }
  return json(404, { error: "not found" });
}

async function answer(req: Request) {
  const res = await handle(req).catch(() => json(500, { error: "failed" }));
  const reply = { rid: req.rid, ...res };
  if (pcJam) await pcJam.respond(reply);
  else await androidJam?.respond(reply);
}

export async function startJam(): Promise<void> {
  if (!canHost) return;
  await stopJam();
  const pin = newPin();
  if (pcJam) {
    const r = await pcJam.start(JAM_PORT);
    stopListening = pcJam.onRequest((req) => void answer(req));
    useJam.setState({ hosting: { ...r, pin }, guests: {} });
  } else if (androidJam) {
    const handle = await androidJam.addListener("request", (req) => void answer(req));
    stopListening = () => void handle.remove();
    const r = await androidJam.start({ port: JAM_PORT });
    useJam.setState({ hosting: { ...r, pin }, guests: {} });
  }
}

export async function stopJam(): Promise<void> {
  stopListening?.();
  stopListening = null;
  useJam.setState({ hosting: null, guests: {} });
  await (pcJam?.stop() ?? androidJam?.stop())?.catch(() => {});
}

/** New PIN: everyone has to join again (e.g. to lock someone out). */
export function newJamPin() {
  useJam.setState((s) => (s.hosting ? { hosting: { ...s.hosting, pin: newPin() }, guests: {} } : {}));
}

// ---------------------------------------------------------------- guest

const GUEST_KEY = "youtify:jam-guest";
function guestId(): string {
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return "guest";
  }
}

/** "192.168.1.20", "192.168.1.20:4191" or a pasted guest link → http://host:port */
export function jamBase(address: string): string | null {
  const a = address.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const m = /^((?:\d{1,3}\.){3}\d{1,3})(?::(\d{2,5}))?$/.exec(a);
  if (!m) return null;
  return `http://${m[1]}:${m[2] ?? JAM_PORT}`;
}

/** Address and PIN from a guest link like http://192.168.1.20:4190/?pin=1234 */
export function parseJamLink(text: string): { address: string; pin: string } | null {
  const m = /(?:youtify:\/\/jam\/|https?:\/\/)((?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?)\/?(?:\?pin=|\/)?(\d{4})?/.exec(text.trim());
  return m ? { address: m[1]!, pin: m[2] ?? "" } : null;
}

async function call(base: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const url = `${base}${path}`;
  const method = body ? "POST" : "GET";
  const text = body ? JSON.stringify(body) : undefined;
  if (pcJam) {
    const r = await pcJam.call({ url, method, body: text });
    return { status: r.status, data: JSON.parse(r.body || "null") };
  }
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({
      url,
      method,
      data: body,
      headers: body ? { "Content-Type": "application/json" } : {},
      connectTimeout: 8000,
      readTimeout: 15_000,
    });
    return { status: r.status, data: typeof r.data === "string" ? JSON.parse(r.data || "null") : r.data };
  }
  const r = await fetch(url, { method, body: text, headers: body ? { "Content-Type": "application/json" } : undefined, signal: AbortSignal.timeout(15_000) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

let poll: ReturnType<typeof setInterval> | null = null;

function who() {
  const j = useJam.getState().joined!;
  return { pin: j.pin, guest: guestId(), name: j.name };
}

async function refresh() {
  const j = useJam.getState().joined;
  if (!j) return;
  try {
    const q = new URLSearchParams({ pin: j.pin, guest: guestId(), name: j.name });
    const r = await call(j.base, `/jam/state?${q}`);
    if (r.status === 403) {
      useJam.setState({ remoteError: getT().jam.wrongPin });
      leaveJam();
      return;
    }
    if (r.status !== 200) throw new Error(String(r.status));
    useJam.setState({ remote: r.data as JamState, remoteError: null });
  } catch {
    useJam.setState({ remoteError: getT().jam.unreachable });
  }
}

export async function joinJam(address: string, pin: string, name: string): Promise<boolean> {
  const base = jamBase(address);
  if (!base) {
    useJam.setState({ remoteError: getT().jam.badAddress });
    return false;
  }
  leaveJam();
  useJam.setState({ joined: { base, pin: pin.trim(), name: name.trim().slice(0, 30) }, remote: null, remoteError: null });
  await refresh();
  if (!useJam.getState().remote) {
    useJam.setState({ joined: null });
    return false;
  }
  poll = setInterval(() => void refresh(), 2000);
  return true;
}

export function leaveJam() {
  if (poll) clearInterval(poll);
  poll = null;
  useJam.setState({ joined: null, remote: null });
}

export async function jamCommand(cmd: JamCommand): Promise<void> {
  const j = useJam.getState().joined;
  if (!j) return;
  try {
    const r = await call(j.base, "/jam/cmd", { ...who(), ...cmd });
    if (r.status === 200) useJam.setState({ remote: r.data as JamState });
    else if (r.status === 403) await refresh();
  } catch {
    useJam.setState({ remoteError: getT().jam.unreachable });
  }
}

export async function jamSearch(q: string): Promise<JamTrack[]> {
  const j = useJam.getState().joined;
  if (!j) return [];
  const params = new URLSearchParams({ ...who(), q });
  const r = await call(j.base, `/jam/search?${params}`);
  return r.status === 200 && Array.isArray(r.data) ? (r.data as JamTrack[]) : [];
}
