"""Central configuration: paths, model, thresholds, vocabularies, README tables."""
import os
from pathlib import Path

# --- Paths -------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
TRAINING_PATH = ROOT / "jira_first_20000_requested_fields_synthetic.json"
# The real filename differs from the one named in the README, so glob for it.
CHALLENGE_GLOB = "jira_hackathon_*challenge*.json"
ARTIFACTS_DIR = ROOT / "artifacts"
OUTPUTS_DIR = ROOT / "outputs"
CATALOG_VERSION = 1  # schema version of catalog.json
# One directory per knowledge-base version (CORE_API §10); content is immutable once published.
KB_VERSION = os.getenv("KB_VERSION", "v1")
KB_DIR = ARTIFACTS_DIR / "kb" / KB_VERSION
KB_MANIFEST_PATH = KB_DIR / "manifest.json"
CATALOG_PATH = KB_DIR / "catalog.json"
SERVICE_CARDS_PATH = KB_DIR / "service_cards.json"
EMBEDDINGS_PATH = KB_DIR / "embeddings.npz"
LLM_CACHE_DIR = ARTIFACTS_DIR / "llm_cache"

# --- Models ------------------------------------------------------------------
# Self-hosted Ollama on the team Mac mini, reached over Tailscale (not a cloud LLM).
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://100.87.163.97:11434")
SWISSCOM_API_URL = os.getenv(
    "SWISSCOM_API_URL",
    "https://api.swisscom.com/products/swiss-ai-weeks/apertus-1.5-70b/v1/chat/completions",
)
OPENAI_API_URL = os.getenv("OPENAI_API_URL", "https://api.openai.com/v1/responses")
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "high")
OPENAI_REASONING_MODE = os.getenv("OPENAI_REASONING_MODE", "standard")
OPENAI_TIMEOUT_S = 180
# AGENTS.md default is qwen2.5:14b; the Mac mini currently runs the 7b variant.
TRIAGE_MODEL = os.getenv("TRIAGE_MODEL", "qwen2.5:7b")
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
TEMPERATURE = 0
SEED = 0
NUM_CTX = 8192  # Ollama's default (4096) would silently truncate the triage prompt.
KEEP_ALIVE = "30m"
LLM_TIMEOUT_S = 90
LLM_MAX_RETRIES = 2  # extra attempts after a validation failure, truncation or timeout
# Output cap per structured call (Ollama num_predict). Without it a JSON-grammar call can
# run away (seen: two calls hung for ~37 min). Not part of the cache key.
MAX_TOKENS = {"TriageOutput": 400, "TriageSample": 80, "TriageEvidence": 400, "ServiceScope": 200,
              "DevTicket": 700, "ResolutionComment": 200}
MAX_TOKENS_DEFAULT = 600

# The Mac mini's Ollama serves one request at a time (measured); 2 client threads
# overlap client-side work and keep the server busy. Raise with OLLAMA_NUM_PARALLEL.
LLM_CONCURRENCY = int(os.getenv("LLM_CONCURRENCY", "2"))
# Separate evidence-quote call (~5 s/ticket). Off for evaluation runs.
EVIDENCE_ENABLED = True
# Resolution-comment call (~4 s/ticket). Off for evaluation runs.
COMMENT_ENABLED = True

# --- Retrieval ---------------------------------------------------------------
TOP_K_PATTERNS = 3
TOP_K_CARDS = 3

# --- Thresholds --------------------------------------------------------------
# Similarity at which a pattern starts to count as evidence for a resolver. It only scales
# the retrieval_similarity confidence signal; it no longer gates the assignee, which follows
# the service (see decisions.assignee_decision).
ASSIGNEE_SIM_THRESHOLD = 0.60

# --- Vocabularies ------------------------------------------------------------
LEVELS = ["Highest", "High", "Medium", "Low", "Lowest"]
WORK_TYPES = ["Incident", "Service Request"]
RESOLUTIONS = ["done", "cancelled", "clarification", "cannot reproduce"]
RESOLUTION_PREFIX = "Resolution: "
CATCH_ALL_SERVICE = "Emailed Support Tickets"

