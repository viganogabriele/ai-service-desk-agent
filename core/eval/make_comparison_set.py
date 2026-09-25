"""Combine the independent handwritten and generated tickets into one labelled file."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    handwritten_path = ROOT / "handwritten.json"
    generated_path = ROOT / "devset.json"
    handwritten = json.loads(handwritten_path.read_text(encoding="utf-8"))["records"]
    generated_file = json.loads(generated_path.read_text(encoding="utf-8"))
    generated = generated_file["records"]
    generation = {"model": generated_file["model"],
                  "reasoning_effort": generated_file.get("reasoning_effort"),
                  "reasoning_mode": generated_file.get("reasoning_mode")}
    if generation != {"model": "gpt-6-luna", "reasoning_effort": "medium", "reasoning_mode": "standard"}:
        raise ValueError(f"Unexpected generation settings: {generation}")
    records = handwritten + generated
    ids = [record["id"] for record in records]
    if len(records) != 300 or len(set(ids)) != 300:
        raise ValueError(f"Expected 300 unique tickets; found {len(records)} tickets and {len(set(ids))} IDs")
    output = {
        "note": "Frozen comparison set: 50 independently handwritten and 250 GPT-6 Luna generated tickets. "
                "Do not revise after evaluating models against it.",
        "sources": {"handwritten": len(handwritten), "generated": len(generated)},
        "generation": generation,
        "records": records,
    }
    path = ROOT / "comparison_300.json"
    path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"Wrote {path}: 300 cases; SHA-256 {digest}")


if __name__ == "__main__":
    main()
