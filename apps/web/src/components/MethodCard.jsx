import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  AlertTriangle,
  Check,
  Clock,
  Database,
  Fingerprint,
  ListOrdered,
  Microscope,
  ShieldCheck,
  Target,
} from 'lucide-react';

/* The method, one step at a time. Every setting is read out of the source by
 * GET /api/ledger/method, which also reports the file and line it came from,
 * and every result is measured by the same call. */

const BASE = import.meta.env.VITE_LAB_API ?? '';

async function getJSON(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return response.json();
}

const int = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));

export default function MethodCard() {
  const [method, setMethod] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getJSON('/api/ledger/method')
      .then(setMethod)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <section className="glass lift rounded-xl px-5 pb-6 pt-5">
      <div className="font-mono text-[10px] text-hive-400/80">Method</div>
      <h2 className="font-serif-display mt-1 text-2xl text-wax">Each setting, and the line of code it comes from</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
        The server reads these values out of the source when the page loads. A grey tag gives the file and line.
      </p>

      {error && (
        <div className="mt-5 flex items-center gap-2 text-sm text-warn">
          <AlertTriangle className="h-4 w-4" /> Method card did not load: {error}
        </div>
      )}
      {!method && !error && (
        <p className="mt-6 font-mono text-[11px] text-white/35">
          reading settings from source and training the model once…
        </p>
      )}
      {method && <Steps m={method} />}
    </section>
  );
}

const STRATEGY_NOTE = {
  model: <>sorts the pool's insecticides by predicted safety, safest first.</>,
  insecticide_only: <>takes the insecticides in a shuffled order, with no model. It is the control.</>,
};

