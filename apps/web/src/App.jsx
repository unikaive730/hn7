import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
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
import {
  compareStrategies,
  getCurve,
  getEras,
  getFacts,
  getMolecule,
  getRecord,
  runExperiment,
  searchEvidence,
} from './api.js';
import { SpeedupDial } from './components/Dial.jsx';
import { AssayStream } from './components/AssayStream.jsx';
import { DiscoveryCurve } from './components/Curve.jsx';
import { EraPanel, MoleculePanel, RecordPanel, StrategyCompare } from './components/Panels.jsx';
import SiteNav from './components/SiteNav.jsx';
import Hero from './components/Hero.jsx';
import SiteFooter from './components/SiteFooter.jsx';

// Sections below the lab load as separate chunks, so the first screen does
// not wait for the agent replay, the evidence graph or the ledger.
const AgentRoom = lazy(() => import('./components/AgentRoom.jsx'));
const LearningLoop = lazy(() => import('./components/LearningLoop.jsx'));
const RediscoveredGallery = lazy(() => import('./components/RediscoveredGallery.jsx'));
const ChemicalSpace = lazy(() => import('./components/ChemicalSpace.jsx'));
const EvidenceGraph = lazy(() => import('./components/EvidenceGraph.jsx'));
const RigorPanel = lazy(() => import('./components/RigorPanel.jsx'));
const ExternalValidation = lazy(() => import('./components/ExternalValidation.jsx'));
const Candidates = lazy(() => import('./components/Candidates.jsx'));
const MethodCard = lazy(() => import('./components/MethodCard.jsx'));
const ResponsibleCard = lazy(() => import('./components/ResponsibleCard.jsx'));
const Ledger = lazy(() => import('./components/Ledger.jsx'));

const CUTOFF = 2000; // the experiment's design input, not a result
const DEFAULT_BUDGET = 30; // the slider's starting value, also an input
const REVEAL_MS = 2500; // how long the whole queue takes to appear, at any budget
const REVEAL_TICK_MS = 55; // one row per tick at the default budget

const STRATEGIES = [
  { id: 'model', label: 'Learned ordering', hint: 'Insecticides first, lowest predicted bee risk first' },
  { id: 'diversity', label: 'Scaffold diversity', hint: 'Same, with a penalty for repeating a scaffold' },
  { id: 'insecticide_only', label: 'No model', hint: 'Insecticides first, in arbitrary order' },
];

// What each step does in this browser run. The recorded agent run, where
// every step is a real agent turn, is replayed in the Agents section.
const STAGES = [
  { id: 'literature', label: 'Literature', icon: BookOpen, note: 'live search' },
  { id: 'insight', label: 'Insight', icon: Sparkles, note: 'states the rule to test' },
  { id: 'planner', label: 'Planner', icon: Cpu, note: 'takes your ordering and budget' },
  { id: 'approval', label: 'Approval', icon: ShieldCheck, note: 'you accept or deny' },
  { id: 'runner', label: 'Runner', icon: FlaskConical, note: 'server ranks the pool' },
  { id: 'analysis', label: 'Analysis', icon: Activity, note: 'queue and speedup' },
];

