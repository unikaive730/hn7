import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, Filter, Target } from 'lucide-react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/* Pest-active molecules from ChEMBL that the bee model scores as safe.
 * Reads GET /api/candidates, which serves the `candidates` block of
 * lab/data/derived/chembl_external.json (`python -m lab.beeguard.external`,
 * from lab/data/chembl_pests.csv written by lab/scripts/fetch_chembl.py).
 * Structures are drawn from SMILES because none of these molecules is in
 * ApisTox, and /api/structure/{cid}.svg only knows ApisTox CIDs. */

const AXIS = 'rgba(255,255,255,0.3)';
const PAGE = 12;

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

const tooltipStyle = {
  background: '#12121a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
};

const FUNNEL = [
  ['records', 'ChEMBL pest records'],
  ['molecules', 'distinct molecules'],
  ['valid_smiles', 'parse in RDKit'],
  ['not_in_apistox', 'not in ApisTox'],
  ['with_potency', 'lethal dose in mg/L'],
  ['active', 'active on a pest'],
  ['predicted_bee_safe', 'predicted bee-safe'],
  ['in_domain', 'inside the domain'],
];

function mgL(v) {
  if (v == null) return 'n/a';
  if (v >= 0.01) return String(Number(v.toPrecision(3)));
  return v.toExponential(1);
}

const smilesSvg = (smiles, size) =>
  `/api/structure/smiles.svg?smiles=${encodeURIComponent(smiles)}&size=${size}`;