function Steps({ m }) {
  // Budgets come from the keys the server ran, smallest first.
  const [short, long] = Object.keys(m.scoring.runs).sort((a, b) => Number(a) - Number(b));
  const runShort = m.scoring.runs[short];
  const runLong = m.scoring.runs[long];
  const recallStep = m.scoring.targets ? (100 / m.scoring.targets).toFixed(1) : null;
  const gated = m.gate.gated_tools?.value ?? [];

  const steps = [
    {
      icon: Database,
      title: 'Data',
      body: (
        <>
          ApisTox: {int(m.data.rows)} molecules, each with a first-reported year from {m.data.year_min} to{' '}
          {m.data.year_max} and a binary honey bee toxicity label. The compound year does
          not establish when its toxicity label became available.
        </>
      ),
      tags: [
        { k: 'file', v: m.data.file },
        { k: 'sha256', v: `${m.data.sha256?.slice(0, 12)}…`, ok: m.data.matches_manifest },
        { k: 'y =', v: 'label', where: m.data.label_column },
      ],
    },
    {
      icon: Clock,
      title: 'Time split',
      body: (
        <>
          The model trains on molecules reported in or before {m.split.cutoff_year?.value} ({int(m.split.train)}).
          The {int(m.split.pool)} reported later are the pool it has to put in order. The dataset ships its own time
          split files ({int(m.split.shipped_split?.['time_train.csv'])} / {int(m.split.shipped_split?.['time_test.csv'])});
          the engine splits on the year column instead, which is why the counts differ.
        </>
      ),
      tags: [
        { k: 'cutoff_year', v: m.split.cutoff_year?.value, where: m.split.cutoff_year?.where },
        { k: 'rule', v: 'year <= cutoff', where: m.split.rule },
      ],
      extra: <DecadeChart decades={m.split.decades} cutoff={m.split.cutoff_year?.value} />,
    },
    {
      icon: Fingerprint,
      title: 'Model',
      body: (
        <>
          Morgan fingerprints into a random forest. Trained in {m.model.trained_seconds} s on this server. On the{' '}
          {int(m.split.pool)} post-cutoff molecules it separates toxic from non-toxic at AUROC{' '}
          <Num>{m.model.pool_auroc}</Num>.
        </>
      ),
      tags: [
        { k: 'radius', v: m.model.fingerprint_radius?.value, where: m.model.fingerprint_radius?.where },
        { k: 'bits', v: int(m.model.fingerprint_bits?.value), where: m.model.fingerprint_bits?.where },
        { k: 'trees', v: m.model.trees?.value, where: m.model.trees?.where },
        { k: 'seed', v: m.model.seed?.value, where: m.model.seed?.where },
      ],
    },
    {
      icon: ListOrdered,
      title: 'Acquisition strategies',
      body: (
        <ul className="mt-1 space-y-1">
          {m.strategies.names.map((name) => (
            <li key={name}>
              <Code>{name}</Code>{' '}
              {name === 'diversity' ? (
                <>
                  does the same as <Code>model</Code> but subtracts {m.strategies.diversity_weight?.value} from a
                  molecule's score for each pick already made from its scaffold.
                </>
              ) : (
                STRATEGY_NOTE[name] ?? <>is accepted by engine.order().</>
              )}
            </li>
          ))}
        </ul>
      ),
      tags: [
        { k: 'order()', v: 'engine', where: m.strategies.defined },
        { k: 'diversity_weight', v: m.strategies.diversity_weight?.value, where: m.strategies.diversity_weight?.where },
      ],
    },
    {
      icon: ShieldCheck,
      title: 'Human approval gate',
      gate: true,
      body: (
        <>
          Reading, searching and comparing need no approval. The {gated.length} tools that spend assay budget get{' '}
          <Code>ASK</Code> from the policy, and the session waits until a person approves.
          {m.gate.tool_call_cap && (
            <> A session is also capped at {m.gate.tool_call_cap.value} tool calls.</>
          )}
          {m.gate.budget_bounds && (
            <>
              {' '}
              The web API refuses budgets outside {m.gate.budget_bounds.value[0]} to {m.gate.budget_bounds.value[1]}.
            </>
          )}
        </>
      ),
      tags: [
        ...gated.map((t) => ({ k: 'gated', v: t, where: m.gate.gated_tools.where })),
        { k: 'returns', v: '"ASK"', where: m.gate.returns },
        ...(m.gate.tool_call_cap
          ? [{ k: m.gate.tool_call_cap.policy, v: m.gate.tool_call_cap.value, where: m.gate.tool_call_cap.where }]
          : []),
      ],
    },
    {
      icon: Target,
      title: 'Scoring against hidden answers',
      body: (
        <>
          An answer is a post-cutoff insecticide labelled non-toxic. There are {m.scoring.targets}, and the ordering
          never sees which they are. With {short} assays the learned ordering finds <Num>{runShort.found}</Num> of{' '}
          {runShort.targets}. A random order over all {int(m.split.pool)} pool molecules needs a median of{' '}
          <Num>{int(runShort.random_median)}</Num> assays to find as many ({m.strategies.random_shuffles?.value}{' '}
          shuffles), so the ratio is <Num>{runShort.speedup}×</Num>. With {long} assays it finds {runLong.found} of{' '}
          {runLong.targets} and the ratio is <Num>{runLong.speedup}×</Num>, because the budget is the divisor. We
          report both.
          {recallStep && <> With only {m.scoring.targets} answers, one molecule moves recall by {recallStep} points.</>}
        </>
      ),
      tags: [
        { k: 'answer', v: 'insecticide == 1 and label == 0', where: m.scoring.target_rule },
        { k: 'shuffles', v: m.strategies.random_shuffles?.value, where: m.strategies.random_shuffles?.where },
      ],
      extra: <HitStrip budget={Number(short)} foundAt={runShort.found_at} />,
    },
    {
      icon: Microscope,
      title: 'Falsification',
      warn: true,
      body: (
        <>
          We split the pool by Murcko scaffold, seen before the cutoff or not. The ranking holds up on familiar
          chemistry and gets worse on new chemistry. {m.falsification.targets_on_unseen} of the{' '}
          {m.falsification.targets} answers sit on unseen scaffolds, so most answers are in the weaker group.
        </>
      ),
      tags: [{ k: 'scaffold', v: 'MurckoScaffold', where: m.falsification.scaffold }],
      extra: (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Meter label="seen scaffolds" n={m.falsification.seen_n} value={m.falsification.seen_auroc} tone="signal" />
          <Meter label="unseen scaffolds" n={m.falsification.unseen_n} value={m.falsification.unseen_auroc} tone="warn" />
        </div>
      ),
    },
  ];

  return (
    <ol className="relative mt-6">
      <span className="absolute bottom-3 left-[15px] top-3 w-px bg-gradient-to-b from-hive-400/50 via-white/10 to-warn/40" />
      {steps.map((step, index) => (
        <Step key={step.title} index={index} step={step} />
      ))}
    </ol>
  );
}

