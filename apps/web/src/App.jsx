import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Cpu,
  FlaskConical,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getFacts, runExperiment, searchEvidence } from './api.js';
import { Counter, SpeedupDial } from './components/Dial.jsx';
import { AssayStream } from './components/AssayStream.jsx';

const STRATEGIES = [
  { id: 'model', label: 'Learned ordering', hint: 'Rank by predicted bee safety' },
  { id: 'diversity', label: 'Scaffold diversity', hint: 'Penalise repeating a scaffold' },
  { id: 'insecticide_only', label: 'No model', hint: 'Insecticides in arbitrary order' },
];

const STAGES = [
  { id: 'literature', label: 'Literature', icon: BookOpen, note: 'finds evidence' },
  { id: 'insight', label: 'Insight', icon: Sparkles, note: 'proposes a hypothesis' },
  { id: 'planner', label: 'Planner', icon: Cpu, note: 'compares two tests' },
  { id: 'approval', label: 'Approval', icon: ShieldCheck, note: 'a human decides' },
  { id: 'runner', label: 'Runner', icon: FlaskConical, note: 'spends the budget' },
  { id: 'analysis', label: 'Analysis', icon: Activity, note: 'keeps or breaks it' },
];

export default function App() {
  const [facts, setFacts] = useState(null);
  const [strategy, setStrategy] = useState('model');
  const [budget, setBudget] = useState(30);
  const [result, setResult] = useState(null);
  const [stage, setStage] = useState(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState(null);
  const revealTimer = useRef(null);

  useEffect(() => {
    getFacts().then(setFacts).catch((e) => setError(e.message));
    return () => clearInterval(revealTimer.current);
  }, []);

  /** Walk the loop: the first stages are narration over work already done,
   *  the approval is a real stop, and the run after it is a real computation. */
  const startLoop = useCallback(async () => {
    setError(null);
    setResult(null);
    setRevealed(0);
    clearInterval(revealTimer.current);

    for (const id of ['literature', 'insight', 'planner']) {
      setStage(id);
      if (id === 'literature' && !evidence) {
        searchEvidence('honey bee acute toxicity insecticide', 3)
          .then(setEvidence)
          .catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 620));
    }

    setStage('approval');
    setAwaitingApproval(true);
  }, [evidence]);

  const approve = useCallback(async () => {
    setAwaitingApproval(false);
    setStage('runner');
    try {
      const run = await runExperiment({ strategy, budget });
      setResult(run);
      setStage('analysis');

      let shown = 0;
      revealTimer.current = setInterval(() => {
        shown += 1;
        setRevealed(shown);
        if (shown >= run.assays.length) clearInterval(revealTimer.current);
      }, 55);
    } catch (e) {
      setError(e.message);
      setStage(null);
    }
  }, [strategy, budget]);

  const deny = useCallback(() => {
    setAwaitingApproval(false);
    setStage(null);
  }, []);

  const stageIndex = STAGES.findIndex((s) => s.id === stage);

  return (
    <div className="hex-field min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Header facts={facts} />

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        <Pipeline stage={stage} stageIndex={stageIndex} />

        <div className="mt-6 grid gap-5 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-5">
            <Controls
              strategy={strategy}
              setStrategy={setStrategy}
              budget={budget}
              setBudget={setBudget}
              onRun={startLoop}
              busy={stage !== null && !awaitingApproval && !result}
              facts={facts}
            />
            <SpeedupPanel result={result} budget={budget} facts={facts} />
          </div>

          <div className="space-y-5">
            <AnimatePresence>
              {awaitingApproval && (
                <ApprovalCard
                  strategy={strategy}
                  budget={budget}
                  onApprove={approve}
                  onDeny={deny}
                />
              )}
            </AnimatePresence>

            <AssayPanel result={result} revealed={revealed} />
            <BreakPanel facts={facts} result={result} />
            <EvidencePanel evidence={evidence} />
          </div>
        </div>

        <Footer facts={facts} />
      </div>
    </div>
  );
}

function Header({ facts }) {
  return (
    <header className="mb-8">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-hive-400/80">
        <span className="drift inline-block">⬡</span> BeeGuard Lab
      </div>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-white/95 sm:text-5xl">
        We sent a lab back to the year 2000
        <span className="text-hive-400">.</span>
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
        It reads only the chemistry known by then, and has to find the
        insecticides that turned out to be safe for honey bees, confirmed only
        in the two decades after. A bee toxicity assay costs real colonies and
        real weeks, so the question is not accuracy. It is what to test first.
      </p>
      {facts && (
        <div className="mt-5 flex flex-wrap gap-x-7 gap-y-2 text-sm text-white/45">
          <Stat value={facts.train_molecules} label="molecules known by 2000" />
          <Stat value={facts.pool_molecules} label="to be ordered" />
          <Stat value={facts.targets} label="answers hidden among them" />
          <Stat value={facts.trained_seconds} label="seconds to train" decimals={1} />
        </div>
      )}
    </header>
  );
}