function Funnel({ funnel }) {
  // Bar length is log10(count) so the last cut stays visible beside the first; labels carry the real count.
  const rows = FUNNEL.filter(([k]) => funnel[k] != null).map(([k, label]) => ({
    key: k,
    label,
    value: funnel[k],
    length: Math.log10(Math.max(funnel[k], 1)),
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
          <XAxis type="number" domain={[0, 'dataMax']} hide />
          <YAxis
            type="category"
            dataKey="label"
            width={128}
            stroke={AXIS}
            tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            formatter={(v, name, item) => [Number(item.payload.value).toLocaleString('en-US'), 'count']}
          />
          <Bar dataKey="length" radius={[0, 3, 3, 0]} barSize={14} isAnimationActive>
            {rows.map((r, i) => (
              <Cell key={r.key} fill={i === rows.length - 1 ? '#fbbf24' : `rgba(255,255,255,${0.12 + i * 0.03})`} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v) => Number(v).toLocaleString('en-US')}
              style={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SafeBar({ value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className="h-full rounded-full bg-signal"
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className="font-mono text-[11px] tabular text-white/75">{value.toFixed(2)}</span>
    </div>
  );
}

function CandidateRow({ row, rank }) {
  const [broken, setBroken] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="grid grid-cols-[72px_1fr] gap-3 border-t border-white/5 py-3 sm:grid-cols-[28px_96px_1fr_auto] sm:items-center sm:gap-4"
    >
      <span className="hidden text-right font-mono text-xs tabular text-white/30 sm:block">{rank}</span>

      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-md border border-white/6 bg-night-900/60 sm:h-24 sm:w-24">
        {broken ? (
          <span className="px-1 text-center text-[9px] text-white/30">no drawing</span>
        ) : (
          <img
            src={smilesSvg(row.smiles, 192)}
            alt={`2D structure of ${row.name ?? row.chembl_id}`}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain p-1"
          />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-white/30 sm:hidden">#{rank}</span>
          <a
            href={`https://www.ebi.ac.uk/chembl/compound_report_card/${row.chembl_id}/`}
            target="_blank"
            rel="noreferrer"
            title={row.name ?? row.chembl_id}
            className="inline-flex min-w-0 max-w-full items-center gap-1 text-sm text-white/90 hover:text-hive-400"
          >
            <span className="truncate">{row.name ?? row.chembl_id}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-white/25" />
          </a>
          {row.name && <span className="font-mono text-[10px] text-white/30">{row.chembl_id}</span>}
          <span className="rounded border border-hive-400/30 px-1.5 py-0.5 font-mono text-[10px] text-hive-400/85">
            hypothesis, needs bee assay
          </span>
        </div>

        <div className="mt-1 text-xs text-white/55">
          <span className="italic text-white/70">{row.pest}</span>
          <span className="text-white/25"> · </span>
          <span className="font-mono tabular text-white/80">{mgL(row.potency_mg_l)}</span> mg/L{' '}
          <span className="text-white/35">({row.potency_basis})</span>
          {row.year && <span className="text-white/30"> · {row.year}</span>}
        </div>

        <div className="mt-1 truncate text-[11px] text-white/40" title={row.assay_description}>
          nearest ApisTox: <span className="text-white/60">{row.nearest_name}</span>{' '}
          <span className={row.nearest_label ? 'text-warn' : 'text-signal'}>
            ({row.nearest_label ? 'toxic' : 'not toxic'})
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 sm:hidden">
          <SafeBar value={row.bee_safe_score} />
          <span className="font-mono text-[11px] text-white/45">sim {row.max_similarity.toFixed(2)}</span>
        </div>
      </div>

      <div className="hidden w-44 space-y-1.5 sm:block">
        <div className="font-mono text-[10px] text-white/35">bee-safe score</div>
        <SafeBar value={row.bee_safe_score} />
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-white/55">
            sim {row.max_similarity.toFixed(2)}
          </span>
          {row.cid ? (
            <a
              href={`https://pubchem.ncbi.nlm.nih.gov/compound/${row.cid}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-white/40 hover:text-hive-400"
            >
              CID {row.cid}
            </a>
          ) : (
            <span className="text-white/25">no PubChem CID</span>
          )}
        </div>
      </div>
    </motion.li>
  );
}

export default function Candidates() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pest, setPest] = useState(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    getJSON('/api/candidates?limit=500').then(setData).catch((e) => setError(e.message));
  }, []);

  const pests = useMemo(() => {
    if (!data) return [];
    const counts = {};
    data.rows.forEach((r) => {
      counts[r.pest] = (counts[r.pest] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    return pest ? data.rows.filter((r) => r.pest === pest) : data.rows;
  }, [data, pest]);

  return (
    <section className="glass lift rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-[15rem] flex-1">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-hive-400" />
            <h2 className="text-sm font-medium text-white/90">Kills the pest, predicted to spare the bee</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
            Molecules ChEMBL reports as lethal to crop pests, scored by the ApisTox model. None of them
            has a bee measurement in either dataset, so each row is a bee assay worth ordering.
          </p>
        </div>
        {data && (
          <div className="font-mono text-[10px] leading-relaxed text-white/30 sm:text-right">
            {data.total_ranked} ranked
            <br />
            PubChem CID for {data.pubchem_cids_found} of {data.pubchem_lookups} looked up
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Could not load the candidates: {error}
        </div>
      )}
      {!data && !error && <div className="mt-6 h-96 animate-pulse rounded-lg bg-white/[0.03]" />}

      {data && (
        <>
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <div className="mb-1 text-[10px] text-white/35">
                How the list was cut (log scale)
              </div>
              <Funnel funnel={data.funnel} />
            </div>
            <div className="space-y-3 text-xs leading-relaxed text-white/50">
              <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3 font-mono text-[11px] leading-relaxed text-white/55">
                <div>
                  <span className="text-white/30">active </span>
                  {data.rules.active}
                </div>
                <div className="mt-1">
                  <span className="text-white/30">safe </span>
                  {data.rules.bee_safe}
                </div>
                <div className="mt-1">
                  <span className="text-white/30">domain </span>
                  {data.rules.domain}
                </div>
                <div className="mt-1">
                  <span className="text-white/30">sort </span>
                  {data.rules.sort}
                </div>
              </div>
              <p>
                {data.safe_but_out_of_domain.toLocaleString('en-US')} more molecules score as bee-safe
                but share too little structure with ApisTox for that score to carry weight, so they are left
                off. The bee model has been tested on the ApisTox time split and on the ChEMBL bee records
                above. It has not been tested on these pest chemotypes.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <Filter className="mr-1 h-3.5 w-3.5 text-white/30" />
            <button
              onClick={() => {
                setPest(null);
                setShown(PAGE);
              }}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                pest == null
                  ? 'border-hive-400/50 bg-hive-400/10 text-hive-400'
                  : 'border-white/8 text-white/50 hover:border-white/20'
              }`}
            >
              all <span className="font-mono tabular">{data.rows.length}</span>
            </button>
            {pests.map(([name, count]) => (
              <button
                key={name}
                onClick={() => {
                  setPest(name);
                  setShown(PAGE);
                }}
                className={`rounded-md border px-2 py-1 text-[11px] italic transition ${
                  pest === name
                    ? 'border-hive-400/50 bg-hive-400/10 text-hive-400'
                    : 'border-white/8 text-white/50 hover:border-white/20'
                }`}
              >
                {name} <span className="font-mono not-italic tabular">{count}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 text-xs text-white/40">No molecule passes all three cuts for this pest.</p>
          ) : (
            <ol className="mt-3">
              <AnimatePresence initial={false}>
                {rows.slice(0, shown).map((row, i) => (
                  <CandidateRow key={row.chembl_id} row={row} rank={i + 1} />
                ))}
              </AnimatePresence>
            </ol>
          )}

          {rows.length > shown && (
            <button
              onClick={() => setShown((s) => s + PAGE)}
              className="mt-3 w-full rounded-lg border border-white/8 py-2 text-xs text-white/55 transition hover:border-white/20 hover:text-white/80"
            >
              Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
            </button>
          )}
          {data.total_ranked > data.rows.length && (
            <p className="mt-2 text-[11px] text-white/30">
              Showing the top {data.rows.length} of {data.total_ranked}. The rest are in
              lab/data/derived/chembl_external.json.
            </p>
          )}
        </>
      )}
    </section>
  );
}