function Step({ index, step }) {
  const Icon = step.icon;
  const ring = step.gate
    ? 'border-hive-400/70 bg-hive-400/15 text-hive-400'
    : step.warn
      ? 'border-warn/50 bg-warn/10 text-warn'
      : 'border-white/15 bg-night-800 text-white/55';

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="relative grid grid-cols-[32px_1fr] gap-x-4 pb-6 last:pb-0"
    >
      <div className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border ${ring}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className={`min-w-0 ${step.gate ? 'rounded-lg border border-hive-400/20 bg-hive-400/[0.04] p-3 -mt-1' : ''}`}>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-white/25">{String(index + 1).padStart(2, '0')}</span>
          <h3 className="text-[15px] font-semibold text-white/90">{step.title}</h3>
        </div>
        <div className="mt-1 text-sm leading-relaxed text-white/60">{step.body}</div>
        {step.extra}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {step.tags.map((tag, i) => (
            <Tag key={`${tag.k}-${i}`} {...tag} />
          ))}
        </div>
      </div>
    </motion.li>
  );
}

function Tag({ k, v, where, ok }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 overflow-hidden rounded border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px]">
      <span className="text-white/35">{k}</span>
      <span className="truncate text-white/80">{String(v)}</span>
      {ok === true && <Check className="h-3 w-3 shrink-0 text-signal" />}
      {where && <span className="hidden truncate text-white/25 sm:inline">{where}</span>}
    </span>
  );
}

function Num({ children }) {
  return <span className="tabular font-mono font-semibold text-white/90">{children}</span>;
}

function Code({ children }) {
  return <span className="rounded bg-white/[0.06] px-1 font-mono text-[12px] text-hive-200">{children}</span>;
}

function DecadeChart({ decades, cutoff }) {
  if (!decades?.length) return null;
  const data = decades.map((d) => ({ ...d, label: typeof d.decade === 'number' ? `${d.decade}s` : d.decade }));
  return (
    <div className="mt-3">
      <div className="h-28 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={3}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{
                background: '#12121a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, name) => [value, name === 'known' ? `training (<= ${cutoff})` : `pool (> ${cutoff})`]}
            />
            <Bar dataKey="known" stackId="a" fill="rgba(255,255,255,0.28)" />
            <Bar dataKey="after" stackId="a" fill="#fbbf24" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-4 font-mono text-[10px] text-white/40">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-white/30" /> training
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-hive-400" /> pool
        </span>
        <span className="text-white/25">molecules per decade of first report</span>
      </div>
    </div>
  );
}

function HitStrip({ budget, foundAt }) {
  const hits = new Set(foundAt ?? []);
  return (
    <div className="mt-3">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${budget}, minmax(0, 1fr))` }}>
        {Array.from({ length: budget }, (_, i) => i + 1).map((position) => (
          <motion.div
            key={position}
            initial={{ opacity: 0, scaleY: 0.3 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ delay: 0.4 + position * 0.015 }}
            title={`assay ${position}${hits.has(position) ? ': answer found' : ''}`}
            className={`h-5 rounded-[2px] ${hits.has(position) ? 'bg-hive-400' : 'bg-white/[0.07]'}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-white/30">
        <span>assay 1</span>
        <span>amber = answer found at that position</span>
        <span>{budget}</span>
      </div>
    </div>
  );
}

function Meter({ label, n, value, tone }) {
  const bar = tone === 'warn' ? 'bg-warn' : 'bg-signal';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/50">
          {label} <span className="text-white/30">n={n}</span>
        </span>
        <span className="tabular font-mono font-semibold text-white/85">AUROC {value}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <span className="absolute left-1/2 top-0 h-full w-px bg-white/25" title="0.5 = chance" />
        <motion.div
          className={`h-full ${bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}
