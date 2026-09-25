"""Thin Jira Cloud REST client plus helpers shared by upload.py and loop.py."""

import os
import re
import time

import requests
from dotenv import load_dotenv

import backend.jira_scripts.config as config

load_dotenv()


class Jira:
    def __init__(self):
        self.base = os.environ["JIRA_BASE_URL"].rstrip("/")
        self.s = requests.Session()
        self.s.auth = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])
        self.s.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

    def call(self, method, path, **kw):
        """Request with retry on rate limits (429) and server errors."""
        for attempt in range(6):
            r = self.s.request(method, self.base + path, timeout=30, **kw)
            if r.status_code == 429 or r.status_code >= 500:
                wait = int(r.headers.get("Retry-After", 2 ** attempt))
                print(f"  ...Jira said {r.status_code}, retrying in {wait}s")
                time.sleep(wait)
                continue
            if not r.ok:
                raise JiraError(r.status_code, r.text, method, path)
            return r.json() if r.text else None
        raise JiraError(r.status_code, r.text, method, path)

    # ---------- metadata ----------

    def work_types(self):
        data = self.call("GET", f"/rest/api/3/issue/createmeta/{config.PROJECT_KEY}/issuetypes")
        return data.get("issueTypes") or data.get("values") or []

    def create_fields(self, issuetype_id):
        """Fields (with allowedValues) available when creating this work type."""
        data = self.call(
            "GET",
            f"/rest/api/3/issue/createmeta/{config.PROJECT_KEY}/issuetypes/{issuetype_id}",
            params={"maxResults": 200},
        )
        items = data.get("fields") or data.get("values") or []
        return {f["fieldId"]: f for f in items}

    def resolutions(self):
        return self.call("GET", "/rest/api/3/resolution")

    # ---------- issues ----------

    def search(self, jql, fields):
        token = None
        while True:
            params = {"jql": jql, "fields": ",".join(fields), "maxResults": 50}
            if token:
                params["nextPageToken"] = token
            data = self.call("GET", "/rest/api/3/search/jql", params=params)
            yield from data.get("issues", [])
            token = data.get("nextPageToken")
            if not token:
                break

    def create_issue(self, fields):
        return self.call("POST", "/rest/api/3/issue", json={"fields": fields})

    def update_issue(self, key, fields=None, update=None):
        body = {}
        if fields:
            body["fields"] = fields
        if update:
            body["update"] = update
        return self.call("PUT", f"/rest/api/3/issue/{key}", json=body)

    def add_comment(self, key, text, internal=False):
        body = {"body": adf(text)}
        if internal:
            # Jira Service Management reads this property to keep the comment agent-only
            body["properties"] = [{"key": "sd.public.comment", "value": {"internal": True}}]
        return self.call("POST", f"/rest/api/3/issue/{key}/comment", json=body)

    def transitions(self, key):
        return self.call("GET", f"/rest/api/3/issue/{key}/transitions")["transitions"]

    def transition(self, key, transition_id, fields=None):
        body = {"transition": {"id": transition_id}}
        if fields:
            body["fields"] = fields
        return self.call("POST", f"/rest/api/3/issue/{key}/transitions", json=body)


class JiraError(Exception):
    def __init__(self, status, text, method, path):
        super().__init__(f"{method} {path} -> {status}: {text[:500]}")
        self.status = status
        self.text = text


# ---------- Atlassian Document Format ----------

def adf(text):
    """Plain text -> ADF. Blank lines separate paragraphs."""
    paras = [p for p in re.split(r"\n\s*\n", text or "") if p.strip()] or [" "]
    content = []
    for p in paras:
        lines = p.split("\n")
        inline = []
        for i, line in enumerate(lines):
            if i:
                inline.append({"type": "hardBreak"})
            if line:
                inline.append({"type": "text", "text": line})
        content.append({"type": "paragraph", "content": inline})
    return {"type": "doc", "version": 1, "content": content}


def adf_to_text(node):
    """ADF -> plain text (good enough for feeding a model)."""
    if not node:
        return ""
    if isinstance(node, str):
        return node
    t = node.get("type")
    if t == "text":
        return node.get("text", "")
    if t == "hardBreak":
        return "\n"
    inner = "".join(adf_to_text(c) for c in node.get("content", []))
    return inner + ("\n\n" if t == "paragraph" else "")


# ---------- matching our values to Jira's options ----------

# Order matters: "highest"/"lowest" must be checked before "high"/"low".
_RANK_WORDS = [
    (0, ["highest", "critical", "extensive", "widespread", "major"]),
    (4, ["lowest", "no direct", "none", "information", "informational"]),
    (1, ["high", "significant", "large"]),
    (2, ["medium", "moderate", "limited"]),
    (3, ["low", "minor", "localized", "localised"]),
]


def rank(label):
    """0 = most severe ... 4 = least severe. None if unrecognised."""
    s = (label or "").lower()
    for r, words in _RANK_WORDS:
        for w in words:
            if re.search(r"\b" + re.escape(w) + r"\b", s):
                return r
    return None


def option_label(opt):
    return opt.get("value") or opt.get("name") or ""


def match_option(value, allowed):
    """Find the Jira option for `value`: exact name first, then same severity rank,
    then the nearest rank. Returns the option dict or None."""
    if not value or not allowed:
        return None
    v = value.strip().lower()
    for o in allowed:
        if option_label(o).strip().lower() == v:
            return o
    r = rank(value)
    if r is None:
        return None
    ranked = [(rank(option_label(o)), o) for o in allowed]
    ranked = [(x, o) for x, o in ranked if x is not None]
    if not ranked:
        return None
    return min(ranked, key=lambda p: abs(p[0] - r))[1]


def find_work_type(types, name):
    """'Incident' -> the Jira work type whose name contains 'incident'
    (and not 'approvals', to skip 'Service request with approvals')."""
    needle = config.WORK_TYPES.get(name, name).lower()
    for t in types:
        n = t["name"].lower()
        if needle in n and "approval" not in n:
            return t
    return None