# Assumed mapping of Jira levels onto the README matrix labels (see AGENTS.md).
URGENCY_LABELS = {
    "Highest": "Critical",
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
    "Lowest": "Lowest",
}
IMPACT_LABELS = {
    "Highest": "Major / Widespread",
    "High": "Significant / Large",
    "Medium": "Moderate / Limited",
    "Low": "Minor / Localized",
    "Lowest": "No direct impact / Information",
}

# README priority matrix: rows = Urgency, columns = Impact (Highest -> Lowest).
_MATRIX_ROWS = {
    "Highest": ["Highest", "Highest", "High", "Medium", "Medium"],
    "High": ["Highest", "High", "High", "Medium", "Low"],
    "Medium": ["High", "High", "Medium", "Low", "Low"],
    "Low": ["Medium", "Medium", "Low", "Low", "Lowest"],
    "Lowest": ["Medium", "Low", "Low", "Lowest", "Lowest"],
}
PRIORITY_MATRIX = {u: dict(zip(LEVELS, row)) for u, row in _MATRIX_ROWS.items()}

# README critical-service list (the 20 services, in README order).
CRITICALITY = {
    "Trading Platform": "Critical",
    "Order Management": "Critical",
    "Trade Matching": "Critical",
    "Securities Settlement": "Critical",
    "Corporate Actions": "Critical",
    "Fund Pricing": "Critical",
    "NAV Calculation": "Critical",
    "Portfolio Accounting": "Critical",
    "Cash Management": "Critical",
    "Risk & Compliance Monitoring": "Critical",
    "Regulatory Reporting": "Critical",
    "SimCorp Dimension": "Critical",
    "Rimes Data Feed": "Critical",
    "Client Reporting": "Critical",
    "Tax Reporting": "Non-Critical",
    "CRM & Client Portal": "Non-Critical",
    "Identity & Access Management": "Non-Critical",
    "SharePoint & File Storage": "Non-Critical",
    "Outlook & Email": "Non-Critical",
    "Emailed Support Tickets": "Non-Critical",
}
SERVICES = list(CRITICALITY)

# Request type -> Work type prior (a hint, not a rule). None = decide from content.
REQUEST_TYPE_PRIOR = {
    "Machine Created Alert": "Incident",
    "Human Created Incident": "Incident",
    "Misclassified Service Request Title": "Incident",
    "New License": "Service Request",
    "Access to a Service": "Service Request",
    "Access Removal": "Service Request",
    "Misclassified Incident Title": "Service Request",
    "Email / 3rd Party Warning": None,
    "Nonsense / Unclear Input": None,
}

# Fields the pipeline is allowed to write into a challenge record.
PREDICTED_FIELDS = [
    "Work type",
    "Affected Business or IT Services",
    "Service Team(s)",
    "Assignee",
    "Urgency",
    "Impact",
    "Priority",
    "Resolution",
    "Status",
    "All Comments",
]

# README Urgency / Impact definitions (verbatim), keyed by Jira level.
URGENCY_DEFINITIONS = {
    "Highest": "Immediate action required (prevent/fix regulatory breach, security compromise, or major outage). No workaround available.",
    "High": "Rapid resolution needed within hours to avoid escalation. Workaround available but difficult/time-consuming.",
    "Medium": "Important to fix soon; no immediate operational/regulatory threat. Easy workaround available.",
    "Low": "Handled in normal workflow without urgent escalation.",
    "Lowest": "Routine/informational with no effect on operations or compliance.",
}
IMPACT_DEFINITIONS = {
    "Highest": "Full unavailability to critical IT services supporting key operations (> 2 hrs downtime)",
    "High": "Partial unavailability of critical IT services, 1+ business entities affected, or financial counterparts affected",
    "Medium": "Full unavailability of non-critical IT services, or up to 1 business entity affected",
    "Low": "Partial unavailability of non-critical IT services, or individuals affected",
    "Lowest": "No direct operational impact; informational/maintenance without service degradation",
}

