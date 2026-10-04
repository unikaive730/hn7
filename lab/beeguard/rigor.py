"""Learning loop and rigor checks.

Two questions a judge should ask of the headline number, answered by running
code on the same data:

1. Does the lab learn? `learning_loop` spends the assay budget in rounds. After
   each round the labels of the molecules it picked are revealed (they are in
   the dataset, so nothing is simulated) and the model is retrained. A second
   arm spends the same budget with the model frozen at its pre-2000 state.

2. Is the result real? `build_rigor` measures the random baseline as a full
   distribution, compares model families and fingerprints on the same split,
   re-reads the scaffold check from the engine and re-runs the main model with
   five seeds. Every run is logged to a local MLflow file store.

Heavy work is precomputed into lab/data/derived/ so the endpoints answer
instantly. Rebuild everything with:

    PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.rigor
"""
from __future__ import annotations

import json
import math
import os
import shutil
import time
from functools import lru_cache
from pathlib import Path

os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem import Descriptors, MACCSkeys
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .engine import DATA, _fingerprints, get_lab

RDLogger.DisableLog("rdApp.*")

DERIVED = DATA / "derived"
MLRUNS = DERIVED / "mlruns"
EXPERIMENT = "beeguard-lab"
CUTOFF = 2000
BASELINE_SHUFFLES = 5000
BOOTSTRAPS = 1000
SEEDS = (0, 1, 2, 3, 4)
TIE_BREAKS = 2000  # random tie-break orders for the constant-score ablation row
SPEEDUP_BUDGET = 30  # the engine's headline budget
FEATURES_LABEL = "Morgan r2, 2048 bits"
LEARNING_GRID = [(b, s) for b in (30, 60, 90) for s in (5, 10, 20)]
REBUILD = "PYTHONUTF8=1 PYTHONPATH=. lab/.venv/Scripts/python.exe -m lab.beeguard.rigor"


# ---------------------------------------------------------------------- data


@lru_cache(maxsize=1)
def _data(cutoff: int = CUTOFF) -> dict:
    """The full table in the engine's row order, with features computed once."""
    full = pd.read_csv(DATA / "dataset_final.csv")
    full = full[full["year"].notna()].reset_index(drop=True)
    train = full[full["year"] <= cutoff].reset_index(drop=True)
    pool = full[full["year"] > cutoff].reset_index(drop=True)
    return {
        "train": train,
        "pool": pool,
        "y_train": train["label"].to_numpy(),
        "y_pool": pool["label"].to_numpy(),
        "insecticide": pool["insecticide"].to_numpy().astype(int),
        "is_target": ((pool["insecticide"] == 1) & (pool["label"] == 0)).to_numpy(),
    }


@lru_cache(maxsize=4)
def _features(kind: str, cutoff: int = CUTOFF) -> tuple[np.ndarray, np.ndarray]:
    d = _data(cutoff)
    train_smiles = d["train"]["SMILES"].tolist()
    pool_smiles = d["pool"]["SMILES"].tolist()
    if kind == "morgan":
        return _fingerprints(train_smiles), _fingerprints(pool_smiles)
    if kind == "maccs":
        return _maccs(train_smiles), _maccs(pool_smiles)
    if kind == "descriptors":
        x_train, x_pool = _descriptors(train_smiles), _descriptors(pool_smiles)
        # Fill gaps with the training median so no pool information leaks in.
        median = np.nanmedian(x_train, axis=0)
        median = np.where(np.isnan(median), 0.0, median)
        for x in (x_train, x_pool):
            gaps = np.isnan(x)
            x[gaps] = np.take(median, np.where(gaps)[1])
        return x_train, x_pool
    raise ValueError(kind)


def _maccs(smiles: list[str]) -> np.ndarray:
    rows = []
    for smi in smiles:
        mol = Chem.MolFromSmiles(smi)
        rows.append(
            np.zeros(167, dtype=np.uint8)
            if mol is None
            else np.array(MACCSkeys.GenMACCSKeys(mol), dtype=np.uint8)
        )
    return np.vstack(rows)


