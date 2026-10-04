import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, FlaskConical } from 'lucide-react';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

/* Out-of-sample check against ChEMBL. Reads GET /api/external, which serves
 * lab/data/derived/chembl_external.json, built by
 * `python -m lab.beeguard.external` from lab/data/chembl_apis.csv
 * (written by lab/scripts/fetch_chembl.py). Every number below is read from
 * that response; nothing is typed in by hand. */

const AMBER = '#fbbf24';
const ROSE = '#fb7185';
const AXIS = 'rgba(255,255,255,0.3)';

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

const ld50 = (values) => values.map((v) => v.replace(/^=/, '')).join(', ');

const speciesShort = (s) => (s === 'Apis mellifera' ? 'Honey bee' : s === 'Bombus terrestris' ? 'Bumblebee' : s);

/** Small deterministic jitter so two molecules with close scores don't sit on top of each other. */
function jitter(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 997;
  return (h / 997 - 0.5) * 0.36;
}

function Dot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  const color = payload.correct ? AMBER : ROSE;
  return payload.in_domain ? (
    <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.9} stroke="#0a0a0f" strokeWidth={1.5} />
  ) : (
    <circle cx={cx} cy={cy} r={5.5} fill="#0a0a0f" stroke={color} strokeWidth={2} />
  );
}

function ScoreTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div style={tooltipStyle} className="px-2.5 py-2 text-white/80">
      <div className="text-white/95">{r.name}</div>
      <div className="text-white/50">{speciesShort(r.species)} · LD50 {ld50(r.ld50_ug_per_bee)} ug/bee</div>
      <div>vote share {r.p_toxic.toFixed(3)}</div>
      <div>max similarity {r.max_similarity.toFixed(2)}</div>
    </div>
  );
}

/** One count out of a total, for the small readouts under the headline figure. */
function Stat({ value, total, caption, tone = 'text-white/85' }) {
  return (
    <div className="min-w-0 flex-1 px-3 first:pl-0 last:pr-0">
      <div className={`font-mono text-lg tabular ${tone}`}>
        {value}
        <span className="text-white/50">/{total}</span>
      </div>
      <div className="mt-0.5 cap-sm leading-tight text-white/40">{caption}</div>
    </div>
  );
}