# Highest urgency / impact a resolution status allows (README definitions): an alert that
# cleared by itself has no operational effect left, and a clarification ticket cannot be
# acted on until the missing details arrive. The LLM tends to rate the business context
# these tickets describe instead (300-ticket set, Luna: priority 73% -> 79%).
RESOLUTION_SEVERITY_CAPS = {
    "cannot reproduce": {"urgency": "Lowest", "impact": "Lowest"},
    "clarification": {"urgency": "Medium", "impact": "Low"},
}

# Show the ticket's reported (often wrong) values to the LLM. Off: qwen2.5:7b anchored
# on them and kept the wrong service even when retrieval pointed elsewhere.
SHOW_REPORTED_SERVICE = False
SHOW_REPORTED_LEVELS = False

# --- Versions recorded on every run (CORE_API §3) ---------------------------------
POLICY_VERSION = "p1"

# --- Self-consistency (CORE_API §5) --------------------------------------------
# Final values come from the temperature-0 call; these extra samples only feed the
# agreement signal. Fixed seeds + the LLM cache keep reruns reproducible.
SELF_CONSISTENCY_N = 3  # samples have no reasoning (~2 s each on the Mac mini)
SAMPLE_TEMPERATURE = 0.7
SAMPLE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# --- Confidence (CORE_API §5) ----------------------------------------------------
# Signals are stored raw in confidence_signals; confidence = weighted mean of the
# normalised signals that are present. All placeholders until calibrated.
CONFIDENCE_WEIGHTS = {
    "self_consistency": 1.0,
    "card_agreement": 1.0,
    "pattern_agreement": 1.0,
    "retrieval_margin": 1.0,
    "retrieval_similarity": 1.0,
    "unique_resolver": 1.0,
    "prior_agreement": 0.5,
}
RETRIEVAL_MARGIN_SCALE = 0.10     # a top1-top2 cosine gap of >= 0.10 counts as fully separated
PATTERN_AGREEMENT_MIN_SIM = 0.70  # a top pattern only votes on the service when this similar
NO_SIGNAL_CONFIDENCE = 0.5        # when no observable signal exists (e.g. N=0)
FALLBACK_CONFIDENCE = 0.2         # ceiling for fallback assignees
WEAK_MATCH_THRESHOLD = 0.60       # top service-card similarity below this -> weak_match

# --- Policy (CORE_API §3 policy version p1; lanes §5) ------------------------------
# A field below its threshold sends the run to needs_review. Rule fields inherit the
# confidence of their inputs, so only AI fields and the assignee are checked.
FIELD_THRESHOLDS = {"work_type": 0.6, "service": 0.6, "urgency": 0.6, "impact": 0.6, "resolution": 0.6,
                    "assignee": 0.5}
# Autonomy per field / service: suggest_only | auto_above_threshold | full_auto.
AUTONOMY_DEFAULT = "auto_above_threshold"
AUTONOMY_FIELDS: dict[str, str] = {}
AUTONOMY_SERVICES: dict[str, str] = {}
POLICY_PAUSED = False
AUDIT_SAMPLE_RATE = 0.10

# --- API (milestone 6) ---------------------------------------------------------------
API_DB_PATH = Path(os.getenv("API_DB_PATH", str(ROOT / "data" / "core.db")))
API_WORKERS = 2  # a local LLM cannot usefully serve more concurrent runs (CORE_API §10)
PRIORITY_WEIGHTS = {"Highest": 5, "High": 4, "Medium": 3, "Low": 2, "Lowest": 1}  # queue risk sort
CRITICALITY_WEIGHTS = {"Critical": 2, "Non-Critical": 1}

# --- Decision-record fields ------------------------------------------------------
# Decision field name -> challenge-file field name.
DECISION_FIELDS = {
    "work_type": "Work type",
    "service": "Affected Business or IT Services",
    "team": "Service Team(s)",
    "assignee": "Assignee",
    "urgency": "Urgency",
    "impact": "Impact",
    "priority": "Priority",
    "resolution": "Resolution",
}
AI_FIELDS = ["work_type", "service", "urgency", "impact", "resolution"]
