// Offline songs in a folder the user picks (Settings → Storage location): the page asks, the main process does the
// file work. Only plain "<id>.ytfy" names inside the chosen folder are touched.
import { app, dialog, ipcMain, BrowserWindow } from "electron";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const NAME = /^[A-Za-z0-9_-]{6,40}\.ytfy$/;
const inside = (dir: string, name: string) => {
  if (!path.isAbsolute(dir) || !NAME.test(name)) throw new Error("bad path");
  return path.join(dir, name);
};

export function registerFsBridge() {
  ipcMain.handle("youtify:fs:default", () => path.join(app.getPath("music"), "YoutiFy"));
  ipcMain.handle("youtify:fs:choose", async (e, current?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[], defaultPath: current || app.getPath("music") };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle("youtify:fs:write", async (_e, dir: string, name: string, bytes: Uint8Array) => {
    const file = inside(dir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
  });
  ipcMain.handle("youtify:fs:read", async (_e, dir: string, name: string) => {
    try {
      return new Uint8Array(await readFile(inside(dir, name)));
    } catch {
      return null;
    }
  });
  ipcMain.handle("youtify:fs:delete", async (_e, dir: string, name: string) => {
    await rm(inside(dir, name), { force: true });
  });
  ipcMain.handle("youtify:fs:check", async (_e, dir: string) => {
    try {
      await mkdir(dir, { recursive: true });
      return (await stat(dir)).isDirectory();
    } catch {
      return false;
    }
  });
}
