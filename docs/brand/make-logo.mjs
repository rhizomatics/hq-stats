#!/usr/bin/env node
// Builds the hq-stats logo from the HQ icon: the HQ mark, smaller, with "stats" beneath in the same binary style
// (a 1 is a bar with a flag, a 0 an outline) in teal, the HQ mark's own accent and the complement of its orange.
//
//   node docs/brand/make-logo.mjs <path to HQ's icon.svg> > docs/brand/logo.svg
//
// Deterministic: the same icon gives the same logo.
import { readFileSync } from "node:fs";

const [iconPath] = process.argv.slice(2);
if (!iconPath) {
  console.error("usage: make-logo.mjs <hq icon.svg>");
  process.exit(1);
}
const icon = readFileSync(iconPath, "utf8");
// Everything inside the icon except its title and background square.
const mark = icon
  .replace(/^[\s\S]*?<rect width="512"[^>]*\/>\n?/, "")
  .replace(/<\/svg>\s*$/, "")
  .trim();

const NAVY = "#1f2b40";
const GRID = "#2c3d5c";
const TEAL = "#4fb3a9";

// Lower-case "stats" on a 3x5 grid.
const GLYPHS = {
  s: ["111", "100", "111", "001", "111"],
  t: ["010", "111", "010", "010", "011"],
  a: ["111", "001", "111", "101", "111"],
};

// The HQ icon's digit cell is 17 x 21; "stats" uses the same proportions, a little smaller.
const scale = 0.8;
const cw = 17 * scale;
const ch = 21 * scale;
const word = "stats";
const cols = word.length * 4 - 1;
const x0 = (512 - cols * cw) / 2;
const y0 = 356;

// Which digit each lit cell shows: a fixed bit pattern, so the logo is stable.
const BITS = "1011001110100101110010110100111010011011";
const out = [];
let n = 0;
word.split("").forEach((letter, i) => {
  GLYPHS[letter].forEach((row, r) => {
    row.split("").forEach((on, c) => {
      if (on !== "1") return;
      const x = x0 + (i * 4 + c) * cw;
      const y = y0 + r * ch;
      const f = (v) => v.toFixed(1);
      out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(cw + 0.5)}" height="${f(ch + 0.5)}" fill="${GRID}"/>`);
      if (BITS[n++ % BITS.length] === "1") {
        out.push(
          `<rect x="${f(x + 5.9 * scale)}" y="${f(y + 3 * scale)}" width="${f(5.4 * scale)}" height="${f(15 * scale)}" fill="${TEAL}" opacity="0.95"/>`,
        );
        out.push(
          `<rect x="${f(x + 2.5 * scale)}" y="${f(y + 3 * scale)}" width="${f(4.4 * scale)}" height="${f(4.4 * scale)}" fill="${TEAL}" opacity="0.95"/>`,
        );
      } else {
        out.push(
          `<ellipse cx="${f(x + 8.5 * scale)}" cy="${f(y + 10.5 * scale)}" rx="${f(2.9 * scale)}" ry="${f(5.9 * scale)}" fill="none" stroke="${TEAL}" stroke-width="${f(3.2 * scale)}" opacity="0.55"/>`,
        );
      }
    });
  });
});

// The HQ mark spans roughly x 86-420, y 9-442; scaled to sit above the word.
const s = 0.7;
const tx = 256 - ((86 + 420) / 2) * s;
const ty = 22 - 9 * s;
console.log(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<title>hq stats</title>
<rect width="512" height="512" rx="96" fill="${NAVY}"/>
<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s})">
${mark}
</g>
${out.join("\n")}
</svg>`);
