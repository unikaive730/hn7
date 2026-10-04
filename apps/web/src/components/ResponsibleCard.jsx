import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Check, Copy, FileText, Scale, ShieldCheck, Terminal } from 'lucide-react';

/* Data card, model card, dual-use note and how to reproduce. The numbers come
 * from GET /api/ledger/datacard, which reads the CSV and the trained model on
 * the server. The prose is ours; where it states a number, the number is live. */

const BASE = import.meta.env.VITE_LAB_API ?? '';

async function getJSON(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return response.json();
}

const int = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));
const pct = (x) => (x == null ? '?' : `${(x * 100).toFixed(1)}%`);

const REPRODUCE = [
  {
    note: 'Download ApisTox and write lab/data/manifest.json with a sha256 per file.',
    cmd: 'PYTHONUTF8=1 lab/.venv/Scripts/python.exe lab/scripts/fetch_data.py',
  },
  {
    note: 'Train once, then print the pool facts, the holdout AUROCs and one run per strategy.',
    cmd: 'PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.engine',
  },
  {
    note: 'Start the API this page talks to.',
    cmd: 'PYTHONUTF8=1 lab/.venv/Scripts/python.exe -m uvicorn lab.beeguard.api:app --port 8900',
  },
  {
    note: 'Start the web app. It forwards /api to port 8900.',
    cmd: 'cd apps/web && npm run dev',
  },
  {
    note: 'Run the agent lab. In non-interactive mode it stops at the approval gate, since nobody is there to approve.',
    cmd: 'bash scripts/lab.sh "Run one full discovery loop."',
  },
];

