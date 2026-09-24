"""Confidence from observable signals (docs/CORE_API.md §5). Never from the LLM's own rating.

Signals are kept raw in `confidence_signals`; `combine` normalises them to [0, 1] and
takes the weighted mean of those present. Weights and scales live in config.py."""
from collections import Counter

from triage import config


def self_consistency(final: str, samples: list[str]) -> float | None:
    """Share of samples that agree with the final value; None without samples."""
    return sum(s == final for s in samples) / len(samples) if samples else None


def margin(scores: list[float]) -> float:
    """Gap between the best and the second-best score (0 if fewer than two)."""
    top = sorted(scores, reverse=True)
    return top[0] - top[1] if len(top) > 1 else 0.0


def _normalise(name: str, value: float) -> float:
    if name == "retrieval_margin":
        return min(1.0, max(0.0, value / config.RETRIEVAL_MARGIN_SCALE))
    if name == "retrieval_similarity":
        lo = config.ASSIGNEE_SIM_THRESHOLD
        return min(1.0, max(0.0, (value - lo) / (1.0 - lo)))
    return min(1.0, max(0.0, value))


def combine(signals: dict[str, float], weights: dict[str, float] = config.CONFIDENCE_WEIGHTS) -> float:
    present = {k: v for k, v in signals.items() if v is not None and weights.get(k, 0) > 0}
    if not present:
        return config.NO_SIGNAL_CONFIDENCE
    total = sum(weights[k] for k in present)
    return round(sum(weights[k] * _normalise(k, v) for k, v in present.items()) / total, 4)


def ai_field_signals(field: str, final: str, samples: list[str], context: dict) -> dict[str, float]:
    """Signals for an AI-judged field. `context` carries the retrieval results and the
    Request-type prior: keys card_scores (service -> cosine), top_pattern (dict | None),
    prior (work type | None)."""
    signals: dict[str, float] = {}
    sc = self_consistency(final, samples)
    if sc is not None:
        signals["self_consistency"] = sc
    if field == "service":
        cards = sorted(context["card_scores"].items(), key=lambda kv: -kv[1])
        signals["card_agreement"] = float(cards[0][0] == final)
        signals["retrieval_margin"] = round(margin([s for _, s in cards]), 4)
        top = context.get("top_pattern")
        if top and top["score"] >= config.PATTERN_AGREEMENT_MIN_SIM:
            signals["pattern_agreement"] = float(top["service"] == final)
    if field == "work_type" and context.get("prior"):
        signals["prior_agreement"] = float(context["prior"] == final)
    return signals


def vote_alternatives(final: str, samples: list[str]) -> list[tuple[str, float]]:
    """Sampled values other than the final one, ranked by vote share."""
    votes = Counter(s for s in samples if s != final)
    return [(v, n / len(samples)) for v, n in votes.most_common()]


def pattern_assignee_signals(similarity: float, runner_up_similarity: float | None) -> dict[str, float]:
    signals = {"retrieval_similarity": round(similarity, 4)}
    if runner_up_similarity is not None:
        signals["retrieval_margin"] = round(similarity - runner_up_similarity, 4)
    return signals


def assignee_confidence(source: str, signals: dict[str, float], service_confidence: float) -> float:
    """The assignee can be no surer than the service it was routed from; a fallback
    never exceeds FALLBACK_CONFIDENCE."""
    if source == "fallback":
        return min(config.FALLBACK_CONFIDENCE, service_confidence)
    return min(combine(signals), service_confidence)


def rule_confidence(input_confidences: list[float]) -> float:
    """Rule fields inherit the minimum confidence of their inputs."""
    return min(input_confidences)
