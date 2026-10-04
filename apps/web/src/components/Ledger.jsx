import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Bot,
  Braces,
  Check,
  Code2,
  Database,
  Lock,
  Package,
  Radio,
  RefreshCw,
  Wrench,
} from 'lucide-react';

/* Everything on this panel comes from GET /api/ledger and /api/ledger/sources.
 * The server counts rows, recomputes checksums, reads imports and configs, and
 * probes each source when asked. Nothing here is typed in by hand. */

const BASE = import.meta.env.VITE_LAB_API ?? '';

async function getJSON(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return response.json();
}

const int = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));

function bytes(n) {
  if (n == null) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function clock(iso) {
  if (!iso) return '';
  const match = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : iso;
}

export default function Ledger() {
  const [ledger, setLedger] = useState(null);
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [probing, setProbing] = useState(false);

  const probe = useCallback((refresh = false) => {
    setProbing(true);
    setLiveError(null);
    getJSON(`/api/ledger/sources${refresh ? '?refresh=true' : ''}`)
      .then(setLive)
      .catch((e) => setLiveError(e.message))
      .finally(() => setProbing(false));
  }, []);

  useEffect(() => {
    getJSON('/api/ledger?live=false')
      .then(setLedger)
      .catch((e) => setError(e.message));
    probe(false);
  }, [probe]);

  if (error) {
    return (
      <Shell>
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-warn">
          <AlertTriangle className="h-4 w-4" /> Ledger did not load: {error}
        </div>
      </Shell>
    );
  }

  if (!ledger) {
    return (
      <Shell>
        <div className="space-y-2 px-5 py-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-white/[0.04]" style={{ width: `${80 - i * 18}%` }} />
          ))}
          <p className="pt-1 font-mono text-[11px] text-white/30">counting files, reading imports…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell ledger={ledger}>
      <Readout ledger={ledger} live={live} />
      <Rack icon={Database} label="Data on disk" note="lab/data">
        <Datasets datasets={ledger.datasets} derived={ledger.derived} />
      </Rack>
      <Rack icon={Radio} label="Live sources" note={live ? `probed ${clock(live.checked_at)}` : null}>
        <Sources live={live} error={liveError} probing={probing} onRefresh={() => probe(true)} />
      </Rack>
      <Rack icon={Package} label="Python" note={ledger.python.scanned}>
        <PythonPackages python={ledger.python} />
      </Rack>
      <Rack icon={Braces} label="JavaScript" note={ledger.javascript.manifest}>
        <JsPackages js={ledger.javascript} />
      </Rack>
      <Rack icon={Wrench} label="MCP tools" note={ledger.mcp.file}>
        <McpTools mcp={ledger.mcp} />
      </Rack>
      <Rack icon={Bot} label="Agents" note="agents/beeguard">
        <Agents agents={ledger.agents} mcp={ledger.mcp} />
      </Rack>
      <Rack icon={Code2} label="Code" note="non-blank lines">
        <CodeLines rows={ledger.lines_of_code} />
      </Rack>
    </Shell>
  );
}

