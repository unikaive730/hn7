import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Ruler } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* Checks on the headline number, all read from /api/rigor, which serves
 * lab/data/derived/rigor.json (rebuilt with `python -m lab.beeguard.rigor`).
 * Each ablation cell and seed names the MLflow run that produced it. */

const AMBER = '#fbbf24';
const AXIS = 'rgba(255,255,255,0.3)';

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

const n0 = (v) => (v == null ? 'n/a' : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(1));
const n3 = (v) => (v == null ? 'n/a' : Number(v).toFixed(3));
const thousands = (v) => Number(v).toLocaleString('en-US');

function Sci({ value }) {
  if (value == null) return 'n/a';
  if (value >= 0.001) return value.toFixed(value >= 0.1 ? 2 : 3);
  const [mantissa, exponent] = value.toExponential(1).split('e');
  return (
    <span className="whitespace-nowrap">
      {mantissa} × 10<sup>{Number(exponent)}</sup>
    </span>
  );
}

const tooltipStyle = {
  background: '#12121a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
};

export default function RigorPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getJSON('/api/rigor').then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <section className="glass lift rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-[16rem] flex-1">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-hive-400" />
            <h2 className="text-sm font-medium text-white/90">Rigor checks</h2>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/45">
            Each part below tries to break the headline number
            {data ? ` on the same ${data.setup.cutoff_year} time split` : ''}.
          </p>
        </div>
        {data && (
          <div className="font-mono cap-sm leading-relaxed text-white/30 sm:text-right">
            built {data.generated_at}
            <br />
            dataset sha256 {data.dataset_sha256.slice(0, 12)}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Could not load the rigor checks: {error}
        </div>
      )}
      {!data && !error && <div className="mt-6 h-72 animate-pulse rounded-lg bg-white/[0.03]" />}

      {data && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <Baselines data={data} />
          <div className="mt-7 grid gap-x-8 gap-y-7 border-t border-white/6 pt-6 lg:grid-cols-[1.35fr_1fr]">
            <Ablation data={data} />
            <div className="space-y-7">
              <Scaffold data={data} />
              <Seeds data={data} />
            </div>
          </div>
          <MlflowFooter data={data} />
        </motion.div>
      )}
    </section>
  );
}

function Part({ letter, title, children, aside }) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono cap text-hive-400/80">{letter}</span>
        <h3 className="text-[13px] font-medium text-white/85">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ (a) baselines */

