import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Workflow,
} from 'lucide-react';

/* Agent room. Replays a run that Omnigent recorded in its own session store:
 * the orchestrator plus every sub-agent session it spawned, merged by time.
 * Nothing on this panel is generated for display. Turns come from
 * /api/agents/runs/{id} (lab/data/derived/agent_runs.json, extracted from
 * ~/.omnigent/chat.db by `python -m lab.beeguard.agentroom extract`), the
 * diagram from /api/agents/topology (read from agents/beeguard/*.yaml). */

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

const ORDER = ['literature', 'insight', 'planner', 'runner', 'analysis'];
const HUE = {
  orchestrator: '#fbbf24',
  literature: '#8ec5e8',
  insight: '#b9a8e6',
  planner: '#7fd1bf',
  runner: '#e6a3c4',
  analysis: '#c6dc8a',
};
const STEP = { literature: 1, insight: 2, planner: 3, runner: 4, analysis: 5 };

const W = 420;
const C = W / 2;
const R = 138;
const node = (i) => {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
};
const GATE = (() => {
  const a = (162 * Math.PI) / 180;
  return { x: C + 186 * Math.cos(a), y: C + 186 * Math.sin(a) };
})();

const fmtDuration = (s) => {
  if (s == null) return 'n/a';
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return m ? `${m} min ${r} s` : `${r} s`;
};
const clock = (iso) => (iso ? iso.slice(11, 16) : '');
const day = (iso) => (iso ? iso.slice(0, 10) : '');

/* Agents sometimes write emoji. The page shows none, so the few code points that
 * occur in recorded text are drawn as plain marks; Provenance says how many. */
const GLYPHS = [
  [/\u2705/g, '\u2713'],
  [/\u274C/g, '\u2717'],
  [/\u26A0\uFE0F?/g, '!'],
  [/[\u{1F300}-\u{1FAFF}]/gu, ''],
  [/\uFE0F/g, ''],
];
const plain = (text) => GLYPHS.reduce((s, [re, to]) => s.replace(re, to), text ?? '');
const glyphCount = (text) =>
  GLYPHS.slice(0, 4).reduce((n, [re]) => n + ((text ?? '').match(re)?.length ?? 0), 0);
const HANGUL = /[가-힣]/;

/* The strongest recorded moment in the run is a refusal, so the section opens
 * with it. Both the quote and the turn index are read out of the loaded run;
 * nothing here is typed in, and a run without such a turn shows no card. */
function pullQuote(text) {
  const clean = plain(text ?? '').replace(/\*\*/g, '');
  for (const re of [
    /[^.\n]*false experimental record[^.\n]*/i,
    /[^.\n]*scientific misconduct[^.\n]*\./i,
  ]) {
    const match = clean.match(re);
    if (match) return match[0].trim().replace(/^[-*•\s]+/, '');
  }
  return null;
}

function refusals(run) {
  const out = [];
  for (const t of run?.turns ?? []) {
    if (t.kind !== 'message' || t.agent !== 'runner') continue;
    const quote = pullQuote(t.text);
    if (quote) out.push({ i: t.i, t_rel: t.t_rel, quote });
  }
  return out;
}

function reachedStages(run) {
  return ORDER.filter((n) => run.sessions?.some((s) => s.agent === n));
}

function outcome(run, total) {
  const c = run.counts;
  const reached = reachedStages(run);
  const last = reached.at(-1);
  const share = `${reached.length}/${total} specialists`;
  if (c.approvals_granted > 0) return `${share}, gate passed`;
  if (c.approvals_requested > 0) return `${share}, gate raised`;
  if (c.harness_errors > 0) return last ? `stopped at ${last}, model refused` : 'stopped before the first dispatch';
  if (c.denied > 0) return 'stopped by policy';
  if (!reached.length) return 'no specialist reached';
  return share;
}

/** Which agent, edge and gate state the current turn drives. */
function stageOf(turn, lastReply) {
  if (!turn) return {};
  if (turn.kind === 'approval_request') return { agent: turn.agent, gate: 'ask' };
  if (turn.kind === 'approval_granted') return { agent: turn.agent, gate: 'granted' };
  if (turn.kind === 'denied') return { agent: turn.agent, gate: 'denied' };
  if (turn.kind === 'tool_call' && turn.target && STEP[turn.target])
    return { agent: 'orchestrator', edge: turn.target, dir: 'out' };
  if (turn.kind === 'brief') return { agent: turn.agent, edge: turn.agent, dir: 'out' };
  if (turn.kind === 'notice' && STEP[turn.from_agent])
    return { agent: 'orchestrator', edge: turn.from_agent, dir: 'in' };
  if (turn.kind === 'message' && turn.agent !== 'orchestrator' && lastReply.has(turn.i))
    return { agent: turn.agent, edge: turn.agent, dir: 'in' };
  if (turn.kind === 'tool_call' && turn.agent !== 'orchestrator')
    return { agent: turn.agent, lab: turn.ns === 'lab' };
  return { agent: turn.agent };
}

