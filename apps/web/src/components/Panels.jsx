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
      <div className="flex items-center gap-2">
        <GitCompare className="h-4 w-4 text-white/35" />
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">
          Same budget, three orderings
        </h2>
        <span className="ml-auto text-xs text-white/35">
          {data.budget} assays · random finds {data.random_median_found}
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
                {row.scaffolds_covered} scaffolds ·{' '}
                <span className="text-hive-400">{row.vs_random}×</span>
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

      <p className="mt-4 text-xs leading-relaxed text-white/40">
        Diversity trades a find for two more scaffolds. That is the trade worth
        making here: {}
        most of the answers sit on scaffolds the model has never seen, and the
        learned ordering cannot reach them.
      </p>
    </section>
  );
}

/** The same question asked from three points in history. */
export function EraPanel({ data }) {
  if (!data?.eras?.length) return null;

  return (
    <section className="glass lift rounded-xl p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-white/35" />
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">
          Move the clock, re-run the question
        </h2>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {data.eras.map((era, index) => (
          <motion.div
            key={era.cutoff_year}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="rounded-lg border border-white/6 bg-white/[0.02] p-3"
          >
            <div className="text-2xl font-semibold text-hive-400">{era.cutoff_year}</div>
            <div className="mt-2 space-y-1 text-xs text-white/50">
              <div>
                <span className="tabular text-white/80">{era.train_molecules}</span> known
              </div>
              <div>
                <span className="tabular text-white/80">{era.targets}</span> answers ahead
              </div>
              {era.speedup != null && (
                <div className="pt-1 text-sm text-white/75">
                  found <span className="tabular font-semibold">{era.found}</span>,{' '}
                  <span className="text-hive-400">{era.speedup}×</span>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-white/40">
        The lab is not tuned to one date. Move the cutoff and it retrains on
        whatever was published by then, and the answers it has to find change
        with it.
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
        <Layers className="h-4 w-4 text-white/35" />
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">
          Research record
        </h2>
        <span className="ml-auto text-xs text-white/30">{rows.length} rows</span>
      </div>

      <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
          >
            <span
              className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                kindStyle[row.kind] ?? 'border-white/10 text-white/50'
              }`}
            >
              {row.kind.replace('_', ' ')}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/45">
              {row.reason ??
                row.description ??
                row.verdict ??
                row.query ??
                `${row.found ?? ''} found, ${row.speedup ?? ''}×`}
            </span>
            <span className="shrink-0 text-[10px] text-white/25">{row.at?.slice(11, 16)}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-white/35">
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
          <p className="mt-1 break-all font-mono text-[11px] text-white/35">
            {dataset.smiles}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-xs text-white/35 transition hover:text-white/70"
        >
          close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        <Field label="first reported" value={dataset.year} />
        <Field label="bee toxicity" value={dataset.label === 1 ? 'toxic' : 'safe'} />
        <Field label="insecticide" value={dataset.insecticide === 1 ? 'yes' : 'no'} />
        <Field label="mol. weight" value={dataset.molecular_weight} />
      </div>

      {pubchem?.ok && (
        <div className="mt-4 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-wide text-white/35">
            PubChem, fetched just now
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <Field label="formula" value={pubchem.formula} />
            <Field label="XLogP" value={pubchem.xlogp} />
            <Field label="CID" value={pubchem.cid} />
          </div>
          {pubchem.iupac_name && (
            <p className="mt-2 break-words font-mono text-[10px] leading-relaxed text-white/30">
              {pubchem.iupac_name}
            </p>
          )}
          <a
            href={pubchem.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[11px] text-hive-400 underline decoration-hive-400/30 underline-offset-2"
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
      <div className="text-[10px] uppercase tracking-wide text-white/30">{label}</div>
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
          <div className="mt-0.5 text-[11px] leading-snug text-white/45">{stat.label}</div>
        </motion.div>
      ))}
    </div>
  );
}
