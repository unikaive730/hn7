import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowDown, ArrowRight } from 'lucide-react';

/** First screen. GET /api/headline returns a retrospective preview computed
 *  from the lab, including the full order strip. Nothing is typed in. */

const BASE = import.meta.env.VITE_LAB_API ?? '';

async function api(path, signal) {
  const response = await fetch(`${BASE}${path}`, { signal });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

const DEFAULT_BUDGET = 30; // the experiment's input, not a result

function useHeadline() {
  const [state, setState] = useState({ facts: null, run: null, order: null, error: null });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    (async () => {
      try {
        const { facts, run, order } = await api(
          `/api/headline?budget=${DEFAULT_BUDGET}`,
          controller.signal,
        );
        if (alive) setState({ facts, run, order, error: null });
      } catch (error) {
        if (alive) setState((s) => ({ ...s, error: error.message }));
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  return state;
}

export default function Hero() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const imageY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '16%']);
  const { facts, run, order, error } = useHeadline();
  const cutoff = facts?.cutoff_year;

  return (
    <section
      id="top"
      ref={ref}
      className="relative isolate overflow-hidden bg-night-950 md:min-h-[calc(100svh-3rem)]"
    >
      {/* Picture: a block on phones, the full ground on wider screens. */}
      <div className="grain relative h-[58svh] max-h-[34rem] overflow-hidden md:absolute md:inset-0 md:h-auto md:max-h-none">
        <motion.div style={{ y: imageY }} className="absolute inset-0">
          <picture>
            <source media="(max-width: 767px)" srcSet="/img/hero-bee-tall.webp" type="image/webp" />
            <img
              src="/img/hero-bee-wide.webp"
              alt="Illustration of a honey bee on a small flower at dusk"
              className="kenburns h-full w-full object-cover object-[50%_40%] md:object-[30%_50%]"
              fetchPriority="high"
              decoding="async"
            />
          </picture>
        </motion.div>
        <div className="absolute inset-0 bg-[linear-gradient(to_top,var(--color-night-950)_2%,rgba(7,7,11,0.55)_38%,transparent_70%)] md:bg-[linear-gradient(90deg,var(--color-night-950)_0%,rgba(7,7,11,0.92)_32%,rgba(7,7,11,0.45)_56%,rgba(7,7,11,0)_78%)]" />
        <div className="absolute inset-x-0 bottom-0 hidden h-40 bg-linear-to-t from-night-900 to-transparent md:block" />
        <p className="absolute right-4 top-3 font-mono text-[10px] tracking-wide text-wax/45 md:bottom-5 md:right-6 md:top-auto">
          Generated illustration, not a photograph
        </p>
      </div>

      <div className="relative mx-auto -mt-24 max-w-6xl px-4 pb-14 sm:px-6 md:mt-0 md:px-8 md:pb-14 md:pt-[8vh]">
        <div className="max-w-[36rem] lg:max-w-[37rem]">
          <p className="font-mono text-[12px] text-hive-400/90">
            Retrospective test
            {cutoff ? <span className="text-wax/50"> · compound-year cutoff {cutoff}</span> : null}
          </p>

          <h1 className="font-serif-display mt-4 whitespace-nowrap text-[3.3rem] font-normal leading-[0.95] text-wax sm:text-7xl lg:text-[5.5rem]">
            BeeGuard Lab
          </h1>

          <p className="mt-5 max-w-[32rem] text-[17px] leading-relaxed text-wax/72">
            Rank insecticides first reported after {cutoff ?? 'a cutoff year'} using
            earlier compounds’ toxicity labels. Simulated assays reveal the held-out
            labels to measure which ordering finds them first.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a
              href="#lab"
              className="inline-flex items-center gap-2 rounded-md bg-hive-400 px-4 py-2.5 text-sm font-semibold text-night-950 transition-colors hover:bg-hive-200"
            >
              Run the lab
              <ArrowDown className="h-4 w-4" strokeWidth={2.25} />
            </a>
            <a
              href="#agents"
              className="group inline-flex items-center gap-1.5 text-sm text-wax/80 underline decoration-wax/25 underline-offset-[6px] transition-colors hover:text-wax hover:decoration-hive-400"
            >
              See the agents
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          <Readout facts={facts} run={run} error={error} />
          <OrderStrip facts={facts} run={run} order={order} reduce={reduce} />
        </div>
      </div>
    </section>
  );
}

/** The default run, as three measured lines. */
function Readout({ facts, run, error }) {
  if (error) {
    return (
      <p className="mt-10 border-l-2 border-warn/60 pl-3 text-sm text-warn/90">
        The lab API did not answer ({error}). The numbers here come from it, so
        they stay empty until /api/headline responds.
      </p>
    );
  }

  const ready = facts && run;
  const last = run?.found_at?.[run.found_at.length - 1];
  const rows = ready
    ? [
        {
          value: `${run.found}/${run.targets_total}`,
          text: (
            <>
              held-out insecticides with non-toxic labels found in the first {run.budget} simulated assays.
              The last one came at assay {last}.
            </>
          ),
        },
        {
          value: `${run.speedup}×`,
          text: (
            <>
              fewer assays than random order over all {facts.pool_molecules} pool
              molecules, which needs {run.random_assays_for_same_hits} (median over
              shuffles) to find the same {run.found}.
            </>
          ),
        },
        {
          value: `${facts.targets_on_unseen_scaffolds}/${facts.targets}`,
          text: (
            <>of those answers sit on scaffolds no molecule known by {facts.cutoff_year} had.</>
          ),
          tone: 'warn',
        },
      ]
    : null;

  return (
    <div className="mt-10">
      <div className="flex items-baseline justify-between gap-3 border-b border-wax/12 pb-2 font-mono text-[11px] text-wax/45">
        <span>retrospective preview, computed on load</span>
        {run && (
          <span>
            <span className="hidden sm:inline">model ordering · </span>
            {run.seconds} s
          </span>
        )}
      </div>
      <dl>
        {(rows ?? [0, 1, 2]).map((row, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 + index * 0.08, duration: 0.4 }}
            className="grid grid-cols-[6.2rem_1fr] items-baseline gap-4 border-b border-wax/8 py-3 sm:grid-cols-[7.4rem_1fr]"
          >
            <dt
              className={`font-serif-display text-[2.1rem] leading-none sm:text-[2.5rem] ${
                row.tone === 'warn' ? 'text-warn' : 'text-hive-400'
              }`}
              style={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
            >
              {rows ? row.value : <span className="inline-block h-7 w-16 animate-pulse rounded bg-wax/8" />}
            </dt>
            <dd className="text-[13.5px] leading-snug text-wax/65">
              {rows ? row.text : <span className="inline-block h-3 w-48 animate-pulse rounded bg-wax/8" />}
            </dd>
          </motion.div>
        ))}
      </dl>
    </div>
  );
}

