import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

/** The hidden answers, drawn as molecules, in the order the lab asked for them.
 *
 *  Data: GET /api/hidden (lab/beeguard/structures.py). Ranks come from the
 *  learned ordering over the whole post-cutoff pool; the random numbers replay
 *  the seeded shuffles behind the headline random baseline.
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

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const fmt = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

const ordinal = (n) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

export default function RediscoveredGallery({ cutoffYear = 2000 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [scroll, setScroll] = useState({ left: 0, thumb: 1 });
  const scroller = useRef(null);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const span = el.scrollWidth - el.clientWidth;
    setScroll({ left: span > 0 ? el.scrollLeft / span : 0, thumb: el.clientWidth / el.scrollWidth });
  }, []);

  useEffect(() => {
    onScroll();
    window.addEventListener('resize', onScroll);
    return () => window.removeEventListener('resize', onScroll);
  }, [data, onScroll]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    getJSON(`/api/hidden?cutoff_year=${cutoffYear}`)
      .then((payload) => alive && setData(payload))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [cutoffYear]);

  const scrollToCard = useCallback((k) => {
    const node = scroller.current?.querySelector(`[data-k="${k}"]`);
    if (!node || !scroller.current) return;
    const target = node.offsetLeft - (scroller.current.clientWidth - node.clientWidth) / 2;
    scroller.current.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, []);

  const nudge = (direction) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const reading = useMemo(() => {
    if (!data?.rows?.length) return null;
    const seen = data.rows.filter((r) => r.seen_scaffold).map((r) => r.model_rank);
    const unseen = data.rows.filter((r) => !r.seen_scaffold).map((r) => r.model_rank);
    return {
      seenN: seen.length,
      unseenN: unseen.length,
      seenMedian: median(seen),
      unseenMedian: median(unseen),
      baseRate: (100 * data.targets) / data.pool_molecules,
      topRate: (100 * data.targets) / data.model_rank_of_last,
    };
  }, [data]);

  return (
    <section className="relative">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-2xl">
          <div className="font-mono text-[11px] text-hive-400/80">
            {data ? `The ${data.targets} hidden answers` : 'The hidden answers'}
          </div>
          <h3 className="font-serif-display mt-2 text-[1.4rem] leading-tight text-wax sm:text-[1.8rem]">
            Found in the order the lab asked for them
          </h3>
          {data && reading ? (
            <p className="mt-3 text-[15px] leading-relaxed text-white/55">
              Insecticides dated after {data.cutoff_year} that ApisTox records as non-toxic to
              honey bees. The model saw only the {data.train_molecules} molecules dated{' '}
              {data.cutoff_year} or earlier. All {data.targets} came within its first{' '}
              <span className="text-white/85">{data.model_rank_of_last}</span> picks out of{' '}
              {data.pool_molecules}, a hit rate of{' '}
              <span className="text-white/85">{reading.topRate.toFixed(0)}%</span> against a
              base rate of {reading.baseRate.toFixed(1)}%. Random order needs a median of{' '}
              <span className="text-white/85">{fmt(data.random_median_for_all)}</span> picks
              for the same {data.targets}.
            </p>
          ) : (
            !error && <div className="mt-4 h-12 w-full max-w-xl animate-pulse rounded bg-white/5" />
          )}
        </div>

        <div className="hidden gap-1.5 sm:flex">
          <button
            onClick={() => nudge(-1)}
            aria-label="Scroll left"
            className="rounded-md border border-white/10 p-2 text-white/50 transition hover:border-white/25 hover:text-white/80"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => nudge(1)}
            aria-label="Scroll right"
            className="rounded-md border border-white/10 p-2 text-white/50 transition hover:border-white/25 hover:text-white/80"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Could not load the hidden answers: {error}
        </div>
      )}

      {data && (
        <>
          <RankFan data={data} active={active} setActive={setActive} onPick={scrollToCard} />

          <div
            ref={scroller}
            onScroll={onScroll}
            className="-mx-4 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 pt-2 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:pb-12 [&::-webkit-scrollbar]:hidden"
          >
            {data.rows.map((row, index) => (
              <AnswerCard
                key={row.cid}
                row={row}
                index={index}
                pool={data.pool_molecules}
                targets={data.targets}
                root={scroller}
                active={active === row.find_order}
                onHover={setActive}
              />
            ))}
          </div>

          <div className="mb-6 flex items-center gap-3">
            <div className="relative h-0.5 flex-1 overflow-hidden rounded bg-white/10">
              <div
                className="absolute inset-y-0 rounded bg-hive-400/70"
                style={{
                  width: `${scroll.thumb * 100}%`,
                  left: `${scroll.left * (1 - scroll.thumb) * 100}%`,
                }}
              />
            </div>
            <span className="font-mono text-[10.5px] text-white/35">swipe or scroll</span>
          </div>

          {reading && (
            <div className="grid gap-x-10 gap-y-3 border-t border-white/8 pt-4 text-xs leading-relaxed text-white/45 md:grid-cols-[1fr_1fr]">
              <p>
                <span className="text-white/75">Known scaffolds are found somewhat earlier.</span>{' '}
                The {reading.seenN} answers whose Bemis-Murcko scaffold appears in the training
                set have a median rank of{' '}
                <span className="tabular text-white/80">{fmt(reading.seenMedian)}</span>. The{' '}
                {reading.unseenN} on new scaffolds have{' '}
                <span className="tabular text-hive-400">{fmt(reading.unseenMedian)}</span>. The
                first pick, {data.rows[0].display_name}, is on a{' '}
                {data.rows[0].seen_scaffold ? 'known' : 'new'} scaffold. The amber tint on each
                drawing marks its scaffold.
              </p>
              <p>
                Rank is the position in the learned ordering of all {data.pool_molecules}{' '}
                molecules dated after {data.cutoff_year}. Random is where the k-th answer lands
                in a shuffled pool, median of {data.shuffles} shuffles. The closest training
                molecule is the one with the highest Tanimoto similarity on the Morgan
                fingerprints the model uses.
              </p>
            </div>
          )}
        </>
      )}

      {!data && !error && (
        <div className="mt-6 flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[25rem] w-[17rem] shrink-0 animate-pulse rounded-xl bg-white/[0.03]"
              style={{ marginTop: i % 2 ? 28 : 0 }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Two lanes over the same 1..N axis. Top: where the learned ordering found
 *  each answer. Bottom: where random order finds its k-th answer (median).
 *  The lines pair the k-th find in each lane. */
