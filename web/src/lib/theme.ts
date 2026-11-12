/**
 * Colour worlds: the whole design (background, surfaces, lines, text tints, glow) tinted in one hue, for the dark
 * and the light theme. Purple is YoutiFy's own and lives in styles.css; any other colour is generated here.
 */

type Hsl = [number, number, number];

function toHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

const hsl = (h: number, s: number, l: number, a?: number) =>
  `hsl(${Math.round(h)} ${Math.round(s)}% ${l.toFixed(1)}%${a === undefined ? "" : ` / ${a}`})`;

/** CSS for the theme variables in the hue of `hex`. Selectors outrank styles.css whatever the load order. */
export function themeCss(hex: string): string {
  const [h, sat] = toHsl(hex);
  // Strong colours give a clearly tinted dark; grey-ish ones (graphite) stay calm.
  const s = Math.min(sat, 80);
  const tint = s * 0.55;
  const dark = [
    `--bg:${hsl(h, tint, 4.5)}`,
    `--surface-1:${hsl(h, tint, 7.5)}`,
    `--surface-2:${hsl(h, tint, 10)}`,
    `--surface-3:${hsl(h, tint * 0.9, 15)}`,
    `--surface-4:${hsl(h, tint * 0.85, 21)}`,
    `--line:${hsl(h, s, 80, 0.09)}`,
    `--line-strong:${hsl(h, s, 80, 0.17)}`,
    `--fg:${hsl(h, s * 0.5, 96)}`,
    `--fg-2:${hsl(h, s * 0.22, 72)}`,
    `--fg-3:${hsl(h, s * 0.15, 52)}`,
    `--highlight:${hsl(h, s, 90, 0.07)}`,
    `--scrim:${hsl(h, tint, 3, 0.74)}`,
    `--glow-1:${hsl(h, Math.max(s, 20), 55, s < 15 ? 0.14 : 0.3)}`,
    `--glow-2:${hsl(h + 40, Math.max(s, 20), 58, s < 15 ? 0.08 : 0.15)}`,
    `--glass:${hsl(h, tint, 7, 0.66)}`,
    `--glass-core:${hsl(h, tint, 10, 0.62)}`,
  ].join(";");
  const light = [
    `--bg:${hsl(h, s * 0.6, 94)}`,
    `--surface-1:#ffffff`,
    `--surface-2:${hsl(h, s * 0.7, 97.5)}`,
    `--surface-3:${hsl(h, s * 0.55, 93)}`,
    `--surface-4:${hsl(h, s * 0.45, 87)}`,
    `--line:${hsl(h, s, 22, 0.09)}`,
    `--line-strong:${hsl(h, s, 22, 0.16)}`,
    `--fg:${hsl(h, s * 0.45, 10)}`,
    `--fg-2:${hsl(h, s * 0.2, 36)}`,
    `--fg-3:${hsl(h, s * 0.14, 52)}`,
    `--glow-1:${hsl(h, Math.max(s, 20), 60, 0.22)}`,
    `--glow-2:${hsl(h + 40, Math.max(s, 20), 60, 0.12)}`,
    `--glass:rgb(255 255 255 / 0.72)`,
    `--glass-core:${hsl(h, s * 0.6, 98, 0.7)}`,
  ].join(";");
  return `html:root,html[data-theme="dark"]{${dark}}html[data-theme="light"]{${light}}`;
}

/** Dark background in the hue, for the browser/status bar colour. */
export function themeBg(hex: string): string {
  const [h, sat] = toHsl(hex);
  return hsl(h, Math.min(sat, 80) * 0.55, 4.5);
}
