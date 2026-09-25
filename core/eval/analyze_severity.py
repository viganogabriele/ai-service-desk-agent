"""Where urgency / impact accuracy is lost. Reads the training file and stored evaluation
results only; it never calls an LLM and never reads the challenge file.

    python eval/analyze_severity.py eval/results/gpt-6-luna-medium-standard.json [more results...]

Sections:
  1. training   Urgency / Impact / Priority against every training field (mutual information
                against a shuffled-label null). They carry no signal, as the README says.
  2. errors     Confusion, bias (> 0 = rated too high) by source, criticality and resolution.
  3. labels     Label agreement between near-duplicate tickets against the model's own
                agreement on the same pairs, and a no-text baseline from work type + resolution.
  4. caps       The stored predictions with and without config.RESOLUTION_SEVERITY_CAPS.
"""
import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from triage import config  # noqa: E402
from triage.priority import compute_priority, severity_cap  # noqa: E402

RANK = {lvl: len(config.LEVELS) - 1 - i for i, lvl in enumerate(config.LEVELS)}  # Highest = 4 ... Lowest = 0
DATASET = config.ROOT / "eval" / "comparison_300.json"


def _mi_bits(a: pd.Series, b: pd.Series) -> float:
    p = pd.crosstab(a, b).to_numpy(float)
    p = p / p.sum()
    expected = p.sum(1, keepdims=True) @ p.sum(0, keepdims=True)
    nz = p > 0
    return float((p[nz] * np.log2(p[nz] / expected[nz])).sum())


def training_section(shuffles: int = 20) -> None:
    rows = []
    for t in json.loads(config.TRAINING_PATH.read_text(encoding="utf-8")):
        created = pd.Timestamp(t["Created date"])
        rows.append({
            "urgency": t["Urgency"], "impact": t["Impact"], "priority": t["Priority"],
            "work_type": t["Work type"], "service": (t["Affected Business or IT Services"] or ["-"])[0],
            "entity": "|".join(t.get("Business Entity") or []), "reporter": t["Reporter"],
            "assignee": t["Assignee"] or "-", "resolution": t["Resolution"] or "-", "description": t["Description"],
            "comments": len(t.get("All Comments") or []), "hour": created.hour, "weekday": created.weekday(),
        })
    df = pd.DataFrame(rows)
    rng = np.random.default_rng(0)
    print(f"== 1. Training set (n={len(df)}): mutual information in bits, against a shuffled-label null ==")
    print("   levels:", {c: df[c].value_counts().reindex([l.lower() for l in config.LEVELS]).tolist()
                        for c in ("urgency", "impact", "priority")})
    for target in ("urgency", "impact", "priority"):
        print(f"   {target}:")
        for feature in df.columns:
            if feature == target:
                continue
            mi = _mi_bits(df[target], df[feature].astype(str))
            null = [_mi_bits(pd.Series(rng.permutation(df[target].to_numpy())), df[feature].astype(str))
                    for _ in range(shuffles)]
            verdict = "SIGNAL" if mi > max(null) * 1.5 else "noise"
            print(f"     {feature:12s} MI {mi:.4f}   null max {max(null):.4f}   {verdict}")
    matrix = df.apply(lambda r: compute_priority(r.urgency, r.impact).lower(), axis=1)
    chance = sum((matrix == lvl).mean() * (df.priority == lvl).mean() for lvl in df.priority.unique())
    print(f"   priority == matrix(urgency, impact): {(matrix == df.priority).mean():.1%} (chance {chance:.1%})")


def load_rows(path: Path) -> pd.DataFrame:
    dataset = {r["id"]: r for r in json.loads(DATASET.read_text(encoding="utf-8"))["records"]}
    rows = []
    for r in json.loads(path.read_text(encoding="utf-8"))["metrics"]["rows"]:
        pred, label = r.get("pred"), r["label"]
        if not pred or not label.get("urgency"):
            continue
        rows.append({
            "id": r["id"], "src": "handwritten" if r["id"].startswith("H") else "generated",
            "kind": label.get("kind", "-"), "pattern": label.get("source_pattern"),
            "text": dataset[r["id"]]["Description"] + " " + " ".join(dataset[r["id"]].get("All Comments") or []),
            "service": label["service"], "work_type": label["work_type"], "resolution": label["resolution"],
            "criticality": config.CRITICALITY[label["service"]],
            "pred_work_type": pred["work_type"], "pred_resolution": pred["resolution"],
            **{f"label_{f}": label[f] for f in ("urgency", "impact")},
            "label_priority": compute_priority(label["urgency"], label["impact"]),
            **{f"pred_{f}": pred[f] for f in ("urgency", "impact", "priority")},
        })
    df = pd.DataFrame(rows)
    for f in ("urgency", "impact", "priority"):
        df[f"err_{f}"] = df[f"pred_{f}"].map(RANK) - df[f"label_{f}"].map(RANK)
    return df


