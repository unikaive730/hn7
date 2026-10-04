import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { BeeMark } from './SiteNav.jsx';

/** Footer: the data sources the code calls, with licences and the line that
 *  calls each one. The list comes from GET /api/sources, which scans the
 *  backend for call sites, so a source the code stopped using drops off. */

const REPO = 'https://github.com/unikaive730/hn7';

// How each kind of source reaches the lab, as the table states it.
const KIND = {
  live: { label: 'live API call', tone: 'text-signal/80' },
  fetched: { label: 'fetched once, stored as a file', tone: 'text-wax/60' },
  bundled: { label: 'bundled file', tone: 'text-hive-400/80' },
};

// Used only if /api/sources is not mounted. Checked against the code by hand
// on 2026-10-04: ApisTox, PubChem, OpenAlex and Europe PMC have call sites in
// lab/beeguard; ChEMBL is pulled by lab/scripts/fetch_chembl.py.
const FALLBACK = [
  {
    id: 'apistox',
    name: 'ApisTox',
    role: 'bee toxicity labels and first-report years, bundled with the app',
    kind: 'bundled',
    license: 'CC BY-NC 4.0',
    license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    url: 'https://github.com/j-adamczyk/ApisTox_dataset',
    citation:
      'Adamczyk J., Poziemski J., Siedlecki P. ApisTox: a new benchmark dataset for the classification of small molecules toxicity on honey bees. Scientific Data 12, 5 (2025).',
    doi: 'https://doi.org/10.1038/s41597-024-04232-w',
    found_in: [],
  },
  {
    id: 'pubchem',
    name: 'PubChem',
    role: 'compound properties, fetched per molecule',
    kind: 'live',
    license: 'Public domain (NCBI data policy)',
    license_url: 'https://www.ncbi.nlm.nih.gov/home/about/policies/',
    url: 'https://pubchem.ncbi.nlm.nih.gov/',
    found_in: [],
  },
  {
    id: 'chembl',
    name: 'ChEMBL',
    role: 'honey bee LD50 records for an outside test, and crop-pest potency records',
    kind: 'fetched',
    license: 'CC BY-SA 3.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    url: 'https://www.ebi.ac.uk/chembl/',
    citation:
      'Zdrazil B. et al. The ChEMBL Database in 2023: a drug discovery platform spanning multiple bioactivity data types and time periods. Nucleic Acids Research 52, D1180-D1192 (2024).',
    doi: 'https://doi.org/10.1093/nar/gkad1004',
    found_in: [],
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    role: 'literature search',
    kind: 'live',
    license: 'CC0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    url: 'https://openalex.org/',
    found_in: [],
  },
  {
    id: 'europepmc',
    name: 'Europe PMC',
    role: 'literature search',
    kind: 'live',
    license: 'Metadata free to reuse; article licenses vary',
    license_url: 'https://europepmc.org/Copyright',
    url: 'https://europepmc.org/',
    found_in: [],
  },
];