export default function App() {
  const [facts, setFacts] = useState(null);
  const [strategy, setStrategy] = useState('model');
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [result, setResult] = useState(null);
  // The same retrospective preview the hero shows, so the dial and the queue
  // hold real numbers before anyone clicks. It is never presented as a run the
  // judge approved: every panel that shows it says where it came from.
  const [preview, setPreview] = useState(null);
  const [stage, setStage] = useState(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  // True from the moment a run lands until its queue has finished appearing.
  // The counter itself lives inside AssayPanel so that one row arriving does
  // not re-render the rest of the page forty times.
  const [revealing, setRevealing] = useState(false);
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState(null);
  const [curve, setCurve] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [eras, setEras] = useState(null);
  const [record, setRecord] = useState([]);
  const [molecule, setMolecule] = useState(null);
  const phase = useRef('idle');

  useEffect(() => {
    getFacts(CUTOFF).then(setFacts).catch((e) => setError(e.message));
    // Same ordering and budget the hero's /api/headline preview uses, asked for
    // with the rows attached so the queue has something true to show at rest.
    runExperiment({ strategy: 'model', budget: DEFAULT_BUDGET })
      .then(setPreview)
      .catch(() => {});
    // The discovery charts show the default run until a judge runs their own.
    getCurve('model', DEFAULT_BUDGET).then(setCurve).catch(() => {});
    compareStrategies(DEFAULT_BUDGET).then(setComparison).catch(() => {});
    getEras(DEFAULT_BUDGET).then(setEras).catch(() => {});
    getRecord(40).then((r) => setRecord(r.rows ?? [])).catch(() => {});
  }, []);

  /** Walk the loop. The literature step is a live search, the approval is a
   *  real stop, and the run after it is computed on the server. */
  const startLoop = useCallback(async () => {
    if (phase.current !== 'idle' || !facts) return;
    phase.current = 'starting';
    setError(null);
    setResult(null);
    setMolecule(null);
    setEvidence(null);
    setRevealing(false);

    for (const id of ['literature', 'insight', 'planner']) {
      setStage(id);
      if (id === 'literature') {
        searchEvidence('honey bee acute toxicity insecticide', 3)
          .then(setEvidence)
          .catch((e) => setError(`Literature lookup failed: ${e.message}`));
      }
      await new Promise((resolve) => setTimeout(resolve, 620));
    }

    setStage('approval');
    phase.current = 'approval';
    setAwaitingApproval(true);
  }, [facts]);

  const approve = useCallback(async () => {
    // The exiting approval card remains mounted during its animation.
    // A synchronous guard makes a second click harmless before React rerenders.
    if (phase.current !== 'approval') return;
    phase.current = 'running';
    setAwaitingApproval(false);
    setStage('runner');
    try {
      const run = await runExperiment({ strategy, budget });
      setRevealing(true);
      setResult(run);
      setStage('analysis');

      setCurve(null);
      setComparison(null);
      getCurve(strategy, budget).then(setCurve).catch((e) => setError(`Discovery curve failed: ${e.message}`));
      compareStrategies(budget).then(setComparison).catch((e) => setError(`Strategy comparison failed: ${e.message}`));
      getRecord(40).then((r) => setRecord(r.rows ?? [])).catch(() => {});

    } catch (e) {
      setError(e.message);
      setStage(null);
      phase.current = 'idle';
    }
  }, [strategy, budget]);

  const finishReveal = useCallback(() => {
    setRevealing(false);
    phase.current = 'idle';
  }, []);

  const deny = useCallback(() => {
    if (phase.current !== 'approval') return;
    phase.current = 'idle';
    setAwaitingApproval(false);
    setStage(null);
  }, []);

  const openMolecule = useCallback((cid) => {
    getMolecule(cid).then(setMolecule).catch((e) => setError(e.message));
  }, []);

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const cutoff = facts?.cutoff_year ?? CUTOFF;

  return (
    <div className="min-h-screen bg-night-900">
      <SiteNav />
      <Hero />

      <main className="hex-field">
        <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 md:px-8">
          <Chapter
            id="lab"
            index="01"
            label="Lab"
            title="Choose what to test first"
            lede={
              facts
                ? `Pick an ordering and a budget. The run stops for your approval, then the server ranks the ${facts.pool_molecules} molecules first reported after ${cutoff} and the queue fills in below.`
                : 'Pick an ordering and a budget. The run stops for your approval, then the server ranks the pool and the queue fills in below.'
            }
          >
            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <Pipeline stage={stage} stageIndex={stageIndex} />

            <div className="mt-5 grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="space-y-5">
                <Controls
                  strategy={strategy}
                  setStrategy={setStrategy}
                  budget={budget}
                  setBudget={setBudget}
                  onRun={startLoop}
                  busy={!facts || (stage !== null && (!result || revealing))}
                  facts={facts}
                />
                <SpeedupPanel result={result} preview={preview} budget={budget} facts={facts} />
              </div>

              <div className="min-w-0 space-y-5">
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

                <AssayPanel
                  result={result}
                  preview={preview}
                  onOpen={openMolecule}
                  onDone={finishReveal}
                />
                {molecule && (
                  <MoleculePanel molecule={molecule} onClose={() => setMolecule(null)} />
                )}
                <EvidencePanel evidence={evidence} />
              </div>
            </div>
          </Chapter>

          <Chapter
            id="agents"
            minH="min-h-[70svh]"
            index="02"
            label="Agents"
            title="One recorded run of the agent team"
            lede="A replay of what the Omnigent agents wrote and which tools they called, read back from the session store. Nothing in this section is generated in your browser."
          >
            <AgentRoom />
          </Chapter>

          <Chapter
            id="discovery"
            minH="min-h-[95svh]"
            index="03"
            label="Discovery"
            title="How quickly the answers turn up"
            lede="The curve and the strategy table follow the budget you ran above. The clock panel retrains the lab at other cutoff years, and the learning loop asks whether refitting after each batch helps."
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <CurvePanel curve={curve} facts={facts} />
              <StrategyCompare data={comparison} />
            </div>
            <div className="mt-5">
              <EraPanel data={eras} />
            </div>
            <div className="mt-5">
              <LearningLoop />
            </div>
          </Chapter>

          <Chapter
            id="chemistry"
            minH="min-h-[95svh]"
            index="04"
            label="Chemistry"
            title="The answers, and how far each one sits from training"
            lede={`Every structure is drawn by RDKit from the dataset SMILES. Each card also names the closest molecule the model saw by ${cutoff} and how similar the two are.`}
          >
            <div className="space-y-20">
              <RediscoveredGallery cutoffYear={cutoff} />
              <ChemicalSpace cutoffYear={cutoff} />
            </div>
          </Chapter>

          <Chapter
            id="evidence"
            minH="min-h-[95svh]"
            index="05"
            label="Evidence"
            title={`What had been published by ${cutoff}`}
            lede="Literature records are counted by publication year, so the panel shows how much had been written around the compound-year cutoff."
          >
            <EvidenceGraph cutoffYear={cutoff} />
          </Chapter>

          <Chapter
            id="rigor"
            minH="min-h-[110svh]"
            index="06"
            label="Rigor"
            title="Attempts to break the headline number"
            lede="A harder random baseline, other models and fingerprints, unfamiliar scaffolds, other seeds, and an outside test on ChEMBL bee records. Where the result gets weaker, the panel says so."
          >
            <div className="space-y-5">
              <RigorPanel />
              <ExternalValidation />
            </div>
          </Chapter>

          <Chapter
            id="candidates"
            minH="min-h-[95svh]"
            index="07"
            label="Candidates"
            title="What to send to a bee assay next"
            lede="Pest-active compounds from ChEMBL that are not in ApisTox, ranked by predicted bee safety. None of them has a bee measurement yet, so each row is a hypothesis."
          >
            <Candidates />
          </Chapter>

          <Chapter
            id="method"
            minH="min-h-[150svh]"
            index="08"
            label="Method"
            title="How it is built, and what it should not be used for"
            lede="Settings read out of the source, a data and model card, a count of the files and packages the lab runs on, and the record the agents write to."
          >
            <div className="space-y-5">
              <MethodCard />
              <ResponsibleCard />
              <Ledger />
              <RecordPanel rows={record} />
            </div>
          </Chapter>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

/** One section of the page: a numbered label, a plain title and one
 *  sentence, set like a paper's section head rather than a card. */
function Chapter({ id, index, label, title, lede, minH = 'min-h-[80svh]', children }) {
  return (
    <section id={id} className="pt-20 sm:pt-28">
      <header className="mb-8 grid gap-x-10 gap-y-3 border-t border-wax/10 pt-5 md:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="font-mono text-[12px] text-hive-400/85">
          <span className="text-wax/35">{index}</span> {label}
        </div>
        <div>
          <h2 className="font-serif-display text-[1.9rem] leading-[1.08] text-wax sm:text-[2.4rem]">
            {title}
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-wax/60">{lede}</p>
        </div>
      </header>
      {/* The fallback reserves roughly the chapter's settled height, so a
          judge scrolling during load is not thrown when the chunk lands. */}
      <Suspense fallback={<div className={`glass rounded-xl border-t border-wax/10 ${minH}`} />}>
        {children}
      </Suspense>
    </section>
  );
}

function Pipeline({ stage, stageIndex }) {
  return (
    <div className="glass lift fade-right-phone flex items-stretch gap-1 overflow-x-auto rounded-xl p-2">
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
              <span className="cap-sm font-mono text-white/60">{index + 1}</span>
              <Icon
                className={`h-3.5 w-3.5 ${
                  active ? 'text-hive-400' : done ? 'text-signal/70' : 'text-white/50'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  active ? 'text-white' : done ? 'text-white/65' : 'text-white/60'
                }`}
              >
                {s.label}
              </span>
            </div>
            <span className="cap-sm text-white/40">{s.note}</span>
          </div>
        );
      })}
    </div>
  );
}

