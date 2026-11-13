import { contextBridge, ipcRenderer } from "electron";

// The only bridge between the web app and the desktop shell.
contextBridge.exposeInMainWorld("musikeDesktop", {
  platform: process.platform,
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("musike:theme", theme),
  setLanguage: (lang: string) => ipcRenderer.send("musike:lang", lang),
  retry: () => ipcRenderer.send("musike:retry"),
});

// Offline songs in a folder of the user's choice (see fsBridge.ts).
contextBridge.exposeInMainWorld("youtifyFs", {
  defaultDir: () => ipcRenderer.invoke("youtify:fs:default"),
  choose: (current?: string) => ipcRenderer.invoke("youtify:fs:choose", current),
  write: (dir: string, name: string, bytes: Uint8Array) => ipcRenderer.invoke("youtify:fs:write", dir, name, bytes),
  read: (dir: string, name: string) => ipcRenderer.invoke("youtify:fs:read", dir, name),
  remove: (dir: string, name: string) => ipcRenderer.invoke("youtify:fs:delete", dir, name),
  check: (dir: string) => ipcRenderer.invoke("youtify:fs:check", dir),
});
contextBridge.exposeInMainWorld("youtifyJam", {
  start: (port?: number) => ipcRenderer.invoke("youtify:jam:start", port),
  stop: () => ipcRenderer.invoke("youtify:jam:stop"),
  respond: (r: unknown) => ipcRenderer.invoke("youtify:jam:respond", r),
  call: (req: unknown) => ipcRenderer.invoke("youtify:jam:call", req),
  onRequest: (cb: (req: unknown) => void) => {
    const listener = (_e: unknown, req: unknown) => cb(req);
    ipcRenderer.on("youtify:jam:request", listener);
    return () => ipcRenderer.removeListener("youtify:jam:request", listener);
  },
});
