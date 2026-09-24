"""Evaluate triage on a labelled ticket file (hand-written or the generated dev set).
Never used on the challenge file."""
import json
import statistics
import time
from pathlib import Path

from triage import config
from triage.catalog import load_catalog, load_service_cards
from triage.priority import compute_priority
from triage.retrieval import Retriever
from triage.schemas import DecisionsFile
from triage.triage import run_batch, triage_versions, utc_now

FIRM = ("service", "work_type", "resolution")
SOFT = ("urgency", "impact", "priority")


def load_labelled(path: Path) -> list[tuple[str, dict, dict]]:
    records = json.loads(Path(path).read_text(encoding="utf-8"))["records"]
    out = []
    for rec in records:
        ticket = {k: v for k, v in rec.items() if k != "id" and not k.startswith("_")}
        label = dict(rec.get("_label", {}))
        if label.get("urgency") and label.get("impact"):
            label["priority"] = compute_priority(label["urgency"], label["impact"])
        out.append((rec["id"], ticket, label))
    return out


def _pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.0f}%)" if d else "-"


THRESHOLD_SWEEP = (0.55, 0.60, 0.62, 0.65, 0.68, 0.70, 0.72, 0.75, 0.80)


def assignee_by_rule(service: str, top: dict | None, threshold: float, catalog: dict) -> str:
    """AGENTS step 4 recomputed offline for a threshold sweep."""
    if top and top["service"] == service and top["similarity"] >= threshold:
        return top["resolver"]
    return catalog["fallback_assignee"][service]["assignee"]


def score(runs, labelled, catalog: dict | None = None) -> dict:
    """Per-field accuracy, service accuracy per ticket kind and per title style, confidence
    separation, top-pattern resolver hits, and the assignee rule (with a threshold sweep)."""
    rows = []
    for run, (tid, _, label) in zip(runs, labelled):
        if run.status != "completed":
            rows.append({"id": tid, "failed": run.error})
            continue
        d = run.decisions
        pat = d["service"].evidence.patterns[0] if d["service"].evidence.patterns else None
        rows.append({
            "id": tid, "kind": label.get("kind", "-"), "label": label,
            "pred": {f: d[f].value for f in FIRM + SOFT},
            "service_conf": d["service"].confidence,
            "top_pattern": pat.pattern_id if pat else None,
            "top_resolver": pat.resolver if pat else None,
            "top_sim": pat.similarity if pat else None,
            "top_service": pat.service if pat else None,
            "assignee": d["assignee"].value if "assignee" in d else None,
        })
    ok = [r for r in rows if "failed" not in r]
    ai = [run.decisions[f] for run in runs if run.status == "completed" for f in config.AI_FIELDS]
    evidence = (sum(bool(d.evidence.ticket_spans) for d in ai), len(ai))
    res = {"n": len(rows), "failed": len(rows) - len(ok), "fields": {}, "by_kind": {}, "rows": rows,
           "evidence": evidence}
    named = [r for r in ok if not r["label"].get("names_service")]
    res["service_unnamed"] = (sum(r["pred"]["service"] == r["label"]["service"] for r in named), len(named))
    for f in FIRM + SOFT:
        scored = [r for r in ok if r["label"].get(f)]
        res["fields"][f] = (sum(r["pred"][f] == r["label"][f] for r in scored), len(scored))
    for kind in sorted({r["kind"] for r in ok}):
        rs = [r for r in ok if r["kind"] == kind]
        res["by_kind"][kind] = (sum(r["pred"]["service"] == r["label"]["service"] for r in rs), len(rs))
    for name, flag in (("misleading", True), ("plain", False)):
        rs = [r for r in ok if r["kind"] in ("pattern", "card") and bool(r["label"].get("misleading_title")) == flag]
        res["by_kind"][f"{name}-title"] = (sum(r["pred"]["service"] == r["label"]["service"] for r in rs), len(rs))
    with_assignee = [r for r in ok if r["label"].get("assignee")]
    res["assignee"] = (sum(r["assignee"] == r["label"]["assignee"] for r in with_assignee), len(with_assignee))
    res["sweep"] = {}
    if catalog:
        for thr in THRESHOLD_SWEEP:
            hits = sum(assignee_by_rule(r["pred"]["service"],
                                        {"service": r["top_service"], "similarity": r["top_sim"], "resolver": r["top_resolver"]}
                                        if r["top_pattern"] else None, thr, catalog) == r["label"]["assignee"]
                       for r in with_assignee)
            res["sweep"][thr] = (hits, len(with_assignee))
    right = [r["service_conf"] for r in ok if r["pred"]["service"] == r["label"]["service"]]
    wrong = [r["service_conf"] for r in ok if r["pred"]["service"] != r["label"]["service"]]
    res["conf"] = {"right": right, "wrong": wrong}
    pat_rows = [r for r in ok if r["label"].get("assignee_source") == "pattern_match"]
    res["top_pattern"] = {
        "n": len(pat_rows),
        "pattern_hit": sum(r["top_pattern"] == r["label"]["source_pattern"] for r in pat_rows),
        "resolver_hit": sum(r["top_resolver"] == r["label"]["assignee"] for r in pat_rows),
        "sim_right": [r["top_sim"] for r in pat_rows if r["top_resolver"] == r["label"]["assignee"]],
        "sim_wrong": [r["top_sim"] for r in pat_rows if r["top_resolver"] != r["label"]["assignee"]],
        # top patterns on tickets whose true service has no pattern: how similar do wrong matches get?
        "sim_no_pattern_service": [r["top_sim"] for r in ok if r["label"].get("assignee_source") == "fallback"],
    }
    return res


