"""Mine the catalog from training data only: service->team, resolution patterns,
fallback assignee per service. Never reads the challenge file."""
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from triage import config
from triage.data import load_training

SERVICE_FIELD = "Affected Business or IT Services"
TEAM_FIELD = "Service Team(s)"


def split_comment(comment: str) -> tuple[str, str]:
    """'author@x.com: text' -> ('author@x.com', 'text')."""
    author, sep, text = comment.partition(": ")
    return (author.strip(), text.strip()) if sep else ("", comment.strip())


def _service(record: dict) -> str | None:
    services = record.get(SERVICE_FIELD) or []
    return services[0] if len(services) == 1 else None


def mine_service_team(records: list[dict]) -> dict[str, str]:
    """Service -> Team. Raises if the mapping is not a function in the data."""
    seen: dict[str, set[str]] = defaultdict(set)
    for r in records:
        for s in r.get(SERVICE_FIELD) or []:
            seen[s].update(r.get(TEAM_FIELD) or [])
    ambiguous = {s: sorted(t) for s, t in seen.items() if len(t) != 1}
    if ambiguous:
        raise ValueError(f"service->team is not deterministic: {ambiguous}")
    return {s: next(iter(t)) for s, t in sorted(seen.items())}


def mine_patterns(records: list[dict]) -> list[dict]:
    """Distinct 'Resolution: ' comments with the services/resolvers they occur with."""
    by_text: dict[str, dict] = {}
    for r in records:
        service = _service(r)
        for comment in r.get("All Comments") or []:
            author, text = split_comment(comment)
            if not text.startswith(config.RESOLUTION_PREFIX):
                continue
            p = by_text.setdefault(text, {"services": Counter(), "resolvers": Counter()})
            p["services"][service] += 1
            p["resolvers"][author] += 1
    patterns = [
        {
            "text": text,
            "services": sorted(p["services"]),
            "resolvers": sorted(p["resolvers"]),
            "count": sum(p["resolvers"].values()),
        }
        for text, p in by_text.items()
    ]
    patterns.sort(key=lambda p: (p["services"], p["resolvers"], p["text"]))
    for i, p in enumerate(patterns, 1):
        p["id"] = f"P{i:02d}"
    return patterns


def mine_fallback_assignees(records: list[dict]) -> dict[str, dict]:
    """Most frequent training Assignee per service (ties broken alphabetically)."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for r in records:
        service, assignee = _service(r), r.get("Assignee")
        if service and assignee:
            counts[service][assignee] += 1
    out = {}
    for service, c in sorted(counts.items()):
        ranked = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
        top_name, top_n = ranked[0]
        out[service] = {
            "assignee": top_name,
            "count": top_n,
            "runner_up_count": ranked[1][1] if len(ranked) > 1 else 0,
            "tied_at_top": sum(1 for _, n in ranked if n == top_n),
            "total": sum(c.values()),
        }
    return out


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_catalog(records: list[dict] | None = None, source_path: Path = config.TRAINING_PATH) -> dict:
    if records is None:
        records = load_training(source_path)
    service_team = mine_service_team(records)
    raw_patterns = mine_patterns(records)
    fallbacks = mine_fallback_assignees(records)

    warnings = []
    patterns = []
    for p in raw_patterns:
        if len(p["services"]) != 1 or len(p["resolvers"]) != 1:
            warnings.append(
                f"{p['id']} not unique: services={p['services']} resolvers={p['resolvers']}"
            )
        service = p["services"][0]
        patterns.append({
            "id": p["id"],
            "service": service,
            "team": service_team.get(service),
            "resolver": p["resolvers"][0],
            "count": p["count"],
            "text": p["text"],
        })

    if set(service_team) != set(config.SERVICES):
        warnings.append(f"mined services differ from README list: {sorted(set(service_team) ^ set(config.SERVICES))}")
    for s, fb in fallbacks.items():
        if fb["tied_at_top"] > 1:
            warnings.append(f"fallback tie for {s}: {fb['tied_at_top']} assignees at {fb['count']}; picked {fb['assignee']} alphabetically")

    resolvers_by_service: dict[str, list[str]] = defaultdict(list)
    for p in patterns:
        if p["resolver"] not in resolvers_by_service[p["service"]]:
            resolvers_by_service[p["service"]].append(p["resolver"])

    return {
        "version": config.CATALOG_VERSION,
        "source": {"file": source_path.name, "sha256": _file_sha256(source_path), "n_records": len(records)},
        "service_team": service_team,
        "criticality": {s: config.CRITICALITY.get(s) for s in service_team},
        "patterns": patterns,
        "resolvers_by_service": {s: sorted(v) for s, v in sorted(resolvers_by_service.items())},
        "fallback_assignee": fallbacks,
        "warnings": warnings,
    }


def _dump(obj: dict) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def kb_status(manifest_path: Path = config.KB_MANIFEST_PATH) -> str:
    if not manifest_path.exists():
        return "draft"
    return json.loads(manifest_path.read_text(encoding="utf-8"))["status"]


def save_catalog(catalog: dict, path: Path = config.CATALOG_PATH,
                 manifest_path: Path = config.KB_MANIFEST_PATH) -> Path:
    """Write a KB file. A published/live KB version is immutable: rewriting identical
    content is fine (the catalog is deterministic), changing it is refused."""
    text = _dump(catalog)
    if path.exists() and kb_status(manifest_path) != "draft" and path.read_text(encoding="utf-8") != text:
        raise RuntimeError(f"{path.name} belongs to {kb_status(manifest_path)} KB {config.KB_VERSION}; "
                           "create a new KB_VERSION instead of editing it")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def write_manifest(status: str, changelog: list[str], kb_dir: Path = config.KB_DIR,
                   parent_version: str | None = None) -> Path:
    """CORE_API §3 KB-version metadata, with a content hash per file."""
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted(kb_dir.glob("*")) if p.name != "manifest.json"}
    manifest = {"kb_version": kb_dir.name, "status": status, "parent_version": parent_version,
                "changelog": changelog, "files": files}
    path = kb_dir / "manifest.json"
    path.write_text(_dump(manifest), encoding="utf-8")
    return path


def load_catalog(path: Path = config.CATALOG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- Service cards -----------------------------------------------------------

CARD_SYSTEM_PROMPT = """You write service-catalogue entries for the L2 service desk of a pan-European asset manager (Switzerland, France, Luxembourg, Germany, Nordics).
Each entry has two fields:
- "scope": ONE sentence (max 35 words) naming the systems, business processes and the typical failures or requests that belong to this service. Be concrete: name data, jobs, messages, reports or workflows.
- "boundary": optional. Only when another service in the catalogue does closely related work that a triage agent could confuse with this one, ONE short sentence saying which kind of ticket goes to that other service, naming it exactly. Most services need no boundary; use null then. Never name this service itself in the boundary.
Use generic asset-management domain knowledge and the past resolutions shown. Do not mention people, ticket IDs or dates.