export default function AgentRoom() {
  const [topology, setTopology] = useState(null);
  const [runs, setRuns] = useState(null);
  const [runId, setRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  // 122 turns take about 2 min 45 s at 8x and about 41 s at 32x, so the fast
  // pass is the default and 2x/8x stay available for reading along.
  const [speed, setSpeed] = useState(32);
  const [showPlumbing, setShowPlumbing] = useState(false);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([getJSON('/api/agents/topology'), getJSON('/api/agents/runs')])
      .then(([topo, list]) => {
        if (!live) return;
        setTopology(topo);
        setRuns(list.runs);
        const best = [...list.runs].sort(
          (a, b) =>
            b.counts.approvals_granted - a.counts.approvals_granted ||
            b.counts.sub_agent_sessions - a.counts.sub_agent_sessions ||
            b.counts.turns - a.counts.turns,
        )[0];
        if (best) setRunId(best.id);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!runId) return undefined;
    let live = true;
    setRun(null);
    setPlaying(false);
    getJSON(`/api/agents/runs/${runId}`)
      .then((r) => {
        if (!live) return;
        setRun(r);
        setCursor(0);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  const turns = useMemo(() => {
    if (!run) return [];
    return showPlumbing ? run.turns : run.turns.filter((t) => !t.plumbing);
  }, [run, showPlumbing]);

  const lastReply = useMemo(() => {
    const last = {};
    for (const t of run?.turns ?? []) {
      if (t.kind === 'message' && t.agent !== 'orchestrator') last[t.session] = t.i;
    }
    return new Set(Object.values(last));
  }, [run]);

  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= turns.length) {
      setPlaying(false);
      return undefined;
    }
    const prev = turns[cursor - 1];
    const next = turns[cursor];
    const gap = prev && next ? Math.max(0, next.t - prev.t) : 0;
    const wait = Math.min(2400, Math.max(320, (gap * 1000) / speed));
    const id = setTimeout(() => setCursor((c) => Math.min(c + 1, turns.length)), wait);
    return () => clearTimeout(id);
  }, [playing, cursor, turns, speed]);

  useEffect(() => {
    setCursor((c) => Math.min(c, turns.length));
  }, [turns.length]);

  const current = turns[cursor - 1];
  const stage = stageOf(current, lastReply);
  const shown = turns.slice(0, cursor);

  const visited = useMemo(() => {
    const seen = new Set();
    const calls = {};
    let gate = null;
    for (const t of shown) {
      if (t.kind === 'tool_call' && t.target && STEP[t.target]) seen.add(t.target);
      if (t.kind === 'brief') seen.add(t.agent);
      if (t.kind === 'tool_call' && !t.plumbing) calls[t.agent] = (calls[t.agent] ?? 0) + 1;
      if (t.kind === 'approval_request') gate = 'ask';
      if (t.kind === 'approval_granted') gate = 'granted';
      if (t.kind === 'denied') gate = 'denied';
    }
    return { seen, calls, gate };
  }, [shown]);

  /* The same reduction over the whole run, so a node at rest reads "0/36 calls"
   * rather than claiming the agent did nothing. */
  const totalCalls = useMemo(() => {
    const calls = {};
    for (const t of run?.turns ?? []) {
      if (t.kind === 'tool_call' && !t.plumbing) calls[t.agent] = (calls[t.agent] ?? 0) + 1;
    }
    return calls;
  }, [run]);

  if (error) {
    return (
      <section className="glass lift rounded-xl p-4 sm:p-5">
        <Header />
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Could not load the recorded runs: {error}
        </div>
      </section>
    );
  }

  return (
    <section className="glass lift rounded-xl p-4 sm:p-5">
      <Header run={run} topology={topology} />

      {run && <RefusalCard run={run} />}

      {runs && topology && runs.length > 1 && (
        <RunPicker runs={runs} runId={runId} onPick={setRunId} total={topology.specialists.length} />
      )}

      {!run && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="aspect-square animate-pulse rounded-lg bg-white/[0.03]" />
          <div className="h-80 animate-pulse rounded-lg bg-white/[0.03]" />
        </div>
      )}

      {run && topology && (
        <>
          <Counts run={run} />
          <GateNote run={run} topology={topology} />

          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
            <div className="min-w-0">
              <Topology
                topology={topology}
                stage={stage}
                visited={visited}
                totalCalls={totalCalls}
                cursor={cursor}
                picked={picked}
                onPick={setPicked}
              />
              <AgentDetail
                topology={topology}
                run={run}
                name={picked ?? stage.agent ?? 'orchestrator'}
              />
            </div>

            <div className="min-w-0">
              <Controls
                cursor={cursor}
                total={turns.length}
                playing={playing}
                speed={speed}
                onPlay={() => {
                  if (cursor >= turns.length) setCursor(0);
                  setPlaying((p) => !p);
                }}
                onStep={(d) => {
                  setPlaying(false);
                  setCursor((c) => Math.max(0, Math.min(turns.length, c + d)));
                }}
                onRestart={() => {
                  setPlaying(false);
                  setCursor(0);
                }}
                onSeek={(v) => {
                  setPlaying(false);
                  setCursor(v);
                }}
                onSpeed={setSpeed}
                showPlumbing={showPlumbing}
                plumbingCount={run.counts.tool_loads}
                onPlumbing={() => setShowPlumbing((s) => !s)}
                current={current}
              />
              <Timeline turns={shown} total={turns.length} trim={run.trim_chars} />
            </div>
          </div>

          <Provenance run={run} topology={topology} />
        </>
      )}
    </section>
  );
}

