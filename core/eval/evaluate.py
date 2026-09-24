"""Per-field accuracy on a labelled dev file (default: the generated dev set).

    python eval/evaluate.py [--file eval/devset.json] [--samples 3] [--evidence]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from triage import config  # noqa: E402
from triage.evaluation import evaluate_file  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", default="eval/devset.json")
    ap.add_argument("--samples", type=int, default=config.SELF_CONSISTENCY_N)
    ap.add_argument("--evidence", action="store_true")
    ap.add_argument("--comment", action="store_true", help="generate the draft resolution comment")
    ap.add_argument("--concurrency", type=int, default=config.LLM_CONCURRENCY)
    ap.add_argument("--limit", type=int, default=None, help="run only the first N labelled tickets")
    args = ap.parse_args()
    decisions, metrics, report = evaluate_file(args.file, n_samples=args.samples, evidence=args.evidence,
                                               comment=args.comment, concurrency=args.concurrency,
                                               limit=args.limit)
    print(report)
    config.OUTPUTS_DIR.mkdir(exist_ok=True)
    out = config.OUTPUTS_DIR / f"decisions_{decisions.run_id}.json"
    out.write_text(decisions.model_dump_json(indent=1), encoding="utf-8")
    report_path = config.OUTPUTS_DIR / f"evaluation_{decisions.run_id}.json"
    report_path.write_text(json.dumps({
        "file": args.file, "provider": config.LLM_PROVIDER, "versions": decisions.versions.model_dump(),
        "settings": {"samples": args.samples, "evidence": args.evidence, "comment": args.comment,
                     "concurrency": args.concurrency, "limit": args.limit},
        "report": report, "metrics": metrics,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Versions: {decisions.versions.model_dump()}\nSaved {out.relative_to(config.ROOT)} and "
          f"{report_path.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
