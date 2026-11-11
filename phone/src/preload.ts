// Gives the app the same network access it has on Android (see main.ts): hooks the app's build already looks for.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__musikeTransport", (req: unknown) => ipcRenderer.invoke("youtify:net", req));
contextBridge.exposeInMainWorld("__musikeFetchBytes", (req: unknown) => ipcRenderer.invoke("youtify:bytes", req));
contextBridge.exposeInMainWorld("youtifyShell", { platform: process.platform });