function RankFan({ data, active, setActive, onPick }) {
  const box = useRef(null);
  const width = useWidth(box);
  const n = data.pool_molecules;
  const narrow = width < 520;
  const padL = narrow ? 58 : 112;
  const padR = 14;
  const top = 26;
  const bottom = narrow ? 92 : 98;
  const height = bottom + 34;
  const x = (rank) => padL + ((rank - 1) / (n - 1)) * Math.max(width - padL - padR, 1);
  const ticks = [1, 50, 100, 150, n];

  return (
    <div ref={box} className="mt-7 w-full select-none">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Rank of each answer, learned ordering against random">
          <text x={0} y={top + 4} className="fill-white/60 font-mono" fontSize={11}>
            {narrow ? 'model' : 'learned order'}
          </text>
          <text x={0} y={bottom + 4} className="fill-white/35 font-mono" fontSize={11}>
            {narrow ? 'random' : 'random, median'}
          </text>

          <line x1={padL} x2={width - padR} y1={top} y2={top} stroke="rgba(255,255,255,0.12)" />
          <line x1={padL} x2={width - padR} y1={bottom} y2={bottom} stroke="rgba(255,255,255,0.12)" />

          {/* the stretch of the axis the learned ordering needed */}
          <rect
            x={padL}
            y={top - 9}
            width={Math.max(x(data.model_rank_of_last) - padL, 2)}
            height={18}
            fill="rgba(251,191,36,0.08)"
          />

          {data.rows.map((row) => {
            const on = active === row.find_order;
            return (
              <g
                key={row.cid}
                onMouseEnter={() => setActive(row.find_order)}
                onMouseLeave={() => setActive(null)}
                onClick={() => onPick(row.find_order)}
                className="cursor-pointer"
              >
                <motion.line
                  x1={x(row.model_rank)}
                  y1={top}
                  x2={x(row.random_rank_median)}
                  y2={bottom}
                  stroke={on ? '#fbbf24' : row.seen_scaffold ? 'rgba(255,255,255,0.18)' : 'rgba(251,191,36,0.28)'}
                  strokeWidth={on ? 1.6 : 1}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.9, delay: 0.04 * row.find_order, ease: [0.16, 1, 0.3, 1] }}
                />
                <circle
                  cx={x(row.random_rank_median)}
                  cy={bottom}
                  r={on ? 4.5 : 3}
                  fill="#0a0a0f"
                  stroke={on ? '#fbbf24' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={1.2}
                />
                <circle
                  cx={x(row.model_rank)}
                  cy={top}
                  r={on ? 5.5 : 4}
                  fill={row.seen_scaffold ? '#e8e8ef' : '#fbbf24'}
                  stroke="#0a0a0f"
                  strokeWidth={1.5}
                />
                {/* wide invisible hit target for touch */}
                <line
                  x1={x(row.model_rank)}
                  y1={top - 10}
                  x2={x(row.random_rank_median)}
                  y2={bottom + 10}
                  stroke="transparent"
                  strokeWidth={10}
                />
              </g>
            );
          })}

          <text
            x={x(data.model_rank_of_last) + 8}
            y={top - 12}
            className="fill-hive-400 font-mono"
            fontSize={10.5}
          >
            all {data.targets} by rank {data.model_rank_of_last}
          </text>
          <text
            x={Math.min(x(data.random_median_for_all), width - padR)}
            y={bottom - 10}
            textAnchor="end"
            className="fill-white/40 font-mono"
            fontSize={10.5}
          >
            {ordinal(data.targets)} at {fmt(data.random_median_for_all)}
          </text>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={bottom + 8} y2={bottom + 12} stroke="rgba(255,255,255,0.25)" />
              <text
                x={x(t)}
                y={bottom + 25}
                textAnchor={t === n ? 'end' : t === 1 ? 'start' : 'middle'}
                className="fill-white/30 font-mono"
                fontSize={10}
              >
                {t}
              </text>
            </g>
          ))}
        </svg>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-white/40">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-hive-400" /> new scaffold, not in
          the training set
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#e8e8ef]" /> known scaffold
        </span>
        <span className="font-mono">x axis: assays ordered, 1 to {n}</span>
      </div>
    </div>
  );
}

