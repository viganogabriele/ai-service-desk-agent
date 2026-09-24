"""Write predictions back into the challenge structure without altering its shape."""
import copy

from triage import config


def fill_challenge(raw: dict, predictions: list[dict]) -> dict:
    """Return a copy of `raw` with each record updated from the aligned prediction dict.

    Only fields in config.PREDICTED_FIELDS may be written, and only keys that
    already exist in the record, so the structure is preserved exactly.
    """
    records = raw["records"]
    if len(predictions) != len(records):
        raise ValueError(f"{len(predictions)} predictions for {len(records)} records")
    out = copy.deepcopy(raw)
    for record, pred in zip(out["records"], predictions):
        for field, value in pred.items():
            if field not in config.PREDICTED_FIELDS:
                raise KeyError(f"field {field!r} is not a predicted field")
            if field not in record:
                raise KeyError(f"field {field!r} is not in the challenge record")
            record[field] = value
    return out


def predictions_from_run(run) -> dict:
    """Challenge-field values from a completed run's effective decisions. Service and
    team are lists in the challenge structure; Status becomes done once a resolution
    is assigned. The resolution comment is appended by build_output."""
    if run.status != "completed":
        return {}
    pred = {}
    for field, name in config.DECISION_FIELDS.items():
        value = run.decisions[field].effective_value
        pred[name] = [value] if name in ("Affected Business or IT Services", "Service Team(s)") else value
    if pred.get("Resolution"):
        pred["Status"] = "done"
    return pred


def build_output(raw: dict, runs: list) -> dict:
    """The challenge structure with every completed run's predictions filled in; failed
    runs leave their record untouched."""
    predictions = []
    for record, run in zip(raw["records"], runs):
        pred = predictions_from_run(run)
        if pred and run.resolution_comment is not None:
            pred["All Comments"] = list(record.get("All Comments") or []) + [run.resolution_comment.text]
        predictions.append(pred)
    return fill_challenge(raw, predictions)
