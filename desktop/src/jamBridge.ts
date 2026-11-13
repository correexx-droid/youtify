import { ipcMain, type WebContents } from "electron";
import http from "node:http";
import os from "node:os";

/**
 * Jam sessions (web/src/lib/jam.ts): a small HTTP server in the local network. Each request goes to the page,
 * which answers it (the page checks the session PIN). Guests in YoutiFy also send their calls through here, so
 * the page doesn't run into mixed-content or CORS rules.
 */

let server: http.Server | null = null;
let page: WebContents | null = null;
let nextId = 1;
const waiting = new Map<number, (r: { status: number; type: string; body: string }) => void>();

function localIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out;
}

function stop() {
  server?.close();
  server = null;
  for (const done of waiting.values()) done({ status: 503, type: "text/plain", body: "stopped" });
  waiting.clear();
}

function listen(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Cache-Control": "no-store",
      };
      if (req.method === "OPTIONS") {
        res.writeHead(204, headers).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 64 * 1024) req.destroy();
        else chunks.push(c);
      });
      req.on("end", () => {
        if (!page || page.isDestroyed()) {
          res.writeHead(503, headers).end("stopped");
          return;
        }
        const rid = nextId++;
        const timer = setTimeout(() => waiting.get(rid)?.({ status: 503, type: "text/plain", body: "busy" }), 15_000);
        waiting.set(rid, (r) => {
          clearTimeout(timer);
          waiting.delete(rid);
          res.writeHead(r.status, { ...headers, "Content-Type": `${r.type}; charset=utf-8` }).end(r.body);
        });
        page.send("youtify:jam:request", {
          rid: String(rid),
          method: req.method ?? "GET",
          url: req.url ?? "/",
          body: Buffer.concat(chunks).toString("utf8"),
          remote: req.socket.remoteAddress ?? "",
        });
      });
    });
    s.once("error", reject);
    s.listen(port, "0.0.0.0", () => resolve(s));
  });
}

export function registerJamBridge() {
  ipcMain.handle("youtify:jam:start", async (event, first: number = 4190) => {
    stop();
    page = event.sender;
    for (let port = first; port < first + 10; port++) {
      try {
        server = await listen(port);
        return { port, ips: localIps() };
      } catch {
        /* port taken: next one */
      }
    }
    throw new Error("No free port");
  });
  ipcMain.handle("youtify:jam:stop", () => stop());
  ipcMain.handle("youtify:jam:respond", (_e, r: { rid: string; status: number; type: string; body: string }) => {
    waiting.get(Number(r.rid))?.(r);
  });
  // A guest's call to another YoutiFy in the network: only plain http to local addresses.
  ipcMain.handle("youtify:jam:call", async (_e, req: { url: string; method: string; body?: string }) => {
    const u = new URL(req.url);
    if (u.protocol !== "http:" || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(u.hostname)) throw new Error("not a local address");
    const r = await fetch(u, {
      method: req.method,
      body: req.body,
      headers: req.body ? { "Content-Type": "application/json" } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return { status: r.status, body: await r.text() };
  });
}
