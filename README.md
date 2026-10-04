# BeeGuard Lab

BeeGuard Lab chooses which molecules to test first when honey bee toxicity assays have a limited budget. It trains on ApisTox chemistry known by a cutoff year, ranks molecules reported later, and reveals their existing dataset labels to measure retrospective discovery. Built for Hack-Nation 7, Challenge 3: Databricks · Agentic Scientific Discovery.

Live demo: [beeguard.marketpilot.it](https://beeguard.marketpilot.it) · [API documentation](https://beeguard.marketpilot.it/docs)

This is a reproducible computational benchmark. It does not perform new animal experiments. “Non-toxic” means the acute-toxicity label in the dataset; it does not establish field safety, chronic safety, or effects on other pollinators.

The cutoff uses each compound's first-report year, not the date its toxicity label became available. It is a compound-year benchmark, not proof that a historical lab had access to all training labels at that time.

## What the demo does

- Runs model, scaffold-diversity, and insecticide-only orderings with a selectable assay budget. The browser pauses for approval before requesting the computational run.
- Shows discovery curves, random-order ranges, strategy comparisons, and 1990/2000/2010 cutoff experiments.
- Replays recorded Omnigent conversations with the orchestrator and five specialists. The selected completed conversation used `claude-haiku-4-5-20251001`.
- Displays RDKit molecule drawings, scaffold similarity, chemical space, dated literature evidence, active-learning comparisons, and statistical checks.
- Tests against ChEMBL bee records and lists pest-active candidates as hypotheses that still need bee assays.
- Shows source provenance, dataset checksums, model settings, and the research record.

The interactive lab computes rankings on the Python server using cached trained models. Literature search and molecule detail can request OpenAlex, Europe PMC, and PubChem. Agent replay and several scientific panels read saved artifacts in `lab/data/derived`; they are not new LLM sessions. Agent text is not itself a measurement: check the recorded tool results and benchmark outputs before treating a transcript claim as evidence.

## Measured results and limits

The current year-based engine uses 1,035 ApisTox molecules: 834 dated through 2000 for training and 201 dated after 2000 in the pool. Thirteen pool molecules are insecticides with the dataset's non-toxic label.

| Check | Recorded result |
|---|---|
| Model ordering, budget 30 | 13 of 13 targets found; last target at position 28 |
| Whole-pool random baseline for the same 13 hits | Median 191 assays across 500 shuffled orders, seed 0 |
| Budget-based headline | `191 / 30 = 6.37×` |
| Year-based holdout AUROC | 0.8171; bootstrap interval 0.7332–0.8911 |
| Seen / unseen scaffold AUROC | 0.8995 / 0.7480; 8 of 13 targets have unseen scaffolds |
| Harder insecticide-only comparison | Random median 30 assays versus model 28 to find all 13; exact probability of random reaching all by 28 is 0.1815 |

The headline includes the benefit of prioritizing known insecticides over the entire pool. It is not a 6.37× estimate of the model's benefit inside the insecticide class. The harder comparison uses 5,000 shuffles in `rigor.json`, and the improvement within that class is modest.

The older `lab/scripts/baseline.py` uses the supplied official split files rather than the engine's strict year filter. Its saved result is AUROC 0.7947 with train/test counts 829/208. These two split definitions and their metrics should not be combined.

## Agent specifications and policies

Each specialist owns one scientific decision and is given only the tools that decision needs. The orchestrator never runs an experiment itself; it holds the budget and decides who works next. Configs live in `agents/beeguard/config.yaml` and `agents/beeguard/agents/<name>/config.yaml`, one directory per sub-agent, which is how Omnigent discovers them.

| Agent | The decision it owns | Tools it can call | Input | Output |
|---|---|---|---|---|
| orchestrator | Who works next, and how much budget the run may spend | `sys_session_send`, `sys_read_inbox`, and the lab MCP server | The question and the assay budget | The measured acceleration, and where it is weakest |
| literature | What counts as evidence for the question | `find_evidence` (OpenAlex, Europe PMC) | A focused query | Evidence cards carrying DOIs; says so when a search returns nothing |
| insight | The one hypothesis worth testing, and what would falsify it | none; it reasons only over the cards it is handed | Evidence cards | A hypothesis, a confidence, and the result that would break it |
| planner | Which of the competing experiments runs | `describe_pool`, `estimate_experiment`, `choose_experiment` | The hypothesis and the budget | The chosen experiment, the rejected one, and why |
| runner | Nothing scientific. It executes and reports verbatim | `run_experiment` (gated), `test_hypothesis_on_unseen_chemistry` (gated) | The chosen experiment | The numbers the tool returned, unmodified |
| analysis | Whether the result supports or breaks the hypothesis | `test_hypothesis_on_unseen_chemistry` (gated), `note_next_experiment` | The result and the hypothesis | Supported, rejected or inconclusive, and the next experiment it justifies |

Two policies bind the run, declared under `guardrails.policies` in the bundle config:

| Policy | Handler | Effect |
|---|---|---|
| `approve_experiments` | `lab.beeguard.policies.ask_before_experiment` | Returns `ASK` for `run_experiment` and `test_hypothesis_on_unseen_chemistry`, with a readable summary of what is about to be spent. Everything else is reading and reasoning, and is allowed |
| `cap_tool_calls` | `omnigent.policies.builtins.safety.max_tool_calls_per_session` | Stops a run at 60 tool calls |

The boundary is code the agents cannot edit, not a sentence in a prompt asking them to behave. Spending assay budget is a decision a person makes.

## What we would run next

Two experiments, in this order.

**1. Settle whether the model adds anything beyond the insecticide filter.** This is the honest open question, and the page says so rather than hiding it. Random order over the whole 201-molecule pool needs a median of 191 assays to find all 13 answers and the lab needs 28, which is the 6.37×; none of 5,000 shuffles reached all 13 by assay 28 (p = 4.0 × 10⁻¹³). But most of that gap is the free `insecticide` annotation. Restricted to the 31 pool insecticides the ordering actually draws from, random needs a median of 30 and the lab needs 28, with 895 of 5,000 shuffles doing at least as well (p = 0.18) and a within-class AUROC of 0.628. Thirteen answers among thirty-one candidates cannot separate a real effect from noise. The experiment is a power problem, not a modelling one: pool several cutoff years so the within-class comparison runs on hundreds of answers instead of thirteen, and pre-register the within-class AUROC as the endpoint before looking.

**2. Put the top candidates in front of actual bees.** The candidate funnel starts from 12,851 ChEMBL activity records on eleven pest species, keeps the 3,463 molecules absent from ApisTox, the 470 active at 10 mg/L or better, the 348 the model scores as bee-safe, and the 288 that also sit inside the applicability domain. Every one is a prediction with no bee measurement behind it. The first assay to order is the top of that list, for example CHEMBL2228438, active on *Mythimna separata* at 10 mg/L, scored 0.97 bee-safe at a Tanimoto of 0.71 to its nearest ApisTox neighbour, which is itself labelled non-toxic. An OECD 213/214 acute oral and contact test on the top ranked molecules, alongside a matched set the model scores as unsafe, turns the ranking into a measurement. Sixty molecules the model calls bee-safe are deliberately left off the list because nothing in training sits within 0.3 Tanimoto of them; they are the second batch, and the honest test of whether the applicability-domain cut was doing real work.

## Everything here was built during the hackathon

The kickoff was 2026-10-04 01:00 KST and the challenge brief was published at 01:59. The first commit in this repository is 01:22 on the same day, and the history runs continuously to the deadline, so the whole timeline is visible in `git log`. Nothing was carried in from an earlier project.

Two things predate it and are reused under their own licences, as they should be: the public datasets (ApisTox, ChEMBL) and the open-source libraries in `requirements.txt` and `package.json`. The scaffold in the first commit is the stock Vite, React and Node starter; the scientific work begins at 02:24 with the Python lab environment.

## Repository

| Path | Role |
|---|---|
| `apps/web` | React + Vite interface, Tailwind, Framer Motion, Recharts |
| `lab/beeguard` | Python FastAPI service, model engine, data tools, policies, MCP server, scientific checks |
| `lab/scripts` | ApisTox and ChEMBL fetching, official-split baseline and discovery scripts |
| `lab/data` | Downloaded data, checksum manifests, derived artifacts |
| `agents/beeguard` | Omnigent orchestrator and five specialist bundles |
| `scripts/lab.sh` | Omnigent daemon and run launcher |
| `deploy` | Shared runtime staging, Hugging Face Docker Space and EC2 deployment helpers |
| `apps/api`, `packages/shared` | Original Node scaffold; not the BeeGuard scientific API |

## Run locally

Use Python 3.12 and Node 22.12 or later. The following PowerShell commands start the actual BeeGuard API; the root `npm run dev` and `npm start` currently target the original Node scaffold.

```powershell
py -3.12 -m venv lab/.venv
& ./lab/.venv/Scripts/python.exe -m pip install -r deploy/hf-space/requirements.txt
npm ci
$env:PYTHONUTF8='1'
& ./lab/.venv/Scripts/python.exe -m uvicorn lab.beeguard.api:app --host 127.0.0.1 --port 8900
```

In a second terminal from the repository root:

```powershell
npm run dev --workspace @hn7/web
```

Open `http://localhost:5173`; Vite proxies `/api` to port 8900. API documentation is at `http://localhost:8900/docs`. The saved data and derived artifacts are included, so the local benchmark and replay do not require LLM credentials. Live external lookups depend on the providers responding.

For the built site on the API's single port:

```powershell
npm run build
$env:PYTHONUTF8='1'
& ./lab/.venv/Scripts/python.exe -m uvicorn lab.beeguard.api:app --host 127.0.0.1 --port 8900
```

Start or restart the API after the build so it mounts `apps/web/dist`. `WEB_DIST` can select another build directory.

## Reproduce the science and agent provenance

For full artifact rebuilding, install the broader lab environment with `lab/requirements.lock.txt`. The small deployment requirements above cover the served demo; additional dependencies such as MLflow are needed for full scientific rebuilds.

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONPATH='.'
& ./lab/.venv/Scripts/python.exe -m lab.beeguard.engine
& ./lab/.venv/Scripts/python.exe lab/scripts/baseline.py
& ./lab/.venv/Scripts/python.exe lab/scripts/discovery.py
& ./lab/.venv/Scripts/python.exe -m lab.beeguard.rigor
```

`lab/scripts/fetch_data.py` downloads ApisTox and writes `lab/data/manifest.json`; compare its SHA256 entries to the files used for the run. ChEMBL fetching and evidence-graph refreshing make real network requests and have separate timestamps and manifests.

A new agent conversation additionally needs an installed, authenticated Omnigent CLI and the configured Claude harness. The agent configs contain machine-specific Python and `PYTHONPATH` values; adjust them for your checkout before launching:

```bash
bash scripts/lab.sh "Run one full discovery loop and report what you measured."
```

`lab/beeguard/policies.py` returns `ASK` for `run_experiment` and the unseen-chemistry test. The noninteractive launcher cannot answer approval requests. The saved Haiku conversation shows specialist handoffs and literature/planner tool calls, but no recorded `run_experiment` call or approval event; it does not prove a newly approved assay run. To refresh the replay from a local Omnigent session store, run `python -m lab.beeguard.agentroom extract` with the lab environment.

## Deployment and submission status

The EC2 release at [beeguard.marketpilot.it](https://beeguard.marketpilot.it) is deployed and verified. The release command checks the staged snapshot locally and on the server, preserves the previous app, and rolls back if the public checks fail. Build first, then verify or deploy:

```powershell
npm run build
& ./lab/.venv/Scripts/python.exe deploy/ec2/release.py
# Add --deploy to upload and activate the verified snapshot:
& ./lab/.venv/Scripts/python.exe deploy/ec2/release.py --deploy
```

The staged folder contains the FastAPI app, saved scientific artifacts, agent configs, built frontend, Dockerfile, entry point, and checksum manifest. Set `BEEGUARD_HOST` and `BEEGUARD_KEY` for the intended server. The current release preserved `/opt/beeguard/releases/backup-20261004T074808Z`. The alternative `deploy/hf-space/Dockerfile` serves port 7860; it is not the current public deployment.

Latest verification: production web build and four API regression test groups passed; 19 staged paths and the model result passed locally and remotely; six public paths passed smoke checks. A fresh model run at budget 30 reproduced 13 hits and 6.37×. Browser checks covered duplicate-run prevention and the full-budget insecticide-only ordering. Run the regression suite with `python -m unittest discover -s lab/tests` in the lab environment.

Submission materials are available at [the materials page](https://beeguard.marketpilot.it/submission/):

| Material | On this site | On Google Drive |
|---|---|---|
| Demo, 59 s, recorded from the running app | [demo_video.mp4](https://beeguard.marketpilot.it/submission/demo_video.mp4) | [Drive](https://drive.google.com/file/d/1FXUM-YLbaaYuZLPVf-64Z8PbAeFA8dgv/view) |
| Technical explanation, 55.7 s | [tech_video.mp4](https://beeguard.marketpilot.it/submission/tech_video.mp4) | [Drive](https://drive.google.com/file/d/15-QTQfYamEAdu1GIrwFNNftf3MZU_HRj/view) |
| Team introduction, 53.5 s | [team_video.mp4](https://beeguard.marketpilot.it/submission/team_video.mp4) | [Drive](https://drive.google.com/file/d/1jlCaO8Tw0HV-pw_Xjj9vMnOvtV7p-n4E/view) |
| Full walkthrough, 120 s | [walkthrough_2min.mp4](https://beeguard.marketpilot.it/submission/walkthrough_2min.mp4) | [Drive](https://drive.google.com/file/d/1Z1vxHRke7LMtEw3SQL9MyIXeR8X8k86u/view) |
| One-page report | [MarketPilot_OnePager.pdf](https://beeguard.marketpilot.it/submission/MarketPilot_OnePager.pdf) | [Drive](https://drive.google.com/file/d/1bgC54rCSm73l9sj5FDausYuOX9AJT8gy/view) |
| Team photo | — | [Drive](https://drive.google.com/file/d/11LeH4e1vA3buUfnuWMYuS9k9WEVpkuuI/view) |
| Source and dataset archives | [code.zip](https://beeguard.marketpilot.it/submission/code.zip), [dataset.zip](https://beeguard.marketpilot.it/submission/dataset.zip) | — |

Everything is mirrored on [Google Drive](https://drive.google.com/drive/folders/1KCqr99qdNdKVX6tMcUti00Z948a1edue) so the judges can reach it if this server is down. The three short videos have English captions and synthetic narration; the full walkthrough has English captions. Source and dataset archives restore together into the original directory layout and reproduce the offline API smoke checks.

## License

Code: MIT, see [LICENSE](LICENSE). Downloaded datasets retain their own licenses: ApisTox CC BY-NC 4.0 and ChEMBL CC BY-SA 3.0. Dataset use and redistribution must follow those terms.