export default function ExternalValidation() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getJSON('/api/external').then(setData).catch((e) => setError(e.message));
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const lanes = [];
    const key = (r) => `${speciesShort(r.species)} · ${r.chembl_label ? 'toxic' : 'not toxic'}`;
    // Honey bee lanes first, toxic on top.
    const order = (r) => (r.species === 'Apis mellifera' ? 0 : 1) * 2 + (r.chembl_label ? 0 : 1);
    [...data.rows].sort((a, b) => order(a) - order(b)).forEach((r) => {
      if (!lanes.includes(key(r))) lanes.push(key(r));
    });
    const points = data.rows.map((r) => ({
      ...r,
      x: r.p_toxic,
      y: lanes.length - 1 - lanes.indexOf(key(r)) + jitter(r.chembl_id + r.species),
    }));
    const honey = data.rows.filter((r) => r.species === 'Apis mellifera');
    const misses = honey.filter((r) => !r.correct);
    return {
      lanes,
      points,
      honey,
      misses,
      missesOutside: misses.filter((r) => !r.in_domain).length,
      nearDuplicates: honey.filter((r) => r.name_in_apistox),
    };
  }, [data]);

  return (
    <section className="glass lift rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-[15rem] flex-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-hive-400" />
            <h2 className="text-sm font-medium text-white/90">Outside test on ChEMBL bee records</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
            Honey bee LD50 values that ChEMBL took from papers outside ApisTox. Same EPA rule for the
            label. The model was retrained with all of these molecules removed before scoring them.
          </p>
        </div>
        {data && (
          <div className="font-mono cap-sm leading-relaxed text-white/55 sm:text-right">
            ChEMBL pulled {data.chembl_fetched_at?.slice(0, 16).replace('T', ' ')} UTC
            <br />
            CC BY-SA 3.0
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Could not load the ChEMBL test: {error}
        </div>
      )}
      {!data && !error && <div className="mt-6 h-72 animate-pulse rounded-lg bg-white/[0.03]" />}

      {data && view && data.honey_bee && (
        <>
          {/* Where the test set came from, as counts. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono cap text-white/45">
            <span>
              <span className="text-white/80">{data.chembl_records.apis_all}</span> honey bee records
            </span>
            <span className="text-white/45">/</span>
            <span>
              <span className="text-white/80">{data.chembl_records.apis_molecules}</span> molecules
            </span>
            <span className="text-white/45">/</span>
            <span>
              <span className="text-white/80">{data.honey_bee.n}</span> with a usable LD50
            </span>
            <span className="text-white/45">/</span>
            <span>
              <span className="text-white/80">{data.honey_bee_new.n}</span> not in ApisTox
            </span>
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
            <div>
              <div className="h-56 w-full">
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 22, right: 12, bottom: 18, left: 4 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={[0, 1]}
                      ticks={[0, 0.25, 0.5, 0.75, 1]}
                      stroke={AXIS}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      label={{
                        value: 'forest vote share',
                        position: 'insideBottom',
                        offset: -10,
                        fill: AXIS,
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[-0.6, view.lanes.length - 0.4]}
                      ticks={view.lanes.map((_, i) => i)}
                      tickFormatter={(i) => view.lanes[view.lanes.length - 1 - i] ?? ''}
                      stroke={AXIS}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      width={112}
                    />
                    <ZAxis range={[60, 60]} />
                    <ReferenceLine
                      x={data.call_threshold}
                      stroke="rgba(255,255,255,0.25)"
                      strokeDasharray="3 4"
                      label={{ value: 'toxic call', position: 'top', fill: AXIS, fontSize: 10 }}
                    />
                    <Tooltip content={<ScoreTooltip />} cursor={false} />
                    <Scatter data={view.points} shape={<Dot />} isAnimationActive />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 cap-sm text-white/40">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-hive-400" /> right call
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-warn" /> wrong call
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white/50" /> outside
                  domain (max similarity &lt; {data.domain_min_similarity})
                </span>
                <span className="basis-full text-white/60">
                  The axis is the forest's vote share over its 500 trees. It ranks molecules; it
                  is not a calibrated probability.
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="font-mono cap-sm uppercase tracking-wider text-white/60">
                  A labelling check, not a benchmark
                </div>
                {data.honey_bee.pairs_total ? (
                  <p className="mt-1.5 text-[15px] leading-snug text-white/80">
                    <span className="font-mono tabular text-hive-400">
                      {data.honey_bee.pairs_total} pairs
                    </span>{' '}
                    are the whole test: {data.honey_bee.toxic} toxic against{' '}
                    {data.honey_bee.nontoxic} not toxic, over {data.honey_bee.n} honey bee
                    molecules. It asks whether the ApisTox labelling rule still holds on records
                    from other papers. It does not measure accuracy.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[15px] leading-snug text-white/80">
                    {data.honey_bee.auroc_note}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-lg leading-none tabular text-white/70">
                    {data.honey_bee.auroc != null ? data.honey_bee.auroc.toFixed(2) : 'n/a'}
                  </span>
                  <span className="cap text-white/40">
                    AUROC
                    {data.honey_bee.pairs_total
                      ? `, from ${data.honey_bee.pairs_ordered} of those ${data.honey_bee.pairs_total} pairs coming out the right way round`
                      : ''}
                  </span>
                </div>
              </div>

              <div className="flex divide-x divide-white/8 border-t border-white/8 pt-3">
                <Stat
                  value={data.honey_bee.correct}
                  total={data.honey_bee.n}
                  caption={`right at the ${data.call_threshold} vote-share cut`}
                />
                <Stat
                  value={data.honey_bee.in_domain_correct}
                  total={data.honey_bee.in_domain_n}
                  caption="right, inside the domain"
                />
                <Stat
                  value={data.honey_bee.out_of_domain_correct}
                  total={data.honey_bee.out_of_domain}
                  caption="right, outside it"
                  tone="text-white/55"
                />
              </div>

              <p className="text-xs leading-relaxed text-white/50">
                {view.misses.length} calls are wrong, and {view.missesOutside} of those are molecules with
                nothing in training above {data.domain_min_similarity} similarity. The domain check is
                there to catch exactly that, before a number like this gets quoted as accuracy.
              </p>
            </div>
          </div>

          {/* Per-molecule table: the whole test set fits on screen. */}
          <div className="mt-5 overflow-x-auto rounded-lg border border-white/6">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-white/[0.03] cap-sm uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2 font-normal">Molecule</th>
                  <th className="px-3 py-2 font-normal">Bee</th>
                  <th className="px-3 py-2 font-normal">LD50, ug/bee</th>
                  <th className="px-3 py-2 font-normal">ChEMBL label</th>
                  <th className="px-3 py-2 font-normal">ApisTox label</th>
                  <th className="px-3 py-2 text-right font-normal">Vote share</th>
                  <th className="px-3 py-2 text-right font-normal">Max sim.</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <motion.tr
                    key={`${r.species}-${r.chembl_id}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-t border-white/5"
                  >
                    <td className="px-3 py-2">
                      <a
                        href={`https://www.ebi.ac.uk/chembl/compound_report_card/${r.chembl_id}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="tap inline-flex items-center gap-1 text-white/85 hover:text-hive-400"
                      >
                        {r.name} <ExternalLink className="h-3 w-3 text-white/50" />
                      </a>
                      {r.name_in_apistox && (
                        <div className="cap-sm text-white/60">
                          same name in ApisTox, different structure record
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-white/55">{speciesShort(r.species)}</td>
                    <td className="px-3 py-2 font-mono text-white/60">{ld50(r.ld50_ug_per_bee)}</td>
                    <td className={`px-3 py-2 ${r.chembl_label ? 'text-warn' : 'text-signal'}`}>
                      {r.chembl_label ? 'toxic' : 'not toxic'}
                    </td>
                    <td className="px-3 py-2 text-white/50">
                      {r.apistox_label == null ? 'absent' : r.apistox_label ? 'toxic' : 'not toxic'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular ${
                        r.correct ? 'text-white/80' : 'text-warn'
                      }`}
                    >
                      {r.p_toxic.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular">
                      <span className={r.in_domain ? 'text-white/70' : 'text-white/60'}>
                        {r.max_similarity.toFixed(2)}
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 text-xs leading-relaxed text-white/50 md:grid-cols-2">
            <p>
              <span className="text-white/75">Overlap.</span> {data.label_agreement.overlap} of the{' '}
              {data.honey_bee.n} honey bee molecules are already in ApisTox, and the two sources give the
              same label for {data.label_agreement.agree} of {data.label_agreement.overlap}.
              {view.nearDuplicates.length > 0 &&
                ` ${view.nearDuplicates.map((r) => r.name).join(', ')} counts as new by InChIKey but sits under the same name in ApisTox, so read it as a near-duplicate.`}{' '}
              ChEMBL adds almost no new bee chemistry, so at {data.honey_bee.n} molecules this is a
              sanity check on the labelling rule, not a second benchmark.
            </p>
            {data.species_pairs?.length > 0 && (
              <p>
                <span className="text-white/75">Two species.</span> {data.species_pairs.length} molecules
                were measured on both bees. {data.species_disagree} of them change label: honey bee LD50{' '}
                {ld50(data.species_pairs[0].honey_bee_ld50)} ug against bumblebee{' '}
                {ld50(data.species_pairs[0].bumblebee_ld50)} ug for {data.species_pairs[0].name}. A
                model trained on honey bee labels should not be used to clear a molecule for bumblebees.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
