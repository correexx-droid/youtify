import { Capacitor } from "@capacitor/core";

/**
 * Where offline songs live. Each saved song remembers its store, so songs can stay where they are when the user
 * picks a new place (or be moved there).
 *
 *   "app"  inside the app (IndexedDB), private, everywhere
 *   "doc"  Android: Documents/YoutiFy, visible in the file manager
 *   "ext"  Android: the app's folder on the device storage (Android/data/…/files/YoutiFy)
 *   "dir:<path>"  PC programs: any folder the user chose
 */

export type StoreId = "app" | "doc" | "ext" | `dir:${string}`;

export interface FileStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | undefined>;
  remove(id: string): Promise<void>;
}

interface PcFs {
  defaultDir(): Promise<string>;
  choose(current?: string): Promise<string | null>;
  write(dir: string, name: string, bytes: Uint8Array): Promise<void>;
  read(dir: string, name: string): Promise<Uint8Array | null>;
  remove(dir: string, name: string): Promise<void>;
  check(dir: string): Promise<boolean>;
}

/** The PC programs' folder bridge (desktop/src/fsBridge.ts, phone/src/fsBridge.ts). */
export const pcFs = (globalThis as { youtifyFs?: PcFs }).youtifyFs ?? null;
export const isAndroid = Capacitor.getPlatform() === "android";

const fileName = (id: string) => `${id}.ytfy`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function androidStore(kind: "doc" | "ext"): Promise<FileStore> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const directory = kind === "doc" ? Directory.Documents : Directory.External;
  const path = (id: string) => `YoutiFy/${fileName(id)}`;
  return {
    put: async (id, bytes) => {
      await Filesystem.writeFile({ path: path(id), data: toBase64(bytes), directory, recursive: true });
    },
    get: async (id) => {
      try {
        const { data } = await Filesystem.readFile({ path: path(id), directory });
        return typeof data === "string" ? fromBase64(data) : new Uint8Array(await (data as Blob).arrayBuffer());
      } catch {
        return undefined;
      }
    },
    remove: async (id) => {
      await Filesystem.deleteFile({ path: path(id), directory }).catch(() => {});
    },
  };
}

function folderStore(dir: string): FileStore {
  if (!pcFs) throw new Error("no folder access here");
  return {
    put: (id, bytes) => pcFs.write(dir, fileName(id), bytes),
    get: async (id) => (await pcFs.read(dir, fileName(id))) ?? undefined,
    remove: (id) => pcFs.remove(dir, fileName(id)),
  };
}

/** Stores other than "app" (IndexedDB, handled by the offline store itself). */
export async function externalStore(id: StoreId): Promise<FileStore> {
  if (id === "doc" || id === "ext") return androidStore(id);
  if (id.startsWith("dir:")) return folderStore(id.slice(4));
  throw new Error(`unknown store ${id}`);
}

/** Which places this platform offers. */
export function availableStores(): ("app" | "doc" | "ext" | "dir")[] {
  if (isAndroid) return ["app", "doc", "ext"];
  if (pcFs) return ["app", "dir"];
  return ["app"];
}

/** Readable location, e.g. "/storage/emulated/0/Documents/YoutiFy" or "C:\Users\…\Music\YoutiFy". */
export async function describeStore(id: StoreId): Promise<string | null> {
  if (id.startsWith("dir:")) return id.slice(4);
  if (id === "doc" || id === "ext") {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { uri } = await Filesystem.getUri({ path: "YoutiFy", directory: id === "doc" ? Directory.Documents : Directory.External });
      return decodeURIComponent(uri.replace(/^file:\/\//, ""));
    } catch {
      return null;
    }
  }
  return null;
}

/** Android before 11 asks for storage permission before writing to Documents. */
export async function prepareStore(id: StoreId): Promise<boolean> {
  if (id === "doc") {
    try {
      const { Filesystem } = await import("@capacitor/filesystem");
      const st = await Filesystem.checkPermissions();
      if (st.publicStorage !== "granted") {
        const r = await Filesystem.requestPermissions();
        if (r.publicStorage !== "granted") return false;
      }
    } catch {
      /* newer Android: no permission needed for the app's own files */
    }
  }
  if (id.startsWith("dir:") && pcFs) return pcFs.check(id.slice(4));
  return true;
}
