import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Crosshair } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Every dated molecule in ApisTox on one map of fingerprint space.
 *
 *  Data: GET /api/space (lab/beeguard/structures.py). Coordinates are t-SNE on
 *  1 - Tanimoto between the same Morgan fingerprints the model trains on, so
 *  the map shows what the model can and cannot see. Distances on a t-SNE map
 *  are not to scale; every similarity number below is computed on the
 *  fingerprints, not read off the picture.
 */

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
  return response.json();
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const COLORS = {
  train: 'rgba(232,232,239,0.22)',
  pool: 'rgba(251,191,36,0.78)',
  toxic: 'rgba(251,113,133,0.78)',
  safe: 'rgba(52,211,153,0.55)',
  ring: '#fbbf24',
};

const MODES = [
  { id: 'split', label: 'Time split' },
  { id: 'toxicity', label: 'Bee toxicity' },
];

/** A few CIDs are shared by two different molecules in ApisTox; those rows carry
 *  their SMILES so the drawing matches the point. */
function structureUrl(point, size, scaffold = false) {
  const tail = `size=${size}${scaffold ? '&scaffold=true' : ''}`;
  return point.smiles
    ? `/api/structure/smiles.svg?smiles=${encodeURIComponent(point.smiles)}&${tail}`
    : `/api/structure/${point.cid}.svg?${tail}`;
}

function fill(point, mode) {
  if (mode === 'toxicity') return point.label === 'toxic' ? COLORS.toxic : COLORS.safe;
  return point.split === 'pool' ? COLORS.pool : COLORS.train;
}