def _descriptors(smiles: list[str]) -> np.ndarray:
    names = [name for name, _ in Descriptors.descList]
    rows = []
    for smi in smiles:
        mol = Chem.MolFromSmiles(smi)
        if mol is None:
            rows.append([np.nan] * len(names))
            continue
        values = Descriptors.CalcMolDescriptors(mol)
        rows.append([values.get(name, np.nan) for name in names])
    x = np.array(rows, dtype=np.float64)
    x[~np.isfinite(x)] = np.nan
    # A few descriptors (Ipc) run to 1e30; clip so scaling stays meaningful.
    return np.clip(x, -1e6, 1e6)


# -------------------------------------------------------------------- models


def _tanimoto(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    inter = a @ b.T
    union = a.sum(1)[:, None] + b.sum(1)[None, :] - inter
    return inter / np.maximum(union, 1e-9)


def _knn_tanimoto(x_train, y_train, x_test, k: int = 7) -> np.ndarray:
    """Similarity-weighted vote of the k most similar training molecules."""
    sim = _tanimoto(x_test, x_train)
    idx = np.argpartition(-sim, k, axis=1)[:, :k]
    sims = np.take_along_axis(sim, idx, axis=1) + 1e-6
    return (sims * y_train[idx]).sum(1) / sims.sum(1)


def _risk(model: str, fingerprint: str, seed: int = 0, cutoff: int = CUTOFF) -> np.ndarray:
    """Predicted probability that each pool molecule is toxic to bees."""
    d = _data(cutoff)
    x_train, x_pool = _features(fingerprint, cutoff)
    y = d["y_train"]
    bits = fingerprint != "descriptors"
    if model == "random_forest":
        clf = RandomForestClassifier(n_estimators=500, random_state=seed, n_jobs=-1)
        return clf.fit(x_train, y).predict_proba(x_pool)[:, 1]
    if model == "logistic":
        clf = LogisticRegression(max_iter=5000)
        if not bits:
            clf = make_pipeline(StandardScaler(), clf)
        return clf.fit(x_train, y).predict_proba(x_pool)[:, 1]
    if model == "knn":
        if bits:
            return _knn_tanimoto(x_train, y, x_pool)
        clf = make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=7, weights="distance"))
        return clf.fit(x_train, y).predict_proba(x_pool)[:, 1]
    if model == "dummy":
        return np.full(len(x_pool), y.mean())
    raise ValueError(model)


def _acquisition_order(risk: np.ndarray, insecticide: np.ndarray) -> np.ndarray:
    """Insecticides first, lowest predicted risk first, row index breaks ties.

    Inside the insecticides this is the engine's "model" ordering exactly.
    """
    return np.lexsort((np.arange(len(risk)), risk, -insecticide))


def _hit_positions(order: np.ndarray, is_target: np.ndarray) -> list[int]:
    return [p + 1 for p, i in enumerate(order) if is_target[i]]


def _bootstrap_auroc(y: np.ndarray, score: np.ndarray, n: int = BOOTSTRAPS, seed: int = 0):
    rng = np.random.default_rng(seed)
    values = []
    size = len(y)
    for _ in range(n):
        pick = rng.integers(0, size, size)
        if y[pick].min() == y[pick].max():
            continue
        values.append(roc_auc_score(y[pick], score[pick]))
    return round(float(np.percentile(values, 2.5)), 4), round(float(np.percentile(values, 97.5)), 4)


# ------------------------------------------------------------ learning loop