function Baselines({ data }) {
  const [which, setWhich] = useState('whole_pool');
  const base = data.baselines[which];
  const inClass = data.baselines.insecticides_only;
  const whole = data.baselines.whole_pool;
  const ours = base.model_assays_to_all;

  const toggle = (
    <div className="flex rounded-md border border-white/8 p-0.5 cap-sm">
      {[
        ['whole_pool', `whole pool, ${whole.candidates}`],
        ['insecticides_only', `insecticides only, ${inClass.candidates}`],
      ].map(([id, label]) => (
        <button
          key={id}
          onClick={() => setWhich(id)}
          className={`tap-y rounded px-2 py-0.5 transition ${
            which === id ? 'bg-hive-400/15 text-hive-400' : 'text-white/40 hover:text-white/70'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const hist = base.all_hist;
  const step = base.candidates > 60 ? 25 : 2;
  const domainLo = Math.max(0, Math.floor((Math.min(ours, hist[0].assays) - 2) / step) * step);
  const domainHi = base.candidates + 1;
  const ticks = [];
  for (let t = domainLo; t <= domainHi; t += step) ticks.push(t);

  const verdict =
    which === 'whole_pool' ? (
      <>
        Random ordering over all {whole.candidates} molecules needs a median of {n0(whole.random_all_p50)} assays to
        find all {whole.answers} answers (5th to 95th percentile {n0(whole.random_all_p5)} to {n0(whole.random_all_p95)}).
        This lab needed {ours}.{' '}
        {whole.shuffles_at_or_below_model === 0
          ? `None of the ${thousands(whole.shuffles)} shuffles did as well.`
          : `${thousands(whole.shuffles_at_or_below_model)} of ${thousands(whole.shuffles)} shuffles did as well.`}{' '}
        The exact chance is <Sci value={whole.exact_p_all_within_model} />.
      </>
    ) : (
      <>
        The ordering already filters to insecticides, so this is the stricter test. Random order inside the{' '}
        {inClass.candidates} insecticides finds all {inClass.answers} by a median of {n0(inClass.random_all_p50)}{' '}
        assays; this lab needed {ours}, and {thousands(inClass.shuffles_at_or_below_model)} of{' '}
        {thousands(inClass.shuffles)} shuffles did as well (exact p = <Sci value={inClass.exact_p_all_within_model} />).
        Using every position, answers sit at a mean rank of {inClass.mean_answer_position} against{' '}
        {inClass.random_mean_answer_position} for random: within-class AUROC {n3(inClass.within_class_auroc)}, one-sided
        Mann-Whitney p = {n3(inClass.mannwhitney_p)}.{' '}
        {inClass.mannwhitney_p < 0.05
          ? 'The structure model adds a significant lift inside the class.'
          : `With ${inClass.answers} answers that lift is not significant at 0.05. Most of the headline speedup comes from knowing which molecules are insecticides.`}
      </>
    );

  return (
    <div className="mt-5">
      <Part letter="a" title="How often does random ordering do this well?" aside={toggle}>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-[1fr_15rem]">
          <div className="min-w-0 space-y-5">
            <div>
              <div className="h-44 w-full">
                <ResponsiveContainer>
                  <BarChart data={hist} margin={{ top: 14, right: 8, bottom: 0, left: -22 }} barCategoryGap={0}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="assays"
                      type="number"
                      domain={[domainLo, domainHi]}
                      ticks={ticks}
                      stroke={AXIS}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <YAxis stroke={AXIS} tick={{ fontSize: 10 }} tickLine={false} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      labelFormatter={(v) => `all ${base.answers} found at assay ${v}`}
                      formatter={(v) => [`${v} of ${thousands(base.shuffles)} shuffles`, 'random']}
                    />
                    <ReferenceLine x={base.random_all_p50} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 3" />
                    <ReferenceLine
                      x={ours}
                      stroke={AMBER}
                      strokeWidth={2}
                      label={{ value: `this lab, ${ours}`, position: 'top', fill: AMBER, fontSize: 10 }}
                    />
                    <Bar dataKey="count" fill="rgba(255,255,255,0.28)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 cap text-white/35">
                Assays random ordering needs to find all {base.answers}, over {thousands(base.shuffles)} shuffles (seed{' '}
                {base.seed}). Dashed line: random median. The discovery curve and the answer gallery
                draw the same baseline at 400 and 500 shuffles, enough for a median on screen; this
                is the stress-test count.
              </p>
            </div>
            <PerK base={base} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:block md:space-y-3 md:border-l md:border-white/6 md:pl-5">
            <Readout
              label={`random, median over ${thousands(base.shuffles)} shuffles`}
              value={n0(base.random_all_p50)}
              note={`${base.exact_median_all} exact`}
            />
            <Readout label="random, 5th to 95th" value={`${n0(base.random_all_p5)} to ${n0(base.random_all_p95)}`} />
            <Readout label="this lab" value={ours} accent />
            <Readout
              label="shuffles at or below"
              value={`${thousands(base.shuffles_at_or_below_model)} / ${thousands(base.shuffles)}`}
            />
            <Readout label="exact probability" value={<Sci value={base.exact_p_all_within_model} />} />
            <p className="col-span-2 pt-1 cap-sm leading-snug text-white/30">
              exact = C({ours}, {base.answers}) / C({base.candidates}, {base.answers}), the chance all {base.answers}{' '}
              land in the first {ours} picks.
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-white/65">{verdict}</p>
      </Part>
    </div>
  );
}

function Readout({ label, value, note, accent }) {
  return (
    <div>
      <div className="cap-sm text-white/35">{label}</div>
      <div className={`tabular font-mono text-lg leading-tight ${accent ? 'text-hive-400' : 'text-white/85'}`}>
        {value}
        {note && <span className="ml-2 cap-sm text-white/30">{note}</span>}
      </div>
    </div>
  );
}

/** Assays needed for the k-th answer: this lab against the random band. */
function PerK({ base }) {
  const rows = base.per_k.map((r) => ({ ...r, band: [r.p5, r.p95] }));
  return (
    <div>
      <div className="h-40 w-full">
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="k" stroke={AXIS} tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis stroke={AXIS} tick={{ fontSize: 10 }} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(k) => `answer ${k} of ${base.answers}`}
              formatter={(v, name) => {
                if (name === 'band') return [`${v[0]} to ${v[1]}`, 'random 5th to 95th'];
                if (name === 'p50') return [v, 'random median'];
                return [v, 'this lab'];
              }}
            />
            <Area dataKey="band" stroke="none" fill="rgba(255,255,255,0.08)" isAnimationActive={false} />
            <Line dataKey="p50" stroke="rgba(255,255,255,0.4)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line dataKey="model" stroke={AMBER} strokeWidth={2} dot={{ r: 2.5, fill: AMBER, strokeWidth: 0 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 cap text-white/35">
        Assays spent before the k-th answer turns up. Shaded: random, 5th to 95th percentile.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- (b) ablation */

const metricsFor = (setup) => [
  { id: 'auroc', label: 'AUROC', better: 'max' },
  { id: 'assays_to_half', label: `assays to ${setup.half_k}`, better: 'min' },
  { id: 'assays_to_all', label: `assays to ${setup.targets}`, better: 'min' },
];

const SHORT_MODEL = {
  random_forest: 'Random forest',
  logistic: 'Logistic',
  knn: 'k-NN, k=7',
  dummy: 'Prior only',
};
const SHORT_FP = { morgan: 'Morgan', maccs: 'MACCS', descriptors: 'Descriptors' };

function Ablation({ data }) {
  const [metric, setMetric] = useState('auroc');
  const { models, fingerprints, cells } = data.ablation;
  const METRICS = metricsFor(data.setup);
  const spec = METRICS.find((m) => m.id === metric);

  const byKey = useMemo(() => Object.fromEntries(cells.map((c) => [`${c.model}|${c.fingerprint}`, c])), [cells]);
  const real = cells.filter((c) => c.model !== 'dummy');
  const best = spec.better === 'max' ? Math.max(...real.map((c) => c[metric])) : Math.min(...real.map((c) => c[metric]));

  const topAuroc = real.reduce((a, c) => (c.auroc > a.auroc ? c : a));
  const quickest = real.reduce((a, c) => (c.assays_to_all < a.assays_to_all ? c : a));
  const prior = cells.find((c) => c.model === 'dummy');
  const morganRf = byKey['random_forest|morgan'];

  const toggle = (
    <div className="flex rounded-md border border-white/8 p-0.5 cap-sm">
      {METRICS.map((m) => (
        <button
          key={m.id}
          onClick={() => setMetric(m.id)}
          className={`tap-y rounded px-2 py-0.5 transition ${
            metric === m.id ? 'bg-hive-400/15 text-hive-400' : 'text-white/40 hover:text-white/70'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  return (
    <Part letter="b" title="Ablation over model and fingerprint" aside={toggle}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[19rem] border-collapse cap">
          <thead>
            <tr className="cap-sm text-white/35">
              <th className="py-1.5 pr-2 text-left font-normal" />
              {fingerprints.map((fp) => (
                <th key={fp.key} className="px-1.5 py-1.5 text-left font-normal" title={fp.label}>
                  {SHORT_FP[fp.key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.key} className="border-t border-white/[0.06]">
                <th
                  className={`py-2 pr-2 text-left align-top font-normal ${
                    model.key === 'dummy' ? 'text-white/35' : 'text-white/65'
                  }`}
                  title={model.label}
                >
                  {SHORT_MODEL[model.key]}
                </th>
                {fingerprints.map((fp) => {
                  const cell = byKey[`${model.key}|${fp.key}`];
                  const value = cell[metric];
                  const isBest = model.key !== 'dummy' && value === best;
                  return (
                    <td key={fp.key} className="px-0.5 py-1 align-top">
                      <div
                        className={`rounded-md px-1.5 py-1 ${
                          isBest ? 'bg-hive-400/12 ring-1 ring-hive-400/50' : ''
                        }`}
                      >
                        <div
                          className={`tabular font-mono text-[13px] ${
                            isBest ? 'text-hive-400' : model.key === 'dummy' ? 'text-white/40' : 'text-white/80'
                          }`}
                        >
                          {metric === 'auroc' ? n3(value) : n0(value)}
                        </div>
                        {metric === 'auroc' && model.key !== 'dummy' && (
                          <div className="tabular font-mono cap-sm text-white/30">
                            {n3(cell.ci_low)} to {n3(cell.ci_high)}
                          </div>
                        )}
                        <div className="truncate font-mono cap-sm text-white/20" title={cell.mlflow_run_id ?? ''}>
                          {cell.mlflow_run_id ? cell.mlflow_run_id.slice(0, 8) : cell.note ? 'tie-breaks' : ''}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-white/55">
        Time split at {data.setup.cutoff_year}, AUROC on all {data.setup.pool} pool molecules with a{' '}
        {thousands(data.setup.bootstraps)}-sample bootstrap 95% interval. {SHORT_MODEL[topAuroc.model]} on{' '}
        {SHORT_FP[topAuroc.fingerprint]} ranks toxicity best ({n3(topAuroc.auroc)}).{' '}
        {quickest.model === topAuroc.model && quickest.fingerprint === topAuroc.fingerprint
          ? `It is also quickest to all ${data.setup.targets} answers (${quickest.assays_to_all} assays).`
          : `${SHORT_MODEL[quickest.model]} on ${SHORT_FP[quickest.fingerprint]} reaches all ${data.setup.targets} answers soonest (${quickest.assays_to_all} assays, against ${morganRf.assays_to_all} for the main model).`}{' '}
        A prior with no structure needs {n0(prior.assays_to_all)}, the median of {thousands(prior.tie_breaks)} random
        tie-breaks. Most intervals overlap, so read the gaps between cells as tendencies.
      </p>
    </Part>
  );
}

/* ------------------------------------------------------------ (c) scaffolds */

function Scaffold({ data }) {
  const s = data.scaffold;
  const lo = 0.5;
  const hi = 1;
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const rows = [
    { label: 'scaffold seen in training', n: s.seen_n, auroc: s.seen_auroc, ci: s.seen_ci },
    { label: 'scaffold never seen', n: s.unseen_n, auroc: s.unseen_auroc, ci: s.unseen_ci },
  ];
  // Read from the intervals themselves rather than asserted in prose.
  const overlaps = s.seen_ci?.[0] != null && s.unseen_ci?.[1] != null && s.seen_ci[0] <= s.unseen_ci[1];
  const ac = s.acyclic_check;
  return (
    <Part letter="c" title="Does it hold on unfamiliar chemistry?">
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between cap">
              <span className="text-white/60">
                {row.label} <span className="text-white/30">n = {row.n}</span>
              </span>
              <span className={`tabular font-mono ${i === 0 ? 'text-white/85' : 'text-hive-400'}`}>
                {Number(row.auroc).toFixed(4)}
              </span>
            </div>
            <div className="relative mt-1.5 h-3">
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25"
                style={{ left: x(row.ci[0]), width: `calc(${x(row.ci[1])} - ${x(row.ci[0])})` }}
              />
              <motion.div
                className={`absolute top-1/2 h-3 w-0.5 -translate-y-1/2 ${i === 0 ? 'bg-white/85' : 'bg-hive-400'}`}
                initial={{ left: x(lo) }}
                animate={{ left: x(row.auroc) }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        ))}
        <div className="flex justify-between font-mono cap-sm text-white/25">
          <span>0.5</span>
          <span>0.75</span>
          <span>1.0</span>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-white/55">
        Murcko scaffolds. AUROC drops by {n3(s.seen_auroc - s.unseen_auroc)} on scaffolds absent from the pre-
        {data.setup.cutoff_year} data, and {s.targets_on_unseen_scaffolds} of the {s.targets} answers sit there. Bars
        are bootstrap 95% intervals.{' '}
        {overlaps && (
          <span className="text-white/45">
            The two intervals overlap ({n3(s.seen_ci[0])} to {n3(s.seen_ci[1])} against {n3(s.unseen_ci[0])}{' '}
            to {n3(s.unseen_ci[1])}), so read this as a tendency, not a measured gap.
          </span>
        )}
        {ac && (
          <span className="text-white/45">
            {' '}
            A second caveat in the split itself: a molecule with no ring has an empty Murcko scaffold,{' '}
            {ac.train_molecules_without_a_ring} training molecules share it, so the{' '}
            {ac.moved_out_of_seen} acyclic pool molecules count as seen. Moving them across gives{' '}
            {Number(ac.seen_auroc).toFixed(3)} (n = {ac.seen_n}) against{' '}
            {Number(ac.unseen_auroc).toFixed(3)} (n = {ac.unseen_n}); the bars above are the published
            split, unchanged. None of the answers is acyclic, so{' '}
            {ac.targets_on_unseen_scaffolds} of {s.targets} on unseen scaffolds holds either way.
          </span>
        )}
      </p>
    </Part>
  );
}

/* --------------------------------------------------------------- (d) seeds */

function Seeds({ data }) {
  const { rows, auroc, assays_to_all: toAll, speedup_budget30: sp30, speedup_to_all: spAll } = data.seeds;
  const budget = data.seeds.speedup_budget;
  const allInside = rows.every((row) => row.found_in_30 === data.setup.targets);
  const lo = Math.floor((auroc.min - 0.005) * 200) / 200;
  const hi = Math.ceil((auroc.max + 0.005) * 200) / 200;
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;

  return (
    <Part letter="d" title={`Same model, ${rows.length} seeds`}>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-hive-400/15"
          style={{ left: x(auroc.mean - auroc.sd), width: `calc(${x(auroc.mean + auroc.sd)} - ${x(auroc.mean - auroc.sd)})` }}
        />
        {rows.map((row, i) => (
          <motion.div
            key={row.seed}
            title={`seed ${row.seed}: AUROC ${row.auroc}, run ${row.mlflow_run_id ?? 'n/a'}`}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-night-900 bg-hive-400"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.06 }}
            style={{ left: x(row.auroc) }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono cap-sm text-white/25">
        <span>{lo.toFixed(3)}</span>
        <span>AUROC</span>
        <span>{hi.toFixed(3)}</span>
      </div>

      <table className="mt-3 w-full border-collapse font-mono cap-sm">
        <thead>
          <tr className="text-white/30">
            <th className="py-1 text-left font-normal">seed</th>
            <th className="py-1 text-right font-normal">AUROC</th>
            <th className="py-1 text-right font-normal">to {data.setup.targets}</th>
            <th className="py-1 text-right font-normal">run</th>
          </tr>
        </thead>
        <tbody className="text-white/60">
          {rows.map((row) => (
            <tr key={row.seed} className="border-t border-white/[0.05]">
              <td className="py-1">{row.seed}</td>
              <td className="tabular py-1 text-right">{n3(row.auroc)}</td>
              <td className="tabular py-1 text-right">{row.assays_to_all}</td>
              <td className="py-1 text-right text-white/25">{row.mlflow_run_id?.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[12px] leading-relaxed text-white/55">
        AUROC {n3(auroc.mean)} ± {n3(auroc.sd)} (sd). All {data.setup.targets} answers by assay {n0(toAll.min)} to{' '}
        {n0(toAll.max)}. The budget-{budget} speedup is{' '}
        {sp30.sd === 0 ? `${sp30.mean}× in every seed` : `${sp30.mean}× ± ${sp30.sd}`}
        {allInside
          ? `, because every seed finds all ${data.setup.targets} inside ${budget} assays`
          : `; not every seed finds all ${data.setup.targets} inside ${budget} assays`}
        . Measured to the last answer it is {spAll.min.toFixed(2)}× to {spAll.max.toFixed(2)}× (
        {data.seeds.random_all_median_used} random assays divided by the seed's own count).
      </p>
    </Part>
  );
}

function MlflowFooter({ data }) {
  const m = data.mlflow;
  return (
    <div className="mt-6 border-t border-white/6 pt-3 font-mono cap-sm leading-relaxed text-white/30">
      MLflow: {m.runs} runs in experiment &quot;{m.experiment_name}&quot; (id {m.experiment_id}), file store at{' '}
      {m.tracking_dir}. Open with <span className="text-white/45">MLFLOW_ALLOW_FILE_STORE=true mlflow ui --backend-store-uri {m.tracking_dir}</span>.
      Rebuild: <span className="text-white/45">{data.command}</span>
    </div>
  );
}