export default function ChemicalSpace({ cutoffYear = 2000 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('split');
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    getJSON(`/api/space?cutoff_year=${cutoffYear}`)
      .then((payload) => alive && setData(payload))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [cutoffYear]);

  const targets = useMemo(
    () => (data?.points ?? []).filter((p) => p.is_target).sort((a, b) => a.year - b.year),
    [data],
  );

  // Start pinned on the answer furthest from anything in the training set,
  // so the side panel opens on a structure instead of an empty prompt.
  useEffect(() => {
    if (!targets.length) return;
    const far = targets.reduce((a, b) => (b.nn_train_tanimoto < a.nn_train_tanimoto ? b : a));
    setPinned(far);
  }, [targets]);

  const focus = hovered ?? pinned;
  const sim = data?.nearest_known_similarity;

  return (
    <section className="relative">
      <header className="max-w-3xl">
        <div className="font-mono text-[11px] text-hive-400/80">
          Chemical space
        </div>
        <h3 className="font-serif-display mt-2 text-[1.4rem] leading-tight text-wax sm:text-[1.8rem]">
          {data
            ? `Where the ${data.counts.targets} answers sit among ${data.counts.points.toLocaleString('en-US')} molecules`
            : 'Where the answers sit'}
        </h3>
        {sim && <Reading sim={sim} cutoff={data.cutoff_year} />}
      </header>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Could not load the map: {error}
        </div>
      )}

      {!data && !error && (
        <div className="mt-6 aspect-square w-full animate-pulse rounded-xl bg-white/[0.03] sm:aspect-[16/10]" />
      )}

      {data && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-md border border-white/10 p-0.5" role="tablist">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={mode === m.id}
                    onClick={() => setMode(m.id)}
                    className={`rounded px-3 py-1.5 text-xs transition ${
                      mode === m.id ? 'bg-white/10 text-white/90' : 'text-white/45 hover:text-white/75'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[10.5px] text-white/30">
                {data.counts.train} dated ≤{data.cutoff_year} · {data.counts.pool} after ·{' '}
                {data.counts.targets} answers
              </span>
            </div>

            <MapCanvas
              points={data.points}
              mode={mode}
              focus={focus}
              onHover={setHovered}
              onPin={setPinned}
            />
            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-white/30">
              {data.method}. The axes have no units. Close points share substructure, but
              long distances on the map are not to scale.
            </p>
          </div>

          <aside className="space-y-4">
            <Legend mode={mode} cutoff={data.cutoff_year} counts={data.counts} />
            <Detail point={focus} cutoff={data.cutoff_year} pinned={!hovered && !!pinned} />
            <div>
              <div className="mb-2 font-mono text-[10px] text-white/35">
                Hidden answers, by year
              </div>
              <div className="flex flex-wrap gap-1.5">
                {targets.map((t) => (
                  <button
                    key={t.id}
                    onMouseEnter={() => setHovered(t)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(t)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setPinned(t)}
                    className={`max-w-[9.5rem] truncate rounded border px-2 py-1 text-[11px] transition ${
                      focus?.id === t.id
                        ? 'border-hive-400/60 bg-hive-400/10 text-white/90'
                        : t.seen_scaffold
                          ? 'border-white/10 text-white/55 hover:border-white/25'
                          : 'border-hive-400/25 text-hive-200/80 hover:border-hive-400/50'
                    }`}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {data && <SimilarityHistogram points={data.points} sim={sim} cutoff={data.cutoff_year} />}
    </section>
  );
}

/** One computed sentence about the map, from the fingerprint similarities. */
function Reading({ sim, cutoff }) {
  const pu = sim.pool_unseen_scaffold;
  const ps = sim.pool_seen_scaffold;
  const tu = sim.targets_unseen_scaffold;
  const ts = sim.targets_seen_scaffold;
  // Gaps are taken from the two-decimal medians on screen so the sentence adds up.
  const two = (v) => Number(v.toFixed(2));
  const poolGap = two(ps.median) - two(pu.median);
  const answerGap = two(ts.median) - two(tu.median);
  return (
    <p className="mt-3 text-[15px] leading-relaxed text-white/55">
      For each molecule dated after {cutoff} we took the Tanimoto similarity to its closest
      training molecule. If its scaffold is missing from the training set, the median is{' '}
      <span className="text-hive-400">{pu.median.toFixed(2)}</span> (n={pu.n}). If the scaffold
      is already there, it is <span className="text-white/85">{ps.median.toFixed(2)}</span>{' '}
      (n={ps.n}). The hidden answers barely split this way: {tu.median.toFixed(2)} on new
      scaffolds (n={tu.n}) and {ts.median.toFixed(2)} on known ones (n={ts.n}), a gap of{' '}
      {answerGap.toFixed(2)} where the whole pool shows {poolGap.toFixed(2)}.
    </p>
  );
}

function MapCanvas({ points, mode, focus, onHover, onPin }) {
  const box = useRef(null);
  const width = useWidth(box);
  const height = width < 640 ? width : Math.round(width * 0.66);
  const [hoverPos, setHoverPos] = useState(null);

  const scale = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const pad = 14;
    const sx = (width - 2 * pad) / (x1 - x0 || 1);
    const sy = (height - 2 * pad) / (y1 - y0 || 1);
    return {
      x: (v) => pad + (v - x0) * sx,
      y: (v) => height - pad - (v - y0) * sy,
    };
  }, [points, width, height]);

  const r = Math.min(Math.max(width / 260, 1.8), 3.3);

  // Draw order: training set, then pool, then the answers on top.
  const layer = useMemo(() => {
    if (!width) return null;
    const order = [
      ...points.filter((p) => p.split === 'train'),
      ...points.filter((p) => p.split === 'pool' && !p.is_target),
    ];
    return order.map((p) => (
      <circle
        key={p.id}
        cx={scale.x(p.x)}
        cy={scale.y(p.y)}
        r={p.split === 'train' ? r * 0.85 : r}
        fill={fill(p, mode)}
      />
    ));
  }, [points, mode, scale, r, width]);

  const answers = useMemo(() => points.filter((p) => p.is_target), [points]);

  const nearest = useCallback(
    (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      let best = null;
      let bestD = 18 * 18;
      for (const p of points) {
        const dx = scale.x(p.x) - mx;
        const dy = scale.y(p.y) - my;
        // answers win ties so they are easy to land on
        const d = dx * dx + dy * dy - (p.is_target ? 30 : 0);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    },
    [points, scale],
  );

  const handleMove = (event) => {
    const p = nearest(event);
    onHover(p);
    setHoverPos(p ? { x: scale.x(p.x), y: scale.y(p.y) } : null);
  };

  const fx = focus ? scale.x(focus.x) : null;
  const fy = focus ? scale.y(focus.y) : null;

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-xl border border-white/[0.07] bg-[radial-gradient(ellipse_at_center,rgba(28,28,39,0.9),rgba(10,10,15,1))]"
      style={{ height: height || undefined, minHeight: 240 }}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block touch-none"
          onPointerMove={handleMove}
          onPointerDown={(event) => {
            const p = nearest(event);
            onPin(p);
            onHover(p);
          }}
          onPointerLeave={() => {
            onHover(null);
            setHoverPos(null);
          }}
          role="img"
          aria-label="t-SNE map of ApisTox molecules"
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <g key={f} stroke="rgba(255,255,255,0.035)">
              <line x1={width * f} x2={width * f} y1={0} y2={height} />
              <line x1={0} x2={width} y1={height * f} y2={height * f} />
            </g>
          ))}

          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            {layer}
          </motion.g>

          {answers.map((p, i) => (
            <motion.g
              key={p.id}
              initial={{ opacity: 0, scale: 2.2 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.5 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: `${scale.x(p.x)}px ${scale.y(p.y)}px` }}
            >
              {!p.seen_scaffold && (
                <circle
                  cx={scale.x(p.x)}
                  cy={scale.y(p.y)}
                  r={r + 7.5}
                  fill="none"
                  stroke="rgba(251,191,36,0.35)"
                  strokeWidth={1}
                />
              )}
              <circle
                cx={scale.x(p.x)}
                cy={scale.y(p.y)}
                r={r + 4}
                fill="none"
                stroke={COLORS.ring}
                strokeWidth={1.5}
              />
              <circle cx={scale.x(p.x)} cy={scale.y(p.y)} r={r + 0.6} fill={fill(p, mode)} />
            </motion.g>
          ))}

          {focus && (
            <g pointerEvents="none">
              <line x1={fx} x2={fx} y1={0} y2={height} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 4" />
              <line x1={0} x2={width} y1={fy} y2={fy} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 4" />
              <circle cx={fx} cy={fy} r={r + 10} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1} />
            </g>
          )}

          <text x={10} y={height - 10} className="fill-white/20 font-mono" fontSize={10}>
            t-SNE 1 →
          </text>
          <text
            x={12}
            y={12}
            className="fill-white/20 font-mono"
            fontSize={10}
            transform={`rotate(90 12 12)`}
          >
            t-SNE 2 →
          </text>
        </svg>
      )}

      <AnimatePresence>
        {focus && hoverPos && (
          <motion.div
            key={focus.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute z-10 w-40 rounded-lg border border-white/10 bg-night-800/95 p-2 shadow-xl backdrop-blur"
            style={{
              left: Math.min(Math.max(hoverPos.x + 14, 6), width - 166),
              top: hoverPos.y > height - 190 ? Math.max(hoverPos.y - 196, 6) : hoverPos.y + 14,
            }}
          >
            <img
              src={structureUrl(focus, 150)}
              alt=""
              className="mx-auto block h-[8.5rem] w-[8.5rem]"
            />
            <div className="mt-1 truncate text-[11px] font-medium text-white/90">{focus.name}</div>
            <div className="font-mono text-[10px] text-white/40">
              {focus.year} · {focus.label}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Swatch({ color, ring, double, small }) {
  const size = small ? 6 : 8;
  return (
    <svg width={22} height={22} className="shrink-0" aria-hidden>
      {double && <circle cx={11} cy={11} r={10} fill="none" stroke="rgba(251,191,36,0.35)" />}
      {ring && <circle cx={11} cy={11} r={7} fill="none" stroke={COLORS.ring} strokeWidth={1.5} />}
      <circle cx={11} cy={11} r={size / 2} fill={color} />
    </svg>
  );
}

function Legend({ mode, cutoff, counts }) {
  const rows =
    mode === 'split'
      ? [
          { color: COLORS.train, label: `dated ${cutoff} or earlier, used for training`, n: counts.train, small: true },
          { color: COLORS.pool, label: `dated after ${cutoff}, the pool to order`, n: counts.pool },
        ]
      : [
          { color: COLORS.toxic, label: 'toxic to honey bees', n: counts.toxic },
          { color: COLORS.safe, label: 'non-toxic', n: counts.points - counts.toxic },
        ];
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.015] p-3">
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-[12px] text-white/60">
            <Swatch color={row.color} small={row.small} />
            <span className="flex-1">{row.label}</span>
            <span className="tabular font-mono text-[11px] text-white/35">{row.n}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-[12px] text-white/60">
          <Swatch color="transparent" ring />
          <span className="flex-1">hidden answer</span>
          <span className="tabular font-mono text-[11px] text-white/35">{counts.targets}</span>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-white/60">
          <Swatch color="transparent" ring double />
          <span className="flex-1">answer on a new scaffold</span>
        </div>
      </div>
    </div>
  );
}

function Detail({ point, cutoff, pinned }) {
  if (!point) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-white/10 px-3 py-4 text-[12px] text-white/40">
        <Crosshair className="h-4 w-4 shrink-0 text-white/30" />
        Point at or tap a molecule to see its structure.
      </div>
    );
  }
  const inPool = point.split === 'pool';
  return (
    <div className="rounded-lg border border-white/[0.07] bg-night-800/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white/90" title={point.name}>
            {point.name}
          </div>
          <div className="font-mono text-[10.5px] text-white/35">CID {point.cid}</div>
        </div>
        {pinned && (
          <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-white/40">
            pinned
          </span>
        )}
      </div>
      <img
        src={structureUrl(point, 220, true)}
        alt={`2D structure of ${point.name}`}
        className="mx-auto mt-1 block aspect-square w-full max-w-[13rem]"
      />
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
        <Field k="ApisTox year" v={point.year} />
        <Field k="bee toxicity" v={point.label} tone={point.label === 'toxic' ? 'text-warn' : 'text-signal'} />
        <Field k="set" v={inPool ? `after ${cutoff}` : `training`} />
        <Field k="insecticide" v={point.insecticide ? 'yes' : 'no'} />
        {inPool && <Field k="scaffold" v={point.seen_scaffold ? 'known' : 'new'} />}
        {inPool && <Field k="nearest known" v={point.nn_train_tanimoto?.toFixed(2)} />}
      </dl>
      {point.is_target && (
        <div className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] text-hive-400">
          Hidden answer: dated after {cutoff}, an insecticide, and non-toxic to honey bees in
          ApisTox.
        </div>
      )}
    </div>
  );
}

function Field({ k, v, tone = 'text-white/80' }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-white/30">{k}</dt>
      <dd className={`tabular ${tone}`}>{v ?? 'n/a'}</dd>
    </div>
  );
}

/** How close each post-cutoff molecule is to its nearest pre-cutoff relative,
 *  split by whether its scaffold existed before. Answers stacked on top. */
function SimilarityHistogram({ points, sim, cutoff }) {
  const bins = useMemo(() => {
    const width = 0.05;
    const rows = Array.from({ length: 20 }, (_, i) => ({
      bin: (i * width).toFixed(2),
      known: 0,
      fresh: 0,
      answers: 0,
    }));
    for (const p of points) {
      if (p.split !== 'pool' || p.nn_train_tanimoto == null) continue;
      const i = Math.min(Math.floor(p.nn_train_tanimoto / width), 19);
      if (p.is_target) rows[i].answers += 1;
      else if (p.seen_scaffold) rows[i].known += 1;
      else rows[i].fresh += 1;
    }
    return rows;
  }, [points]);

  return (
    <div className="mt-8 grid gap-6 border-t border-white/8 pt-6 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
      <div className="min-w-0">
        <div className="font-mono text-[10px] text-white/35">
          Nearest molecule dated {cutoff} or earlier, Tanimoto similarity
        </div>
        <div className="mt-3 h-52 w-full">
          <ResponsiveContainer>
            <BarChart data={bins} margin={{ top: 4, right: 4, bottom: 0, left: -26 }} barCategoryGap={1}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="bin"
                stroke="rgba(255,255,255,0.3)"
                tick={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                interval={3}
              />
              <YAxis
                stroke="rgba(255,255,255,0.3)"
                tick={{ fontSize: 10 }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{
                  background: '#12121a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(value) => `similarity ${value} to ${(Number(value) + 0.05).toFixed(2)}`}
                formatter={(value, name) => [
                  value,
                  { known: 'known scaffold', fresh: 'new scaffold', answers: 'hidden answers' }[name] ?? name,
                ]}
              />
              <Bar dataKey="known" stackId="s" fill="rgba(232,232,239,0.28)" isAnimationActive={false} />
              <Bar
                dataKey="fresh"
                stackId="s"
                fill="rgba(251,191,36,0.10)"
                stroke="rgba(251,191,36,0.55)"
                strokeWidth={1}
                isAnimationActive={false}
              />
              <Bar dataKey="answers" stackId="s" fill="#fbbf24" animationDuration={700} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-2.5 self-end text-[12px] leading-relaxed text-white/50">
        <Median label="known scaffold" q={sim.pool_seen_scaffold} swatch="rgba(232,232,239,0.5)" />
        <Median label="new scaffold" q={sim.pool_unseen_scaffold} swatch="rgba(251,191,36,0.18)" outline />
        <Median label="answers, known scaffold" q={sim.targets_seen_scaffold} swatch="#fbbf24" />
        <Median label="answers, new scaffold" q={sim.targets_unseen_scaffold} swatch="#fbbf24" />
        <p className="pt-1 text-[11px] text-white/35">
          Median, then the 25th to 75th percentile, for each group. The bars count all{' '}
          {sim.pool_all.n} molecules dated after {cutoff} once each. A value of 1.00 would mean
          the training set holds the same fingerprint.
        </p>
      </div>
    </div>
  );
}

function Median({ label, q, swatch, outline }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="mt-1 inline-block h-2 w-2 shrink-0 rounded-sm"
        style={{ background: swatch, border: outline ? '1px solid rgba(251,191,36,0.6)' : undefined }}
      />
      <span className="flex-1">
        {label} <span className="font-mono text-[10.5px] text-white/30">n={q.n}</span>
      </span>
      <span className="tabular font-mono text-white/80">{q.median.toFixed(2)}</span>
      <span className="tabular font-mono text-[10.5px] text-white/30">
        {q.q25.toFixed(2)}-{q.q75.toFixed(2)}
      </span>
    </div>
  );
}