def learning_loop(budget: int = 60, batch: int = 10, trees: int = 200, seed: int = 0,
                  cutoff: int = CUTOFF) -> dict:
    """Spend `budget` assays in rounds of `batch`, with and without retraining.

    Both arms start from the same pre-cutoff model. Each round the current
    model ranks what is still untested, the top `batch` are assayed (their
    labels revealed from the dataset), and the retraining arm refits on the
    training set plus everything revealed so far.
    """
    started = time.time()
    d = _data(cutoff)
    x_train, x_pool = _features("morgan", cutoff)
    y_train, y_pool = d["y_train"], d["y_pool"]
    insecticide, is_target = d["insecticide"], d["is_target"]
    pool = d["pool"]
    cids = pool["CID"].to_numpy()
    n_pool = len(pool)
    budget = min(budget, n_pool)

    def fit(extra: list[int]):
        x = np.vstack([x_train, x_pool[extra]]) if extra else x_train
        y = np.concatenate([y_train, y_pool[extra]]) if extra else y_train
        return RandomForestClassifier(n_estimators=trees, random_state=seed, n_jobs=-1).fit(x, y)

    def ranks_of_targets(risk_all: np.ndarray, remaining: np.ndarray) -> dict[int, int]:
        """Queue position of every untested target among the untested molecules."""
        order = remaining[_acquisition_order(risk_all[remaining], insecticide[remaining])]
        return {int(cids[i]): pos + 1 for pos, i in enumerate(order) if is_target[i]}

    def auroc(risk_all: np.ndarray, subset: np.ndarray):
        y = y_pool[subset]
        if len(subset) < 2 or y.min() == y.max():
            return None
        return round(float(roc_auc_score(y, risk_all[subset])), 4)

    base = fit([])
    frozen_risk = base.predict_proba(x_pool)[:, 1]
    arms = {
        "retrain": {"risk": frozen_risk.copy(), "tested": [], "found": 0, "rounds": [], "hit_at": [],
                    "history": [frozen_risk.copy()]},
        "frozen": {"risk": frozen_risk, "tested": [], "found": 0, "rounds": [], "hit_at": []},
    }
    all_idx = np.arange(n_pool)

    for name, arm in arms.items():
        arm["rounds"].append({
            "round": 0, "assays": 0, "found": 0,
            "pool_auroc": auroc(arm["risk"], all_idx), "untested": n_pool,
            "picked": [], "targets_left": int(is_target.sum()),
            "median_rank_before": None, "median_rank_after": None,
            "moved_up": 0, "moved_down": 0,
            "target_ranks": ranks_of_targets(arm["risk"], all_idx),
        })

    used, round_no = 0, 0
    while used < budget:
        round_no += 1
        take = min(batch, budget - used)
        used += take
        for name, arm in arms.items():
            tested = set(arm["tested"])
            remaining = np.array([i for i in all_idx if i not in tested])
            order = remaining[_acquisition_order(arm["risk"][remaining], insecticide[remaining])]
            picked = [int(i) for i in order[:take]]
            arm["tested"].extend(picked)
            hits = [i for i in picked if is_target[i]]
            arm["hit_at"] += [used - take + p + 1 for p, i in enumerate(picked) if is_target[i]]
            arm["found"] += len(hits)

            still = np.array([i for i in remaining if i not in set(picked)])
            before = ranks_of_targets(arm["risk"], still) if len(still) else {}
            if name == "retrain":
                arm["risk"] = fit(arm["tested"]).predict_proba(x_pool)[:, 1]
                arm["history"].append(arm["risk"].copy())
            after = ranks_of_targets(arm["risk"], still) if len(still) else {}
            moves = [before[c] - after[c] for c in after]
            arm["rounds"].append({
                "round": round_no, "assays": used, "found": arm["found"],
                "pool_auroc": auroc(arm["risk"], still) if len(still) else None,
                "untested": int(len(still)),
                "picked": [
                    {"cid": int(pool.loc[i, "CID"]), "name": str(pool.loc[i, "name"]),
                     "target": bool(is_target[i]), "toxic": bool(y_pool[i])}
                    for i in picked
                ],
                "targets_left": len(after),
                "median_rank_before": float(np.median(list(before.values()))) if before else None,
                "median_rank_after": float(np.median(list(after.values()))) if after else None,
                "moved_up": int(sum(m > 0 for m in moves)),
                "moved_down": int(sum(m < 0 for m in moves)),
                "target_ranks": after,
            })

    # AUROC on the molecules neither arm has tested yet, so both arms are
    # scored on exactly the same set each round.
    tested_r, tested_f = [], []
    for r_round, f_round in zip(arms["retrain"]["rounds"], arms["frozen"]["rounds"]):
        tested_r += [p["cid"] for p in r_round["picked"]]
        tested_f += [p["cid"] for p in f_round["picked"]]
        common_cids = set(pool["CID"]) - set(tested_r) - set(tested_f)
        common = np.flatnonzero(pool["CID"].isin(common_cids).to_numpy())
        r_round["common_auroc"] = auroc(arms["retrain"]["history"][r_round["round"]], common)
        f_round["common_auroc"] = auroc(frozen_risk, common)
        r_round["common_n"] = f_round["common_n"] = int(len(common))

    names = dict(zip(pool["CID"].astype(int), pool["name"].astype(str)))
    target_cids = [int(c) for c in pool.loc[is_target, "CID"]]

    def summary(arm) -> dict:
        found_at = None
        for rnd in arm["rounds"]:
            if rnd["found"] == int(is_target.sum()):
                found_at = rnd["assays"]
                break
        return {
            "found": arm["found"],
            "hit_at": arm["hit_at"],
            "all_found_at": arm["hit_at"][-1] if arm["found"] == int(is_target.sum()) else None,
            "all_found_by": found_at,
            "auroc_start": arm["rounds"][0]["pool_auroc"],
            "auroc_end": arm["rounds"][-1]["pool_auroc"],
            "common_auroc_end": arm["rounds"][-1]["common_auroc"],
        }

    for arm in arms.values():
        for rnd in arm["rounds"]:
            rnd["target_ranks"] = [
                {"cid": c, "rank": r} for c, r in sorted(rnd["target_ranks"].items(), key=lambda kv: kv[1])
            ]

    return {
        "budget": budget,
        "batch": batch,
        "trees": trees,
        "seed": seed,
        "features": FEATURES_LABEL,
        "cutoff_year": cutoff,
        "targets": int(is_target.sum()),
        "pool": n_pool,
        "insecticides_in_pool": int(insecticide.sum()),
        "targets_meta": [{"cid": c, "name": names[c]} for c in target_cids],
        "retrain": {"summary": summary(arms["retrain"]), "rounds": arms["retrain"]["rounds"]},
        "frozen": {"summary": summary(arms["frozen"]), "rounds": arms["frozen"]["rounds"]},
        "seconds": round(time.time() - started, 2),
    }