/** Every molecule in the pool, in the order the lab would test it.
 *  Tall marks are the hidden answers; a rose cap marks an answer whose
 *  scaffold was absent before the cutoff. */
function OrderStrip({ facts, run, order, reduce }) {
  if (!facts || !run || !order?.length) return null;

  const n = order.length;
  const budget = run.budget;
  const randomAt = run.random_assays_for_same_hits;
  const pct = (position) => `${(position / n) * 100}%`;

  return (
    <figure className="mt-8">
      <div className="relative h-5 font-mono text-[10.5px] text-wax/55">
        <span className="absolute left-0 top-0">first {budget} assays</span>
        {randomAt != null && (
          <span
            className="absolute top-0 -translate-x-full whitespace-nowrap pr-1.5 text-wax/45"
            style={{ left: pct(randomAt) }}
          >
            random order needs {randomAt}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${n} 40`}
        preserveAspectRatio="none"
        className="block h-14 w-full"
        role="img"
        aria-label={`${n} molecules in test order; ${run.found} answers found within the first ${budget}`}
      >
        <defs>
          <clipPath id="strip-reveal">
            <motion.rect
              x="0"
              y="0"
              height="40"
              initial={{ width: reduce ? n : 0 }}
              animate={{ width: n }}
              transition={{ duration: reduce ? 0 : 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
            />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={budget} height="40" fill="rgba(251,191,36,0.08)" />
        <g clipPath="url(#strip-reveal)">
          {order.map((a) =>
            a.is_target ? (
              <g key={a.position}>
                <rect x={a.position - 0.85} y="9" width="0.7" height="27" fill="#fbbf24" />
                {!a.scaffold_seen && (
                  <rect x={a.position - 0.85} y="3" width="0.7" height="4" fill="#fb7185" />
                )}
              </g>
            ) : (
              <rect
                key={a.position}
                x={a.position - 0.75}
                y="28"
                width="0.5"
                height="8"
                fill="rgba(239,230,207,0.26)"
              />
            ),
          )}
        </g>
        {randomAt != null && (
          <line
            x1={randomAt - 0.5}
            x2={randomAt - 0.5}
            y1="0"
            y2="40"
            stroke="rgba(239,230,207,0.6)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <line
          x1="0"
          x2={n}
          y1="36.5"
          y2="36.5"
          stroke="rgba(239,230,207,0.18)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="relative mt-1 h-4 font-mono text-[10px] text-wax/40">
        <span className="absolute left-0">1</span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(budget) }}>
          {budget}
        </span>
        <span className="absolute right-0">{n}</span>
      </div>

      <figcaption className="mt-3 text-[12px] leading-relaxed text-wax/45">
        The {n} molecules first reported after {facts.cutoff_year}, in the order
        the lab would test them. <span className="text-hive-400">Tall marks</span>{' '}
        are the {facts.targets} insecticides carrying non-toxic dataset labels;{' '}
        <span className="text-warn">a rose cap</span> means no molecule known by{' '}
        {facts.cutoff_year} shared its scaffold.
      </figcaption>
    </figure>
  );
}
