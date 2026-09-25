"""Priority = matrix(Urgency, Impact). Never predicted directly. Plus the resolution caps on
Urgency and Impact that feed it."""
from triage import config


def normalize_level(level: str) -> str:
    """Map any casing ('low', 'LOW') to the canonical Title Case level."""
    canon = str(level).strip().title()
    if canon not in config.LEVELS:
        raise ValueError(f"unknown level {level!r}; expected one of {config.LEVELS}")
    return canon


def compute_priority(urgency: str, impact: str) -> str:
    return config.PRIORITY_MATRIX[normalize_level(urgency)][normalize_level(impact)]


def severity_cap(field: str, level: str, resolution: str) -> str:
    """`level` lowered to the ceiling the resolution status allows for urgency / impact
    (config.RESOLUTION_SEVERITY_CAPS); unchanged when it is already at or below it."""
    ceiling = config.RESOLUTION_SEVERITY_CAPS.get(resolution, {}).get(field)
    level = normalize_level(level)
    if ceiling and config.LEVELS.index(level) < config.LEVELS.index(ceiling):
        return ceiling
    return level