def _learning_path(budget: int, batch: int) -> Path:
    return DERIVED / f"learning_{budget}_{batch}.json"


@lru_cache(maxsize=64)
def get_learning(budget: int = 60, batch: int = 10) -> dict:
    path = _learning_path(budget, batch)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    result = learning_loop(budget, batch)
    result["mlflow_run_id"] = None
    DERIVED.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result), encoding="utf-8")
    return result


# ------------------------------------------------------------------- rigor


def _order_statistics(n: int, positives: np.ndarray, shuffles: int, seed: int = 0) -> np.ndarray:
    """For each shuffle, the assay at which the k-th answer turns up (k = 1..K)."""
    rng = np.random.default_rng(seed)
    k = int(positives.sum())
    out = np.zeros((shuffles, k), dtype=np.int16)
    for row in range(shuffles):
        perm = rng.permutation(n)
        out[row] = np.flatnonzero(positives[perm])[:k] + 1
    return out


def _baseline(label: str, n: int, positives: np.ndarray, model_positions: list[int]) -> dict:
    stats = _order_statistics(n, positives, BASELINE_SHUFFLES)
    k_total = stats.shape[1]
    per_k = []
    for k in range(1, k_total + 1):
        column = stats[:, k - 1]
        model = model_positions[k - 1]
        per_k.append({
            "k": k,
            "p5": float(np.percentile(column, 5)),
            "p50": float(np.percentile(column, 50)),
            "p95": float(np.percentile(column, 95)),
            "model": model,
            "share_at_or_below_model": round(float((column <= model).mean()), 4),
        })
    last = stats[:, -1]
    lo, hi = int(last.min()), int(last.max())
    hist = [{"assays": int(v), "count": int((last == v).sum())} for v in range(lo, hi + 1)]
    model_all = model_positions[-1]
    # Exact: P(all K answers inside the first m picks) = C(m, K) / C(n, K).
    exact_p = math.comb(model_all, k_total) / math.comb(n, k_total)
    exact_median = next(m for m in range(k_total, n + 1)
                        if math.comb(m, k_total) / math.comb(n, k_total) >= 0.5)
    return {
        "label": label,
        "candidates": int(n),
        "answers": k_total,
        "shuffles": BASELINE_SHUFFLES,
        "seed": 0,
        "per_k": per_k,
        "all_hist": hist,
        "model_assays_to_all": model_all,
        "random_all_p5": per_k[-1]["p5"],
        "random_all_p50": per_k[-1]["p50"],
        "random_all_p95": per_k[-1]["p95"],
        "shuffles_at_or_below_model": int((last <= model_all).sum()),
        "exact_p_all_within_model": exact_p,
        "exact_median_all": exact_median,
    }


