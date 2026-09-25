"""Generate a labelled dev set of challenge-style tickets with the LLM.

Built only from the KB (training-mined patterns + reviewed service cards) and generic
domain knowledge - never from the challenge file. Labels come from the source:
service/assignee from the pattern (or the card for services without patterns),
resolution from the scenario; work type/urgency/impact are the generator's own and soft.

    python eval/make_devset.py            # writes eval/devset.json (cached, reproducible)
"""
import argparse
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from triage import config  # noqa: E402
from triage.catalog import load_catalog, load_service_cards  # noqa: E402
from triage.generate import (  # noqa: E402
    ENTITIES, NONSENSE_PROMPT, DevTicket, adjacent, card, generate, names_service, request_type, scenario_prompt,
)
from triage.priority import compute_priority  # noqa: E402

OUT_PATH = config.ROOT / "eval" / "devset.json"


def _record(tid: str, t: DevTicket, reported: str, rng: random.Random, label: dict, names_service: bool,
            misleading_title: bool = False) -> dict:
    u, i = rng.choice(config.LEVELS), rng.choice(config.LEVELS)  # reported levels are unreliable, like the challenge
    authors = ["alex.meier", "sofia.lind", "marc.dupont", "eva.keller", "jonas.berg"]
    return {
        "id": tid,
        "Work type": rng.choice(config.WORK_TYPES),
        "Request type": request_type(random.Random(f"request-type-{tid}"), label["kind"], t.work_type, misleading_title),
        "Summary": t.summary,
        "Description": t.description,
        "Affected Business or IT Services": [reported],
        "Business Entity": [rng.choice(ENTITIES)],
        "Business Critical for Entity": [],
        "Service Team(s)": [],
        "Assignee": None,
        "Priority": compute_priority(u, i),
        "Urgency": u,
        "Impact": i,
        "Resolution": None,
        "Status": "open",
        "All Comments": [f"{rng.choice(authors)}@intcom.com: {c}" for c in t.comments],
        "_label": {**label, "work_type": t.work_type, "urgency": t.urgency, "impact": t.impact,
                   "names_service": names_service, "misleading_title": misleading_title},
    }