function Controls({ strategy, setStrategy, budget, setBudget, onRun, busy, facts }) {
  return (
    <section className="glass lift rounded-xl p-5">
      <h3 className="cap font-mono text-white/45">Ordering</h3>

      <div className="mt-3 space-y-1.5">
        {STRATEGIES.map((option) => (
          <button
            key={option.id}
            disabled={busy}
            onClick={() => setStrategy(option.id)}
            aria-pressed={strategy === option.id}
            className={`w-full rounded-lg border px-3 py-2.5 text-left transition-all ${
              strategy === option.id
                ? 'border-hive-400/50 bg-hive-400/10'
                : 'border-white/6 bg-white/[0.02] hover:border-white/15'
            }`}
          >
            <div className="text-sm font-medium text-white/85">{option.label}</div>
            <div className="cap text-white/40">{option.hint}</div>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="budget" className="cap font-mono text-white/45">
            Assay budget
          </label>
          <span className="tabular text-lg font-semibold text-hive-400">{budget}</span>
        </div>
        <input
          id="budget"
          disabled={busy}
          aria-label="Assay budget"
          type="range"
          min="5"
          max={facts?.pool_molecules ?? 201}
          value={budget}
          onChange={(event) => setBudget(Number(event.target.value))}
          className="mt-2 h-10 w-full accent-hive-500 md:h-4"
        />
        <p className="cap mt-1.5 text-white/40">
          One simulated assay reveals an existing dataset label.
        </p>
      </div>

      <button
        onClick={onRun}
        disabled={busy}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-hive-500 px-4 py-3 text-sm font-semibold text-night-900 transition hover:bg-hive-400 disabled:opacity-40"
      >
        <Play className="h-4 w-4" />
        {busy ? 'Running' : 'Run the loop'}
      </button>
    </section>
  );
}

function SpeedupPanel({ result, preview, budget, facts }) {
  // Before the first approval the panel shows the preview the page computed on
  // load. The caption always names which of the two is on screen.
  const shown = result ?? preview;
  const isPreview = !result && Boolean(preview);
  // The ratio is the random median divided by the budget, so a budget larger
  // than that median puts it under 1. Saying "fewer assays than random" there
  // would state the opposite of the number.
  const under = shown != null && shown.speedup < 1;

  return (
    <section className="glass lift rounded-xl p-5">
      <SpeedupDial
        speedup={shown?.speedup}
        found={shown?.found}
        total={facts?.targets}
        budget={shown?.budget ?? budget}
        label={under ? 'random assays per assay spent' : 'fewer assays than random'}
      />
      {shown ? (
        <>
          <p className="mt-3 text-center text-xs leading-relaxed text-white/45">
            Random order over all {facts?.pool_molecules ?? 'the'} pool molecules needs{' '}
            <span className="font-semibold text-white/70">{shown.random_assays_for_same_hits}</span>{' '}
            assays (median of shuffled orders) to find the same {shown.found}. The Rigor
            section repeats the test against random order inside the insecticides only.
          </p>
          {under && (
            <p className="mt-2 text-center text-xs leading-relaxed text-white/45">
              This budget is larger than the {shown.random_assays_for_same_hits} assays random
              order needs, so the ratio falls below 1 and there is no saving left to measure.
            </p>
          )}
          {isPreview && (
            <p className="cap mt-2 text-center leading-relaxed text-white/40">
              Retrospective preview, computed on load: learned ordering at {shown.budget} assays.
              Run the loop to compute your own here.
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-center text-xs leading-relaxed text-white/60">
          Empty until you run the loop.
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
        <span className="cap font-mono">Approval needed</span>
      </div>
      <p className="mt-3 text-[15px] text-white/85">
        The planner wants to spend{' '}
        <span className="font-semibold text-hive-400">{budget} assays</span> using{' '}
        <span className="font-semibold text-hive-400">
          {STRATEGIES.find((s) => s.id === strategy)?.label}
        </span>
        .
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-white/45">
        This interactive ranking waits for you to accept; the headline is a retrospective preview.
        Recorded Omnigent runs use a separate ASK policy before experiment tool calls.
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

function AssayPanel({ result, preview, onOpen, onDone }) {
  const shown = result ?? preview;
  const isPreview = !result && Boolean(preview);
  const [revealed, setRevealed] = useState(0);

  // The reveal is a reading aid, not a measurement: the server answers in well
  // under a second. The tick rate is fixed and the step widens with the budget,
  // so the whole queue lands in about REVEAL_MS at any budget. At 30 assays the
  // step is one row and the default looks exactly as it did; at 201 it is five,
  // instead of holding the controls shut for seventeen seconds.
  useEffect(() => {
    if (!result) {
      setRevealed(0);
      return undefined;
    }
    const total = result.assays.length;
    const frames = Math.max(1, Math.round(REVEAL_MS / REVEAL_TICK_MS));
    const chunk = Math.max(1, Math.ceil(total / frames));
    let seen = 0;
    setRevealed(0);
    const timer = setInterval(() => {
      seen = Math.min(total, seen + chunk);
      setRevealed(seen);
      if (seen >= total) {
        clearInterval(timer);
        onDone?.();
      }
    }, REVEAL_TICK_MS);
    return () => clearInterval(timer);
  }, [result, onDone]);

  if (!shown) {
    return (
      <section className="glass lift grid min-h-[13rem] place-items-center rounded-xl p-5 text-center">
        <div className="max-w-sm">
          <FlaskConical className="mx-auto h-7 w-7 text-white/15" />
          <p className="mt-3 text-sm leading-relaxed text-white/40">
            The assay queue appears here once the run is approved. Click any row to open the
            molecule with a live PubChem lookup.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="cap font-mono text-white/45">
          Assay queue{isPreview ? ', preview' : ''}
        </h3>
        <span className="text-xs text-white/40">
          hits at {shown.found_at.join(', ') || 'none'}
        </span>
      </div>
      {isPreview && (
        <p className="cap mb-2 leading-relaxed text-white/40">
          Learned ordering at {shown.budget} assays, computed when the page loaded. Approving a
          run replaces it with yours.
        </p>
      )}
      <div className="max-h-[22rem] overflow-y-auto pr-1">
        <AssayStream
          assays={shown.assays}
          revealed={isPreview ? shown.assays.length : revealed}
          onOpen={onOpen}
        />
      </div>
      <p className="cap mt-2 leading-relaxed text-white/40">
        No applicability-domain cut is applied to this queue: every pool molecule is scored, so an
        inorganic salt with no close training analogue can sit near the top. The forward candidate
        list in Chemistry applies that cut; this retrospective ordering does not.
      </p>
    </section>
  );
}

const STRATEGY_NAME = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.label]));

function CurvePanel({ curve, facts }) {
  if (!curve) {
    return <section className="glass lift h-[20rem] animate-pulse rounded-xl" />;
  }
  return (
    <section className="glass lift min-w-0 rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="cap font-mono text-white/45">
          Discovery curve · {STRATEGY_NAME[curve.strategy] ?? curve.strategy}, {curve.budget} assays
        </h3>
      </div>
      <DiscoveryCurve data={curve} targets={facts?.targets ?? curve.targets} />
      <p className="mt-2 text-xs leading-relaxed text-white/40">
        Answers found against assays spent. The amber line is this lab; the dashed line is the
        random median and the grey band is random order from the 10th to the 90th percentile
        over {curve.shuffles} shuffles, enough for a median on screen; the 5,000-shuffle stress
        test is in Rigor.
      </p>
    </section>
  );
}

function EvidencePanel({ evidence }) {
  if (!evidence) return null;
  const answered = [
    ['OpenAlex', evidence.openalex],
    ['Europe PMC', evidence.europepmc],
  ];
  const papers = answered.flatMap(([, block]) => (block?.items ?? []).slice(0, 2));
  const ok = answered.filter(([, block]) => block?.items?.length).map(([name]) => name);
  const failed = answered.filter(([, block]) => !block?.items?.length).map(([name]) => name);
  if (!papers.length) return null;

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-white/60" />
        <h3 className="cap font-mono text-white/45">
          Literature step, searched when you pressed run
        </h3>
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
              >{paper.title}</a>
            <span className="ml-2 text-xs text-white/60">{paper.year}</span>
          </motion.li>
        ))}
      </ul>
      <p className="cap mt-3 leading-relaxed text-white/40">
        Returned by {ok.join(' and ')}.
        {failed.length > 0 && ` ${failed.join(' and ')} returned nothing this time, so nothing is shown for it.`}
      </p>
    </section>
  );
}
