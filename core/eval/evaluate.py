"""Per-field accuracy on a labelled dev file (default: the generated dev set).

    python eval/evaluate.py [--file eval/devset.json] [--samples 3] [--evidence]
"""
import argparse
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
    args = ap.parse_args()
    decisions, _, report = evaluate_file(args.file, n_samples=args.samples, evidence=args.evidence)
    print(report)
    config.OUTPUTS_DIR.mkdir(exist_ok=True)
    out = config.OUTPUTS_DIR / f"decisions_{decisions.run_id}.json"
    out.write_text(decisions.model_dump_json(indent=1), encoding="utf-8")
    print(f"Versions: {decisions.versions.model_dump()}\nSaved {out.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
