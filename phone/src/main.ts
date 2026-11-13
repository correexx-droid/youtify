/**
 * YoutiFy Mobile: the Android app (the same web build as the APK, with the backend running inside the app) as a
 * PC program in a phone-sized window.
 *
 * On a phone, the app's requests to YouTube and Spotify go through Android's HTTP stack, because a browser would
 * block them (cross-origin) or add headers YouTube rejects. Here the main process does that job: the page hands
 * each request over IPC and Node's fetch sends it with exactly the headers the app set.
 */
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
import { registerFsBridge } from "./fsBridge";
import { registerJamBridge } from "./jamBridge";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEME = "youtify";
const HOST = "app";
const ORIGIN = `${SCHEME}://${HOST}`;

// A proper origin (not file://) so IndexedDB, the library and offline songs persist like on the phone.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const www = app.isPackaged ? path.join(process.resourcesPath, "www") : path.join(__dirname, "..", "..", "web", "dist-native");

// ---------------------------------------------------------------- Network bridge (what CapacitorHttp does on Android)

interface RawRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const allowed = (url: string) => /^https:\/\//.test(url);

function headersOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

ipcMain.handle("youtify:net", async (_e, req: RawRequest) => {
  if (!allowed(req.url)) throw new Error("blocked");
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "follow",
  });
  return { status: res.status, headers: headersOf(res), body: await res.text() };
});

ipcMain.handle("youtify:bytes", async (_e, req: { url: string; headers: Record<string, string> }) => {
  if (!allowed(req.url)) throw new Error("blocked");
  const res = await fetch(req.url, { headers: req.headers, redirect: "follow", signal: AbortSignal.timeout(45_000) });
  return { status: res.status, headers: headersOf(res), bytes: new Uint8Array(await res.arrayBuffer()) };
});

// ---------------------------------------------------------------- Window

type Size = "phone" | "tablet" | "large";
const SIZES: Record<Size, [number, number]> = { phone: [412, 880], tablet: [820, 1000], large: [1280, 820] };
const settingsFile = () => path.join(app.getPath("userData"), "window.json");

function readSize(): Size {
  try {
    const v = JSON.parse(readFileSync(settingsFile(), "utf8")).size;
    return v in SIZES ? v : "phone";
  } catch {
    return "phone";
  }
}

let win: BrowserWindow | null = null;

function setSize(size: Size) {
  if (!win) return;
  const [w, h] = SIZES[size];
  win.setSize(w, h, true);
  win.center();
  try {
    writeFileSync(settingsFile(), JSON.stringify({ size }));
  } catch {
    /* read-only profile */
  }
  buildMenu(size);
}

function buildMenu(current: Size) {
  const item = (size: Size, label: string, key: string): Electron.MenuItemConstructorOptions => ({
    label,
    type: "radio",
    checked: current === size,
    accelerator: `CmdOrCtrl+${key}`,
    click: () => setSize(size),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Ansicht",
        submenu: [
          item("phone", "Handy", "1"),
          item("tablet", "Tablet", "2"),
          item("large", "Groß", "3"),
          { type: "separator" },
          { role: "reload", label: "Neu laden" },
          { role: "togglefullscreen", label: "Vollbild" },
          { type: "separator" },
          { role: "toggleDevTools", label: "Entwicklertools" },
          { role: "quit", label: "Beenden" },
        ],
      },
    ]),
  );
}

function createWindow() {
  const size = readSize();
  const [width, height] = SIZES[size];
  win = new BrowserWindow({
    width,
    height,
    minWidth: 340,
    minHeight: 560,
    title: "YoutiFy Mobile",
    backgroundColor: "#0A0613",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  buildMenu(size);
  // Links to YouTube, GitHub & co. open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  void win.loadURL(`${ORIGIN}/`);
  win.on("closed", () => (win = null));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerFsBridge();
    registerJamBridge();
    // The app's files; unknown paths get index.html (the app routes by itself).
    protocol.handle(SCHEME, (request) => {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      let file = path.normalize(path.join(www, rel));
      if (!file.startsWith(www) || !rel || !existsSync(file)) file = path.join(www, "index.html");
      return net.fetch(pathToFileURL(file).href);
    });
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