def _dist(xs: list[float]) -> str:
    if not xs:
        return "-"
    return f"n={len(xs)} min {min(xs):.2f} / median {statistics.median(xs):.2f} / max {max(xs):.2f}"


def format_report(res: dict, elapsed: float) -> str:
    lines = [f"Tickets: {res['n']} ({res['failed']} failed), {elapsed:.0f}s total, "
             f"{elapsed / max(1, res['n']):.1f}s per ticket"]
    lines.append("Accuracy (firm): " + "  ".join(f"{f} {_pct(*res['fields'][f])}" for f in FIRM))
    lines.append("Accuracy (soft): " + "  ".join(f"{f} {_pct(*res['fields'][f])}" for f in SOFT))
    lines.append(f"Service on tickets that never name it: {_pct(*res['service_unnamed'])}")
    lines.append(f"AI fields with >= 1 verified evidence span: {_pct(*res['evidence'])}")
    lines.append("Service by kind: " + "  ".join(f"{k} {_pct(*v)}" for k, v in res["by_kind"].items()))
    c = res["conf"]
    lines.append(f"Service confidence when right: {_dist(c['right'])}")
    lines.append(f"Service confidence when wrong: {_dist(c['wrong'])}")
    for thr in (0.5, 0.6, 0.7):
        hi = [x for x in c["right"] if x >= thr], [x for x in c["wrong"] if x >= thr]
        n_hi = len(hi[0]) + len(hi[1])
        lines.append(f"  conf >= {thr}: covers {_pct(n_hi, len(c['right']) + len(c['wrong']))}, "
                     f"accuracy {_pct(len(hi[0]), n_hi)}")
    lines.append(f"Assignee (rule, threshold {config.ASSIGNEE_SIM_THRESHOLD}): {_pct(*res['assignee'])}")
    if res["sweep"]:
        lines.append("  threshold sweep: " + "  ".join(f"{t:.2f} {_pct(*v)}" for t, v in res["sweep"].items()))
    t = res["top_pattern"]
    lines.append(f"Top pattern on pattern tickets: pattern {_pct(t['pattern_hit'], t['n'])}, "
                 f"resolver {_pct(t['resolver_hit'], t['n'])}")
    lines.append(f"  top similarity, resolver right: {_dist(t['sim_right'])}")
    lines.append(f"  top similarity, resolver wrong: {_dist(t['sim_wrong'])}")
    lines.append(f"  top similarity, service has no pattern: {_dist(t['sim_no_pattern_service'])}")
    errors = [r for r in res["rows"] if "failed" not in r and r["pred"]["service"] != r["label"]["service"]]
    if errors:
        lines.append("Service errors: " + "; ".join(
            f"{r['id']} {r['label']['service']} -> {r['pred']['service']} ({r['service_conf']:.2f})" for r in errors))
    return "\n".join(lines)


def evaluate_file(path: str, n_samples: int = config.SELF_CONSISTENCY_N, evidence: bool = False,
                  run_id: str | None = None) -> tuple[DecisionsFile, dict, str]:
    catalog, cards = load_catalog(), load_service_cards()
    retriever = Retriever(catalog, cards)
    labelled = load_labelled(Path(path))
    run_id = run_id or time.strftime("%Y%m%d-%H%M%S")
    versions, created, t0 = triage_versions(), utc_now(), time.time()
    runs = run_batch([(tid, ticket) for tid, ticket, _ in labelled], run_id, retriever, cards, catalog, versions,
                     n_samples=n_samples, evidence=evidence, comment=False)
    res = score(runs, labelled, catalog)
    report = format_report(res, time.time() - t0)
    return DecisionsFile(run_id=run_id, created_at=created, source_file=str(path), versions=versions, runs=runs), res, report
