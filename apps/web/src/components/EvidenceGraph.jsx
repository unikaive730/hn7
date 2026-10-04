import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Network, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* Literature around the thirteen hidden answers.
 *
 * Everything drawn here comes from /api/evidence/graph and
 * /api/evidence/timeline, which serve a saved literature fetch
 * (lab/data/derived/evidence_graph.json). The index used (OpenAlex, or Europe
 * PMC when OpenAlex refuses), the fetch time and the request counts are shown
 * in the header; the re-fetch button asks the API to query again.
 */

const AMBER = '#fbbf24';
const EARLY = '#fb7185';
const LATE = '#d4d4dc';
const TIMELINE_COLORS = {
  molecules: AMBER,
  molecules_bee: '#fde68a',
  'c:neonicotinoid': '#7dd3fc',
  'c:pollinator': '#5eead4',
  'c:bee_acute': '#c4b5fd',
  'c:selectivity': '#a1a1aa',
};
// Identity is never colour alone: each concept line also carries its own dash.
const TIMELINE_DASH = {
  molecules_bee: '4 3',
  'c:neonicotinoid': '7 3',
  'c:pollinator': '2 3',
  'c:bee_acute': '9 3 2 3',
  'c:selectivity': '1 3',
};
const SHORT_CONCEPT = {
  'c:neonicotinoid': 'neonics',
  'c:pollinator': 'pollinator',
  'c:bee_acute': 'bee acute',
  'c:selectivity': 'selectivity',
};
const TIP_STYLE = {
  background: '#12121a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

const fmt = (n) => (n == null ? 'n/a' : Number(n).toLocaleString('en-US'));

function shortDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`;
}

/* ------------------------------------------------------------------ layout */

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small force simulation: molecules held on a ring, concepts near the
 *  middle, papers pulled toward whatever returned them or mentions them.
 *  Deterministic, so the picture is the same on every load. */
export function computeLayout(data, width) {
  const small = width < 640;
  const W = width;
  const H = small ? Math.round(width * 1.12) : Math.round(Math.min(720, width * 0.88));
  const cx = W / 2;
  const cy = H / 2;
  const R = small ? W * 0.39 : Math.min(W / 2 - 150, H / 2 - 46);
  const rand = seeded(11);

  const nodes = [];
  const byId = new Map();
  const add = (node) => {
    nodes.push(node);
    byId.set(node.id, node);
  };

  const molecules = [...data.molecules].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  molecules.forEach((m, i) => {
    const angle = -Math.PI / 2 + (i / molecules.length) * Math.PI * 2;
    add({
      id: m.id,
      kind: 'molecule',
      ref: m,
      angle,
      r: small ? 11 : 14,
      mass: 5,
      q: 4,
      x: cx + R * Math.cos(angle),
      y: cy + R * Math.sin(angle),
    });
  });
  data.concepts.forEach((c, i) => {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    add({
      id: c.id,
      kind: 'concept',
      ref: c,
      r: small ? 7 : 9,
      mass: 4,
      q: 3,
      x: cx + R * 0.4 * Math.cos(angle),
      y: cy + R * 0.4 * Math.sin(angle),
    });
  });
  data.papers.forEach((p) => {
    const home = byId.get(p.found_by[0]) ?? { x: cx, y: cy };
    const r = Math.min(small ? 6 : 8, 2 + 1.35 * Math.log10((p.cited_by ?? 0) + 1));
    add({
      id: p.id,
      kind: 'paper',
      ref: p,
      r,
      mass: 1,
      q: 1,
      x: home.x + (rand() - 0.5) * 50 + (cx - home.x) * 0.15,
      y: home.y + (rand() - 0.5) * 50 + (cy - home.y) * 0.15,
    });
  });

  const links = data.edges
    .map((e) => ({ s: byId.get(e.source), t: byId.get(e.target), kind: e.kind }))
    .filter((l) => l.s && l.t);

  for (const n of nodes) {
    n.vx = 0;
    n.vy = 0;
  }

  const steps = 320;
  const repel = small ? 120 : 220;
  const queryLength = small ? 24 : 34;
  for (let step = 0; step < steps; step += 1) {
    const alpha = 0.08 + 0.92 * (1 - step / steps);

    for (const l of links) {
      const dx = l.t.x - l.s.x;
      const dy = l.t.y - l.s.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const rest = l.kind === 'query' ? queryLength + l.s.r + l.t.r : R * 0.75;
      const k = l.kind === 'query' ? 0.06 : 0.006;
      const f = (d - rest) * k * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      l.s.vx += fx / l.s.mass;
      l.s.vy += fy / l.s.mass;
      l.t.vx -= fx / l.t.mass;
      l.t.vy -= fy / l.t.mass;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > 160 * 160) continue;
        const d = Math.sqrt(d2);
        let f = (repel * alpha * (a.q + b.q)) / Math.max(d2, 36);
        const gap = a.r + b.r + 3;
        if (d < gap) f += (gap - d) * 0.5;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx / a.mass;
        a.vy -= fy / a.mass;
        b.vx += fx / b.mass;
        b.vy += fy / b.mass;
      }
    }

    for (const n of nodes) {
      const dx = n.x - cx;
      const dy = n.y - cy;
      const d = Math.hypot(dx, dy) || 0.01;
      if (n.kind === 'molecule') {
        const pull = (R - d) * 0.12;
        n.vx += (dx / d) * pull;
        n.vy += (dy / d) * pull;
        n.vx += (cx + R * Math.cos(n.angle) - n.x) * 0.02;
        n.vy += (cy + R * Math.sin(n.angle) - n.y) * 0.02;
      } else if (n.kind === 'concept') {
        const pull = (R * 0.4 - d) * 0.08;
        n.vx += (dx / d) * pull;
        n.vy += (dy / d) * pull;
      } else {
        n.vx -= dx * 0.0025 * alpha;
        n.vy -= dy * 0.0025 * alpha;
      }
      n.vx *= 0.62;
      n.vy *= 0.62;
      n.x += Math.max(-12, Math.min(12, n.vx));
      n.y += Math.max(-12, Math.min(12, n.vy));
      const pad = n.r + 4;
      n.x = Math.max(pad, Math.min(W - pad, n.x));
      n.y = Math.max(pad, Math.min(H - pad, n.y));
    }
  }

  return { W, H, cx, cy, R, small, nodes, links, byId };
}

function hexPath(x, y, r) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(`${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const update = () => {
      const w = ref.current?.clientWidth ?? 0;
      setWidth((prev) => (Math.abs(prev - w) >= 4 ? w : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* ------------------------------------------------------------------- graph */

function GraphCanvas({ data, selected, onSelect, pinned, onPin }) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const layout = useMemo(() => (width ? computeLayout(data, width) : null), [data, width]);

  const focus = useMemo(() => {
    if (!layout || !selected) return null;
    const keep = new Set([selected]);
    const papers = new Set();
    for (const l of layout.links) {
      if (l.t.id === selected) papers.add(l.s.id);
    }
    for (const l of layout.links) {
      if (papers.has(l.s.id)) {
        keep.add(l.s.id);
        keep.add(l.t.id);
      }
    }
    return keep;
  }, [layout, selected]);

  const tipNode = layout && (hover ?? pinned) ? layout.byId.get(hover ?? pinned) : null;
  const cutoff = data.cutoff_year;

  return (
    <div ref={wrapRef} className="relative w-full">
      {layout && (
        <svg
          width={layout.W}
          height={layout.H}
          viewBox={`0 0 ${layout.W} ${layout.H}`}
          className="block select-none"
          role="img"
          aria-label="Graph of the hidden-answer molecules, background concepts and the papers that mention them"
          onClick={(e) => {
            if (e.target === e.currentTarget) onPin(null);
          }}
        >
          <style>{'@keyframes egIn{from{opacity:0}to{opacity:1}}'}</style>
          <circle
            cx={layout.cx}
            cy={layout.cy}
            r={layout.R}
            fill="none"
            stroke="rgba(251,191,36,0.10)"
            strokeDasharray="2 5"
          />
          <circle
            cx={layout.cx}
            cy={layout.cy}
            r={layout.R * 0.4}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
          />

          <g>
            {layout.links.map((l, i) => {
              const lit = focus ? focus.has(l.s.id) && focus.has(l.t.id) : false;
              const dim = focus && !lit;
              return (
                <line
                  key={i}
                  x1={l.s.x}
                  y1={l.s.y}
                  x2={l.t.x}
                  y2={l.t.y}
                  stroke={l.kind === 'text' ? AMBER : '#ffffff'}
                  strokeOpacity={
                    dim ? 0.05 : lit ? (l.kind === 'text' ? 0.65 : 0.45) : l.kind === 'text' ? 0.22 : 0.1
                  }
                  strokeWidth={lit ? 1.1 : 0.8}
                  strokeDasharray={l.kind === 'text' ? '3 3' : undefined}
                />
              );
            })}
          </g>

          <g>
            {layout.nodes
              .filter((n) => n.kind === 'paper')
              .map((n) => {
                const p = n.ref;
                const early = !p.after_cutoff;
                const dim = focus && !focus.has(n.id);
                const active = (hover ?? pinned) === n.id;
                return (
                  <g
                    key={n.id}
                    opacity={dim ? 0.3 : 1}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPin(pinned === n.id ? null : n.id);
                    }}
                  >
                    <g
                      style={{
                        animation: 'egIn 0.7s ease-out both',
                        animationDelay: `${(Math.hypot(n.x - layout.cx, n.y - layout.cy) / layout.R) * 0.45}s`,
                      }}
                    >
                    <circle cx={n.x} cy={n.y} r={Math.max(n.r + 5, 9)} fill="transparent" />
                    {p.mentions_bees && (
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r + 2.2}
                        fill="none"
                        stroke={AMBER}
                        strokeOpacity={0.7}
                        strokeWidth={0.9}
                      />
                    )}
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill={early ? EARLY : LATE}
                      fillOpacity={early ? 0.95 : 0.62}
                      stroke={active ? '#fff' : 'none'}
                      strokeWidth={1.2}
                    />
                    </g>
                  </g>
                );
              })}
          </g>

          <g>
            {layout.nodes
              .filter((n) => n.kind === 'concept')
              .map((n) => {
                const dim = focus && !focus.has(n.id);
                const text = SHORT_CONCEPT[n.id] ?? n.ref.label;
                const half = (text.length * (layout.small ? 6.2 : 6.9)) / 2;
                const lx = Math.max(half + 2, Math.min(layout.W - half - 2, n.x));
                return (
                  <g key={n.id} opacity={dim ? 0.4 : 1}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill="#0a0a0f"
                      stroke="rgba(255,255,255,0.65)"
                      strokeWidth={1.2}
                    />
                    <circle cx={n.x} cy={n.y} r={2} fill="rgba(255,255,255,0.65)" />
                    <text
                      x={lx}
                      y={n.y + n.r + 12}
                      textAnchor="middle"
                      stroke="#0a0a0f"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="font-mono"
                      fontSize={layout.small ? 8.5 : 9.5}
                      letterSpacing="0.06em"
                      fill="rgba(255,255,255,0.55)"
                      style={{ textTransform: 'uppercase', pointerEvents: 'none' }}
                    >
                      {text}
                    </text>
                  </g>
                );
              })}
          </g>

          <g>
            {layout.nodes
              .filter((n) => n.kind === 'molecule')
              .map((n) => {
                const m = n.ref;
                const isSel = selected === n.id;
                const dim = focus && !focus.has(n.id);
                const ux = (n.x - layout.cx) / (Math.hypot(n.x - layout.cx, n.y - layout.cy) || 1);
                const uy = (n.y - layout.cy) / (Math.hypot(n.x - layout.cx, n.y - layout.cy) || 1);
                const showLabel = !layout.small || isSel;
                const labelW = m.label.length * 6.4;
                let anchor = Math.abs(ux) < 0.25 ? 'middle' : ux > 0 ? 'start' : 'end';
                let lx = n.x + ux * (n.r + 8);
                const ly = n.y + uy * (n.r + 8) + 4;
                if (anchor === 'start' && lx + labelW > layout.W - 2) {
                  anchor = 'end';
                  lx = n.x - n.r - 8;
                } else if (anchor === 'end' && lx - labelW < 2) {
                  anchor = 'start';
                  lx = n.x + n.r + 8;
                } else if (anchor === 'middle') {
                  lx = Math.max(labelW / 2 + 2, Math.min(layout.W - labelW / 2 - 2, lx));
                }
                return (
                  <g
                    key={n.id}
                    opacity={dim ? 0.5 : 1}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(n.id);
                    }}
                  >
                    <path
                      d={hexPath(n.x, n.y, n.r + 6)}
                      fill="transparent"
                      stroke={isSel ? 'rgba(251,191,36,0.35)' : 'none'}
                    />
                    <path
                      d={hexPath(n.x, n.y, n.r)}
                      fill={isSel ? AMBER : '#1c1c27'}
                      stroke={AMBER}
                      strokeWidth={1.3}
                    />
                    <text
                      x={n.x}
                      y={n.y + 3.6}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize={layout.small ? 9 : 10}
                      fontWeight={600}
                      fill={isSel ? '#0a0a0f' : AMBER}
                      style={{ pointerEvents: 'none' }}
                    >
                      {m.rank}
                    </text>
                    {showLabel && (
                      <text
                        x={lx}
                        y={ly}
                        textAnchor={anchor}
                        fontSize={11.5}
                        fill={isSel ? AMBER : 'rgba(255,255,255,0.72)'}
                        stroke="#0a0a0f"
                        strokeWidth={3}
                        paintOrder="stroke"
                        style={{ pointerEvents: 'none' }}
                      >
                        {m.label}
                      </text>
                    )}
                  </g>
                );
              })}
          </g>
        </svg>
      )}

      <AnimatePresence>
        {tipNode?.kind === 'paper' && (
          <motion.div
            key={tipNode.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-auto absolute z-10 w-64 rounded-md border border-white/10 bg-night-800/95 p-2.5 cap shadow-xl backdrop-blur"
            style={{
              left: Math.min(Math.max(tipNode.x - 128, 4), (layout?.W ?? 300) - 260),
              top: tipNode.y > (layout?.H ?? 0) * 0.6 ? tipNode.y - 118 : tipNode.y + 14,
            }}
          >
            <div className="flex items-baseline gap-2 font-mono cap-sm text-white/40">
              <span style={{ color: tipNode.ref.after_cutoff ? undefined : EARLY }}>
                {tipNode.ref.year ?? 'no year'}
              </span>
              <span>cited {fmt(tipNode.ref.cited_by)}</span>
              {tipNode.ref.mentions_bees && <span className="text-hive-400">bee terms</span>}
            </div>
            <div className="mt-1 line-clamp-3 leading-snug text-white/85">{tipNode.ref.title}</div>
            {tipNode.ref.venue && (
              <div className="mt-1 truncate text-white/60">{tipNode.ref.venue}</div>
            )}
            {tipNode.ref.doi && pinned === tipNode.id && (
              <a
                href={`https://doi.org/${tipNode.ref.doi}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-hive-400"
              >
                doi.org/{tipNode.ref.doi.slice(0, 26)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {pinned !== tipNode.id && (
              <div className="mt-1.5 text-white/55">click to pin</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono cap-sm text-white/40 sm:absolute sm:bottom-1 sm:left-1 sm:mt-0">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d={hexPath(6, 6, 5)} fill="#1c1c27" stroke={AMBER} />
          </svg>
          molecule, lab rank
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4.5" fill="none" stroke="rgba(255,255,255,0.65)" />
          </svg>
          concept
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: EARLY }} />
          paper dated {cutoff} or earlier
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: LATE, opacity: 0.6 }} />
          after {cutoff}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: AMBER }} />
          mentions bees
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="4">
            <line x1="0" y1="2" x2="16" y2="2" stroke={AMBER} strokeDasharray="3 2" />
          </svg>
          name in text
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ detail panel */

function YearBars({ molecule, cutoff }) {
  const all = molecule.all?.by_year ?? {};
  const bee = molecule.bee?.by_year ?? {};
  const years = Object.keys(all).map(Number);
  const last = years.length ? Math.max(...years) : cutoff + 1;
  const first = 1990;
  const rows = [];
  for (let y = first; y <= last; y += 1) {
    const a = all[y] ?? 0;
    const b = Math.min(bee[y] ?? 0, a);
    rows.push({ year: y, bee: b, other: a - b });
  }
  const older = years.filter((y) => y < first).reduce((s, y) => s + all[y], 0);

  return (
    <div>
      <div className="h-36 w-full">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: -28 }} barCategoryGap={1}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TIP_STYLE}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              labelFormatter={(y) => `${y}`}
              formatter={(value, name) => [value, name === 'bee' ? 'with bee terms' : 'other mentions']}
            />
            <ReferenceLine
              x={cutoff}
              stroke={EARLY}
              strokeDasharray="3 3"
              label={{ value: `cutoff ${cutoff}`, position: 'insideTopLeft', fill: EARLY, fontSize: 9 }}
            />
            <Bar dataKey="other" stackId="a" fill="rgba(212,212,220,0.32)" isAnimationActive={false} />
            <Bar dataKey="bee" stackId="a" fill={AMBER} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {older > 0 && (
        <p className="mt-1 font-mono cap-sm text-white/55">
          {older} record{older > 1 ? 's' : ''} dated before {first} not drawn
        </p>
      )}
    </div>
  );
}

function PaperRow({ paper, moleculeId, strict = false }) {
  const named = paper.title_mentions?.includes(moleculeId);
  return (
    <li className="group grid grid-cols-[2.6rem_1fr] gap-x-2 border-t border-white/5 py-2 first:border-t-0">
      <span
        className="font-mono cap tabular"
        style={{ color: paper.after_cutoff ? 'rgba(255,255,255,0.5)' : EARLY }}
      >
        {paper.year ?? '----'}
      </span>
      <div className="min-w-0">
        {paper.doi ? (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 text-[12.5px] leading-snug text-white/80 decoration-white/20 underline-offset-2 hover:underline"
          >
            {paper.title}
          </a>
        ) : (
          <span className="line-clamp-2 text-[12.5px] leading-snug text-white/80">{paper.title}</span>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono cap-sm text-white/60">
          <span className="truncate">{paper.venue ?? 'no venue listed'}</span>
          <span>cited {fmt(paper.cited_by)}</span>
          {moleculeId && (
            <span className={named ? 'text-white/55' : strict ? 'text-warn/85' : 'text-white/60'}>
              {named ? 'name in title' : strict ? 'abstract match only' : 'name in abstract'}
            </span>
          )}
          {paper.mentions_bees && <span className="text-hive-400/90">bee terms</span>}
        </div>
      </div>
    </li>
  );
}

function MoleculeDetail({ data, molecule, papersById }) {
  const [tab, setTab] = useState('cited');
  const lit = data.literature?.name ?? 'the index';
  const cutoff = data.cutoff_year;
  useEffect(() => setTab('cited'), [molecule?.id]);
  if (!molecule) return null;

  const early = molecule.early_paper_ids.map((id) => papersById.get(id)).filter(Boolean);
  const cited = molecule.top_paper_ids.map((id) => papersById.get(id)).filter(Boolean);
  const list = tab === 'early' ? early : cited;
  const a = molecule.all ?? {};
  const b = molecule.bee ?? {};

  return (
    <motion.div
      key={molecule.id}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full flex-col"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-right">
          <div className="font-mono cap-sm uppercase tracking-widest text-white/55">rank</div>
          <div className="font-mono text-3xl font-semibold leading-none text-hive-400 tabular">
            {molecule.rank}
          </div>
          <div className="mt-0.5 font-mono cap-sm text-white/55">of {data.lab.pool_size}</div>
        </div>
        <div className="min-w-0 border-l border-white/8 pl-3">
          <h3 className="truncate text-lg font-medium text-white/95">{molecule.label}</h3>
          <p className="mt-0.5 font-mono cap-sm text-white/40">
            CID {molecule.cid} · in ApisTox from {molecule.apistox_year} ·{' '}
            {molecule.scaffold_seen ? 'scaffold seen before' : 'scaffold new to the model'}
          </p>
          <p className="mt-0.5 font-mono cap-sm text-white/55">
            query {molecule.query} ({molecule.term_from})
          </p>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-white/60">
        Lab rank {molecule.rank} of {data.lab.pool_size}, from data that stops at {cutoff}. {lit}{' '}
        lists {a.before ? fmt(a.before) : 'no'} record{a.before === 1 ? '' : 's'} naming it dated{' '}
        {cutoff} or earlier
        {b.before ? `, ${b.before} of them with bee terms` : ''}.{' '}
        {b.first_year
          ? `The first record that names it together with bees is from ${b.first_year}.`
          : `None of its ${fmt(a.total ?? 0)} records names bees.`}
      </p>

      <div className="mt-3 grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-3">
        <div className="rounded-md border border-white/6 bg-black/20 p-1">
          <img
            src={`/api/evidence/structure/${molecule.cid}`}
            alt={`2D structure of ${molecule.label}`}
            className="aspect-[7/5] w-full object-contain"
            loading="lazy"
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono cap">
          <div>
            <dt className="cap-sm uppercase tracking-wider text-white/55">by {cutoff}</dt>
            <dd className="text-xl tabular" style={{ color: a.before ? EARLY : 'rgba(255,255,255,0.85)' }}>
              {fmt(a.before)}
            </dd>
          </div>
          <div>
            <dt className="cap-sm uppercase tracking-wider text-white/55">after</dt>
            <dd className="text-xl tabular text-white/85">{fmt(a.after)}</dd>
          </div>
          <div>
            <dt className="cap-sm uppercase tracking-wider text-white/55">bee, by {cutoff}</dt>
            <dd className="tabular text-white/70">{fmt(b.before)}</dd>
          </div>
          <div>
            <dt className="cap-sm uppercase tracking-wider text-white/55">bee, after</dt>
            <dd className="tabular text-hive-400">{fmt(b.after)}</dd>
          </div>
          <div className="col-span-2 cap-sm text-white/60">
            first bee record: {b.first_year ?? 'none'}
          </div>
        </dl>
      </div>

      <div className="mt-3">
        <YearBars molecule={molecule} cutoff={cutoff} />
      </div>

      <div className="mt-3 flex items-center gap-3 border-b border-white/8 cap">
        {[
          ['cited', `most cited (${cited.length})`],
          ['early', `dated by ${cutoff} (${early.length} of ${fmt(a.before)})`],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            disabled={id === 'early' && !early.length}
            className={`tap-y -mb-px border-b px-0.5 pb-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
              tab === id ? 'border-hive-400 text-white/85' : 'border-transparent text-white/40 hover:text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="mt-1 max-h-64 overflow-y-auto pr-1">
        {list.map((p) => (
          <PaperRow key={p.id} paper={p} moleculeId={molecule.id} strict={tab === 'early'} />
        ))}
        {!list.length && (
          <li className="py-3 text-[12px] text-white/40">{lit} returned no records for this query.</li>
        )}
      </ul>
      {tab === 'early' && (
        <p className="mt-2 cap leading-relaxed text-white/60">
          {lit} matched these on title or abstract. Where the title does not name the
          molecule, open the record before trusting the date: indexes sometimes attach a later
          abstract to an old entry.
        </p>
      )}
    </motion.div>
  );
}

function ConceptDetail({ data, concept, papersById }) {
  const cited = concept.top_paper_ids.map((id) => papersById.get(id)).filter(Boolean);
  return (
    <motion.div key={concept.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
      <div className="font-mono cap-sm uppercase tracking-widest text-white/55">concept</div>
      <h3 className="mt-1 text-lg font-medium text-white/95">{concept.label}</h3>
      <p className="mt-1 font-mono cap-sm text-white/60">query {concept.query}</p>
      <div className="mt-3 flex gap-6 font-mono">
        <div>
          <div className="cap-sm uppercase tracking-wider text-white/55">by {data.cutoff_year}</div>
          <div className="text-xl tabular text-white/85">{fmt(concept.before)}</div>
        </div>
        <div>
          <div className="cap-sm uppercase tracking-wider text-white/55">after</div>
          <div className="text-xl tabular text-white/85">{fmt(concept.after)}</div>
        </div>
      </div>
      <ul className="mt-3">
        {cited.map((p) => (
          <PaperRow key={p.id} paper={p} />
        ))}
      </ul>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- lag rows */

function LagRows({ data, selected, onSelect }) {
  const cutoff = data.cutoff_year;
  const rows = [...data.molecules].sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9));
  const max = Math.max(1, ...rows.map((m) => Math.max(m.all?.before ?? 0, m.all?.after ?? 0)));
  const scale = (n) => (n > 0 ? Math.max(1.5, (n / max) * 100) : 0);
  const suspect = (m) => m.bee?.first_year != null && m.bee.first_year < m.apistox_year - 10;
  const flagged = rows.filter(suspect).map((m) => m.label);
  const cols =
    'grid-cols-[1.5rem_minmax(0,6rem)_minmax(0,1fr)_minmax(0,1.35fr)] sm:grid-cols-[2rem_9rem_minmax(0,1fr)_minmax(0,1.35fr)_3.2rem]';

  return (
    <div>
      <div className={`grid ${cols} items-end gap-x-2 border-b border-white/8 pb-1.5 font-mono cap-sm uppercase tracking-wider text-white/55`}>
        <span>rank</span>
        <span>molecule</span>
        <span>by {cutoff}</span>
        <span className="text-right">
          after <span className="text-hive-400/80">· bee</span>
        </span>
        <span className="hidden text-right sm:block">1st bee</span>
      </div>
      <ul>
        {rows.map((m) => {
          const a = m.all ?? {};
          const b = m.bee ?? {};
          const isSel = selected === m.id;
          return (
            <li key={m.id}>
              <button
                onClick={() => onSelect(m.id)}
                className={`grid w-full ${cols} items-center gap-x-2 border-b border-white/[0.04] py-1.5 text-left transition ${
                  isSel ? 'bg-hive-400/[0.07]' : 'hover:bg-white/[0.025]'
                }`}
              >
                <span className={`font-mono cap tabular ${isSel ? 'text-hive-400' : 'text-white/45'}`}>
                  {m.rank}
                </span>
                <span className={`truncate text-[12px] ${isSel ? 'text-white' : 'text-white/75'}`}>
                  {m.label}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-6 shrink-0 font-mono cap-sm tabular"
                    style={{ color: a.before ? EARLY : 'rgba(255,255,255,0.3)' }}
                  >
                    {fmt(a.before)}
                  </span>
                  <span className="relative h-2.5 min-w-0 flex-1">
                    <span
                      className="absolute right-0 h-full rounded-l-sm"
                      style={{ width: `${scale(a.before)}%`, background: EARLY, opacity: 0.85 }}
                    />
                  </span>
                </span>
                <span className="flex items-center gap-1.5 border-l border-white/20">
                  <span className="relative h-2.5 min-w-0 flex-1">
                    <span
                      className="absolute left-0 h-full rounded-r-sm bg-white/30"
                      style={{ width: `${scale(a.after)}%` }}
                    />
                  </span>
                  <span className="w-[4.4rem] shrink-0 whitespace-nowrap text-right font-mono cap-sm tabular text-white/80">
                    {fmt(a.after)}
                    <span className={b.after > 0 ? 'text-hive-400' : 'text-white/50'}> · {fmt(b.after)}</span>
                  </span>
                </span>
                <span className="hidden text-right font-mono cap-sm tabular text-white/45 sm:block">
                  {b.first_year ?? 'none'}
                  {suspect(m) && <span className="text-warn">?</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono cap-sm leading-relaxed text-white/55">
        Bars are log scale. Amber count: records that also name bees or pollinators.
        {flagged.length > 0 &&
          ` ? marks a first bee record more than 10 years older than the molecule's ApisTox entry (${flagged.join(', ')}); its "dated by ${cutoff}" list shows which record that is.`}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- timeline */

function Timeline({ timeline, cutoff }) {
  const [hidden, setHidden] = useState(() => new Set(['molecules_bee']));
  const from = 1980;
  const lastFull = useMemo(() => {
    const y = new Date(timeline.fetched_at).getUTCFullYear();
    return Number.isFinite(y) ? y : null;
  }, [timeline.fetched_at]);

  const { rows, omitted } = useMemo(() => {
    const ids = timeline.series.map((s) => s.id);
    const out = [];
    const skipped = {};
    for (const row of timeline.rows) {
      if (row.year < from) {
        for (const id of ids) if (row[id]) skipped[id] = (skipped[id] ?? 0) + row[id];
        continue;
      }
      const r = { year: row.year };
      for (const id of ids) r[id] = row[id] > 0 ? row[id] : null;
      out.push(r);
    }
    return { rows: out, omitted: skipped };
  }, [timeline]);

  const omittedText = Object.entries(omitted)
    .map(([id, n]) => `${timeline.series.find((s) => s.id === id)?.label ?? id} ${fmt(n)}`)
    .join(', ');

  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="year"
              type="number"
              domain={[from, 'dataMax']}
              tick={{ fontSize: 9.5, fill: 'rgba(255,255,255,0.35)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              ticks={[1980, 1990, 2000, 2010, 2020]}
            />
            <YAxis
              scale="log"
              domain={[1, 'dataMax']}
              allowDataOverflow
              tick={{ fontSize: 9.5, fill: 'rgba(255,255,255,0.35)' }}
              tickLine={false}
              axisLine={false}
              ticks={[1, 10, 100, 1000]}
            />
            <Tooltip
              contentStyle={TIP_STYLE}
              labelFormatter={(y) => `${y}${y === lastFull ? ' (partial year)' : ''}`}
              formatter={(value, id) => [
                fmt(value),
                timeline.series.find((s) => s.id === id)?.label ?? id,
              ]}
            />
            <ReferenceLine x={cutoff} stroke={EARLY} strokeDasharray="3 3" />
            {timeline.series
              .filter((s) => !hidden.has(s.id))
              .map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  type="linear"
                  stroke={TIMELINE_COLORS[s.id] ?? '#fff'}
                  strokeWidth={s.id === 'molecules' ? 2.2 : 1.2}
                  strokeOpacity={s.id.startsWith('molecules') ? 1 : 0.75}
                  strokeDasharray={TIMELINE_DASH[s.id]}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 space-y-1">
        {timeline.series.map((s) => {
          const off = hidden.has(s.id);
          return (
            <li key={s.id}>
              <button
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
                className={`flex w-full items-baseline gap-2 text-left cap transition max-md:py-2.5 ${off ? 'opacity-35' : ''}`}
              >
                <span
                  className="mt-1 inline-block h-[2px] w-4 shrink-0"
                  style={{ background: TIMELINE_COLORS[s.id] ?? '#fff' }}
                />
                <span className="shrink-0 whitespace-nowrap text-white/75">{s.label}</span>
                <span className="hidden min-w-0 truncate font-mono cap-sm text-white/55 sm:inline" title={s.query}>
                  {s.query}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono cap-sm leading-relaxed text-white/55">
        Records per publication year, log scale.{lastFull ? ` ${lastFull} is a partial year.` : ''}
        {omittedText &&
          ` Dated before ${from} and left off the chart, still counted in the totals: ${omittedText}.`}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- main */

export default function EvidenceGraph({ cutoffYear = 2000 }) {
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [pinned, setPinned] = useState(null);

  const load = useCallback(
    async (refresh = false) => {
      setError(null);
      try {
        const graph = await getJSON(
          `/api/evidence/graph?cutoff_year=${cutoffYear}${refresh ? '&refresh=1' : ''}`,
        );
        const tl = await getJSON(`/api/evidence/timeline?cutoff_year=${cutoffYear}`);
        setData(graph);
        setTimeline(tl);
        setSelected((prev) => {
          if (prev && graph.molecules.some((m) => m.id === prev)) return prev;
          const first = [...graph.molecules].sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9))[0];
          return first?.id ?? null;
        });
      } catch (err) {
        setError(err.message);
      }
    },
    [cutoffYear],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const papersById = useMemo(
    () => new Map((data?.papers ?? []).map((p) => [p.id, p])),
    [data],
  );

  if (error && !data) {
    return (
      <section className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm text-warn">
          <TriangleAlert className="h-4 w-4" />
          Literature graph unavailable
        </div>
        <p className="mt-2 font-mono cap text-white/45">{error}</p>
      </section>
    );
  }

  if (!data || !timeline) {
    return (
      <section className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 font-mono cap text-white/40">
          <Network className="h-4 w-4 animate-pulse text-white/55" />
          loading the literature fetch for {cutoffYear}
        </div>
        <div className="mt-4 h-72 animate-pulse rounded-lg bg-white/[0.03]" />
      </section>
    );
  }

  const s = data.summary;
  const cutoff = data.cutoff_year;
  const selMolecule = data.molecules.find((m) => m.id === selected);
  const selConcept = data.concepts.find((c) => c.id === selected);
  const lit = data.literature?.name ?? 'the index';
  const fallback = data.literature?.fallback_from;
  const fallbackLimited = Boolean(
    fallback && (data.errors ?? []).some((e) => e.startsWith(`${fallback}: 429`) && /budget/i.test(e)),
  );
  const failures = (data.errors ?? []).filter((e) => !(fallback && e.startsWith(`${fallback}: 429`)));
  const pctAfter = Math.round((s.share_after ?? 0) * 1000) / 10;

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  return (
    <section
      className="lift relative overflow-hidden rounded-xl border border-white/[0.07]"
      style={{ background: 'linear-gradient(160deg, rgba(34,34,46,0.92), rgba(14,14,20,0.96))' }}
    >
      <div className="hex-field pointer-events-none absolute inset-0 opacity-40" />

      <header className="relative flex flex-col gap-4 border-b border-white/6 px-5 pb-4 pt-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="font-mono cap-sm text-hive-400/80">Literature</div>
          <h3 className="mt-1.5 font-mono text-[13px] uppercase tracking-[0.14em] leading-relaxed text-white/75">
            {s.share_after == null
              ? `No ${lit} record names any of the ${s.molecules} answers`
              : `${pctAfter}% of the records that name the ${s.molecules} answers are dated after ${cutoff}`}
          </h3>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/55">
            {lit} lists <span style={{ color: EARLY }}>{fmt(s.papers_before)}</span> records that name
            one of them in the title or abstract up to {cutoff}, and {fmt(s.papers_after)} after. The
            lab ranked all {s.molecules} from data that stops at {cutoff}.
          </p>
        </div>
        <div className="shrink-0 font-mono cap-sm leading-relaxed text-white/40 lg:text-right">
          <div>
            fetched <span className="text-white/70">{shortDate(data.fetched_at)}</span>
          </div>
          <div>
            {data.sources
              .filter((src) => src.name !== fallback)
              .map((src) => `${src.name} ${src.requests} requests`)
              .join(' · ')}
            {failures.length ? <span className="text-warn"> · {failures.length} failed</span> : null}
          </div>
          {fallback && (
            <div className="max-w-xs text-white/60 lg:ml-auto">
              {fallbackLimited
                ? `${fallback} refused the first request with 429 (no API key, daily budget for this IP used up), so the records come from ${lit}.`
                : `${fallback} did not answer the first request, so the records come from ${lit}.`}
            </div>
          )}
          <div>matched on title and abstract</div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="mt-1 inline-flex items-center gap-1.5 text-white/50 transition hover:text-hive-400 disabled:text-white/55"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing
              ? `querying again${data.build_seconds ? `, last full fetch took ${Math.round(data.build_seconds)} s` : ''}`
              : 're-fetch live'}
          </button>
          {error && data && <div className="text-warn">{error}</div>}
          {data.refresh_failed && (
            <div className="max-w-xs text-warn lg:ml-auto">
              re-fetch at {shortDate(data.refresh_failed.at)} came back incomplete; showing the
              saved fetch
            </div>
          )}
        </div>
      </header>

      <dl className="relative grid grid-cols-1 gap-x-8 border-b border-white/6 px-5 py-2 sm:grid-cols-2">
        {[
          [`${s.no_paper_by_cutoff} of ${s.molecules}`, `had no record of any kind dated ${cutoff} or earlier`, EARLY],
          [`${s.no_bee_paper_by_cutoff} of ${s.molecules}`, `had no record that also names bees by ${cutoff}`, null],
          [`${fmt(s.bee_papers_before)} / ${fmt(s.bee_papers_after)}`, `records that name a molecule and bees, by ${cutoff} / after`, null],
          [`top ${s.worst_rank}`, `of ${data.lab.pool_size} in the lab's queue holds all ${s.molecules}`, AMBER],
        ].map(([value, label, color]) => (
          <div key={label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-white/[0.04] py-2 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
            <dt className="font-mono text-[15px] tabular" style={{ color: color ?? 'rgba(255,255,255,0.88)' }}>
              {value}
            </dt>
            <dd className="text-[12px] leading-snug text-white/50">{label}</dd>
          </div>
        ))}
      </dl>

      <Exception data={data} cutoff={cutoff} lit={lit} />

      <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-white/6 p-3 sm:p-4 lg:border-b-0 lg:border-r">
          <div className="mb-1 flex items-center gap-2 px-1 font-mono cap-sm text-white/60">
            <Network className="h-3.5 w-3.5" />
            {data.molecules.length} molecules · {data.concepts.length} concepts · {data.papers.length} papers ·{' '}
            {data.edges.length} links
          </div>
          <GraphCanvas
            data={data}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setPinned(null);
            }}
            pinned={pinned}
            onPin={setPinned}
          />
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {data.concepts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`tap-y rounded border px-2 py-0.5 font-mono cap-sm uppercase tracking-wider transition ${
                  selected === c.id
                    ? 'border-white/40 text-white/85'
                    : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0 p-5">
          {selMolecule && (
            <MoleculeDetail data={data} molecule={selMolecule} papersById={papersById} />
          )}
          {selConcept && <ConceptDetail data={data} concept={selConcept} papersById={papersById} />}
        </div>
      </div>

      <div className="relative grid grid-cols-1 border-t border-white/6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="border-b border-white/6 p-5 lg:border-b-0 lg:border-r">
          <h3 className="text-[13px] font-medium text-white/85">
            Records by and after {cutoff}, in the lab&apos;s queue order
          </h3>
          <p className="mt-1 cap leading-relaxed text-white/40">
            Top row is the first molecule the lab would test. Left bar: records dated {cutoff} or
            earlier. Right bar: after {cutoff}. Click a row to open it in the panel above.
          </p>
          <div className="mt-3">
            <LagRows data={data} selected={selected} onSelect={setSelected} />
          </div>
        </div>
        <div className="p-5">
          <h3 className="text-[13px] font-medium text-white/85">Records per year</h3>
          <p className="mt-1 cap leading-relaxed text-white/40">
            {data.concepts.length} background topics next to the {s.molecules} answers summed. Click
            an entry in the key to hide or show its line.
          </p>
          <div className="mt-3">
            <Timeline timeline={timeline} cutoff={cutoff} />
          </div>
        </div>
      </div>

      <footer className="relative border-t border-white/6 px-5 py-3 font-mono cap-sm leading-relaxed text-white/55">
        Source: {data.method} Bee subset adds {data.bee_terms}. Names: ApisTox, or the PubChem synonym where ApisTox
        lists an IUPAC-style name. Solid line: the paper came back from that node&apos;s query.
        Dashed: the node&apos;s name appears in the paper&apos;s title or abstract. Rank: position in
        the lab&apos;s ordering of the {data.lab.pool_size} post-{cutoff} molecules, from a model
        trained on {fmt(data.lab.train_size)} molecules recorded by {cutoff}.
      </footer>
    </section>
  );
}

/** The one answer with pre-cutoff bee literature, named rather than averaged.
 *  Everything here is read from the same /api/evidence/graph payload. */
function Exception({ data, cutoff, lit }) {
  const worst = data.molecules.reduce(
    (a, m) => ((m.bee?.before ?? 0) > (a?.bee?.before ?? 0) ? m : a),
    null,
  );
  if (!worst || !(worst.bee?.before > 0)) return null;
  const ranks = data.molecules.map((m) => m.rank).filter((r) => r != null);
  const without = ranks.filter((r) => r !== worst.rank);
  const lastWithout = without.length ? Math.max(...without) : null;
  const isLast = worst.rank === Math.max(...ranks);

  return (
    <div className="relative border-b border-white/6 px-5 py-3 cap leading-relaxed text-white/50">
      <span className="text-white/75">The exception is {worst.label}.</span> {lit} holds{' '}
      {worst.all?.before} records on it dated {cutoff} or earlier, first in {worst.all?.first_year},
      and {worst.bee.before} of those name bees.
      {isLast && lastWithout != null && (
        <>
          {' '}
          It is also the last answer the lab reaches, at rank {worst.rank}, so dropping it leaves{' '}
          {without.length} answers inside {lastWithout} assays and the result gets stronger, not
          weaker.
        </>
      )}
    </div>
  );
}
