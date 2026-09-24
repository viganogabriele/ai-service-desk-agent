"""Priority = matrix(Urgency, Impact). Never predicted directly."""
from triage import config


def normalize_level(level: str) -> str:
    """Map any casing ('low', 'LOW') to the canonical Title Case level."""
    canon = str(level).strip().title()
    if canon not in config.LEVELS:
        raise ValueError(f"unknown level {level!r}; expected one of {config.LEVELS}")
    return canon


def compute_priority(urgency: str, impact: str) -> str:
    return config.PRIORITY_MATRIX[normalize_level(urgency)][normalize_level(impact)]
