// Bundles the main process and the preload script of YoutiFy Mobile into dist/.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "dist"), { recursive: true });
for (const [entry, out] of [
  ["main.ts", "main.cjs"],
  ["preload.ts", "preload.cjs"],
]) {
  await build({
    entryPoints: [path.join(root, "src", entry)],
    outfile: path.join(root, "dist", out),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    logLevel: "warning",
  });
}