Example (a service NOT in this catalogue):
Service: Transfer Agency (team: Fund Operations)
{"scope": "Shareholder register and investor dealing for the funds: subscription and redemption orders, investor onboarding records, dealing-cutoff breaches and contract-note errors.", "boundary": "Errors in the published share-class NAV itself go to NAV Calculation."}"""


def _card_prompt(service: str, catalog: dict) -> list[dict]:
    lines = []
    for s, team in catalog["service_team"].items():
        past = [p["text"][len(config.RESOLUTION_PREFIX):] for p in catalog["patterns"] if p["service"] == s]
        seen = ("; past resolutions: " + " | ".join(past)) if past else ""
        lines.append(f"- {s} (team: {team}, {catalog['criticality'][s]}){seen}")
    user = (
        "Service catalogue:\n" + "\n".join(lines) + "\n\n"
        f"Write the entry for: {service} (team: {catalog['service_team'][service]}, {catalog['criticality'][service]})\n"
        'Return JSON: {"scope": "...", "boundary": "..." or null}'
    )
    return [{"role": "system", "content": CARD_SYSTEM_PROMPT}, {"role": "user", "content": user}]


def check_boundary(service: str, boundary: str | None) -> str | None:
    """Keep a boundary only if it names another catalogue service and not this one."""
    if not boundary or service in boundary:
        return None
    return boundary if any(s in boundary for s in config.SERVICES if s != service) else None


def build_service_cards(catalog: dict, chat=None, model: str | None = None) -> dict:
    """One LLM call per service for scope/boundary; everything else is mined. Returned
    unreviewed: a human must set "reviewed": true before cards are used in prompts."""
    from triage.llm import chat_structured
    from triage.schemas import ServiceScope

    chat = chat or chat_structured
    model = model or config.TRIAGE_MODEL
    cards = []
    for service, team in catalog["service_team"].items():
        patterns = [p for p in catalog["patterns"] if p["service"] == service]
        out = chat(_card_prompt(service, catalog), ServiceScope, model=model)
        boundary = check_boundary(service, out.boundary)
        cards.append({
            "service": service,
            "team": team,
            "criticality": catalog["criticality"][service],
            "pattern_ids": [p["id"] for p in patterns],
            "scope": out.scope,
            "boundary": boundary,
            "boundary_dropped": out.boundary if out.boundary and boundary is None else None,
            "scope_source": "llm",
        })
    return {
        "version": config.CATALOG_VERSION,
        "model": model,
        "catalog_sha256": catalog["source"]["sha256"],
        "reviewed": False,
        "cards": cards,
    }


def save_service_cards(cards: dict, path: Path = config.SERVICE_CARDS_PATH) -> Path:
    return save_catalog(cards, path)


def load_service_cards(path: Path = config.SERVICE_CARDS_PATH, require_reviewed: bool = True) -> dict:
    with open(path, encoding="utf-8") as f:
        cards = json.load(f)
    if require_reviewed and not cards.get("reviewed"):
        raise RuntimeError(f"{path.name} has not been reviewed; set \"reviewed\": true after human review")
    return cards
