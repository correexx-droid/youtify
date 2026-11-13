// Gives the app the same network access it has on Android (see main.ts): hooks the app's build already looks for.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__musikeTransport", (req: unknown) => ipcRenderer.invoke("youtify:net", req));
contextBridge.exposeInMainWorld("__musikeFetchBytes", (req: unknown) => ipcRenderer.invoke("youtify:bytes", req));
contextBridge.exposeInMainWorld("youtifyShell", { platform: process.platform });
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
