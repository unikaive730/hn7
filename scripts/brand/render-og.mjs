// Renders the 1200x630 share card to apps/web/public/og.png.
// The numbers are read from lab/data/derived/brand_numbers.json, which
//   PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.brand
// writes by running the lab (facts + model run at budget 30 + full pool order).
// Nothing on the card is typed in by hand.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/windr/github/marketing-monorepo/node_modules/puppeteer');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const numbers = JSON.parse(readFileSync(join(ROOT, 'lab/data/derived/brand_numbers.json'), 'utf8'));
const { facts, run, order } = numbers;
const bee = pathToFileURL(join(ROOT, 'apps/web/public/img/hero-bee-wide.jpg')).href;
const mark = readFileSync(join(ROOT, 'apps/web/public/favicon.svg'), 'utf8');

const n = order.length;
const ticks = order
  .map((a) => {
    if (!a.is_target) return `<rect x="${a.position - 0.75}" y="28" width="0.5" height="8" fill="rgba(239,230,207,0.28)"/>`;
    const cap = a.scaffold_seen ? '' : `<rect x="${a.position - 0.85}" y="3" width="0.7" height="4" fill="#fb7185"/>`;
    return `<rect x="${a.position - 0.85}" y="9" width="0.7" height="27" fill="#fbbf24"/>${cap}`;
  })
  .join('');
const last = run.found_at[run.found_at.length - 1];
const pct = (p) => `${(p / n) * 100}%`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;background:#07070b;color:#efe6cf;font-family:'Instrument Sans',sans-serif;-webkit-font-smoothing:antialiased}
  .bg{position:absolute;inset:0;background:url('${bee}') no-repeat;background-size:auto 104%;background-position:right -36px center}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,#07070b 0%,rgba(7,7,11,.94) 34%,rgba(7,7,11,.4) 55%,rgba(7,7,11,0) 70%),linear-gradient(0deg,rgba(7,7,11,.85) 0%,rgba(7,7,11,0) 30%)}
  .grain{position:absolute;inset:0;opacity:.14;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 1.4 -0.2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .wrap{position:absolute;left:64px;top:52px;width:640px}
  .eyebrow{display:flex;align-items:center;gap:10px;font-family:'JetBrains Mono',monospace;font-size:15px;color:#fbbf24}
  .eyebrow svg{width:24px;height:24px}
  .eyebrow span{color:rgba(239,230,207,.5)}
  h1{font-family:'Newsreader',serif;font-optical-sizing:auto;font-variation-settings:'opsz' 72;font-weight:400;font-size:92px;line-height:.95;letter-spacing:-.022em;margin-top:18px}
  .line{margin-top:16px;font-size:22px;line-height:1.4;color:rgba(239,230,207,.74);max-width:600px}
  .stats{display:flex;gap:34px;margin-top:30px}
  .stat b{display:block;font-family:'Newsreader',serif;font-variation-settings:'opsz' 72;font-weight:400;font-size:50px;line-height:1;color:#fbbf24;font-variant-numeric:lining-nums tabular-nums}
  .stat b.warn{color:#fb7185}
  .stat small{display:block;margin-top:6px;font-size:14px;line-height:1.3;color:rgba(239,230,207,.62);max-width:170px}
  .strip{position:absolute;left:64px;bottom:44px;width:640px}
  .labels{position:relative;height:16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:rgba(239,230,207,.5)}
  .labels span{position:absolute;top:0;white-space:nowrap}
  svg.tape{display:block;width:640px;height:44px}
  .foot{position:absolute;right:40px;bottom:24px;font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(239,230,207,.42)}
</style></head><body>
<div class="bg"></div><div class="shade"></div><div class="grain"></div>
<div class="wrap">
  <div class="eyebrow">${mark}Retrospective test <span>· knowledge cut at ${facts.cutoff_year}</span></div>
  <h1>BeeGuard Lab</h1>
  <p class="line">Agents that know only the chemistry published up to ${facts.cutoff_year} choose which newer insecticides to test on honey bees first.</p>
  <div class="stats">
    <div class="stat"><b>${run.found}/${run.targets_total}</b><small>later bee-safe insecticides found in the first ${run.budget} assays</small></div>
    <div class="stat"><b>${run.speedup}×</b><small>fewer assays than random order, which needs ${run.random_assays_for_same_hits}</small></div>
    <div class="stat"><b class="warn">${facts.targets_on_unseen_scaffolds}/${facts.targets}</b><small>on scaffolds no molecule known by ${facts.cutoff_year} had</small></div>
  </div>
</div>
<div class="strip">
  <div class="labels"><span style="left:0">first ${run.budget} assays · last find at ${last}</span><span style="left:${pct(run.random_assays_for_same_hits)};transform:translateX(-100%);padding-right:6px">random needs ${run.random_assays_for_same_hits}</span></div>
  <svg class="tape" viewBox="0 0 ${n} 40" preserveAspectRatio="none">
    <rect x="0" y="0" width="${run.budget}" height="40" fill="rgba(251,191,36,0.09)"/>${ticks}
    <line x1="${run.random_assays_for_same_hits - 0.5}" x2="${run.random_assays_for_same_hits - 0.5}" y1="0" y2="40" stroke="rgba(239,230,207,.6)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
  </svg>
  <div class="labels" style="margin-top:4px"><span style="left:0">1</span><span style="right:0">${n} molecules after ${facts.cutoff_year}, in test order</span></div>
</div>
<div class="foot">ApisTox (CC BY-NC 4.0) · illustration generated with Gemini</div>
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
const tmp = join(ROOT, 'scripts/brand/raw/og.html');
writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));
const out = join(ROOT, 'apps/web/public/og.png');
const shot = await page.screenshot({ type: 'png' });
const sharp = require('C:/Users/windr/github/marketing-monorepo/node_modules/sharp');
await sharp(shot).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(out);
await browser.close();
console.log(`wrote ${out} from brand_numbers.json computed_at ${numbers.computed_at}`);
