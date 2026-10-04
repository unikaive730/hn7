// Renders PNG fallbacks of the SVG mark: favicon-32, apple-touch-icon (180,
// on the night background, because iOS fills transparency with black), and
// 192/512 for the web manifest.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('C:/Users/windr/github/marketing-monorepo/node_modules/sharp');
const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web', 'public');
const svg = readFileSync(join(PUB, 'favicon.svg'));
const NIGHT = { r: 10, g: 10, b: 15, alpha: 1 };

async function plain(size, name) {
  await sharp(svg, { density: 1200 }).resize(size, size).png().toFile(join(PUB, name));
}
async function onNight(size, name, pad = 0.18) {
  const inner = Math.round(size * (1 - pad * 2));
  const mark = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: NIGHT } })
    .composite([{ input: mark, gravity: 'center' }]).png().toFile(join(PUB, name));
}
await plain(32, 'favicon-32.png');
await onNight(180, 'apple-touch-icon.png', 0.14);
await onNight(192, 'icon-192.png', 0.16);
await onNight(512, 'icon-512.png', 0.16);
console.log('icons written');
