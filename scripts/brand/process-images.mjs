// Grades and compresses the generated illustrations into apps/web/public/img.
// The grade pulls saturation down and lifts nothing: the site is dark and the
// pictures should sit inside it, not glow on top of it.
// Usage: node scripts/brand/process-images.mjs
import { createRequire } from 'node:module';
import { statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('C:/Users/windr/github/marketing-monorepo/node_modules/sharp');

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, 'raw');
const OUT = join(HERE, '..', '..', 'apps', 'web', 'public', 'img');
mkdirSync(OUT, { recursive: true });

const grade = (img, { sat = 0.86, bright = 0.94 } = {}) =>
  img.modulate({ saturation: sat, brightness: bright }).linear(1.04, -4);

async function emit(pipeline, name, { webp = 72, jpg = 0 } = {}) {
  const results = [];
  const w = join(OUT, `${name}.webp`);
  await pipeline.clone().webp({ quality: webp, effort: 6 }).toFile(w);
  results.push([w, statSync(w).size]);
  if (jpg) {
    const j = join(OUT, `${name}.jpg`);
    await pipeline.clone().jpeg({ quality: jpg, mozjpeg: true, progressive: true }).toFile(j);
    results.push([j, statSync(j).size]);
  }
  for (const [file, size] of results) console.log(`${file.split(/[\/]/).pop().padEnd(24)} ${(size / 1024).toFixed(0)} KB`);
}

// Hero, wide. The source is 2752 x 1536; the bee sits in the right third.
const hero = sharp(join(RAW, 'hero.png'));
await emit(grade(hero.clone()).resize({ width: 2000 }), 'hero-bee-wide', { webp: 68, jpg: 74 });

// Hero, tall 4:5 crop around the bee for phones.
await emit(
  grade(hero.clone().extract({ left: 1360, top: 0, width: 1229, height: 1536 })).resize({ width: 900 }),
  'hero-bee-tall',
  { webp: 70 },
);

// Section art: the bench.
await emit(grade(sharp(join(RAW, 'bench.png')), { sat: 0.82, bright: 0.9 }).resize({ width: 1600 }), 'lab-bench', { webp: 70 });

// Background texture: comb. Darker still; it only ever sits behind text.
await emit(grade(sharp(join(RAW, 'texture.png')), { sat: 0.8, bright: 0.8 }).resize({ width: 1600 }), 'comb-texture', { webp: 64 });