MODELS = [
    ("random_forest", "Random forest, 500 trees"),
    ("logistic", "Logistic regression"),
    ("knn", "k-NN, k=7"),
    ("dummy", "Prior only (no structure)"),
]
FINGERPRINTS = [
    ("morgan", FEATURES_LABEL),
    ("maccs", "MACCS, 167 keys"),
    ("descriptors", f"RDKit descriptors, {len(Descriptors.descList)}"),
]


def _half_k(target: np.ndarray) -> int:
    """The answer that marks half the set (the 7th of 13)."""
    return (int(target.sum()) + 1) // 2


def _ablation_cell(model: str, fingerprint: str, d: dict) -> dict:
    y, ins, target = d["y_pool"], d["insecticide"], d["is_target"]
    half_k = _half_k(target)
    risk = _risk(model, fingerprint)
    if model == "dummy":
        # A constant score leaves the queue order to the tie-break. Use random
        # tie-breaks instead of row order, which is sorted by year.
        stats = _order_statistics(int(ins.sum()), target[ins == 1], TIE_BREAKS, seed=1)
        half, full = float(np.median(stats[:, half_k - 1])), float(np.median(stats[:, -1]))
        found30 = float(np.median((stats <= SPEEDUP_BUDGET).sum(1)))
        return {"auroc": 0.5, "ci_low": 0.5, "ci_high": 0.5,
                "assays_to_half": half, "assays_to_all": full, "found_in_30": found30,
                "tie_breaks": TIE_BREAKS,
                "note": f"median of {TIE_BREAKS:,} random tie-breaks"}
    positions = _hit_positions(_acquisition_order(risk, ins), target)
    lo, hi = _bootstrap_auroc(y, risk)
    return {
        "auroc": round(float(roc_auc_score(y, risk)), 4),
        "ci_low": lo,
        "ci_high": hi,
        "assays_to_half": positions[half_k - 1],
        "assays_to_all": positions[-1],
        "found_in_30": int(sum(p <= SPEEDUP_BUDGET for p in positions)),
    }


def _drop_previous_runs(mlflow, experiment_id: str) -> None:
    """Remove this module's earlier runs so the store holds one current set.

    Only runs tagged module=rigor are touched; other modules may log to the
    same experiment.
    """
    client = mlflow.tracking.MlflowClient()
    old = client.search_runs([experiment_id], filter_string="tags.module = 'rigor'", max_results=5000)
    for row in old:
        client.delete_run(row.info.run_id)
        # The file store only flags a deleted run; remove its folder too.
        for folder in (MLRUNS / experiment_id / row.info.run_id, MLRUNS / ".trash" / row.info.run_id):
            shutil.rmtree(folder, ignore_errors=True)


def _within_class(model_positions: list[int], n_class: int) -> dict:
    """Rank test inside the insecticides: are the answers ahead of the rest?

    Finding all 13 depends only on where the last one sits. This uses every
    position: Mann-Whitney U of answer positions against non-answer positions
    in the same queue, which is also the within-class AUROC.
    """
    from scipy.stats import mannwhitneyu

    answers = np.array(model_positions)
    others = np.array([p for p in range(1, n_class + 1) if p not in set(model_positions)])
    test = mannwhitneyu(others, answers, alternative="greater")
    return {
        "within_class_auroc": round(float(test.statistic / (len(answers) * len(others))), 4),
        "mannwhitney_p": round(float(test.pvalue), 4),
        "mean_answer_position": round(float(answers.mean()), 2),
        "random_mean_answer_position": round((n_class + 1) / 2, 2),
    }