function AnswerCard({ row, index, pool, targets, root, active, onHover }) {
  const lower = index % 2 === 1;
  const first = index === 0;
  const track = (rank) => `${((rank - 1) / (pool - 1)) * 100}%`;

  return (
    <motion.article
      data-k={row.find_order}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ root, once: true, amount: 0.05 }}
      transition={{ duration: 0.55, delay: (index % 4) * 0.06, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => onHover(row.find_order)}
      onMouseLeave={() => onHover(null)}
      className={`relative shrink-0 snap-center overflow-hidden rounded-xl border bg-night-800/80 transition-colors ${
        first ? 'w-[19.5rem] sm:w-[22rem]' : 'w-[16.5rem] sm:w-[17.5rem]'
      } ${lower ? 'sm:mt-9' : ''} ${
        active ? 'border-hive-400/50' : 'border-white/[0.07] hover:border-white/15'
      }`}
    >
      <div className="flex items-start justify-between px-4 pt-4">
        <div>
          <div className="font-mono text-[10px] text-white/35">
            {first ? 'first pick' : `find ${row.find_order} of ${targets}`}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[11px] text-white/40">rank</span>
            <span className={`tabular font-semibold text-hive-400 ${first ? 'text-5xl' : 'text-4xl'}`}>
              {row.model_rank}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] text-white/30">random</div>
          <div className="tabular mt-1 text-lg text-white/55">{fmt(row.random_rank_median)}</div>
        </div>
      </div>

      <div className="relative mx-3 mt-2 rounded-lg bg-black/25">
        <img
          src={`/api/structure/${row.cid}.svg?size=280&scaffold=true`}
          alt={`2D structure of ${row.display_name}`}
          loading="lazy"
          className={`mx-auto block aspect-square ${first ? 'w-[17rem]' : 'w-[13.5rem]'}`}
        />
        <span
          className={`absolute left-2 top-2 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
            row.seen_scaffold ? 'border-white/15 text-white/55' : 'border-hive-400/40 text-hive-400'
          }`}
        >
          {row.seen_scaffold ? 'known scaffold' : 'new scaffold'}
        </span>
      </div>

      <div className="px-4 pb-4 pt-3">
        <h3
          className="line-clamp-2 text-[15px] font-medium leading-snug text-white/90"
          title={row.name && row.name !== row.display_name ? row.name : undefined}
        >
          {row.display_name}
        </h3>
        <div className="mt-1 font-mono text-[11px] text-white/40">
          ApisTox year {row.year} · CID {row.cid}
        </div>

        <div className="relative mt-3 h-3" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
          <div
            className="absolute top-1/2 h-px bg-hive-400/40"
            style={{ left: track(row.model_rank), width: `calc(${track(row.random_rank_median)} - ${track(row.model_rank)})` }}
          />
          <span
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hive-400"
            style={{ left: track(row.model_rank) }}
          />
          <span
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50 bg-night-800"
            style={{ left: track(row.random_rank_median) }}
          />
        </div>

        <div className="mt-3 border-t border-white/[0.06] pt-2.5 text-[11px] leading-relaxed text-white/45">
          <span className="text-white/30">Closest training molecule</span>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-white/70" title={row.nearest_known.name}>
              {row.nearest_known.name}
            </span>
            <span className="tabular shrink-0 font-mono text-white/60">
              {row.nearest_known.tanimoto.toFixed(2)}
            </span>
          </div>
          <div className="font-mono text-[10px] text-white/30">
            {row.nearest_known.year} · {row.nearest_known.label === 'toxic' ? 'toxic to bees' : 'non-toxic'}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
