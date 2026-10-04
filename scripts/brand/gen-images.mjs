// Generates the illustration set for the site with Gemini image generation.
// Usage: node scripts/brand/gen-images.mjs <job> [<job> ...]
// Writes raw PNGs to scripts/brand/raw/ and appends one line per call to
// scripts/brand/raw/calls.log, so the total spend can be counted afterwards.
// The key is read from the marketing-monorepo env file and never printed.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, 'raw');
mkdirSync(RAW, { recursive: true });
const LOG = join(RAW, 'calls.log');
const MAX_CALLS = 8;

const envText = readFileSync('C:/Users/windr/github/marketing-monorepo/apps/api/.env.local', 'utf8');
const KEY = envText.split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='))
  ?.slice('GEMINI_API_KEY='.length).replace(/^["']|["']$/g, '').trim();
if (!KEY) throw new Error('GEMINI_API_KEY not found');

const MODEL = 'gemini-3.1-flash-image-preview';

const PHOTO = 'Realistic documentary nature photography, natural light only, muted and slightly desaturated colours, deep blacks, fine film grain, a little lens softness at the edges, not glossy, not oversaturated, no HDR look. No text, no letters, no numbers, no watermark, no logos, no people, no faces.';

const JOBS = {
  hero: {
    aspect: '16:9',
    size: '2K',
    prompt: `Macro photograph of one western honey bee (Apis mellifera) resting on a small pale flower at dusk, seen in side profile. The bee sits in the right third of the frame; the left half of the frame is dark, an out-of-focus background of deep blue-black with a few soft warm bokeh dots. Low warm amber rim light from behind outlines the fine hairs of the thorax and the edges of the translucent wings. Anatomically correct honey bee: exactly six legs, two pairs of wings folded flat over the striped abdomen, two elbowed antennae, two compound eyes. Shot on a 100mm macro lens at f/4, shallow depth of field, the eye and thorax sharp. ${PHOTO}`,
  },
  heroTall: {
    aspect: '4:5',
    size: '1K',
    prompt: `Macro photograph of one western honey bee (Apis mellifera) resting on a small pale flower at dusk, seen in three-quarter side profile, placed in the upper half of the frame. The lower third of the frame is dark, an out-of-focus background of deep blue-black. Low warm amber rim light from behind outlines the fine hairs of the thorax and the edges of the translucent wings. Anatomically correct honey bee: exactly six legs, two pairs of wings folded flat over the striped abdomen, two elbowed antennae. Shot on a 100mm macro lens at f/4, shallow depth of field. ${PHOTO}`,
  },
  bench: {
    aspect: '16:9',
    size: '1K',
    prompt: `Low-light photograph of a honey bee research laboratory bench at night. In the background a wooden hive frame with capped beeswax comb leans against the wall; on the bench a rack of small glass vials, a multichannel pipette lying on its side, and a clear plastic 96-well plate. A single warm desk lamp throws an amber pool of light across part of the bench; the rest of the room falls into deep blue shadow. 35mm lens, shallow depth of field, slightly messy and lived-in, as a working lab is. Nothing has any writing or labels on it. ${PHOTO}`,
  },
  texture: {
    aspect: '16:9',
    size: '1K',
    prompt: `Very dark abstract close-up of old beeswax honeycomb, mostly near-black, with deep amber and brown tones only where faint light grazes the cell walls. Some cells are empty, some partly filled with dark honey, edges uneven and irregular as real comb is. Low contrast overall, large areas of almost pure black, no focal point, suitable as a quiet background behind text. Raking light from the top left. ${PHOTO}`,
  },
};

const used = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0;
const jobs = process.argv.slice(2);
if (!jobs.length) throw new Error(`name a job: ${Object.keys(JOBS).join(', ')}`);
if (used + jobs.length > MAX_CALLS) throw new Error(`call cap: ${used} used, ${jobs.length} requested, cap ${MAX_CALLS}`);

await Promise.all(jobs.map(async (name, i) => {
  const job = JOBS[name.split('#')[0]];
  if (!job) throw new Error(`unknown job ${name}`);
  const started = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: job.prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: job.aspect, imageSize: job.size },
      },
    }),
  });
  const stamp = new Date().toISOString();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    appendFileSync(LOG, `${stamp}\t${name}\t${job.size}\tHTTP ${res.status}\n`);
    console.log(`FAIL ${name}: HTTP ${res.status} ${err?.error?.message?.slice(0, 160) ?? ''}`);
    return;
  }
  const data = await res.json();
  const part = (data?.candidates?.[0]?.content?.parts ?? []).find((p) => p?.inlineData?.data);
  const tag = name.replace('#', '_');
  if (!part) {
    appendFileSync(LOG, `${stamp}\t${name}\t${job.size}\tno image\n`);
    console.log(`FAIL ${name}: no image (${data?.promptFeedback?.blockReason ?? data?.candidates?.[0]?.finishReason ?? '-'})`);
    return;
  }
  const out = join(RAW, `${tag}.png`);
  writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
  const usage = data?.usageMetadata ?? {};
  appendFileSync(LOG, `${stamp}\t${name}\t${job.size}\tok\t${usage.candidatesTokenCount ?? '?'} out tokens\n`);
  console.log(`OK ${name} -> ${out} (${Math.round((Date.now() - started) / 1000)}s, ${usage.candidatesTokenCount ?? '?'} output tokens)`);
}));