export default function ResponsibleCard() {
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getJSON('/api/ledger/datacard')
      .then(setCard)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <section className="glass lift overflow-hidden rounded-xl">
      <header className="border-b border-white/[0.06] px-5 py-4">
        <div className="font-mono cap-sm text-hive-400/80">Responsibility</div>
        <h3 className="mt-1.5 font-mono text-[13px] uppercase tracking-[0.14em] text-white/75">Intended use, known limits, dual-use risk</h3>
      </header>

      {error && (
        <div className="flex items-center gap-2 px-5 py-5 text-sm text-warn">
          <AlertTriangle className="h-4 w-4" /> Data card did not load: {error}
        </div>
      )}
      {!card && !error && (
        <p className="px-5 py-6 font-mono cap text-white/35">reading the dataset and the trained model…</p>
      )}

      {card && (
        <>
          <div className="grid lg:grid-cols-2">
            <DataCard card={card} />
            <ModelCard card={card} />
          </div>
          <DualUse card={card} />
          <Reproduce sha={card.dataset.sha256} />
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- data card */

function DataCard({ card }) {
  const d = card.dataset;
  const shares = card.by_source.map((s) => s.toxic_share);
  const low = Math.min(...shares);
  const high = Math.max(...shares);
  // One scale for both bar groups, so source and exposure bars compare directly.
  const scale = Math.max(high, ...card.by_exposure.map((e) => e.toxic_share), 0.01);
  const repo = d.source_url?.match(/githubusercontent\.com\/([^/]+\/[^/]+)\//)?.[1];

  return (
    <div className="border-b border-white/[0.06] px-5 py-5 lg:border-b-0 lg:border-r">
      <Heading icon={FileText}>Data card</Heading>

      <dl className="mt-3 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[7.5rem_1fr] sm:gap-y-2">
        <Term>Dataset</Term>
        <Def>
          {d.name}, fetched by <Mono>{d.license_from?.split(':')[0] ?? 'lab/scripts/fetch_data.py'}</Mono>
          {repo && (
            <>
              {' '}
              from{' '}
              <a
                className="text-white/75 underline decoration-white/20 underline-offset-2 hover:text-hive-400"
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noreferrer"
              >
                {repo}
              </a>
            </>
          )}
          .
        </Def>
        <Term>Size</Term>
        <Def>
          <Mono>{int(d.molecules)}</Mono> molecules: <Mono>{int(d.toxic)}</Mono> labelled toxic to honey bees,{' '}
          <Mono>{int(d.non_toxic)}</Mono> not. First reported between {d.year_min} and {d.year_max}.
        </Def>
        <Term>Licence</Term>
        <Def>
          <Mono>{d.license}</Mono>.
          {/NC/.test(d.license ?? '') && (
            <> Non-commercial use only, and that covers the trained model and the rankings on this page.</>
          )}{' '}
          Our code is MIT, which does not change the data's terms. Other files in lab/data have their own licences; the
          ledger lists them.
          {d.citation && (
            <div className="mt-1.5 cap leading-relaxed text-white/45">
              Cite the creators as the licence asks: {d.citation}
              {d.citation_doi && (
                <>
                  {' '}
                  <a
                    className="text-white/70 underline decoration-white/20 underline-offset-2 hover:text-hive-400"
                    href={d.citation_doi}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.citation_doi.replace('https://doi.org/', 'doi:')}
                  </a>
                </>
              )}
            </div>
          )}
        </Def>
        <Term>Exposure</Term>
        <Def>
          {card.by_exposure.map((e, i) => (
            <span key={e.value}>
              {i > 0 && ', '}
              {e.value.toLowerCase()} <Mono>{int(e.molecules)}</Mono>
            </span>
          ))}
          . All {card.by_exposure.length} exposure types share one binary label.
        </Def>
      </dl>

      <div className="mt-4">
        <div className="font-mono cap-sm uppercase tracking-wider text-white/35">
          Toxic share by source database · bars to {pct(scale)}
        </div>
        <div className="mt-2 space-y-2">
          {card.by_source.map((source, i) => (
            <div key={source.value}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-mono text-white/70">
                  {source.value} <span className="text-white/30">n={int(source.molecules)}</span>
                </span>
                <span className="tabular font-mono text-white/85">{pct(source.toxic_share)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full bg-hive-400/70"
                  initial={{ width: 0 }}
                  animate={{ width: `${(source.toxic_share / scale) * 100}%` }}
                  transition={{ duration: 0.7, delay: i * 0.06 }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 font-mono cap-sm uppercase tracking-wider text-white/35">
          Toxic share by exposure type · bars to {pct(scale)}
        </div>
        <div className="mt-2 space-y-2">
          {card.by_exposure.map((route, i) => (
            <div key={route.value}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-mono text-white/70">
                  {route.value.toLowerCase()} <span className="text-white/30">n={int(route.molecules)}</span>
                </span>
                <span className="tabular font-mono text-white/85">{pct(route.toxic_share)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full bg-white/30"
                  initial={{ width: 0 }}
                  animate={{ width: `${(route.toxic_share / scale) * 100}%` }}
                  transition={{ duration: 0.7, delay: 0.2 + i * 0.06 }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/45">
          The toxic share runs from {pct(low)} to {pct(high)} depending on which database a label came from. Part of
          that is different chemistry in each database, part is where each one draws the line. This data cannot tell
          the two apart, so treat the labels as noisy.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ model card */

function ModelCard({ card }) {
  const dom = card.domain;
  const split = card.split;
  const hold = split.holdout;
  const recallStep = split.targets ? (100 / split.targets).toFixed(1) : '?';

  return (
    <div className="px-5 py-5">
      <Heading icon={Scale}>Model card</Heading>

      <dl className="mt-3 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[7.5rem_1fr] sm:gap-y-2">
        <Term>Intended use</Term>
        <Def>
          Deciding which molecules to send first when a honey bee acute toxicity assay budget is fixed. Also a
          retrospective benchmark split by compound first-report year at {split.cutoff_year}.
        </Def>
        <Term>Out of scope</Term>
        <Def>
          Regulatory or registration decisions. Advice on how or where to spray. Other bee species, chronic or sublethal
          effects, mixtures and formulated products. Commercial use of any kind, because of the data licence.
        </Def>
      </dl>

      <div className="mt-4 font-mono cap-sm uppercase tracking-wider text-white/35">Known limitations</div>
      <ul className="mt-2 space-y-2 text-sm leading-relaxed text-white/60">
        <Limit>
          <b className="font-semibold text-white/80">Small answer set.</b> {split.targets} hidden answers in a pool of{' '}
          {int(split.pool)}. One molecule is {recallStep} points of recall, so the headline moves a lot with a single
          label.
        </Limit>
        <Limit>
          <b className="font-semibold text-white/80">Mixed labels.</b> {card.by_source.length} source databases and{' '}
          {card.by_exposure.length} exposure types feed one binary label (see the data card).
        </Limit>
        <Limit>
          <b className="font-semibold text-white/80">Scaffold shift.</b> {int(split.unseen_scaffold_molecules)} of{' '}
          {int(split.pool)} pool molecules have a scaffold the training set never had. AUROC there is{' '}
          <Mono>{hold?.unseen_auroc}</Mono>, against <Mono>{hold?.seen_auroc}</Mono> on familiar scaffolds. The two
          bootstrap intervals in the rigor checks overlap, so read this as a tendency, not a measured gap.
        </Limit>
        <Limit>
          <b className="font-semibold text-white/80">Applicability domain.</b> {int(dom.pool_below_0_4)} of{' '}
          {int(dom.pool)} pool molecules have no training neighbour at or above {dom.threshold} Tanimoto similarity, and{' '}
          {dom.answers_below_0_4} of the {dom.answers} answers are among them. Scores for those molecules are
          extrapolation.
        </Limit>
        <Limit>
          <b className="font-semibold text-white/80">Retrospective only.</b> The year marks a compound’s first report,
          not its toxicity assay date. This split does not prove which labels a historical lab could have accessed.
          The lab reveals existing labels and has not tested a new molecule.
        </Limit>
      </ul>

      <DomainChart domain={dom} />
    </div>
  );
}

function DomainChart({ domain }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-mono cap-sm uppercase tracking-wider text-white/35">
          Nearest training neighbour, per pool molecule
        </span>
        <span className="font-mono cap-sm text-white/30">
          median {domain.median_pool} pool · {domain.median_answers} answers
        </span>
      </div>
      <div className="mt-2 h-36 w-full">
        <ResponsiveContainer>
          <BarChart data={domain.histogram} margin={{ top: 6, right: 4, bottom: 0, left: -26 }} barCategoryGap={2}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="bin"
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
            />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} allowDecimals={false} />
            <ReferenceLine x={Number(domain.threshold).toFixed(1)} stroke="rgba(251,113,133,0.6)" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{
                background: '#12121a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(bin) => {
                const bins = domain.histogram.map((h) => Number(h.bin));
                const width = bins.length > 1 ? bins[1] - bins[0] : 0;
                return `similarity ${bin} to ${(Number(bin) + width).toFixed(1)}`;
              }}
              formatter={(value, name) => [value, name === 'answers' ? 'hidden answers' : 'other pool molecules']}
            />
            <Bar dataKey="pool" stackId="s" fill="rgba(255,255,255,0.25)" />
            <Bar dataKey="answers" stackId="s" fill="#fbbf24" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 cap leading-relaxed text-white/35">
        Max Tanimoto similarity to any molecule reported by the cutoff, on the same fingerprints the model uses. Left of
        the dashed line, no training molecule reaches {domain.threshold}.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- dual use */

const ORDERING = {
  model: 'safest first',
  diversity: 'safest first, fewer repeats per scaffold',
  insecticide_only: 'a shuffle',
};

function DualUse({ card }) {
  return (
    <div className="border-t border-warn/15 bg-warn/[0.03] px-5 py-5">
      <Heading icon={AlertTriangle} tone="warn">
        Dual use
      </Heading>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/65">
        A model that scores molecules for bee safety also scores them for bee toxicity. Flip the sign and it points at
        chemistry that harms pollinators. The data is public and the model is an ordinary random forest, so we do not
        think this lab adds much to that risk. We still limited what the app itself will do:
      </p>
      <ul className="mt-3 grid gap-2 text-sm text-white/60 md:grid-cols-2">
        <Mitigation>
          The API and the MCP tools accept {card.strategies.value.length} orderings:{' '}
          {card.strategies.value.map((name, i) => (
            <span key={name}>
              {i > 0 && ', '}
              <Mono>{name}</Mono> ({ORDERING[name] ?? 'see engine.order()'})
            </span>
          ))}
          . None ranks toxic first.
        </Mitigation>
        <Mitigation>
          Spending assay budget goes through an Omnigent policy that returns <Mono>ASK</Mono>. A person approves each
          experiment, and a session is capped in tool calls.
        </Mitigation>
        <Mitigation>
          It does not generate molecules. It only reorders the {int(card.split.pool)} that are already in the dataset.
        </Mitigation>
        <Mitigation>The data licence rules out commercial use of the model and its rankings.</Mitigation>
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-white/40">
        None of this stops someone with the code from inverting the score. It keeps this deployment from doing it on
        request.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- reproduce */

function Reproduce({ sha }) {
  const [copied, setCopied] = useState(null);

  const copy = (text, index) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(index);
        setTimeout(() => setCopied(null), 1400);
      },
      () => {},
    );
  };

  return (
    <div className="border-t border-white/[0.06] px-5 py-5">
      <Heading icon={Terminal}>Reproduce</Heading>
      <p className="mt-2 text-sm text-white/55">
        From the repository root. Paths are for the Windows venv we built on; on Linux or macOS use{' '}
        <Mono>lab/.venv/bin/python</Mono>.
      </p>
      <ol className="mt-3 space-y-2">
        {REPRODUCE.map((step, index) => (
          <li key={step.cmd} className="rounded-lg border border-white/[0.06] bg-night-900/70">
            <div className="flex items-start justify-between gap-3 px-3 pt-2">
              <span className="cap leading-snug text-white/45">
                <span className="mr-1.5 font-mono text-white/25">{index + 1}.</span>
                {step.note}
              </span>
              <button
                onClick={() => copy(step.cmd, index)}
                className="tap-y shrink-0 rounded p-1 max-md:min-w-10 text-white/35 transition hover:bg-white/5 hover:text-white/70"
                aria-label="Copy command"
              >
                {copied === index ? <Check className="h-3.5 w-3.5 text-signal" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <pre className="overflow-x-auto px-3 pb-2 pt-1 font-mono cap text-hive-200/90">{step.cmd}</pre>
          </li>
        ))}
      </ol>
      {sha && (
        <p className="mt-3 break-all font-mono cap-sm leading-relaxed text-white/30">
          <ShieldCheck className="mr-1 inline h-3 w-3 text-signal/70" />
          dataset_final.csv sha256 {sha}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Heading({ icon: Icon, tone, children }) {
  return (
    <div className={`flex items-center gap-2 ${tone === 'warn' ? 'text-warn' : 'text-white/55'}`}>
      <Icon className="h-4 w-4" />
      <h3 className="font-mono cap">{children}</h3>
    </div>
  );
}

function Term({ children }) {
  return <dt className="pt-1.5 font-mono sm:pt-0.5 cap-sm uppercase tracking-wider text-white/35">{children}</dt>;
}

function Def({ children }) {
  return <dd className="min-w-0 leading-relaxed text-white/65">{children}</dd>;
}

function Mono({ children }) {
  return <span className="tabular font-mono text-[0.92em] text-white/85">{children}</span>;
}

function Limit({ children }) {
  return (
    <li className="relative pl-4">
      <span className="absolute left-0 top-[0.6em] h-1 w-1.5 rounded-full bg-white/25" />
      {children}
    </li>
  );
}

function Mitigation({ children }) {
  return (
    <li className="flex gap-2 rounded-lg border border-white/[0.05] bg-night-900/40 px-3 py-2 leading-relaxed">
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" />
      <span>{children}</span>
    </li>
  );
}
