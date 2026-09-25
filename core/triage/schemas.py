"""Pydantic models: LLM outputs, and the decision / resolution-comment / run records
of docs/CORE_API.md §3-§4 (the CLI sidecar and the future API share them)."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from triage import config

Level = Literal[tuple(config.LEVELS)]
Service = Literal[tuple(config.SERVICES)]
WorkType = Literal[tuple(config.WORK_TYPES)]
Resolution = Literal[tuple(config.RESOLUTIONS)]
Source = Literal["rule", "pattern_match", "ai_judgment", "fallback"]
DecisionField = Literal[tuple(config.DECISION_FIELDS)]
Flag = Literal[
    "weak_match", "generic_bucket", "fallback_assignee",
    "downgrade_on_critical", "service_changed", "work_type_changed",
    "stale_comment", "forced_inconsistent", "conflict_with_override",
    "assignee_needs_review", "capped_by_resolution",
]
Lane = Literal["auto_applied", "needs_review", "human_only"]

FILLER_PHRASES = ("problem fixed", "issue fixed", "resolution recorded")

# Which sources each field may carry (CORE_API §4 "source").
FIELD_SOURCES = {
    "work_type": {"ai_judgment"}, "service": {"ai_judgment"}, "urgency": {"ai_judgment"},
    "impact": {"ai_judgment"}, "resolution": {"ai_judgment"},
    "team": {"rule"}, "priority": {"rule"},
    "assignee": {"pattern_match", "fallback"},
}
FIELD_VOCAB = {
    "work_type": config.WORK_TYPES, "service": config.SERVICES, "urgency": config.LEVELS,
    "impact": config.LEVELS, "priority": config.LEVELS, "resolution": config.RESOLUTIONS,
}


def _check_filler(body: str) -> None:
    body = body.strip().lower()
    if not body or any(body.startswith(p) for p in FILLER_PHRASES):
        raise ValueError("generic filler is not a resolution")


# --- LLM outputs ---------------------------------------------------------------

Quotes = list[str]


class TriageEvidence(BaseModel):
    """Structured output of the evidence call: short verbatim ticket quotes per field."""

    model_config = ConfigDict(extra="forbid")

    work_type: Quotes = Field(default_factory=list, max_length=3)
    service: Quotes = Field(default_factory=list, max_length=3)
    urgency: Quotes = Field(default_factory=list, max_length=3)
    impact: Quotes = Field(default_factory=list, max_length=3)
    resolution: Quotes = Field(default_factory=list, max_length=3)


class TriageSample(BaseModel):
    """Decision fields only: the fast self-consistency samples (no reasoning)."""

    model_config = ConfigDict(extra="forbid")

    work_type: WorkType
    service: Service
    urgency: Level
    impact: Level
    resolution: Resolution


class TriageOutput(BaseModel):
    """Structured output of the final (temperature-0) triage call. `reasoning` first."""

    model_config = ConfigDict(extra="forbid")

    reasoning: str = Field(min_length=1)
    work_type: WorkType
    service: Service
    urgency: Level
    impact: Level
    resolution: Resolution


class ResolutionComment(BaseModel):
    """Structured output of the resolution-comment LLM call."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=len(config.RESOLUTION_PREFIX) + 1)

    @field_validator("text")
    @classmethod
    def _check_text(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(config.RESOLUTION_PREFIX):
            raise ValueError(f"must start with {config.RESOLUTION_PREFIX!r}")
        _check_filler(v[len(config.RESOLUTION_PREFIX):])
        return v


class ServiceScope(BaseModel):
    """Structured output of the one-off service-card scope call."""

    model_config = ConfigDict(extra="forbid")

    scope: str = Field(min_length=10, max_length=400)
    boundary: str | None = None

    @field_validator("scope", "boundary")
    @classmethod
    def _one_line(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = " ".join(v.split())
        if len(v.split()) > 40:
            raise ValueError("must be one line of at most 40 words")
        return v or None


# --- Decision record (CORE_API §4) -------------------------------------------------

class TicketSpan(BaseModel):
    """Character span in a ticket field; `field` is a challenge field name, with an
    index for comments (e.g. "All Comments[1]")."""

    model_config = ConfigDict(extra="forbid")

    field: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def _ordered(self):
        if self.end - self.start != len(self.text):
            raise ValueError("end - start must equal len(text)")
        return self


class PatternEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern_id: str
    similarity: float
    service: Service
    resolver: str


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_spans: list[TicketSpan] = Field(default_factory=list)
    patterns: list[PatternEvidence] = Field(default_factory=list)
    service_card: Service | None = None


class Alternative(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str
    score: float = Field(ge=0.0, le=1.0)
    source: Source


class DecisionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: DecisionField
    value: str | None
    original_value: str | None = None
    effective_value: str | None
    source: Source
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_signals: dict[str, float] = Field(default_factory=dict)
    reason: str = Field(min_length=1)
    rule_trace: str | None = None
    evidence: Evidence = Field(default_factory=Evidence)
    alternatives: list[Alternative] = Field(default_factory=list)
    flags: list[Flag] = Field(default_factory=list)
    pinned: bool = False

    @model_validator(mode="after")
    def _consistent(self):
        if self.source not in FIELD_SOURCES[self.field]:
            raise ValueError(f"{self.field} cannot have source {self.source}")
        if (self.source == "rule") != (self.rule_trace is not None):
            raise ValueError("rule_trace is required for rule fields and only for them")
        vocab = FIELD_VOCAB.get(self.field)
        if vocab and self.value is not None and self.value not in vocab:
            raise ValueError(f"{self.value!r} is not a valid {self.field}")
        if not self.pinned and self.effective_value != self.value:
            raise ValueError("effective_value must equal value unless pinned")
        return self


# --- Resolution comment record (CORE_API §4) ---------------------------------------

_COMMENT_RE = re.compile(r"^(\S+): (Resolution: .+)$", re.S)


class CommentSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    origin: Literal["ticket", "exemplar", "generated"]


class ResolutionCommentRecord(BaseModel):
    """`text` is the full "<assignee>: Resolution: …" string; `segments`, when present,
    concatenate to the part after "<assignee>: "."""

    model_config = ConfigDict(extra="forbid")

    text: str
    segments: list[CommentSegment] = Field(default_factory=list)
    exemplar_pattern_ids: list[str] = Field(default_factory=list)
    unsupported_specifics: list[str] = Field(default_factory=list)
    stale: bool = False
    edited_by: str | None = None

    @model_validator(mode="after")
    def _check(self):
        m = _COMMENT_RE.match(self.text)
        if not m:
            raise ValueError('text must look like "<assignee>: Resolution: …"')
        _check_filler(m.group(2)[len(config.RESOLUTION_PREFIX):])
        if self.segments and "".join(s.text for s in self.segments) != m.group(2):
            raise ValueError("segments must concatenate to the comment after the assignee prefix")
        return self


# --- Run record (CORE_API §3) ------------------------------------------------------

class RunVersions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    prompt: str
    kb: str
    policy: str


class RunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    ticket_id: str
    snapshot_id: str
    mode: Literal["live", "shadow"] = "live"
    status: Literal["queued", "running", "completed", "failed"]
    versions: RunVersions
    started_at: str
    completed_at: str | None = None
    error: str | None = None
    decisions: dict[DecisionField, DecisionRecord] = Field(default_factory=dict)
    resolution_comment: ResolutionCommentRecord | None = None
    lane: Lane | None = None
    lane_reasons: list[str] = Field(default_factory=list)
    audit_sampled: bool = False
    reasoning: str | None = None  # the LLM's triage reasoning, for the "why" view

    @model_validator(mode="after")
    def _keys(self):
        for key, rec in self.decisions.items():
            if key != rec.field:
                raise ValueError(f"decision key {key} != record field {rec.field}")
        return self


class DecisionsFile(BaseModel):
    """Top level of outputs/decisions_<runid>.json."""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    created_at: str
    source_file: str
    versions: RunVersions
    runs: list[RunRecord]