def build_rigor(log: bool = True) -> dict:
    """Run every check and write lab/data/derived/rigor.json."""
    import mlflow

    started = time.time()
    DERIVED.mkdir(parents=True, exist_ok=True)
    if log:
        mlflow.set_tracking_uri(MLRUNS.resolve().as_uri())
        experiment = mlflow.set_experiment(EXPERIMENT)
        _drop_previous_runs(mlflow, experiment.experiment_id)

    def run(name: str, params: dict, metrics: dict, steps: dict | None = None) -> str | None:
        if not log:
            return None
        with mlflow.start_run(run_name=name) as active:
            mlflow.set_tags({"split": f"time_{CUTOFF}", "dataset": "ApisTox dataset_final.csv",
                             "module": "rigor"})
            mlflow.log_params(params)
            mlflow.log_metrics({k: float(v) for k, v in metrics.items() if v is not None})
            for key, series in (steps or {}).items():
                for step, value in series:
                    if value is not None:
                        mlflow.log_metric(key, float(value), step=step)
            return active.info.run_id

    d = _data()
    lab = get_lab(CUTOFF)
    ins, target = d["insecticide"], d["is_target"]

    # Main model, exactly as the engine trains it.
    main_risk = _risk("random_forest", "morgan", seed=0)
    assert np.allclose(1.0 - main_risk, lab.safe_score), "rigor and engine disagree on the main model"
    model_positions = _hit_positions(_acquisition_order(main_risk, ins), target)

    # (a) random baselines as distributions
    whole = _baseline("random over the whole pool", len(target), target, model_positions)
    in_class = _baseline("random over insecticides only", int(ins.sum()), target[ins == 1],
                         model_positions)
    in_class.update(_within_class(model_positions, int(ins.sum())))
    for base in (whole, in_class):
        base["mlflow_run_id"] = run(
            f"baseline: {base['label']}",
            {"candidates": base["candidates"], "shuffles": BASELINE_SHUFFLES, "seed": 0},
            {"random_all_p5": base["random_all_p5"], "random_all_p50": base["random_all_p50"],
             "random_all_p95": base["random_all_p95"], "model_assays_to_all": base["model_assays_to_all"],
             "exact_p_all_within_model": base["exact_p_all_within_model"]},
        )

    # (b) ablation
    cells = []
    for model, model_label in MODELS:
        for fp, fp_label in FINGERPRINTS:
            cell = {"model": model, "fingerprint": fp, **_ablation_cell(model, fp, d)}
            cell["mlflow_run_id"] = run(
                f"ablation: {model} x {fp}",
                {"model": model, "fingerprint": fp, "split": f"time_{CUTOFF}", "seed": 0},
                {k: cell[k] for k in ("auroc", "ci_low", "ci_high", "assays_to_half",
                                      "assays_to_all", "found_in_30")},
            )
            cells.append(cell)
            print(f"  {model:14s} {fp:12s} auroc {cell['auroc']:.4f}  "
                  f"to {_half_k(target)}: {cell['assays_to_half']}  "
                  f"to {int(target.sum())}: {cell['assays_to_all']}")
    real = [c for c in cells if c["model"] != "dummy"]
    best_auroc = max(real, key=lambda c: c["auroc"])
    best_assays = min(real, key=lambda c: (c["assays_to_all"], c["assays_to_half"]))

    # (c) scaffold split, reused from the engine
    holdout = lab.holdout()
    seen, unseen = lab.seen_scaffold, ~lab.seen_scaffold
    y = d["y_pool"]
    seen_ci = _bootstrap_auroc(y[seen], main_risk[seen])
    unseen_ci = _bootstrap_auroc(y[unseen], main_risk[unseen])
    facts = lab.facts()
    scaffold = {
        **holdout,
        "seen_ci": list(seen_ci),
        "unseen_ci": list(unseen_ci),
        "targets_on_unseen_scaffolds": facts["targets_on_unseen_scaffolds"],
        "targets": facts["targets"],
    }
    scaffold["mlflow_run_id"] = run(
        "scaffold split check",
        {"model": "random_forest", "fingerprint": "morgan", "scaffold": "Murcko"},
        {"seen_auroc": holdout["seen_auroc"], "unseen_auroc": holdout["unseen_auroc"],
         "gap": holdout["seen_auroc"] - holdout["unseen_auroc"]},
    )

    # (d) seeds
    seed_rows = []
    random_all_median = whole["exact_median_all"]
    for seed in SEEDS:
        risk = main_risk if seed == 0 else _risk("random_forest", "morgan", seed=seed)
        positions = _hit_positions(_acquisition_order(risk, ins), target)
        found30 = int(sum(p <= SPEEDUP_BUDGET for p in positions))
        random_median = lab._random_baseline(found30, 500) if found30 else None
        row = {
            "seed": seed,
            "auroc": round(float(roc_auc_score(y, risk)), 4),
            "found_in_30": found30,
            "assays_to_all": positions[-1],
            "speedup_budget30": round(random_median / SPEEDUP_BUDGET, 2) if random_median else None,
            "speedup_to_all": round(random_all_median / positions[-1], 2),
        }
        row["mlflow_run_id"] = run(
            f"main model, seed {seed}",
            {"model": "random_forest", "fingerprint": "morgan", "trees": 500, "seed": seed},
            {k: row[k] for k in ("auroc", "found_in_30", "assays_to_all",
                                 "speedup_budget30", "speedup_to_all")},
        )
        seed_rows.append(row)

    def spread(key: str) -> dict:
        values = np.array([r[key] for r in seed_rows if r[key] is not None], dtype=float)
        return {"mean": round(float(values.mean()), 4), "sd": round(float(values.std(ddof=1)), 4),
                "min": round(float(values.min()), 4), "max": round(float(values.max()), 4)}

    main_ci = _bootstrap_auroc(y, main_risk)

    # learning loop grid, logged with per-round series
    learning_runs = {}
    for budget, batch in LEARNING_GRID:
        result = learning_loop(budget, batch)
        series = {}
        for arm in ("retrain", "frozen"):
            series[f"{arm}_found"] = [(r["assays"], r["found"]) for r in result[arm]["rounds"]]
            series[f"{arm}_common_auroc"] = [(r["assays"], r["common_auroc"]) for r in result[arm]["rounds"]]
        run_id = run(
            f"learning loop: budget {budget}, batch {batch}",
            {"budget": budget, "batch": batch, "trees": result["trees"], "seed": 0},
            {"retrain_found": result["retrain"]["summary"]["found"],
             "frozen_found": result["frozen"]["summary"]["found"],
             "retrain_common_auroc_end": result["retrain"]["summary"]["common_auroc_end"],
             "frozen_common_auroc_end": result["frozen"]["summary"]["common_auroc_end"]},
            series,
        )
        result["mlflow_run_id"] = run_id
        learning_runs[f"{budget}_{batch}"] = run_id
        _learning_path(budget, batch).write_text(json.dumps(result), encoding="utf-8")
        print(f"  learning {budget:>3}/{batch:<2} retrain {result['retrain']['summary']}  "
              f"frozen {result['frozen']['summary']}  {result['seconds']}s")
    get_learning.cache_clear()

    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    out = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "command": REBUILD,
        "dataset_sha256": manifest["dataset_final.csv"]["sha256"],
        "setup": {
            "cutoff_year": CUTOFF,
            "train": int(len(d["train"])),
            "pool": int(len(d["pool"])),
            "insecticides_in_pool": int(ins.sum()),
            "targets": int(target.sum()),
            "half_k": _half_k(target),
            "main_model": f"random forest, 500 trees, {FEATURES_LABEL}, seed 0",
            "main_auroc": round(float(roc_auc_score(y, main_risk)), 4),
            "main_auroc_ci": list(main_ci),
            "bootstraps": BOOTSTRAPS,
            "model_positions": model_positions,
        },
        "baselines": {"whole_pool": whole, "insecticides_only": in_class},
        "ablation": {
            "models": [{"key": k, "label": v} for k, v in MODELS],
            "fingerprints": [{"key": k, "label": v} for k, v in FINGERPRINTS],
            "cells": cells,
            "best_auroc": {"model": best_auroc["model"], "fingerprint": best_auroc["fingerprint"]},
            "best_assays": {"model": best_assays["model"], "fingerprint": best_assays["fingerprint"]},
        },
        "scaffold": scaffold,
        "seeds": {
            "rows": seed_rows,
            "auroc": spread("auroc"),
            "assays_to_all": spread("assays_to_all"),
            "speedup_budget30": spread("speedup_budget30"),
            "speedup_to_all": spread("speedup_to_all"),
            "random_all_median_used": random_all_median,
            "speedup_budget": SPEEDUP_BUDGET,
        },
        "mlflow": {
            "tracking_dir": "lab/data/derived/mlruns",
            "experiment_name": EXPERIMENT,
            "experiment_id": experiment.experiment_id if log else None,
            "runs": (2 + len(cells) + 1 + len(SEEDS) + len(LEARNING_GRID)) if log else 0,
            "learning_runs": learning_runs,
        },
        "seconds": round(time.time() - started, 1),
    }
    (DERIVED / "rigor.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    get_rigor.cache_clear()
    return out


@lru_cache(maxsize=1)
def get_rigor() -> dict:
    path = DERIVED / "rigor.json"
    if not path.exists():
        return build_rigor()
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    result = build_rigor()
    print(json.dumps({k: result[k] for k in ("setup", "scaffold", "mlflow", "seconds")}, indent=1))
