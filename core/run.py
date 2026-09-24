"""CLI: build the catalog (and, in later milestones, triage the challenge)."""
import argparse
import json
import time
from pathlib import Path

from triage import config
from triage.catalog import (
    build_catalog,
    build_service_cards,
    load_catalog,
    save_catalog,
    save_service_cards,
)


def print_catalog_summary(catalog: dict) -> None:
    patterns_per_service: dict[str, int] = {}
    for p in catalog["patterns"]:
        patterns_per_service[p["service"]] = patterns_per_service.get(p["service"], 0) + 1

    rows = []
    for service, team in catalog["service_team"].items():
        resolvers = catalog["resolvers_by_service"].get(service)
        fb = catalog["fallback_assignee"][service]
        owner = ", ".join(resolvers) if resolvers else f"fallback: {fb['assignee']}"
        rows.append((service, team, catalog["criticality"][service] or "?", str(patterns_per_service.get(service, 0)), owner))

    headers = ("Service", "Team", "Crit", "#Pat", "Resolver(s) / fallback")
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for r in rows:
        print(fmt.format(*r))
    print(f"\n{len(catalog['service_team'])} services, {len(set(catalog['service_team'].values()))} teams, "
          f"{len(catalog['patterns'])} patterns over {len(patterns_per_service)} services")
    for w in catalog["warnings"]:
        print(f"WARNING: {w}")


def cmd_catalog(args: argparse.Namespace) -> None:
    catalog = build_catalog()
    path = save_catalog(catalog)
    print_catalog_summary(catalog)
    print(f"\nSaved {path.relative_to(config.ROOT)}")


def cmd_cards(args: argparse.Namespace) -> None:
    path = config.SERVICE_CARDS_PATH
    if path.exists() and not args.force:
        raise SystemExit(f"{path.name} exists (possibly human-edited); pass --force to regenerate")
    cards = build_service_cards(load_catalog(), model=args.model)
    save_service_cards(cards, path)
    for c in cards["cards"]:
        print(f"[{c['criticality']:<12}] {c['service']} ({c['team']}; patterns: {', '.join(c['pattern_ids']) or '-'})\n    {c['scope']}"
              + (f"\n    Not: {c['boundary']}" if c["boundary"] else "")
              + (f"\n    (dropped boundary: {c['boundary_dropped']})" if c["boundary_dropped"] else ""))
    print(f"\nSaved {path.relative_to(config.ROOT)} (reviewed: false; review, edit, then set reviewed: true)")


def new_run_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def write_decisions(decisions, run_id: str) -> Path:
    config.OUTPUTS_DIR.mkdir(exist_ok=True)
    path = config.OUTPUTS_DIR / f"decisions_{run_id}.json"
    path.write_text(decisions.model_dump_json(indent=1), encoding="utf-8")
    return path


def cmd_sample(args: argparse.Namespace) -> None:
    """Triage a labelled ticket file (never the challenge) and report accuracy."""
    from triage.evaluation import evaluate_file

    decisions, _, report = evaluate_file(args.file, n_samples=args.samples, evidence=args.evidence)
    print(report)
    print(f"Versions: {decisions.versions.model_dump()}")
    print(f"Saved {write_decisions(decisions, decisions.run_id).relative_to(config.ROOT)}")


def _ticket_ids(records: list[dict]) -> list[str]:
    return [str(r.get("Key") or r.get("Issue key") or f"R{i + 1:02d}") for i, r in enumerate(records)]


def print_run_summary(runs) -> None:
    rows = []
    for run in runs:
        if run.status != "completed":
            rows.append((run.ticket_id, f"FAILED: {run.error}"[:70], "", "", "", "", "", ""))
            continue
        d = run.decisions
        rows.append((run.ticket_id, d["service"].value, d["team"].value,
                     f"{d['assignee'].value.split('@')[0]} ({d['assignee'].source})",
                     f"{d['urgency'].value}/{d['impact'].value}->{d['priority'].value}", d["resolution"].value,
                     run.lane, f"{min(r.confidence for r in d.values()):.2f}"))
    headers = ("ID", "Service", "Team", "Assignee", "U/I->Priority", "Resolution", "Lane", "MinConf")
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers)); print(fmt.format(*("-" * w for w in widths)))
    for r in rows:
        print(fmt.format(*r))
    lanes = {}
    for run in runs:
        lanes[run.lane or run.status] = lanes.get(run.lane or run.status, 0) + 1
    print(f"\nLanes: {lanes}")


def cmd_triage(args: argparse.Namespace) -> None:
    """Triage a challenge-format file (default: the challenge glob) and write the filled
    file plus the decisions sidecar."""
    from triage.catalog import load_service_cards
    from triage.data import find_challenge_path, load_challenge_raw
    from triage.output import build_output
    from triage.retrieval import Retriever
    from triage.schemas import DecisionsFile
    from triage.triage import run_batch, triage_versions, utc_now

    path = Path(args.file) if args.file else find_challenge_path()
    raw = load_challenge_raw(path)
    if args.limit:
        raw = {**raw, "records": raw["records"][: args.limit]}
    catalog, cards = load_catalog(), load_service_cards()
    retriever = Retriever(catalog, cards)
    run_id, versions, created = new_run_id(), triage_versions(), utc_now()
    items = list(zip(_ticket_ids(raw["records"]), raw["records"]))
    runs = run_batch(items, run_id, retriever, cards, catalog, versions, n_samples=args.samples,
                     evidence=args.evidence, comment=args.comment)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{path.stem}_triaged_{run_id}.json"
    out_path.write_text(json.dumps(build_output(raw, runs), indent=2, ensure_ascii=False), encoding="utf-8")
    sidecar = out_dir / f"decisions_{run_id}.json"
    sidecar.write_text(DecisionsFile(run_id=run_id, created_at=created, source_file=path.name, versions=versions,
                                     runs=runs).model_dump_json(indent=1), encoding="utf-8")
    print_run_summary(runs)
    print(f"Versions: {versions.model_dump()}")
    print(f"Saved {out_path} and {sidecar}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog", help="mine the catalog from training data").set_defaults(func=cmd_catalog)
    cards = sub.add_parser("cards", help="generate service-card scope lines with the LLM")
    cards.add_argument("--force", action="store_true", help="overwrite an existing service_cards.json")
    cards.add_argument("--model", default=None, help="override TRIAGE_MODEL")
    cards.set_defaults(func=cmd_cards)
    sample = sub.add_parser("sample", help="triage labelled hand-written tickets and compare")
    sample.add_argument("--file", default="eval/handwritten.json")
    sample.add_argument("--samples", type=int, default=config.SELF_CONSISTENCY_N, help="self-consistency samples")
    sample.add_argument("--evidence", action="store_true", help="also run the evidence-quote call")
    sample.set_defaults(func=cmd_sample)
    tri = sub.add_parser("triage", help="triage a challenge-format file (default: the challenge)")
    tri.add_argument("--file", default=None, help="challenge-format JSON (default: the challenge glob)")
    tri.add_argument("--out", default=str(config.OUTPUTS_DIR))
    tri.add_argument("--limit", type=int, default=0, help="only the first N records")
    tri.add_argument("--samples", type=int, default=config.SELF_CONSISTENCY_N)
    tri.add_argument("--no-evidence", dest="evidence", action="store_false", help="skip the evidence-quote call")
    tri.add_argument("--no-comment", dest="comment", action="store_false", help="skip the resolution comment")
    tri.set_defaults(func=cmd_triage, evidence=config.EVIDENCE_ENABLED, comment=config.COMMENT_ENABLED)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