function Header({ run, topology }) {
  const n = topology?.specialists?.length;
  const gated = topology?.gated_tools ?? [];
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-hive-400" />
          <h2 className="text-sm font-medium text-white/90">Agent room</h2>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
          {run
            ? `Omnigent run of ${day(run.started_at)}, ${clock(run.started_at)} KST, played back from its session store turn by turn.`
            : 'An Omnigent run played back from its session store turn by turn.'}
          {topology && (
            <>
              {' '}The orchestrator sends the question to {n} specialists with{' '}
              <code className="font-mono text-white/60">{topology.orchestrator.dispatch_tool}</code> and
              reads their replies from its inbox.
              {gated.length > 0 && (
                <>
                  {' '}A call to {gated.map((t, i) => (
                    <span key={t}>
                      {i > 0 && ' or '}
                      <code className="font-mono text-white/60">{t}</code>
                    </span>
                  ))}{' '}
                  waits at an ASK policy until it is accepted.
                </>
              )}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** What the runner specialist said when it was told to produce assay numbers
 *  it could not have measured. Quotes are lifted verbatim from the turns. */
function RefusalCard({ run }) {
  const quotes = useMemo(() => refusals(run), [run]);
  const brief = run.turns.find((t) => t.kind === 'brief' && t.agent === 'runner');
  if (quotes.length < 1) return null;

  return (
    <div className="mt-4 rounded-lg border border-warn/25 bg-warn/[0.05] p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0 text-warn" />
        <h3 className="text-sm font-medium text-white/90">
          The runner refused to invent the measurement
        </h3>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
        {brief ? `In turn ${brief.i} of this run the` : 'The'} orchestrator briefed the runner
        specialist to carry out an acute oral LD50 assay in honey bees on five molecules. The
        runner refused {quotes.length === 2 ? 'twice' : `${quotes.length} times`}, in its own
        words.
      </p>
      <div className="mt-3 space-y-2">
        {quotes.map((q) => (
          <blockquote
            key={q.i}
            className="border-l-2 pl-3"
            style={{ borderColor: HUE.runner }}
          >
            <p className="text-[13.5px] leading-relaxed text-white/85">{q.quote}</p>
            <div className="cap-sm mt-1 font-mono text-white/45">
              runner · turn {q.i} · +{q.t_rel.toFixed(0)}s
            </div>
          </blockquote>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-white/55">
        The orchestrator then narrowed the brief to published values only. The refusal is the
        part of the loop that is worth keeping: a specialist that will not write a number it did
        not measure. The counts and the replay below are the rest of the same run.
      </p>
    </div>
  );
}

function RunPicker({ runs, runId, onPick, total }) {
  const [open, setOpen] = useState(false);
  const selected = runs.find((r) => r.id === runId);
  const others = runs.filter((r) => r.id !== runId);
  const allEarlier =
    selected && others.every((r) => (r.started_at ?? '') < (selected.started_at ?? ''));
  if (!others.length) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 font-mono text-[13px] text-white/45 transition hover:text-white/75"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {others.length} {allEarlier ? 'earlier attempts' : 'other recorded runs'}
      </button>
      {open && <RunChips runs={runs} runId={runId} onPick={onPick} total={total} />}
    </div>
  );
}

function RunChips({ runs, runId, onPick, total }) {
  return (
    <div className="fade-right mt-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {runs.map((r) => {
        const active = r.id === runId;
        return (
          <button
            key={r.id}
            onClick={() => onPick(r.id)}
            className={`shrink-0 rounded-md border px-2.5 py-1.5 text-left transition ${
              active
                ? 'border-hive-400/50 bg-hive-400/10'
                : 'border-white/8 bg-white/[0.02] hover:border-white/20'
            }`}
          >
            <div className={`cap font-mono ${active ? 'text-hive-200' : 'text-white/60'}`}>
              {day(r.started_at).slice(5)} {clock(r.started_at)}
            </div>
            <div className="cap-sm text-white/45">
              {outcome(r, total)}
              {r.model ? <span className="text-white/60"> · {r.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')}</span> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Counts({ run }) {
  const c = run.counts;
  // Opens on what the agents actually did, and keeps the approval count next
  // to the sentence underneath that explains it.
  const cells = [
    ['lab.* tool calls', c.lab_calls],
    ['dispatches', c.dispatches],
    ['agents', c.agents],
    ['turns', c.turns],
    ['tool calls in all', c.tool_calls],
    ['wall clock', fmtDuration(run.duration_s)],
    ['approvals granted / asked', `${c.approvals_granted}/${c.approvals_requested}`],
  ];
  return (
    <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-y border-white/6 py-2.5">
      {cells.map(([label, value]) => (
        <div key={label} className="flex flex-row-reverse items-baseline justify-end gap-1.5">
          <dt className="cap text-white/45">{label}</dt>
          <dd className="tabular font-mono text-[15px] text-wax/90">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What the approval gate did in this run, read from the run's own counts. */
function GateNote({ run, topology }) {
  const c = run.counts;
  const gatedCalls = Object.values(run.tool_counts ?? {}).reduce(
    (sum, per) => sum + topology.gated_tools.reduce((s, tool) => s + (per[tool] ?? 0), 0),
    0,
  );
  let text;
  if (c.approvals_requested > 0) {
    text = `The gate fired ${c.approvals_requested} time${c.approvals_requested > 1 ? 's' : ''} and was answered ${c.approvals_granted} time${c.approvals_granted === 1 ? '' : 's'}; the checkpoint cards below show when.`;
  } else if (gatedCalls === 0) {
    text = `The gate did not fire in this run: no agent called ${topology.gated_tools.join(' or ')}.`;
  } else {
    text = `${gatedCalls} gated call${gatedCalls > 1 ? 's' : ''} recorded without a logged approval prompt.`;
  }
  return (
    <div className="mt-2 flex flex-wrap items-start gap-x-2 gap-y-1 text-[13px] leading-relaxed text-white/55">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/60" />
      <span className="min-w-0 flex-1">
        {text} A number in an agent's message is the agent's own text and may come from the
        model's memory. Only numbers inside a lab.* result came back from the lab tools.
      </span>
    </div>
  );
}

function Topology({ topology, stage, visited, totalCalls = {}, cursor, picked, onPick }) {
  const specialists = ORDER.filter((n) => topology.specialists.some((s) => s.name === n));
  const labAccess = new Set(
    topology.specialists.filter((s) => s.lab_access).map((s) => s.name),
  );
  /* Dashed lines to the gate: agents whose config names a gated tool in its prompt
   * or puts the agent behind the approval gate in its description. */
  const gateLinked = topology.specialists
    .filter((s) => s.lab_access && (s.gated_tools?.length || /approval/i.test(s.description ?? '')))
    .map((s) => s.name)
    .filter((n) => ORDER.includes(n));
  const gateColor =
    stage.gate === 'ask' || (visited.gate === 'ask' && !stage.gate)
      ? '#fb7185'
      : visited.gate === 'granted'
        ? '#34d399'
        : visited.gate === 'denied'
          ? '#fb7185'
          : 'rgba(255,255,255,0.35)';

  return (
    <div className="hex-field relative rounded-lg border border-white/6 bg-night-900/60">
      <svg viewBox={`0 0 ${W} ${W}`} className="block h-auto w-full" role="img"
        aria-label={`Orchestrator in the centre, ${specialists.length} specialist agents around it, approval gate on the left`}>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 6" />

        {gateLinked.map((name) => {
          const p = node(ORDER.indexOf(name));
          return (
            <line key={`g-${name}`} x1={p.x} y1={p.y} x2={GATE.x} y2={GATE.y}
              stroke={gateColor} strokeOpacity={0.5} strokeDasharray="3 4" />
          );
        })}

        {specialists.map((name) => {
          const i = ORDER.indexOf(name);
          const p = node(i);
          const lit = stage.edge === name;
          const seen = visited.seen.has(name);
          return (
            <g key={`e-${name}`}>
              <line x1={C} y1={C} x2={p.x} y2={p.y}
                stroke={lit ? HUE[name] : seen ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={lit ? 2 : 1.2} />
              {lit && (
                <motion.circle
                  key={`pulse-${cursor}`}
                  r={4}
                  fill={HUE[name]}
                  initial={stage.dir === 'in' ? { cx: p.x, cy: p.y } : { cx: C, cy: C }}
                  animate={stage.dir === 'in' ? { cx: C, cy: C } : { cx: p.x, cy: p.y }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
            </g>
          );
        })}

        <g transform={`translate(${GATE.x} ${GATE.y})`}>
          <motion.rect x={-17} y={-17} width={34} height={34} rx={7}
            fill="rgba(10,10,15,0.92)" stroke={gateColor}
            animate={{ strokeWidth: stage.gate === 'ask' ? [1.5, 3, 1.5] : 1.5 }}
            transition={{ duration: 1.2, repeat: stage.gate === 'ask' ? Infinity : 0 }} />
          {visited.gate === 'granted' ? (
            <ShieldCheck x={-9} y={-9} width={18} height={18} color={gateColor} />
          ) : (
            <ShieldAlert x={-9} y={-9} width={18} height={18} color={gateColor} />
          )}
          <text y={31} textAnchor="middle" className="fill-white/45" style={{ font: '500 11px var(--font-mono)' }}>
            approval
          </text>
        </g>

        <Hex x={C} y={C} r={44} active={stage.agent === 'orchestrator'} hue={HUE.orchestrator}
          onClick={() => onPick(picked === 'orchestrator' ? null : 'orchestrator')} />
        <text x={C} y={C - 3} textAnchor="middle" className="fill-hive-200"
          style={{ font: '600 12px var(--font-display)', pointerEvents: 'none' }}>
          orchestrator
        </text>
        <text x={C} y={C + 14} textAnchor="middle" className="fill-white/45"
          style={{ font: '400 11px var(--font-mono)', pointerEvents: 'none' }}>
          {visited.calls.orchestrator ?? 0}/{totalCalls.orchestrator ?? 0} calls
        </text>

        {specialists.map((name) => {
          const p = node(ORDER.indexOf(name));
          const active = stage.agent === name;
          const calls = visited.calls[name] ?? 0;
          const top = name === 'literature';
          const nameY = top ? p.y - 46 : p.y + 44;
          const callsY = top ? p.y - 34 : p.y + 57;
          return (
            <g key={name} className="cursor-pointer" onClick={() => onPick(picked === name ? null : name)}>
              <Hex x={p.x} y={p.y} r={28} active={active} hue={HUE[name]}
                dim={!visited.seen.has(name) && !active} lab={active && stage.lab} />
              <text x={p.x} y={p.y + 4} textAnchor="middle"
                style={{ font: '600 12px var(--font-mono)', fill: HUE[name] }}>
                {STEP[name]}
              </text>
              <text x={p.x} y={nameY} textAnchor="middle" className="fill-white/75"
                style={{ font: '500 12.5px var(--font-display)' }}>
                {name}
              </text>
              <text x={p.x} y={callsY} textAnchor="middle" className="fill-white/45"
                style={{ font: '400 11px var(--font-mono)' }}>
                {calls}/{totalCalls[name] ?? 0} calls{labAccess.has(name) ? ' · lab' : ''}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="cap-sm pointer-events-none absolute bottom-2 right-3 font-mono text-white/40">
        select a node for its config
      </div>
    </div>
  );
}

function Hex({ x, y, r, active, hue, dim, lab, onClick }) {
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 30) * Math.PI) / 180;
    return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
  }).join(' ');
  return (
    <g onClick={onClick}>
      {active && (
        <motion.polygon points={pts} fill="none" stroke={hue}
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 1.35 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
          style={{ transformOrigin: `${x}px ${y}px` }} />
      )}
      <polygon points={pts}
        fill={active ? 'rgba(28,28,39,0.98)' : 'rgba(18,18,26,0.92)'}
        stroke={active ? hue : dim ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.22)'}
        strokeWidth={active ? 2 : 1} />
      {lab && <circle cx={x + r * 0.78} cy={y - r * 0.62} r={3.5} fill="#34d399" />}
    </g>
  );
}

function AgentDetail({ topology, run, name }) {
  const isOrch = name === 'orchestrator';
  const spec = isOrch ? null : topology.specialists.find((s) => s.name === name);
  const observed = run.tool_counts?.[name] ?? {};
  const observedRows = Object.entries(observed).sort((a, b) => b[1] - a[1]);
  const description = isOrch
    ? `Holds the budget and decides who works next. Dispatches with ${topology.orchestrator.dispatch_tool}.`
    : spec?.description;
  const sessions = run.sessions?.filter((s) => s.agent === name) ?? [];
  const recordedModel = sessions.find((s) => s.model)?.model ?? (isOrch ? run.model : null);
  const harness = isOrch ? topology.orchestrator.harness : spec?.harness;
  const configModel = isOrch ? topology.orchestrator.model : spec?.model;
  const modelNote = sessions.length
    ? recordedModel
      ? `model ${recordedModel} (recorded)`
      : 'model not recorded'
    : `not reached in this run; config names ${configModel ?? 'no model'}`;

  return (
    <div className="mt-3 rounded-lg border border-white/6 bg-white/[0.02] p-3">
      <div className="flex items-baseline gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: HUE[name] }} />
        <span className="text-sm text-white/85">{name}</span>
        {!isOrch && <span className="cap-sm font-mono text-white/45">step {STEP[name]}</span>}
      </div>
      <div className="cap-sm mt-0.5 break-words font-mono text-white/45">
        {[harness, modelNote].filter(Boolean).join(' · ')}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-white/50">{description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {(isOrch ? topology.orchestrator.dispatches : spec?.tools_named_in_prompt ?? []).map((t) => (
          <span key={t} className="cap-sm rounded border border-white/10 px-1.5 py-0.5 font-mono text-white/65">
            {t}
          </span>
        ))}
        {!isOrch && spec && !spec.lab_access && (
          <span className="cap-sm text-white/45">no lab tools: reasons over what it is sent</span>
        )}
      </div>
      <div className="mt-2.5 border-t border-white/5 pt-2">
        <div className="cap-sm font-mono text-white/45">called in this run</div>
        {observedRows.length ? (
          <div className="mt-1 space-y-0.5">
            {observedRows.map(([tool, n]) => (
              <div key={tool} className="cap flex justify-between font-mono">
                <span className="truncate text-white/55">{tool}</span>
                <span className="tabular text-white/80">{n}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cap mt-1 text-white/45">nothing</div>
        )}
      </div>
    </div>
  );
}

function Controls({
  cursor, total, playing, speed, onPlay, onStep, onRestart, onSeek, onSpeed,
  showPlumbing, plumbingCount, onPlumbing, current,
}) {
  const btn = 'grid h-9 w-9 place-items-center rounded-md border border-white/10 text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-30 md:h-8 md:w-8';
  return (
    <div className="rounded-lg border border-white/6 bg-night-800/70 p-2.5">
      <div className="flex items-center gap-1.5">
        <button className={btn} onClick={onRestart} aria-label="Restart replay">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button className={btn} onClick={() => onStep(-1)} disabled={cursor === 0} aria-label="Previous turn">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          className="grid h-8 w-10 place-items-center rounded-md border border-hive-400/50 bg-hive-400/10 text-hive-200 transition hover:bg-hive-400/20"
          onClick={onPlay}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button className={btn} onClick={() => onStep(1)} disabled={cursor >= total} aria-label="Next turn">
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <div className="cap-sm ml-auto flex items-center gap-0.5 font-mono">
          {[2, 8, 32].map((s) => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              className={`tap rounded px-2 py-1 transition ${
                speed === s ? 'bg-white/10 text-white/85' : 'text-white/60 hover:text-white/60'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={total}
        value={cursor}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="mt-2.5 h-10 w-full accent-amber-400 md:h-4"
        aria-label="Seek through turns"
      />
      <div className="cap-sm mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-white/45">
        <span className="tabular">
          turn {cursor}/{total}
        </span>
        {current && (
          <span className="tabular">
            +{current.t_rel.toFixed(0)} s · {clock(current.at)}
          </span>
        )}
        <span>time compressed, order kept</span>
        <button onClick={onPlumbing} className="ml-auto text-white/40 underline-offset-2 hover:text-white/70 hover:underline">
          {showPlumbing ? 'hide' : 'show'} {plumbingCount} tool-schema loads
        </button>
      </div>
    </div>
  );
}

function Timeline({ turns, total, trim }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  return (
    <div ref={ref} className="mt-3 max-h-[34rem] space-y-2 overflow-y-auto pr-1 sm:max-h-[38rem]">
      {turns.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-white/40">
          Press play, or step through the {total} recorded turns one at a time.
        </div>
      )}
      <AnimatePresence initial={false}>
        {turns.map((t) => (
          <motion.div
            key={t.i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Turn t={t} trim={trim} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Turn({ t, trim }) {
  if (t.kind === 'approval_request' || t.kind === 'approval_granted' || t.kind === 'denied') {
    return <Checkpoint t={t} />;
  }
  if (t.kind === 'notice') {
    return (
      <div className="cap-sm flex items-center gap-2 px-1 font-mono text-white/45">
        <span className="h-px flex-1 bg-white/8" />
        <span className={t.failed ? 'text-warn/80' : ''}>
          {t.from_agent ?? 'sub-agent'} {t.failed ? 'failed' : 'replied'}: result in orchestrator inbox
        </span>
        <span className="tabular text-white/50">+{t.t_rel.toFixed(0)}s</span>
        <span className="h-px flex-1 bg-white/8" />
      </div>
    );
  }
  if (t.kind === 'harness_error') {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2">
        <Meta t={t} label={`harness error${t.code ? `, ${t.code}` : ''}`} tone="text-warn" />
        <Clamp text={plain(t.text)} className="mt-1 text-xs leading-relaxed text-warn/80" lines={3} />
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-1 w-0.5 shrink-0 self-stretch rounded-full" style={{ background: HUE[t.agent] ?? '#888', opacity: 0.55 }} />
      <div className="min-w-0 flex-1">
        {t.kind === 'tool_call' ? <ToolTurn t={t} trim={trim} /> : <MessageTurn t={t} trim={trim} />}
      </div>
    </div>
  );
}

function Meta({ t, label, tone = 'text-white/40', korean = false }) {
  return (
    <div className="cap-sm flex items-baseline gap-2 font-mono">
      <span className="font-medium" style={{ color: HUE[t.agent] ?? '#aaa' }}>{t.agent}</span>
      <span className={tone}>{label}</span>
      {korean && (
        <span className="rounded border border-white/10 px-1 text-white/60" title="Kept in the language the agent wrote it in">
          written in Korean
        </span>
      )}
      <span className="tabular ml-auto text-white/50">+{t.t_rel.toFixed(0)}s</span>
    </div>
  );
}

function MessageTurn({ t, trim }) {
  const label = { prompt: 'prompt', brief: 'brief from orchestrator', message: 'reply' }[t.kind] ?? t.kind;
  const lines = t.kind === 'brief' ? 4 : 6;
  return (
    <div className={`rounded-lg px-3 py-2 ${t.kind === 'prompt' ? 'border border-hive-400/25 bg-hive-400/[0.05]' : 'bg-white/[0.025]'}`}>
      <Meta t={t} label={label} korean={HANGUL.test(t.text ?? '')} />
      <Clamp markdown text={t.text} lines={lines} className="mt-1 text-[13.5px] leading-relaxed text-white/80" />
      {t.text_truncated && (
        <div className="cap-sm mt-1 font-mono text-white/45">
          message cut in the record: first {(trim?.message ?? t.text.length).toLocaleString()} chars kept
        </div>
      )}
    </div>
  );
}

function ToolTurn({ t, trim }) {
  const [open, setOpen] = useState(false);
  const dispatch = Boolean(t.target);
  return (
    <div className={`rounded-lg px-3 py-2 ${t.plumbing ? 'opacity-60' : ''} ${dispatch ? 'border border-white/10 bg-white/[0.03]' : 'bg-white/[0.015]'}`}>
      <Meta t={t} label={dispatch ? 'dispatch' : t.plumbing ? 'loads tool schemas' : 'tool call'} />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className={`cap rounded border px-1.5 py-0.5 font-mono ${
          t.error ? 'border-warn/40 text-warn' : t.ns === 'lab' ? 'border-signal/35 text-signal' : 'border-white/12 text-white/70'
        }`}>
          {t.ns === 'lab' ? 'lab.' : ''}{t.tool}
        </span>
        {dispatch && (
          <span className="cap font-mono" style={{ color: HUE[t.target] ?? '#ccc' }}>
            to {t.target}
          </span>
        )}
        {t.unparsed_input && <span className="cap-sm text-warn/80">rejected as invalid JSON</span>}
      </div>
      {t.args_summary && !dispatch && (
        <div className="cap-sm mt-1 break-words font-mono leading-relaxed text-white/45">{t.args_summary}</div>
      )}
      {dispatch && t.args?.title && (
        <div className="cap-sm mt-1 font-mono text-white/45">session title: {t.args.title}</div>
      )}
      {t.result != null && (
        <div className="mt-1.5">
          <button onClick={() => setOpen((o) => !o)}
            className="cap-sm flex items-center gap-1 font-mono text-white/45 hover:text-white/70">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            result · {t.result_chars?.toLocaleString()} chars
            {t.result_truncated
              ? `, first ${(trim?.tool_payload ?? t.result.length).toLocaleString()} kept`
              : ''}
          </button>
          {open && (
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-night-900/80 cap-sm p-2 font-mono leading-relaxed text-white/60">
              {plain(pretty(t.result))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Checkpoint({ t }) {
  const ask = t.kind === 'approval_request';
  const denied = t.kind === 'denied';
  const Icon = ask || denied ? ShieldAlert : ShieldCheck;
  const tone = ask ? 'border-hive-400/50 bg-hive-400/[0.07]' : denied ? 'border-warn/40 bg-warn/[0.07]' : 'border-signal/40 bg-signal/[0.06]';
  const color = ask ? 'text-hive-400' : denied ? 'text-warn' : 'text-signal';
  return (
    <div className={`relative overflow-hidden rounded-lg border ${tone} px-3 py-2.5`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className={`text-xs font-medium ${color}`}>
          {ask ? 'Checkpoint: approval required' : denied ? 'Refused by policy' : 'Approved'}
        </span>
        <span className="cap-sm tabular ml-auto font-mono text-white/45">+{t.t_rel.toFixed(0)}s</span>
      </div>
      <div className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-white/70">
        {ask && (
          <>
            <div>{t.text}</div>
            <div className="cap-sm font-mono text-white/45">
              policy {t.policy ?? 'n/a'} · {t.phase ?? ''} · raised in the {t.agent} session
            </div>
            {t.preview && <Clamp text={t.preview} lines={2} className="cap-sm font-mono text-white/45" />}
          </>
        )}
        {!ask && !denied && (
          <>
            <div>Accepted; the call ran after this point.</div>
            <div className="cap-sm break-all font-mono text-white/45">{t.mechanism}</div>
          </>
        )}
        {denied && <div>{t.text}</div>}
      </div>
    </div>
  );
}

function Clamp({ text, lines = 4, className = '', markdown = false }) {
  const [open, setOpen] = useState(false);
  const long = (text?.length ?? 0) > lines * 90;
  const fade = 'linear-gradient(to bottom, #000 65%, transparent)';
  return (
    <div className={className}>
      <div
        style={
          !open && long
            ? { maxHeight: `${lines * 1.625}em`, overflow: 'hidden', maskImage: fade, WebkitMaskImage: fade }
            : undefined
        }
      >
        {markdown ? (
          <Markdown text={text} />
        ) : (
          <div className="whitespace-pre-wrap break-words">{text}</div>
        )}
      </div>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="cap-sm mt-0.5 font-mono text-white/45 hover:text-white/70">
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

/* Agents answer in Markdown. Showing the asterisks and pipes raw makes a
 * transcript hard to read, so headings, bold, lists, rules and tables are drawn;
 * the words are untouched. No HTML is injected. */
function parseBlocks(src) {
  const out = [];
  let para = [];
  let list = null;
  let table = null;
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join('\n') });
    if (list) out.push(list);
    if (table) out.push(table);
    para = [];
    list = null;
    table = null;
  };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
      out.push({ type: 'hr' });
      continue;
    }
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      out.push({ type: 'h', text: h[1] });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      if (!table) {
        flush();
        table = { type: 'table', rows: [] };
      }
      if (/^[\s|:-]+$/.test(line) && /-{2,}/.test(line)) continue;
      table.rows.push(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
      continue;
    }
    const li = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      if (!list) {
        flush();
        list = { type: 'list', items: [] };
      }
      list.items.push({ marker: /\d/.test(li[2]) ? li[2] : '–', depth: li[1].length >= 2 ? 1 : 0, text: li[3] });
      continue;
    }
    if (list || table) flush();
    para.push(line);
  }
  flush();
  return out;
}

const INLINE = /(\*\*(?:[^*\n]|\*[^*\n]+\*)+?\*\*|`[^`\n]+`|\*[^*\s][^*\n]*?\*)/g;

function inline(text) {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (i % 2 === 0) return part;
    if (part.startsWith('**')) {
      return <strong key={i} className="font-semibold text-white/90">{inline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('`')) {
      return <code key={i} className="rounded bg-white/[0.06] px-1 font-mono text-[0.92em]">{part.slice(1, -1)}</code>;
    }
    return <em key={i}>{inline(part.slice(1, -1))}</em>;
  });
}

function Markdown({ text }) {
  const blocks = useMemo(() => parseBlocks(plain(text)), [text]);
  return (
    <div className="space-y-1.5 break-words">
      {blocks.map((b, i) => {
        if (b.type === 'hr') return <div key={i} className="h-px bg-white/8" />;
        if (b.type === 'h') return <div key={i} className="pt-0.5 font-semibold text-white/85">{inline(b.text)}</div>;
        if (b.type === 'list') {
          return (
            <div key={i} className="space-y-0.5">
              {b.items.map((it, k) => (
                <div key={k} className={`flex gap-1.5 ${it.depth ? 'pl-4' : ''}`}>
                  <span className="shrink-0 font-mono text-white/55">{it.marker}</span>
                  <span className="min-w-0">{inline(it.text)}</span>
                </div>
              ))}
            </div>
          );
        }
        if (b.type === 'table') {
          const [head, ...body] = b.rows;
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr>
                    {head.map((c, k) => (
                      <th key={k} className="border-b border-white/10 px-1.5 py-1 font-medium text-white/60">{inline(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r}>
                      {row.map((c, k) => (
                        <td key={k} className="border-b border-white/5 px-1.5 py-1 align-top text-white/70">{inline(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{inline(b.text)}</p>;
      })}
    </div>
  );
}

function pretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 1);
  } catch {
    return text;
  }
}

function Provenance({ run, topology }) {
  const policies = topology.policies
    .map((p) => (p.params?.limit ? `${p.name} (limit ${p.params.limit})` : p.name))
    .join(', ');
  const { glyphs, korean } = useMemo(() => {
    let g = 0;
    let k = 0;
    for (const t of run.turns) {
      g += glyphCount(t.text) + glyphCount(t.result);
      if (t.kind !== 'tool_call' && HANGUL.test(t.text ?? '')) k += 1;
    }
    return { glyphs: g, korean: k };
  }, [run]);
  const trim = run.trim_chars?.tool_payload;
  return (
    <p className="cap-sm mt-4 break-words font-mono leading-relaxed text-white/45">
      run {run.id.slice(0, 8)} · harness {run.harness}
      {run.model ? ` · ${run.model}` : ''} · {run.counts.sub_agent_sessions} sub-agent sessions ·
      turns read from {run.source} · relay copies of each tool call dropped
      {trim ? `, tool payloads cut at ${trim.toLocaleString()} chars` : ''} · topology from{' '}
      {topology.bundle}/*.yaml · lab tools via {topology.mcp_server.module} (
      {topology.mcp_server.tools.length}) · policies: {policies} · gated:{' '}
      {topology.gated_tools.join(', ')}
      {run.approval_source ? ` · approvals logged from ${run.approval_source}` : ''}
      {korean ? ` · ${korean} messages written in Korean, shown untranslated` : ''}
      {glyphs ? ` · ${glyphs} emoji in agent text drawn as plain marks` : ''}
    </p>
  );
}