function Shell({ ledger, children }) {
  return (
    <section className="glass lift overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/[0.06] px-5 py-4">
        <div>
          <div className="font-mono text-[10px] text-hive-400/80">Ledger</div>
          <h2 className="font-serif-display mt-1 text-2xl text-wax">What the lab runs on, counted on request</h2>
        </div>
        {ledger && (
          <span className="font-mono text-[11px] text-white/35">
            inventory built {clock(ledger.computed_at)} in {ledger.computed_ms} ms
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- readout */

function Readout({ ledger, live }) {
  const files = ledger.datasets.files;
  const listed = files.filter((f) => f.matches_manifest != null);
  const matched = listed.filter((f) => f.matches_manifest).length;
  const unlisted = files.length - listed.length;
  const molecules = files.find((f) => f.file === 'dataset_final.csv')?.rows;
  const probed = live?.sources ?? [];
  const answered = probed.filter((s) => s.ok).length;
  const limited = probed.filter((s) => s.status === 429).length;
  const lines = ledger.lines_of_code.reduce((sum, r) => sum + r.lines, 0);
  const gated = ledger.mcp.tools.filter((t) => t.gated).length;

  const cells = [
    { value: int(molecules), label: 'molecules', sub: 'dataset_final.csv' },
    {
      value: `${matched}/${listed.length}`,
      label: 'sha256 match',
      sub: unlisted ? `${unlisted} not in a manifest` : 'vs manifest',
      tone: matched < listed.length ? 'warn' : null,
    },
    {
      value: live ? `${answered}/${probed.length}` : '…',
      label: 'sources returned 200',
      sub: !live ? 'probing' : limited ? `${limited} rate limited` : `probed ${live.age_seconds}s ago`,
      tone: live && answered < probed.length ? 'warn' : null,
    },
    { value: ledger.python.third_party.length, label: 'Python packages', sub: `+${ledger.python.standard_library.length} stdlib` },
    { value: ledger.javascript.packages.length, label: 'JS packages', sub: 'apps/web' },
    { value: ledger.mcp.tools.length, label: 'MCP tools', sub: `${gated} need approval` },
    {
      value: (ledger.agents.orchestrator ? 1 : 0) + ledger.agents.specialists.length,
      label: 'agents',
      sub: `${ledger.agents.orchestrator ? 1 : 0} lead + ${ledger.agents.specialists.length}`,
    },
    { value: int(lines), label: 'lines of code', sub: `${ledger.derived.files} derived files` },
  ];

  return (
    <div className="overflow-hidden border-b border-white/[0.06]">
      <div className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
      {cells.map((cell, index) => (
        <motion.div
          key={cell.label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04 }}
          className="border-b border-r border-white/[0.06] px-4 py-3"
        >
          <div className={`tabular font-mono text-xl font-semibold ${cell.tone === 'warn' ? 'text-warn' : 'text-white/90'}`}>
            {cell.value}
          </div>
          <div className="mt-0.5 text-[11px] text-white/55">{cell.label}</div>
          <div className="font-mono text-[10px] text-white/25">{cell.sub}</div>
        </motion.div>
      ))}
      </div>
    </div>
  );
}

function Rack({ icon: Icon, label, note, children }) {
  return (
    <div className="grid gap-3 border-b border-white/[0.06] px-5 py-4 last:border-b-0 md:grid-cols-[9.5rem_1fr]">
      <div className="flex items-start gap-2 md:flex-col md:gap-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-white/35" />
          <span className="font-mono text-[10px] text-white/45">{label}</span>
        </div>
        {note && <span className="truncate font-mono text-[10px] text-white/20 md:max-w-full">{note}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------- datasets */

function Datasets({ datasets, derived }) {
  const [allDerived, setAllDerived] = useState(false);
  const shownDerived = allDerived ? derived.entries : derived.entries.slice(0, 8);
  const licence = datasets.files.find((f) => f.file === 'dataset_final.csv')?.license;
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-white/[0.06]">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.03] font-mono text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-3 py-2 font-normal">file</th>
              <th className="px-3 py-2 text-right font-normal">rows</th>
              <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">cols</th>
              <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">size</th>
              <th className="px-3 py-2 font-normal">sha256</th>
              <th className="hidden px-3 py-2 font-normal md:table-cell">licence</th>
            </tr>
          </thead>
          <tbody>
            {datasets.files.map((file) => (
              <tr key={file.file} className="border-t border-white/[0.05]">
                <td className="max-w-[8rem] truncate px-3 py-2 font-mono text-white/75 sm:max-w-none">{file.file}</td>
                <td className="tabular px-3 py-2 text-right font-mono text-white/85">{int(file.rows)}</td>
                <td className="tabular hidden px-3 py-2 text-right font-mono text-white/45 sm:table-cell">{file.columns}</td>
                <td className="tabular hidden px-3 py-2 text-right font-mono text-white/45 sm:table-cell">{bytes(file.bytes)}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-mono text-white/45" title={file.sha256}>
                    {file.sha256.slice(0, 10)}
                    {file.matches_manifest === true && <Check className="h-3 w-3 text-signal" />}
                    {file.matches_manifest === false && <AlertTriangle className="h-3 w-3 text-warn" />}
                    {file.matches_manifest == null && <span className="text-[10px] text-white/25">no manifest</span>}
                  </span>
                </td>
                <td
                  className="hidden px-3 py-2 font-mono text-[11px] text-white/50 md:table-cell"
                  title={file.license_from ? `read from ${file.license_from}` : 'no licence found'}
                >
                  {file.license ?? '?'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">
        Checksums are recomputed on each request and compared with{' '}
        <span className="font-mono text-white/55">{datasets.manifests.join(', ') || 'no manifest'}</span>. Each
        licence comes from the file's manifest or from the script that downloads it; hover a licence to see which.
        ApisTox is {licence ?? 'unknown'}
        {licence && /NC/.test(licence) ? ', so non-commercial use only.' : '.'}
      </p>

      {derived.files > 0 && (
        <div className="mt-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/30">
            {derived.path} · {int(derived.files)} files · {bytes(derived.bytes)}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {shownDerived.map((entry) => (
              <span
                key={entry.name}
                className="rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-white/50"
                title={`modified ${entry.modified}`}
              >
                {entry.name}
                <span className="ml-1 text-white/25">
                  {entry.kind === 'folder' ? `${entry.files} files, ` : ''}
                  {bytes(entry.bytes)}
                </span>
              </span>
            ))}
            {derived.entries.length > 8 && (
              <button
                onClick={() => setAllDerived((v) => !v)}
                className="rounded border border-dashed border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/45 hover:text-white/70"
              >
                {allDerived ? 'show fewer' : `+${derived.entries.length - 8} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- sources */

const RETURNED_LABEL = {
  works_matching_honey_bee: 'works matching "honey bee"',
  papers_matching_honey_bee: 'records matching "honey bee"',
  cid_971_formula: 'CID 971 formula',
  chembl_release: 'release',
};

function Led({ ok, slow }) {
  const color = !ok ? 'bg-warn' : slow ? 'bg-hive-400' : 'bg-signal';
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      {ok && (
        <motion.span
          className={`absolute inset-0 rounded-full ${color}`}
          animate={{ opacity: [0.5, 0, 0.5], scale: [1, 2.2, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

function Sources({ live, error, probing, onRefresh }) {
  const rows = live?.sources ?? [];
  const scale = Math.max(1000, ...rows.map((r) => r.latency_ms ?? 0));

  return (
    <div>
      {error && (
        <div className="mb-2 flex items-center gap-2 text-xs text-warn">
          <AlertTriangle className="h-3.5 w-3.5" /> probe request failed: {error}
        </div>
      )}
      {!live && !error && (
        <p className="font-mono text-[11px] text-white/35">sending one request to each source…</p>
      )}

      <div className="space-y-1.5">
        {rows.map((row) => {
          const returned = Object.entries(row.returned ?? {});
          const limited = row.status === 429;
          const slow = row.latency_ms > 1500 || limited;
          const usage =
            row.mode === 'live'
              ? `called at run time from ${row.called_by.join(', ')}`
              : `fetched offline by ${row.fetched_by.join(', ')} into ${row.outputs.join(', ') || 'lab/data'}${
                  row.read_by?.length ? `, read by ${row.read_by.join(', ')}` : ''
                }`;
          return (
            <div
              key={row.name}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2"
            >
              <Led ok={row.ok || limited} slow={slow} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-white/85">{row.name}</span>
                  <span className="truncate font-mono text-[10px] text-white/30">{row.host}</span>
                </div>
              </div>
              <div className="text-right font-mono text-[11px]">
                <span className={row.ok ? 'text-white/70' : limited ? 'text-hive-400' : 'text-warn'}>
                  {limited ? '429 rate limited' : row.status ?? 'no answer'}
                </span>
                <span className="ml-2 text-white/45">{row.latency_ms} ms</span>
              </div>

              <div />
              <div className="col-span-2 min-w-0">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    className={`h-full ${limited ? 'bg-hive-400/70' : !row.ok ? 'bg-warn' : slow ? 'bg-hive-400/70' : 'bg-signal/70'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (row.latency_ms / scale) * 100)}%` }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-white/40">
                  {returned.map(([key, value]) => (
                    <span key={key}>
                      {RETURNED_LABEL[key] ?? key}:{' '}
                      <span className="font-mono text-white/70">{typeof value === 'number' ? int(value) : String(value)}</span>
                    </span>
                  ))}
                  {row.error && <span className="text-warn">{row.error}</span>}
                  <span className="text-white/30">{usage}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {live && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/35">
          <span>
            Cached {Math.round(live.ttl_seconds / 60)} min, this result is {live.age_seconds}s old. A 429 or a
            timeout is shown as it came back.
            {live.not_called?.map((source) => (
              <span key={source.name}>
                {' '}
                {source.name} has a client in {source.defined_in?.join(', ') || 'no file'}, but no route or tool calls
                it, so it is not probed or counted.
              </span>
            ))}
          </span>
          <button
            onClick={onRefresh}
            disabled={probing}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white/55 transition hover:border-white/25 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${probing ? 'animate-spin' : ''}`} /> probe again
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- packages */

function PythonPackages({ python }) {
  return (
    <div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {python.third_party.map((pkg) => (
          <div
            key={pkg.module}
            className="flex items-baseline justify-between gap-3 border-b border-dashed border-white/[0.06] py-1.5 text-xs"
            title={`imported in ${pkg.files.join(', ')}`}
          >
            <span className="font-mono text-white/80">
              {pkg.distribution}
              {pkg.module !== pkg.distribution.toLowerCase() && (
                <span className="ml-1 text-white/30">({pkg.module})</span>
              )}
            </span>
            <span className="flex items-baseline gap-2 font-mono">
              <span className="text-hive-400/90">{pkg.version ?? 'not installed'}</span>
              <span className="w-12 whitespace-nowrap text-right text-[10px] text-white/30">{pkg.files.length} file{pkg.files.length > 1 ? 's' : ''}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">
        Read from the import statements in the lab package with Python {python.python}. Plus{' '}
        {python.standard_library.length} standard-library modules.
      </p>
      {python.declared_not_imported?.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-white/30">
          Listed in lab/requirements.txt but not imported by the lab code, so not counted above:{' '}
          <span className="font-mono text-white/40">{python.declared_not_imported.join(', ')}</span>.
        </p>
      )}
    </div>
  );
}

function JsPackages({ js }) {
  return (
    <div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {js.packages.map((pkg) => (
          <div
            key={pkg.name}
            className="flex items-baseline justify-between gap-3 border-b border-dashed border-white/[0.06] py-1.5 text-xs"
          >
            <span className="min-w-0 truncate font-mono text-white/80">
              {pkg.name}
              {pkg.kind === 'build' && <span className="ml-1.5 text-[10px] text-white/30">build</span>}
            </span>
            <span className="flex shrink-0 items-baseline gap-2 font-mono">
              <span className="text-hive-400/90">{pkg.installed ?? pkg.declared}</span>
              <span className={`w-14 whitespace-nowrap text-right text-[10px] ${pkg.imported_in ? 'text-white/30' : 'text-white/20'}`}>
                {pkg.imported_in ? `${pkg.imported_in} file${pkg.imported_in > 1 ? 's' : ''}` : 'unused'}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        Installed versions from node_modules. The file count is how many of the {js.source_files} source files import
        the package when the ledger was built.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- MCP tools */

function McpTools({ mcp }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] text-white/40">
        server <span className="text-white/70">{mcp.server}</span>
      </div>
      <ol className="space-y-1">
        {mcp.tools.map((tool) => (
          <li
            key={tool.name}
            className={`rounded-md px-2.5 py-1.5 ${tool.gated ? 'border border-hive-400/25 bg-hive-400/[0.05]' : ''}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs text-white/85">{tool.name}</span>
              <span className="font-mono text-[10px] text-white/30">({tool.params.join(', ')})</span>
              {tool.gated && (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-hive-400">
                  <Lock className="h-3 w-3" /> asks a person first
                </span>
              )}
            </div>
            <div className="text-[11px] leading-snug text-white/45">{tool.summary}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- agents */

function Agents({ agents, mcp }) {
  const root = agents.orchestrator;
  const order = useMemo(() => {
    const listed = root?.tools.find((t) => t.type === 'list')?.members ?? [];
    const byName = Object.fromEntries(agents.specialists.map((a) => [a.name, a]));
    const ordered = listed.map((name) => byName[name]).filter(Boolean);
    const rest = agents.specialists.filter((a) => !listed.includes(a.name));
    return [...ordered, ...rest];
  }, [agents, root]);

  if (!root) return <p className="text-xs text-white/40">No agent bundle found.</p>;

  return (
    <div>
      <div className="rounded-lg border border-hive-400/25 bg-hive-400/[0.04] px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-xs text-hive-400">{root.name}</span>
          <span className="font-mono text-[10px] text-white/30">
            orchestrator · {root.harness} · {root.prompt_words} prompt words
          </span>
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-white/50">{root.description}</div>
      </div>

      <div className="relative ml-3 mt-1 border-l border-white/10 pl-4">
        {order.map((agent, index) => {
          const usesLab = agent.tools.some((t) => t.type === 'mcp');
          return (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="relative py-1.5"
            >
              <span className="absolute -left-4 top-[1.05rem] h-px w-3 bg-white/15" />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[10px] text-white/25">{String(index + 1).padStart(2, '0')}</span>
                <span className="font-mono text-xs text-white/85">{agent.name}</span>
                <span className="font-mono text-[10px] text-white/30">
                  {usesLab ? `${mcp.tools.length} MCP tools` : 'no tools'} · {agent.prompt_words} words
                </span>
              </div>
              <div className="text-[11px] leading-snug text-white/45">{agent.description}</div>
            </motion.div>
          );
        })}
      </div>

      {agents.policies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agents.policies.map((policy) => (
            <span
              key={policy.name}
              className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-white/50"
              title={policy.handler}
            >
              policy {policy.name}
              {Object.entries(policy.params).map(([k, v]) => (
                <span key={k} className="text-white/30">
                  {' '}
                  {k}={String(v)}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ code */

function CodeLines({ rows }) {
  const data = rows.filter((r) => r.lines > 0);
  const total = data.reduce((sum, r) => sum + r.lines, 0);
  return (
    <div>
      <div className="w-full" style={{ height: 36 + data.length * 30 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="area"
              width={132}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{
                background: '#12121a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, _name, item) => [
                `${int(value)} lines in ${item.payload.files} files`,
                item.payload.path,
              ]}
            />
            <Bar dataKey="lines" fill="#fbbf24" fillOpacity={0.75} radius={[0, 3, 3, 0]} barSize={14}>
              <LabelList
                dataKey="lines"
                position="right"
                formatter={(v) => int(v)}
                style={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-white/35">
        {int(total)} non-blank lines across {rows.reduce((s, r) => s + r.files, 0)} files, counted when the ledger was
        built. Dependencies and generated files are not included.
      </p>
    </div>
  );
}