function useSources() {
  const [state, setState] = useState({ rows: null, live: false });
  useEffect(() => {
    let alive = true;
    fetch('/api/sources')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (alive) setState({ rows: data.sources.filter((s) => s.called), live: true, data });
      })
      .catch(() => {
        if (alive) setState({ rows: FALLBACK, live: false });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export default function SiteFooter() {
  const { rows, live, data } = useSources();

  return (
    <footer className="relative isolate mt-24 overflow-hidden border-t border-wax/10 bg-night-950">
      <div className="grain pointer-events-none absolute right-0 top-0 -z-10 h-80 w-full md:w-[62%]">
        <img
          src="/img/lab-bench.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-[60%_55%] opacity-45"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-night-950)_0%,rgba(7,7,11,0.6)_45%,rgba(7,7,11,0.25)_100%)]" />
        <div className="absolute inset-0 bg-linear-to-t from-night-950 via-night-950/70 to-transparent" />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6 md:px-8">
        <h2 className="font-serif-display max-w-xl text-[2.1rem] leading-[1.05] text-wax sm:text-[2.6rem]">
          Where the data comes from
        </h2>
        <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-wax/55">
          {live ? (
            <>
              Built by scanning the server code for call sites (
              {data?.scanned_files} files). A source appears here only if the lab
              calls it, and the line that calls it is shown.
            </>
          ) : (
            <>Sources the lab code calls. The live scan behind this list did not answer, so this is the list as last checked.</>
          )}
        </p>

        <SourceTable rows={rows} />

        <div className="mt-12 grid gap-8 border-t border-wax/10 pt-8 text-[13px] leading-relaxed text-wax/55 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <h3 className="font-mono text-[11px] text-wax/40">Code</h3>
            <p className="mt-2">
              MIT license. Every number on this page is produced by this code from
              the data listed above.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <FooterLink href={REPO}>Repository on GitHub</FooterLink>
              <FooterLink href="/docs">API docs</FooterLink>
              <FooterLink href="/submission/">Videos and submission materials</FooterLink>
            </div>
          </div>
          <div>
            <h3 className="font-mono text-[11px] text-wax/40">Team</h3>
            <p className="mt-2">
              MarketPilot. Built for Hack-Nation 7, Challenge 3 (Databricks,
              Agentic Scientific Discovery).
            </p>
          </div>
          <div>
            <h3 className="font-mono text-[11px] text-wax/40">Images</h3>
            <p className="mt-2">
              Illustrations generated with Gemini; data figures are computed live.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-wax/8 pt-5 text-[11.5px] text-wax/35 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <BeeMark className="h-4 w-4 opacity-80" />
            <span className="font-serif-display text-[14px] text-wax/60">BeeGuard Lab</span>
          </span>
          <span className="max-w-xl sm:text-right">
            Not advice on pesticide use. The lab proposes what to test next; the
            assay decides. ApisTox is used under its non-commercial terms.
          </span>
        </div>
      </div>
    </footer>
  );
}

function SourceTable({ rows }) {
  if (!rows) {
    return (
      <div className="mt-8 space-y-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-wax/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="hidden grid-cols-[9rem_1fr_15rem_13rem] gap-6 border-b border-wax/12 pb-2 font-mono text-[11px] text-wax/40 md:grid">
        <span>Source</span>
        <span>Used for</span>
        <span>How it reaches the lab</span>
        <span>License</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid gap-x-6 gap-y-1 border-b border-wax/8 py-3.5 md:grid-cols-[9rem_1fr_15rem_13rem]"
          >
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className="text-[15px] font-medium text-wax/90 transition-colors hover:text-hive-400"
            >
              {row.name}
            </a>
            <div className="text-[13px] leading-snug text-wax/60">
              {row.role}
              {row.molecules ? (
                <span className="text-wax/45"> · {row.molecules.toLocaleString('en-US')} molecules in the file</span>
              ) : null}
              {row.citation && (
                <p className="font-serif mt-1.5 text-[13px] italic leading-snug text-wax/45">
                  {row.citation}{' '}
                  {row.doi && (
                    <a
                      href={row.doi}
                      target="_blank"
                      rel="noreferrer"
                      className="not-italic font-mono text-[10.5px] text-wax/50 underline decoration-wax/20 underline-offset-2 hover:text-hive-400"
                    >
                      doi
                    </a>
                  )}
                </p>
              )}
            </div>
            <div className="font-mono text-[11px] leading-relaxed text-wax/45">
              <span className={(KIND[row.kind] ?? KIND.bundled).tone}>
                {(KIND[row.kind] ?? { label: row.kind }).label}
              </span>
              {row.found_in?.length ? (
                <span className="block break-all text-wax/35">
                  {row.found_in[0]}
                  {row.found_in.length > 1 ? ` +${row.found_in.length - 1} more` : ''}
                </span>
              ) : null}
            </div>
            <a
              href={row.license_url}
              target="_blank"
              rel="noreferrer"
              className="text-[12.5px] text-wax/55 underline decoration-wax/20 underline-offset-4 transition-colors hover:text-wax/85"
            >
              {row.license}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterLink({ href, children }) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className="inline-flex items-center gap-1 text-wax/75 underline decoration-wax/20 underline-offset-4 transition-colors hover:text-hive-400 hover:decoration-hive-400/50"
    >
      {children}
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}
