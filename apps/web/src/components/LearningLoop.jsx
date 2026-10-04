import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* Active learning, measured. Each round the model picks a batch, the labels of
 * that batch are revealed from the dataset, and the model is refit. A second
 * arm spends the same budget without refitting. Everything here is read from
 * /api/learning, which serves lab/data/derived/learning_<budget>_<batch>.json. */

const AMBER = '#fbbf24';
const GREY = 'rgba(255,255,255,0.45)';
const AXIS = 'rgba(255,255,255,0.3)';
const BUDGETS = [30, 60, 90];
const BATCHES = [5, 10, 20];

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

const fmt = (value, digits = 3) => (value == null ? 'n/a' : Number(value).toFixed(digits));

export default function LearningLoop() {
  const [budget, setBudget] = useState(60);
  const [batch, setBatch] = useState(10);
  const [arm, setArm] = useState('retrain');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    getJSON(`/api/learning?budget=${budget}&batch=${batch}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [budget, batch]);

  return (
    <section className="glass lift rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-[16rem] flex-1">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-hive-400" />
            <h2 className="text-sm font-medium text-white/90">Learning loop</h2>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/45">
            Assay a batch, read the result, refit, pick the next batch. The frozen arm spends the
            same budget and never refits
            {data ? `, so it keeps the model trained on data up to ${data.cutoff_year}` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 cap">
          <Segment label="budget" options={BUDGETS} value={budget} onChange={setBudget} />
          <Segment label="batch" options={BATCHES} value={batch} onChange={setBatch} />
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Could not load the learning run: {error}
        </div>
      )}

      {!data && loading && !error && (
        <div className="mt-6 h-64 animate-pulse rounded-lg bg-white/[0.03]" />
      )}

      {data && (
        <motion.div
          key={`${data.budget}-${data.batch}`}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: loading ? 0.5 : 1 }}
          transition={{ duration: 0.3 }}
        >
          <Verdict data={data} />

          <div className="mt-5 grid gap-x-6 gap-y-6 lg:grid-cols-[1.25fr_1fr]">
            <div className="space-y-6">
              <Figure n="1" caption="Answers found after each round. Steps land on round boundaries.">
                <FoundChart data={data} />
              </Figure>
              <Figure
                n="2"
                caption={`AUROC on the molecules neither arm has tested yet, so both are scored on the same set (${data.retrain.rounds.at(-1).common_n} left at the end). The set shrinks every round, so compare the two lines at the same point, not a line with its own start.`}
              >
                <AurocChart data={data} />
              </Figure>
            </div>

            <Figure
              n="3"
              caption="Queue position of each answer still untested, after every refit. A line that reaches the top row was assayed in that round."
              aside={
                <div className="flex gap-1 cap-sm">
                  {['retrain', 'frozen'].map((id) => (
                    <button
                      key={id}
                      onClick={() => setArm(id)}
                      className={`tap-y rounded px-1.5 py-0.5 transition ${
                        arm === id ? 'bg-white/10 text-white/85' : 'text-white/60 hover:text-white/60'
                      }`}
                    >
                      {id === 'retrain' ? 'retraining' : 'frozen'}
                    </button>
                  ))}
                </div>
              }
            >
              <RankTrace data={data} arm={arm} />
            </Figure>
          </div>

          <RoundTable data={data} />

          <p className="mt-4 break-words font-mono cap-sm leading-relaxed text-white/50">
            random forest, {data.trees} trees, seed {data.seed}, {data.features ?? 'Morgan fingerprints'} · each assay
            reads the measured label from ApisTox · MLflow run{' '}
            {data.mlflow_run_id ? data.mlflow_run_id.slice(0, 12) : 'not logged'} ·
            lab/data/derived/learning_{data.budget}_{data.batch}.json
          </p>
        </motion.div>
      )}
    </section>
  );
}

function Segment({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/60">{label}</span>
      <div className="flex rounded-md border border-white/8 p-0.5">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`tap-y tabular rounded px-2 py-0.5 font-mono transition ${
              option === value ? 'bg-hive-400/15 text-hive-400' : 'text-white/45 hover:text-white/75'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two sentences, built from the run. Wording follows the numbers. */
function Verdict({ data }) {
  const r = data.retrain.summary;
  const f = data.frozen.summary;
  const total = data.targets;

  let found;
  if (r.all_found_at && f.all_found_at) {
    found =
      r.all_found_at === f.all_found_at
        ? `Both arms had all ${total} answers by assay ${r.all_found_at}.`
        : `Retraining had all ${total} by assay ${r.all_found_at}, the frozen model by assay ${f.all_found_at}.`;
  } else {
    found = `Inside ${data.budget} assays, retraining found ${r.found} of ${total} and the frozen model ${f.found}.`;
  }

  let gap = null;
  let gapIndex = -1;
  r.hit_at.forEach((at, i) => {
    const d = (f.hit_at[i] ?? Infinity) - at;
    if (Number.isFinite(d) && d !== 0 && (gap === null || Math.abs(d) > Math.abs(gap))) {
      gap = d;
      gapIndex = i;
    }
  });
  const middle =
    gap === null
      ? ' Retraining did not move any answer earlier or later.'
      : ` The largest difference is the ${ordinal(gapIndex + 1)} answer: assay ${r.hit_at[gapIndex]} with retraining, ${f.hit_at[gapIndex]} without.`;

  // The frozen arm never refits, so its score on the final common set is the
  // starting model's score on those same molecules. Compare the two arms there,
  // not a line against its own round-0 value, which was measured on all molecules.
  const last = data.retrain.rounds.at(-1);
  const frozenLast = data.frozen.rounds.at(-1);
  const diff = last.common_auroc - frozenLast.common_auroc;
  const auroc =
    last.common_auroc == null || frozenLast.common_auroc == null
      ? ''
      : ` On the ${last.common_n} molecules neither arm tested, AUROC is ${fmt(last.common_auroc)} after ` +
        `retraining and ${fmt(frozenLast.common_auroc)} for the frozen model (${diff >= 0 ? '+' : ''}${fmt(diff)}). ` +
        'The frozen model is the starting model unchanged, so the gap is what the revealed labels added.';

  return (
    <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-white/75">
      {found}
      {middle}
      <span className="text-white/55">{auroc}</span>
    </p>
  );
}

function Figure({ n, caption, aside, children }) {
  return (
    <figure className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono cap-sm text-hive-400/70">fig {n}</span>
        <span className="h-px flex-1 bg-white/6" />
        {aside}
      </div>
      {children}
      <figcaption className="mt-1.5 cap leading-snug text-white/60">{caption}</figcaption>
    </figure>
  );
}

const tooltipStyle = {
  background: '#12121a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
};

function Legend() {
  return (
    <div className="mb-1 flex gap-4 cap-sm text-white/45">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded" style={{ background: AMBER }} /> retraining
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-4 border-t border-dashed" style={{ borderColor: GREY }} /> frozen
      </span>
    </div>
  );
}

function merged(data, key) {
  return data.retrain.rounds.map((round, i) => ({
    assays: round.assays,
    round: round.round,
    retrain: round[key],
    frozen: data.frozen.rounds[i]?.[key],
  }));
}

function FoundChart({ data }) {
  const rows = merged(data, 'found');
  return (
    <div>
      <Legend />
      <div className="h-44 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="assays" stroke={AXIS} tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis
              stroke={AXIS}
              tick={{ fontSize: 10 }}
              tickLine={false}
              domain={[0, data.targets]}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => `after ${v} assays`}
              formatter={(v, name) => [`${v} of ${data.targets}`, name === 'retrain' ? 'retraining' : 'frozen']}
            />
            <Line
              type="stepAfter"
              dataKey="frozen"
              stroke={GREY}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="retrain"
              stroke={AMBER}
              strokeWidth={2.25}
              dot={{ r: 2.5, fill: AMBER, strokeWidth: 0 }}
              animationDuration={700}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AurocChart({ data }) {
  const rows = merged(data, 'common_auroc');
  const values = rows.flatMap((r) => [r.retrain, r.frozen]).filter((v) => v != null);
  const lo = Math.floor((Math.min(...values) - 0.01) * 50) / 50;
  const hi = Math.ceil((Math.max(...values) + 0.01) * 50) / 50;
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="assays" stroke={AXIS} tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 10 }}
            tickLine={false}
            domain={[lo, hi]}
            tickFormatter={(v) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(v) => `after ${v} assays`}
            formatter={(v, name) => [fmt(v), name === 'retrain' ? 'retraining' : 'frozen']}
          />
          <Line
            dataKey="frozen"
            stroke={GREY}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="retrain"
            stroke={AMBER}
            strokeWidth={2.25}
            dot={{ r: 2.5, fill: AMBER, strokeWidth: 0 }}
            animationDuration={700}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Which answer the Verdict paragraph singles out: the one whose assay moved
 *  most between the two arms, identified by pick order so the chart and the
 *  sentence always point at the same molecule. */
function largestGapIndex(data) {
  const r = data.retrain.summary.hit_at ?? [];
  const f = data.frozen.summary.hit_at ?? [];
  let gap = null;
  let index = -1;
  r.forEach((at, i) => {
    const d = (f[i] ?? Infinity) - at;
    if (Number.isFinite(d) && d !== 0 && (gap === null || Math.abs(d) > Math.abs(gap))) {
      gap = d;
      index = i;
    }
  });
  return index;
}

function nthAnswerPicked(data, arm, index) {
  if (index < 0) return null;
  let k = 0;
  for (const round of data[arm].rounds) {
    for (const pick of round.picked ?? []) {
      if (!pick.target) continue;
      if (k === index) return pick;
      k += 1;
    }
  }
  return null;
}

/** One line per answer: where it sits in the queue after each refit. */
function RankTrace({ data, arm }) {
  const { rows, cids, maxRank } = useMemo(() => {
    const rounds = data[arm].rounds;
    const ids = data.targets_meta.map((t) => String(t.cid));
    const foundIn = {};
    rounds.forEach((round) =>
      round.picked.forEach((p) => {
        if (p.target) foundIn[p.cid] = round.round;
      }),
    );
    let top = 1;
    const out = rounds.map((round) => {
      const row = { assays: round.assays, round: round.round };
      round.target_ranks.forEach(({ cid, rank }) => {
        row[cid] = rank;
        top = Math.max(top, rank);
      });
      ids.forEach((cid) => {
        if (foundIn[cid] === round.round) row[cid] = 0;
      });
      return row;
    });
    // Every answer is tested well before the budget runs out, so the rounds
    // after the last live trace are empty plot. Stop the axis there.
    let last = 0;
    out.forEach((row, i) => {
      if (ids.some((cid) => row[cid] != null)) last = i;
    });
    return { rows: out.slice(0, last + 1), cids: ids, maxRank: top };
  }, [data, arm]);

  const names = Object.fromEntries(data.targets_meta.map((t) => [String(t.cid), t.name]));
  const gapIndex = largestGapIndex(data);
  const marked = nthAnswerPicked(data, arm, gapIndex);
  const markedCid = marked ? String(marked.cid) : null;
  // Draw the marked trace last so it sits above the grey ones.
  const drawOrder = markedCid ? [...cids.filter((c) => c !== markedCid), markedCid] : cids;

  return (
    <>
      <div className="h-[22rem] w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis dataKey="assays" stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} />
            <YAxis
              stroke={AXIS}
              tick={{ fontSize: 11 }}
              tickLine={false}
              reversed
              domain={[0, maxRank]}
              ticks={[0, ...[7, 14, 21, 28].filter((v) => v <= maxRank), maxRank].filter(
                (v, i, a) => a.indexOf(v) === i,
              )}
              allowDecimals={false}
              tickFormatter={(v) => (v === 0 ? 'tested' : v)}
              width={52}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => `after ${v} assays`}
              itemSorter={(item) => item.value}
              formatter={(v, cid) => [v === 0 ? 'assayed this round' : `#${v} in queue`, names[cid] ?? cid]}
            />
            {drawOrder.map((cid) => {
              const on = cid === markedCid;
              return (
                <Line
                  key={cid}
                  dataKey={cid}
                  stroke={on ? AMBER : 'rgba(255,255,255,0.22)'}
                  strokeWidth={on ? 2 : 1.25}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={(props) =>
                    props.value == null || props.cy == null ? (
                      <g key={`${cid}-${props.index}`} />
                    ) : props.value === 0 ? (
                      <circle
                        key={`${cid}-${props.index}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={on ? 4 : 3.5}
                        fill={on ? AMBER : 'rgba(255,255,255,0.55)'}
                      />
                    ) : (
                      <circle
                        key={`${cid}-${props.index}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={1.4}
                        fill={on ? AMBER : 'rgba(255,255,255,0.4)'}
                      />
                    )
                  }
                  activeDot={{ r: 3, fill: '#fff' }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {marked && (
        <div className="mt-1 flex items-center gap-2 cap text-white/45">
          <span className="inline-block h-0.5 w-5 rounded bg-hive-400" />
          the {ordinal(gapIndex + 1)} answer, {marked.name}. The other {cids.length - 1} are grey.
        </div>
      )}
    </>
  );
}

function RoundTable({ data }) {
  const rounds = data.retrain.rounds.slice(1);
  const frozen = data.frozen.rounds.slice(1);
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono cap-sm text-hive-400/70">table</span>
        <span className="cap text-white/40">round by round, retraining arm unless marked</span>
        <span className="h-px flex-1 bg-white/6" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left cap">
          <thead>
            <tr className="border-b border-white/8 cap-sm text-white/60">
              <th className="py-1.5 pr-3 font-normal">round</th>
              <th className="py-1.5 pr-3 font-normal">assays</th>
              <th className="py-1.5 pr-3 font-normal">found</th>
              <th className="py-1.5 pr-3 font-normal">frozen</th>
              <th className="py-1.5 pr-3 font-normal" title="median queue position of the answers still untested">
                median rank, before refit
              </th>
              <th className="py-1.5 pr-3 font-normal">after</th>
              <th className="py-1.5 pr-3 font-normal">up / down</th>
              <th className="py-1.5 font-normal">answers assayed this round</th>
            </tr>
          </thead>
          <tbody className="font-mono text-white/65">
            {rounds.map((round, i) => {
              const hits = round.picked.filter((p) => p.target).map((p) => p.name);
              const better = round.found > (frozen[i]?.found ?? 0);
              return (
                <tr key={round.round} className="border-b border-white/[0.04]">
                  <td className="py-1.5 pr-3 text-white/40">{round.round}</td>
                  <td className="tabular py-1.5 pr-3">{round.assays}</td>
                  <td className={`tabular py-1.5 pr-3 ${better ? 'text-hive-400' : ''}`}>{round.found}</td>
                  <td className="tabular py-1.5 pr-3 text-white/40">{frozen[i]?.found}</td>
                  <td className="tabular py-1.5 pr-3">{round.median_rank_before ?? ''}</td>
                  <td className="tabular py-1.5 pr-3">{round.median_rank_after ?? ''}</td>
                  <td className="tabular py-1.5 pr-3 text-white/45">
                    {round.targets_left ? `${round.moved_up} / ${round.moved_down}` : ''}
                  </td>
                  <td className="max-w-[16rem] truncate py-1.5 font-sans text-white/55" title={hits.join(', ')}>
                    {hits.length ? hits.join(', ') : <span className="text-white/45">none</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
