"""Loading of the training and challenge files."""
import json
from pathlib import Path

from triage import config


def load_training(path: Path = config.TRAINING_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        records = json.load(f)
    if not isinstance(records, list):
        raise ValueError(f"expected a JSON list in {path}")
    return records


def find_challenge_path(root: Path = config.ROOT) -> Path:
    matches = sorted(root.glob(config.CHALLENGE_GLOB))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"expected exactly one {config.CHALLENGE_GLOB} in {root}, found {len(matches)}"
        )
    return matches[0]


def load_challenge_raw(path: Path | None = None) -> dict:
    """The full challenge object (metadata + records), for writing output back."""
    with open(path or find_challenge_path(), encoding="utf-8") as f:
        return json.load(f)


def load_challenge(path: Path | None = None) -> list[dict]:
    return load_challenge_raw(path)["records"]
