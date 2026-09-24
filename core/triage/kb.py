"""Knowledge-base lifecycle (docs/CORE_API.md §6C): versioned KB directories, applying
approved proposals to a new draft, scoring closure notes, and turning repeated overrides
into proposals. Nothing in the KB updates itself: every change goes through a proposal,
human approval, a new version and an explicit promotion."""
import copy
import hashlib
import json
import re
from pathlib import Path

from triage import config
from triage.state import StateError

STATUSES = ("draft", "published", "live", "retired")
DERIVED_FILES = {"manifest.json", "embeddings.npz"}  # embeddings are a cache of the content
PROPOSAL_MIN_SUPPORT = 3


def _dump(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


class KBStore:
    """One directory per version under `root` (artifacts/kb): catalog.json,
    service_cards.json, manifest.json (+ embeddings.npz, built on first use)."""

    def __init__(self, root: Path = config.ARTIFACTS_DIR / "kb"):
        self.root = Path(root)

    def dir(self, version: str) -> Path:
        return self.root / version

    def manifest(self, version: str) -> dict:
        path = self.dir(version) / "manifest.json"
        if not path.exists():
            raise StateError(404, "not_found", f"unknown KB version {version}", {"kb_version": version})
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_manifest(self, version: str, manifest: dict) -> dict:
        d = self.dir(version)
        manifest["files"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                             for p in sorted(d.glob("*")) if p.name not in DERIVED_FILES}
        (d / "manifest.json").write_text(_dump(manifest), encoding="utf-8")
        return manifest

    def versions(self) -> list[dict]:
        found = [p.name for p in self.root.glob("v*") if (p / "manifest.json").exists()]
        return [self.manifest(v) for v in sorted(found, key=lambda v: int(v[1:]) if v[1:].isdigit() else 0)]

    def live(self) -> str | None:
        return next((m["kb_version"] for m in self.versions() if m["status"] == "live"), None)

    def next_version(self) -> str:
        nums = [int(m["kb_version"][1:]) for m in self.versions() if m["kb_version"][1:].isdigit()]
        return f"v{max(nums, default=0) + 1}"

    def load(self, version: str) -> tuple[dict, dict]:
        self.manifest(version)
        d = self.dir(version)
        return (json.loads((d / "catalog.json").read_text(encoding="utf-8")),
                json.loads((d / "service_cards.json").read_text(encoding="utf-8")))

    def create_draft(self, catalog: dict, cards: dict, parent: str | None, changelog: list[str],
                     actor: str | None = None, created_at: str | None = None) -> dict:
        version = self.next_version()
        d = self.dir(version)
        d.mkdir(parents=True)
        cards = {**cards, "reviewed": False}
        (d / "catalog.json").write_text(_dump(catalog), encoding="utf-8")
        (d / "service_cards.json").write_text(_dump(cards), encoding="utf-8")
        return self._write_manifest(version, {"kb_version": version, "status": "draft", "parent_version": parent,
                                              "created_at": created_at, "created_by": actor, "changelog": changelog})

    def publish(self, version: str, actor: str) -> dict:
        """Freeze a draft. Publishing is the human review of its cards."""
        m = self.manifest(version)
        if m["status"] != "draft":
            raise StateError(409, "version_conflict", f"{version} is {m['status']}, only drafts can be published")
        path = self.dir(version) / "service_cards.json"
        cards = json.loads(path.read_text(encoding="utf-8"))
        cards.update({"reviewed": True, "review_note": f"Reviewed and published by {actor}."})
        path.write_text(_dump(cards), encoding="utf-8")
        return self._write_manifest(version, {**m, "status": "published", "published_by": actor})

    def promote(self, version: str, actor: str) -> tuple[dict, str | None]:
        """Make a published (or retired, for rollback) version live; the old live one retires."""
        m = self.manifest(version)
        if m["status"] not in ("published", "retired"):
            raise StateError(409, "version_conflict", f"{version} is {m['status']}; publish it before promoting")
        previous = self.live()
        if previous and previous != version:
            pm = self.manifest(previous)
            (self.dir(previous) / "manifest.json").write_text(_dump({**pm, "status": "retired"}), encoding="utf-8")
        m = {**m, "status": "live", "promoted_by": actor}
        (self.dir(version) / "manifest.json").write_text(_dump(m), encoding="utf-8")
        return m, previous


# --- Proposals -> a new draft ----------------------------------------------------

def _check_service(service: str) -> None:
    if service not in config.SERVICES:
        raise StateError(422, "invalid_proposal", f"unknown service {service!r}")


def apply_proposals(catalog: dict, cards: dict, proposals: list[dict]) -> tuple[dict, dict, list[str]]:
    """Return copies of (catalog, cards) with approved proposals applied, plus changelog lines."""
    catalog, cards = copy.deepcopy(catalog), copy.deepcopy(cards)
    changelog = []
    card_of = {c["service"]: c for c in cards["cards"]}
    for p in proposals:
        pl, kind = p["payload"], p["type"]
        if kind == "add_pattern":
            _check_service(pl["service"])
            text = pl["text"] if pl["text"].startswith(config.RESOLUTION_PREFIX) else config.RESOLUTION_PREFIX + pl["text"]
            if any(x["text"] == text for x in catalog["patterns"]):
                changelog.append(f"{p['proposal_id']}: pattern already present, skipped")
                continue
            nums = [int(x["id"][1:]) for x in catalog["patterns"] if x["id"][1:].isdigit()]
            pid = f"P{max(nums, default=0) + 1:02d}"
            catalog["patterns"].append({"id": pid, "service": pl["service"], "team": catalog["service_team"][pl["service"]],
                                        "resolver": pl["resolver"], "count": 0, "text": text})
            rbs = catalog["resolvers_by_service"].setdefault(pl["service"], [])
            if pl["resolver"] not in rbs:
                rbs.append(pl["resolver"])
                rbs.sort()
            card_of[pl["service"]]["pattern_ids"].append(pid)
            changelog.append(f"{p['proposal_id']}: added {pid} for {pl['service']} (resolver {pl['resolver']})")
        elif kind == "amend_service_card":
            _check_service(pl["service"])
            card = card_of[pl["service"]]
            for key in ("scope", "boundary"):
                if pl.get(key) is not None:
                    card[key] = pl[key]
            card["scope_source"] = "proposal"
            changelog.append(f"{p['proposal_id']}: amended the {pl['service']} card")
        elif kind == "change_resolver":
            _check_service(pl["service"])
            changed = [x for x in catalog["patterns"] if x["service"] == pl["service"] and x["resolver"] == pl["from"]]
            for x in changed:
                x["resolver"] = pl["to"]
            catalog["resolvers_by_service"][pl["service"]] = sorted(
                {x["resolver"] for x in catalog["patterns"] if x["service"] == pl["service"]})
            changelog.append(f"{p['proposal_id']}: {pl['service']} resolver {pl['from']} -> {pl['to']} "
                             f"({len(changed)} patterns)")
        else:
            changelog.append(f"{p['proposal_id']}: noted ({kind})")
    return catalog, cards, changelog


# --- Closure harvesting ----------------------------------------------------------

_ACTION = re.compile(r"\b(fix|fixed|correct|corrected|updat|restart|clear|replay|grant|provision|reconcil|"
                     r"remov|add|set up|reran|rerun|reprocess|resubmit|mapp|adjust|reset|patch|deploy|revok)", re.I)
_CAUSE = re.compile(r"\b(root cause|caused by|due to|because|traced|diagnos|found|stale|missing|incomplete|"
                    r"locked|stalled|broken|misconfigur)", re.I)
_VERIFY = re.compile(r"\b(verif|confirm|validat|check|match|tested|monitor|reconciled|no further)", re.I)


def score_note(note: str | None) -> dict:
    """Is a closure note a reusable resolution? Root cause / action / verification present,
    filler ("Problem fixed.") detected. specific = action and (cause or verification)."""
    from triage.schemas import FILLER_PHRASES

    text = (note or "").strip()
    body = text[len(config.RESOLUTION_PREFIX):] if text.startswith(config.RESOLUTION_PREFIX) else text
    words = len(body.split())
    filler = not body or words < 6 or any(body.lower().startswith(p) for p in FILLER_PHRASES)
    parts = {"root_cause": bool(_CAUSE.search(body)), "action": bool(_ACTION.search(body)),
             "verification": bool(_VERIFY.search(body))}
    specific = not filler and parts["action"] and (parts["root_cause"] or parts["verification"])
    return {**parts, "filler": filler, "missing": not body, "words": words, "specific": specific}


# --- Learning from overrides -----------------------------------------------------

LEARNABLE = {"wrong_service": "amend_service_card", "wrong_assignee": "change_resolver",
             "resolver_unavailable": "change_resolver"}


def override_groups(overrides: list[dict]) -> dict[str, dict]:
    """Group user overrides (not derived ones) by reason code and original -> new value
    (plus the service for resolver changes). Content similarity is not used yet: the
    value transition is already specific, and PROPOSAL_MIN_SUPPORT distinct tickets are
    required before anything is proposed."""
    groups: dict[str, dict] = {}
    for o in overrides:
        kind = LEARNABLE.get(o["reason_code"])
        if kind is None or o.get("cascaded_from"):
            continue
        if kind == "amend_service_card" and o["field"] != "service":
            continue
        if kind == "change_resolver" and o["field"] != "assignee":
            continue
        scope = o.get("service") or ""
        sig = f"{o['reason_code']}|{o['field']}|{scope if kind == 'change_resolver' else ''}|{o['old_value']}->{o['new_value']}"
        g = groups.setdefault(sig, {"type": kind, "reason_code": o["reason_code"], "field": o["field"],
                                    "service": scope, "old": o["old_value"], "new": o["new_value"],
                                    "tickets": set(), "override_ids": []})
        g["tickets"].add(o["ticket_id"])
        g["override_ids"].append(o["override_id"])
    return groups


def proposal_from_group(sig: str, g: dict) -> dict:
    if g["type"] == "amend_service_card":
        payload = {"service": g["new"], "confused_with": g["old"], "scope": None,
                   "boundary": None, "suggestion": f"Reviewers moved {len(g['tickets'])} tickets from {g['old']} to "
                                                   f"{g['new']}; sharpen the {g['new']} card (scope or boundary)."}
    else:
        payload = {"service": g["service"], "from": g["old"], "to": g["new"]}
    return {"type": g["type"], "payload": payload, "signature": sig,
            "evidence": {"ticket_ids": sorted(g["tickets"]), "override_ids": g["override_ids"],
                         "count": len(g["tickets"])}}