def build_devset(catalog: dict, cards: dict, seed: int = 7, checkpoint: Path | None = None,
                 concurrency: int = 8) -> list[dict]:
    """Every ticket draws from its own RNG (seeded by its id), so editing one scenario
    never changes the generation seeds - and the cache hits - of the others."""
    fallback = {s: v["assignee"] for s, v in catalog["fallback_assignee"].items()}
    specs = []
    saved = json.loads(checkpoint.read_text(encoding="utf-8")) if checkpoint and checkpoint.exists() else []

    def add(kind, svc, reported, label, pattern=None, misleading=False, prompt=None, angle=None):
        tid = f"D{len(specs) + 1:03d}"
        specs.append((tid, kind, svc, reported, label, pattern, misleading, prompt, angle))

    def generate_one(spec):
        tid, kind, svc, reported, label, pattern, misleading, prompt, angle = spec
        rng = random.Random(f"{seed}-{tid}")
        user = prompt or scenario_prompt(kind, svc, card(cards, svc), pattern, misleading)
        if angle:
            user += f"\nMake this scenario distinct: {angle}."
        avoid = [s for s in (svc, reported) if s and s != config.CATCH_ALL_SERVICE and kind != "nonsense"]
        t = generate(user, rng, avoid)
        return _record(tid, t, reported, rng, {**label, "kind": kind}, bool(svc) and names_service(t, svc),
                       misleading)

    # Variant 0 of each scenario: wrong (adjacent) reported service + a title misleading about the
    # work type, with an accurate description (as in the README). Variant 1: plain.
    for p in catalog["patterns"]:
        svc = p["service"]
        label = {"service": svc, "resolution": "done", "assignee": p["resolver"], "assignee_source": "pattern_match",
                 "source_pattern": p["id"]}
        pick = random.Random(f"{seed}-reported-{p['id']}")
        add("pattern", svc, adjacent(pick, svc, catalog), label, pattern=p, misleading=True)
        add("pattern", svc, pick.choice([svc, config.CATCH_ALL_SERVICE]), label, pattern=p)

    no_pattern = [s for s in config.SERVICES if s not in catalog["resolvers_by_service"] and s != config.CATCH_ALL_SERVICE]
    for svc in no_pattern:
        label = {"service": svc, "resolution": "done", "assignee": fallback[svc], "assignee_source": "fallback",
                 "source_pattern": None}
        pick = random.Random(f"{seed}-reported-{svc}")
        add("card", svc, adjacent(pick, svc, catalog), label, misleading=True)
        add("card", svc, pick.choice([svc, config.CATCH_ALL_SERVICE]), label)

    pick = random.Random(f"{seed}-special")
    candidates = [s for s in config.SERVICES if s != config.CATCH_ALL_SERVICE]
    for kind, resolution in (("clarification", "clarification"), ("cannot_reproduce", "cannot reproduce")):
        for svc in pick.sample(candidates, 3):
            add(kind, svc, adjacent(pick, svc, catalog),
                {"service": svc, "resolution": resolution, "assignee": None, "assignee_source": None, "source_pattern": None})
    for _ in range(3):
        add("nonsense", None, pick.choice(config.SERVICES),
            {"service": config.CATCH_ALL_SERVICE, "resolution": "cancelled", "assignee": None, "assignee_source": None,
             "source_pattern": None}, prompt=NONSENSE_PROMPT)

    # Additional independent phrasings of known resolution patterns and card scopes.
    angles = ("an individual user's early-morning workflow", "a same-day cut-off affecting several funds",
              "an overnight batch with a clear error message", "a handoff between two offices")
    for p in catalog["patterns"]:
        svc = p["service"]
        label = {"service": svc, "resolution": "done", "assignee": p["resolver"],
                 "assignee_source": "pattern_match", "source_pattern": p["id"]}
        pick = random.Random(f"{seed}-extra-{p['id']}")
        for variant in range(2):
            add("pattern", svc, adjacent(pick, svc, catalog) if variant == 0 else svc,
                label, pattern=p, misleading=variant == 0, angle=angles[variant])
    for svc in no_pattern:
        label = {"service": svc, "resolution": "done", "assignee": fallback[svc],
                 "assignee_source": "fallback", "source_pattern": None}
        pick = random.Random(f"{seed}-extra-{svc}")
        for variant in range(2):
            add("card", svc, adjacent(pick, svc, catalog) if variant == 0 else svc,
                label, misleading=variant == 0, angle=angles[variant + 2])

    # Six more cases for each named service: actionable issues, incomplete requests,
    # and alerts that cleared. Their labels are grounded in the scenario rather than
    # in the reported service or the generator's wording.
    for svc in candidates:
        pick = random.Random(f"{seed}-coverage-{svc}")
        for variant, kind in enumerate(("card", "card", "clarification", "clarification",
                                         "cannot_reproduce", "cannot_reproduce")):
            resolution = {"card": "done", "clarification": "clarification",
                          "cannot_reproduce": "cannot reproduce"}[kind]
            label = {"service": svc, "resolution": resolution, "assignee": None,
                     "assignee_source": None, "source_pattern": None}
            reported = adjacent(pick, svc, catalog) if variant % 2 == 0 else svc
            add(kind, svc, reported, label, misleading=variant == 0,
                angle=f"{angles[variant % len(angles)]}; variant {variant + 1} for {svc}")
    for variant in range(7):
        add("nonsense", None, pick.choice(config.SERVICES),
            {"service": config.CATCH_ALL_SERVICE, "resolution": "cancelled", "assignee": None,
             "assignee_source": None, "source_pattern": None},
            prompt=NONSENSE_PROMPT, angle=f"accidental message style {variant + 1}")
    if len(saved) > len(specs):
        raise ValueError("Checkpoint has more tickets than the scenario plan")
    for i, record in enumerate(saved):
        if record["id"] != specs[i][0]:
            raise ValueError(f"Checkpoint has an unexpected ID at {specs[i][0]}")
    records = list(saved)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        while len(records) < len(specs):
            batch = specs[len(records):len(records) + concurrency]
            records.extend(pool.map(generate_one, batch))
            if checkpoint:
                checkpoint.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"Generated {len(records)}/{len(specs)} tickets", flush=True)
    return records


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", default="eval/devset.partial.json")
    ap.add_argument("--concurrency", type=int, default=8)
    args = ap.parse_args()
    catalog, cards = load_catalog(), load_service_cards()
    checkpoint = config.ROOT / args.checkpoint
    records = build_devset(catalog, cards, checkpoint=checkpoint, concurrency=args.concurrency)
    OUT_PATH.write_text(json.dumps({
        "note": "LLM-generated dev set (eval/make_devset.py) from the KB only, never from the challenge. "
                "Service and resolution labels follow the source scenario; pattern-derived assignees are firm, "
                "fallback assignees and generator-provided work_type/urgency/impact are soft. "
                "Optimistic: the same model writes and solves these tickets.",
        "model": config.TRIAGE_MODEL,
        "reasoning_effort": config.OPENAI_REASONING_EFFORT if config.LLM_PROVIDER == "openai" else None,
        "reasoning_mode": config.OPENAI_REASONING_MODE if config.LLM_PROVIDER == "openai" else None,
        "records": records,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    checkpoint.unlink(missing_ok=True)
    kinds = {}
    for r in records:
        kinds[r["_label"]["kind"]] = kinds.get(r["_label"]["kind"], 0) + 1
    leaks = sum(r["_label"]["names_service"] for r in records)
    print(f"Wrote {OUT_PATH.relative_to(config.ROOT)}: {len(records)} tickets {kinds}; {leaks} still name their service")


if __name__ == "__main__":
    main()