def errors_section(df: pd.DataFrame) -> None:
    print("\n== 2. Errors ==")
    for f in ("urgency", "impact", "priority"):
        e = df[f"err_{f}"]
        print(f"   {f}: exact {(e == 0).mean():.0%}  within one {(e.abs() <= 1).mean():.0%}  "
              f"too high {(e > 0).mean():.0%}  too low {(e < 0).mean():.0%}")
        table = pd.crosstab(df[f"label_{f}"], df[f"pred_{f}"]).reindex(index=config.LEVELS, columns=config.LEVELS,
                                                                       fill_value=0)
        print("     " + table.rename_axis(index="label \\ pred", columns=None).to_string().replace("\n", "\n     "))
    for col in ("src", "criticality", "resolution"):
        g = df.groupby(col)
        out = pd.DataFrame({"n": g.size(),
                            **{f"{f} exact": g[f"err_{f}"].apply(lambda e: (e == 0).mean()) for f in ("urgency", "impact")},
                            **{f"{f} bias": g[f"err_{f}"].mean() for f in ("urgency", "impact")}})
        print(f"   by {col}:\n     " + out.round(2).to_string().replace("\n", "\n     "))
    perfect_u = (df.apply(lambda r: compute_priority(r.label_urgency, r.pred_impact), axis=1) == df.label_priority).mean()
    perfect_i = (df.apply(lambda r: compute_priority(r.pred_urgency, r.label_impact), axis=1) == df.label_priority).mean()
    print(f"   priority with perfect urgency {perfect_u:.0%}, with perfect impact {perfect_i:.0%}")


def labels_section(df: pd.DataFrame, min_sim: float = 0.85) -> None:
    from sentence_transformers import SentenceTransformer

    print("\n== 3. Label consistency ==")
    emb = SentenceTransformer(config.EMBED_MODEL).encode(df.text.tolist(), normalize_embeddings=True)
    sim = emb @ emb.T
    np.fill_diagonal(sim, -1)
    pairs = []
    for a in range(len(df)):
        same = ((df.service == df.service[a]) & (df.work_type == df.work_type[a])
                & (df.resolution == df.resolution[a])).to_numpy().copy()
        same[a] = False
        if same.any():
            b = int(np.where(same, sim[a], -1).argmax())
            if sim[a, b] >= min_sim:
                pairs.append((a, b))
    print(f"   nearest like-for-like neighbour (same service, work type, resolution; cosine >= {min_sim}), "
          f"{len(pairs)} pairs:")
    for f in ("urgency", "impact", "priority"):
        lab = np.mean([df[f"label_{f}"][a] == df[f"label_{f}"][b] for a, b in pairs])
        pred = np.mean([df[f"pred_{f}"][a] == df[f"pred_{f}"][b] for a, b in pairs])
        print(f"     {f:9s} labels agree {lab:.0%}   model agrees with itself {pred:.0%}")
    same_pattern = [(a.Index, b.Index) for _, g in df[df.kind == "pattern"].groupby("pattern")
                    for a, b in itertools.combinations(g.itertuples(), 2)]
    if same_pattern:
        print(f"   generated tickets from the same resolution pattern ({len(same_pattern)} pairs): labels agree "
              + "  ".join(f"{f} {np.mean([df[f'label_{f}'][a] == df[f'label_{f}'][b] for a, b in same_pattern]):.0%}"
                          for f in ("urgency", "impact")))
    hits = {"urgency": 0, "impact": 0}
    for i, r in df.iterrows():  # leave-one-out majority label per (work type, resolution), no text
        rest = df.drop(i)
        group = rest[(rest.work_type == r.work_type) & (rest.resolution == r.resolution)]
        group = group if len(group) else rest
        for f in hits:
            hits[f] += group[f"label_{f}"].mode().iloc[0] == r[f"label_{f}"]
    print("   no-text baseline (majority label per work type + resolution): "
          + "  ".join(f"{f} {n / len(df):.0%}" for f, n in hits.items())
          + "   | model: " + "  ".join(f"{f} {(df[f'err_{f}'] == 0).mean():.0%}" for f in hits))


def caps_section(df: pd.DataFrame) -> None:
    print("\n== 4. Resolution caps on the stored predictions (config.RESOLUTION_SEVERITY_CAPS) ==")
    u = df.apply(lambda r: severity_cap("urgency", r.pred_urgency, r.pred_resolution), axis=1)
    i = df.apply(lambda r: severity_cap("impact", r.pred_impact, r.pred_resolution), axis=1)
    p = [compute_priority(a, b) for a, b in zip(u, i)]
    capped = df.assign(pred_urgency=u, pred_impact=i, pred_priority=p)
    for name, sub in [("all", slice(None))] + [(s, df.src == s) for s in ("handwritten", "generated")]:
        before, after = df[sub], capped[sub]
        print(f"   {name:12s} " + "  ".join(
            f"{f} {(before[f'pred_{f}'] == before[f'label_{f}']).mean():.0%} -> "
            f"{(after[f'pred_{f}'] == after[f'label_{f}']).mean():.0%}" for f in ("urgency", "impact", "priority")))
    print(f"   capped tickets: {int(((u != df.pred_urgency) | (i != df.pred_impact)).sum())} of {len(df)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("results", nargs="*", type=Path, help="evaluation results on eval/comparison_300.json")
    ap.add_argument("--sections", default="training,errors,labels,caps")
    args = ap.parse_args()
    sections = set(args.sections.split(","))
    if "training" in sections:
        training_section()
    for path in args.results:
        print(f"\n######## {path}")
        df = load_rows(path)
        if "errors" in sections:
            errors_section(df)
        if "labels" in sections:
            labels_section(df)
        if "caps" in sections:
            caps_section(df)


if __name__ == "__main__":
    main()
