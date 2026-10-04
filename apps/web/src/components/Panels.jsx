import { motion } from 'framer-motion';
import { Clock, GitCompare, Layers, Microscope } from 'lucide-react';
import { Counter } from './Dial.jsx';

const STRATEGY_LABEL = {
  model: 'Learned ordering',
  diversity: 'Scaffold diversity',
  insecticide_only: 'No model',
};

/** Three orderings over the same budget.
 *
 *  This is where the trade-off shows: diversity gives up a find to cover two
 *  more scaffolds, which matters because most answers sit on scaffolds the
 *  model has never seen.
 */
export function StrategyCompare({ data }) {
  if (!data?.rows?.length) return null;
  const best = Math.max(...data.rows.map((r) => r.found));

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <GitCompare className="h-4 w-4 text-white/60" />
        <h3 className="font-mono cap text-white/45">Same budget, three orderings</h3>
        <span className="basis-full text-xs text-white/60">
          {data.budget} assays each. Random order over the whole pool finds a median of{' '}
          {data.random_median_found}.
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {data.rows.map((row, index) => (
          <motion.div
            key={row.strategy}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.08 }}
          >
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-white/75">{STRATEGY_LABEL[row.strategy]}</span>
              <span className="tabular text-white/50">
                <span className="font-semibold text-white/85">{row.found}</span> found ·{' '}
                {row.scaffolds_covered} scaffolds
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/8">
              <motion.div
                className={`h-full rounded-full ${
                  row.found === best ? 'bg-hive-400' : 'bg-white/25'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${(row.found / data.targets) * 100}%` }}
                transition={{ duration: 0.8, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      <CompareReading data={data} />
    </section>
  );
}

/** One or two sentences built from the comparison, so the claim moves with
 *  the budget instead of being written for one run. */
function CompareReading({ data }) {
  const by = Object.fromEntries(data.rows.map((r) => [r.strategy, r]));
  const m = by.model;
  const d = by.diversity;
  const n = by.insecticide_only;
  if (!m) return null;
  const parts = [];
  if (n) {
    const r = data.random_median_found;
    const fromFilter = n.found - r;
    const total = m.found - r;
    const share =
      total > 0 && fromFilter >= total / 2
        ? ', so most of the gap to random comes from testing insecticides first'
        : total > 0
          ? ', so the model adds more than the insecticide filter does'
          : '';
    parts.push(
      `Insecticides in ${n.single_draw ? 'one shuffle, seed 0,' : 'arbitrary order'} find ${n.found} and the learned ordering finds ${m.found}, against ${r} for random order over the whole pool${data.random_shuffles ? `, median of ${data.random_shuffles} draws` : ''}${share}.`,
    );
    if (n.single_draw) {
      parts.push(
        'That row is one permutation, an illustration rather than a baseline; the full shuffle distribution for the same ordering is in the rigor checks.',
      );
    }
  }
  if (d) {
    const lost = m.found - d.found;
    const gained = d.scaffolds_covered - m.scaffolds_covered;
    if (lost > 0 && gained > 0) {
      parts.push(
        `The diversity penalty gives up ${lost} ${lost === 1 ? 'find' : 'finds'} to test ${gained} more scaffolds.`,
      );
    } else if (lost <= 0 && gained > 0) {
      parts.push(`The diversity penalty tests ${gained} more scaffolds without losing a find.`);
    } else {
      parts.push(`The diversity penalty finds ${d.found} and covers ${d.scaffolds_covered} scaffolds.`);
    }
    if (d.outside_insecticides > 0) {
      parts.push(
        `Part of that cost is the penalty itself: the score runs 0 to 1 and the penalty is ${data.diversity_weight ?? 1} per repeated scaffold, so ${d.outside_insecticides} of the ${data.budget} picks land outside the insecticides, where no answer can be.`,
      );
    }
  }
  return <p className="mt-4 text-xs leading-relaxed text-white/45">{parts.join(' ')}</p>;
}

/** The same question asked from three points in history, as one table so
 *  the eras read against each other instead of as three separate cards. */
export function EraPanel({ data }) {
  if (!data?.eras?.length) return null;

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Clock className="h-4 w-4 text-white/60" />
        <h3 className="font-mono cap text-white/45">Three cutoffs, each retrained</h3>
        <span className="basis-full text-xs text-white/60">
          Retrained at each cutoff, {data.budget} assays each. Precomputed, not a control.
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[19rem] text-sm">
          <thead className="font-mono cap-sm text-white/60">
            <tr className="border-b border-white/8 text-right">
              <th className="pb-2 text-left font-normal">cutoff</th>
              <th className="pb-2 font-normal">known by then</th>
              <th className="pb-2 font-normal">pool after</th>
              <th className="pb-2 font-normal">found / answers</th>
              <th className="pb-2 font-normal">fewer assays</th>
            </tr>
          </thead>
          <tbody>
            {data.eras.map((era, index) => (
              <motion.tr
                key={era.cutoff_year}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="border-b border-white/5 text-right tabular text-white/70 last:border-0"
              >
                <td className="py-2.5 text-left font-serif-display text-2xl text-hive-400">
                  {era.cutoff_year}
                </td>
                <td className="py-2.5">{era.train_molecules}</td>
                <td className="py-2.5">{era.pool_molecules}</td>
                <td className="whitespace-nowrap py-2.5">
                  <span className="text-white/90">{era.found}</span>
                  <span className="text-white/60"> / {era.targets}</span>
                </td>
                <td className="py-2.5 font-mono text-hive-400">
                  {era.speedup != null ? `${era.speedup}×` : 'n/a'}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-white/40">
        At each cutoff the lab retrains on what was published by then, so both the training set and
        the answers it has to find change. Read the ratios with their rows: a cutoff that found
        fewer than its answers is a ratio for the answers it did find, and a cutoff with only a
        handful of answers moves a long way on one label.
      </p>
    </section>
  );
}

/** The shared research record: what each agent decided, in order. */
export function RecordPanel({ rows }) {
  if (!rows?.length) return null;

  const kindStyle = {
    evidence: 'border-white/10 text-white/60',
    decision: 'border-hive-400/40 text-hive-400',
    experiment: 'border-signal/40 text-signal',
    falsification: 'border-warn/40 text-warn',
    next_experiment: 'border-white/15 text-white/70',
  };

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-white/60" />
        <h3 className="font-mono cap text-white/45">
          Research record
        </h3>
        <span className="ml-auto text-xs text-white/55">{rows.length} rows</span>
      </div>

      <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
          >
            <span
              className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 cap-sm uppercase tracking-wide ${
                kindStyle[row.kind] ?? 'border-white/10 text-white/50'
              }`}
            >
              {row.kind.replace('_', ' ')}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono cap text-white/45">
              {row.reason ??
                row.description ??
                row.verdict ??
                row.query ??
                `${row.found ?? ''} found, ${row.speedup ?? ''}×`}
            </span>
            <span className="shrink-0 cap-sm text-white/50">{row.at?.slice(11, 16)}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-white/60">
        Every decision writes one row here, so a run can be reconstructed from
        the record alone rather than from a transcript.
      </p>
    </section>
  );
}

/** One molecule, opened from the queue, with a live PubChem lookup. */
export function MoleculePanel({ molecule, onClose }) {
  if (!molecule) return null;
  const { dataset, pubchem } = molecule;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass lift rounded-xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Microscope className="h-4 w-4 text-hive-400" />
            <h2 className="truncate text-sm font-medium text-white/90">{dataset.name}</h2>
          </div>
          <p className="mt-1 break-all font-mono cap text-white/60">
            {dataset.smiles}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-xs text-white/60 transition hover:text-white/70"
        >
          close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        <Field label="first reported" value={dataset.year} />
        <Field label="bee toxicity" value={dataset.label === 1 ? 'toxic' : 'non-toxic'} />
        <Field label="insecticide" value={dataset.insecticide === 1 ? 'yes' : 'no'} />
        <Field label="mol. weight" value={dataset.molecular_weight} />
      </div>

      {pubchem?.ok && (
        <div className="mt-4 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <div className="font-mono cap-sm text-white/40">
            PubChem, fetched just now
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <Field label="formula" value={pubchem.formula} />
            <Field label="XLogP" value={pubchem.xlogp} />
            <Field label="CID" value={pubchem.cid} />
          </div>
          {pubchem.iupac_name && (
            <p className="mt-2 break-words font-mono cap-sm leading-relaxed text-white/55">
              {pubchem.iupac_name}
            </p>
          )}
          <a
            href={pubchem.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block cap text-hive-400 underline decoration-hive-400/30 underline-offset-2"
          >
            open on PubChem
          </a>
        </div>
      )}
    </motion.section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="font-mono cap-sm text-white/60">{label}</div>
      <div className="tabular text-white/80">{value ?? '—'}</div>
    </div>
  );
}

/** Four numbers across the top, so the headline survives a glance. */
export function HeadlineStats({ facts, result }) {
  const stats = [
    { value: result?.speedup, decimals: 2, suffix: '×', label: 'faster than random' },
    { value: result?.found, label: `of ${facts?.targets ?? 0} answers found` },
    { value: facts?.pool_molecules, label: 'molecules in the pool' },
    {
      value: facts?.targets_on_unseen_scaffolds,
      label: 'answers on unseen scaffolds',
      tone: 'warn',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.07 }}
          className="glass lift rounded-xl px-4 py-3.5"
        >
          <div
            className={`text-3xl font-semibold ${
              stat.tone === 'warn' ? 'text-warn' : 'text-hive-400'
            }`}
          >
            <Counter value={stat.value ?? 0} decimals={stat.decimals ?? 0} suffix={stat.suffix ?? ''} />
          </div>
          <div className="mt-0.5 cap leading-snug text-white/45">{stat.label}</div>
        </motion.div>
      ))}
    </div>
  );
}