function Stat({ value, label, decimals = 0 }) {
  return (
    <span>
      <span className="font-semibold text-white/80">
        <Counter value={value} decimals={decimals} />
      </span>{' '}
      {label}
    </span>
  );
}

function Pipeline({ stage, stageIndex }) {
  return (
    <div className="glass lift flex items-stretch gap-1 overflow-x-auto rounded-xl p-2">
      {STAGES.map((s, index) => {
        const Icon = s.icon;
        const active = s.id === stage;
        const done = stageIndex > index;
        return (
          <div
            key={s.id}
            className={`relative flex min-w-[8.5rem] flex-1 flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-colors ${
              active ? 'bg-hive-400/12' : done ? 'bg-white/[0.03]' : ''
            }`}
          >
            {active && (
              <motion.div
                layoutId="stage-glow"
                className="absolute inset-0 rounded-lg ring-1 ring-hive-400/50"
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <div className="flex items-center gap-1.5">
              <Icon
                className={`h-3.5 w-3.5 ${
                  active ? 'text-hive-400' : done ? 'text-signal/70' : 'text-white/25'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  active ? 'text-white' : done ? 'text-white/65' : 'text-white/35'
                }`}
              >
                {s.label}
              </span>
            </div>
            <span className="text-[10px] text-white/30">{s.note}</span>
          </div>
        );
      })}
    </div>
  );
}

function Controls({ strategy, setStrategy, budget, setBudget, onRun, busy, facts }) {
  return (
    <section className="glass lift rounded-xl p-5">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">
        Set the experiment
      </h2>

      <div className="mt-4 space-y-1.5">
        {STRATEGIES.map((option) => (
          <button
            key={option.id}
            onClick={() => setStrategy(option.id)}
            className={`w-full rounded-lg border px-3 py-2.5 text-left transition-all ${
              strategy === option.id
                ? 'border-hive-400/50 bg-hive-400/10'
                : 'border-white/6 bg-white/[0.02] hover:border-white/15'
            }`}
          >
            <div className="text-sm font-medium text-white/85">{option.label}</div>
            <div className="text-[11px] text-white/40">{option.hint}</div>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-white/60">Assay budget</span>
          <span className="tabular text-lg font-semibold text-hive-400">{budget}</span>
        </div>
        <input
          type="range"
          min="5"
          max={facts?.pool_molecules ?? 201}
          value={budget}
          onChange={(event) => setBudget(Number(event.target.value))}
          className="mt-2 w-full accent-hive-500"
        />
        <p className="mt-1.5 text-[11px] text-white/35">
          Each assay is one molecule tested on live colonies.
        </p>
      </div>

      <button
        onClick={onRun}
        disabled={busy}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-hive-500 px-4 py-3 text-sm font-semibold text-night-900 transition hover:bg-hive-400 disabled:opacity-40"
      >
        <Play className="h-4 w-4" />
        {busy ? 'Running the loop…' : 'Run the discovery loop'}
      </button>
    </section>
  );
}

function SpeedupPanel({ result, budget, facts }) {
  return (
    <section className="glass lift rounded-xl p-5">
      <SpeedupDial
        speedup={result?.speedup}
        found={result?.found}
        total={facts?.targets}
        budget={result?.budget ?? budget}
      />
      {result && (
        <p className="mt-3 text-center text-xs leading-relaxed text-white/45">
          Random ordering needs{' '}
          <span className="font-semibold text-white/70">
            {result.random_assays_for_same_hits}
          </span>{' '}
          assays for the same {result.found}. Measured over 500 shuffles,{' '}
          not estimated.
        </p>
      )}
    </section>
  );
}

function ApprovalCard({ strategy, budget, onApprove, onDeny }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="glass glow-amber rounded-xl p-5"
    >
      <div className="flex items-center gap-2 text-hive-400">
        <ShieldCheck className="h-4 w-4" />
        <span className="text-[11px] uppercase tracking-[0.2em]">
          Waiting for a scientist
        </span>
      </div>
      <p className="mt-3 text-[15px] text-white/85">
        The planner wants to spend{' '}
        <span className="font-semibold text-hive-400">{budget} assays</span> using
        the {STRATEGIES.find((s) => s.id === strategy)?.label.toLowerCase()}.
      </p>
      <p className="mt-1.5 text-xs text-white/45">
        Nothing runs until you approve. The gate is an Omnigent policy in code
        the agents cannot edit, not a line in a prompt asking them to behave.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-night-900 transition hover:brightness-110"
        >
          Approve and run
        </button>
        <button
          onClick={onDeny}
          className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white/60 transition hover:border-white/25"
        >
          Deny
        </button>
      </div>
    </motion.section>
  );
}

function AssayPanel({ result, revealed }) {
  if (!result) {
    return (
      <section className="glass lift grid min-h-[13rem] place-items-center rounded-xl p-5 text-center">
        <div>
          <FlaskConical className="mx-auto h-7 w-7 text-white/15" />
          <p className="mt-3 text-sm text-white/35">
            Set a budget, then run the loop. The queue appears here as the lab
            orders it.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">
          Assay queue
        </h2>
        <span className="text-xs text-white/40">
          hits at positions {result.found_at.join(', ') || 'none yet'}
        </span>
      </div>
      <div className="max-h-[22rem] overflow-y-auto pr-1">
        <AssayStream assays={result.assays} revealed={revealed} />
      </div>
    </section>
  );
}

function BreakPanel({ facts, result }) {
  if (!facts?.holdout) return null;
  const { seen_auroc: seen, unseen_auroc: unseen } = facts.holdout;
  const gap = (seen - unseen).toFixed(3);

  return (
    <section className="glass lift rounded-xl border-warn/20 p-5">
      <div className="flex items-center gap-2 text-warn">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-[11px] uppercase tracking-[0.2em]">
          Where the hypothesis breaks
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/70">
        The rule holds on chemistry the model already knew, and weakens on
        scaffolds it never saw. That gap is {gap} AUROC. And{' '}
        <span className="font-semibold text-warn">
          {facts.targets_on_unseen_scaffolds} of the {facts.targets} answers
        </span>{' '}
        live on exactly those unfamiliar scaffolds.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Meter label="Scaffolds seen" value={seen} count={facts.holdout.seen_n} tone="signal" />
        <Meter
          label="Scaffolds never seen"
          value={unseen}
          count={facts.holdout.unseen_n}
          tone="warn"
        />
      </div>
      {result && (
        <p className="mt-4 border-t border-white/5 pt-3 text-xs text-white/45">
          Next experiment this result justifies: push scaffold diversity into
          the ordering, so the budget stops buying near-duplicates of chemistry
          the model already understands.
        </p>
      )}
    </section>
  );
}

function Meter({ label, value, count, tone }) {
  const color = tone === 'warn' ? 'bg-warn' : 'bg-signal';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/50">{label}</span>
        <span className="tabular font-semibold text-white/80">{value.toFixed(3)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className={`h-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <div className="mt-1 text-[10px] text-white/30">{count} molecules</div>
    </div>
  );
}

function EvidencePanel({ evidence }) {
  if (!evidence) return null;
  const papers = [
    ...(evidence.openalex?.items ?? []).slice(0, 2),
    ...(evidence.europepmc?.items ?? []).slice(0, 2),
  ];
  if (!papers.length) return null;

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-white/35" />
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">
          Evidence the literature agent pulled, just now
        </h2>
      </div>
      <ul className="mt-3 space-y-2">
        {papers.map((paper, index) => (
          <motion.li
            key={paper.url ?? index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.07 }}
            className="text-sm"
          >
            <a
              href={paper.url}
              target="_blank"
              rel="noreferrer"
              className="text-white/75 underline decoration-white/15 underline-offset-2 hover:text-hive-400"
              dangerouslySetInnerHTML={{ __html: paper.title }}
            />
            <span className="ml-2 text-xs text-white/35">{paper.year}</span>
          </motion.li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-white/30">
        Live from OpenAlex and Europe PMC. A failed lookup shows nothing rather
        than something invented.
      </p>
    </section>
  );
}

function Footer({ facts }) {
  return (
    <footer className="mt-10 border-t border-white/5 pt-5 text-xs leading-relaxed text-white/30">
      <p>
        Data: ApisTox ({facts?.train_molecules ?? '—'} +{' '}
        {facts?.pool_molecules ?? '—'} molecules), CC BY-NC 4.0, used under its
        non-commercial terms. Our code is MIT. Nothing here is advice about
        pesticide use; the lab proposes what to test next, and every number on
        this page was measured by the code in the repository.
      </p>
    </footer>
  );
}
