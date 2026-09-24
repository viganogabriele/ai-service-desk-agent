# Triage Cockpit — UI Concept (context only)

> **Status: context, not a build task.** This describes the product that will sit on top of the Core. Do not build it while working on the Core. Use it to understand *why* the Core exposes what it exposes in `CORE_API.md`. If a Core design choice would make any feature below hard or impossible, flag it.

## 1. The idea
The cockpit is where service-desk staff **supervise** the AI classifier rather than trust a black box. The classifier handles the routine triage. Humans see what it decided, how sure it was, and why. They correct it where needed, and every correction makes the system better.

The core design problem: the pipeline mixes decisions of very different reliability.
- **Rule-based:** Team is a lookup; Priority comes from the matrix. These are nearly always right when their inputs are right.
- **Pattern-matched:** the Assignee is the resolver of a matching historical pattern. Strong when the match is good.
- **Fallback:** the Assignee is the most frequent one for the service. Close to a guess.
- **AI judgment:** Service, Work type, Urgency/Impact and Resolution status. Good, but can be wrong.

The UI's job is to make these differences visible, so people trust each decision exactly as much as it deserves.

## 2. Users

| User | Main goal | Main screens |
|---|---|---|
| Service-desk agent (L1/L2) | Clear the review queue quickly and correctly | Queue, ticket view, override |
| Team lead | Keep routing accurate and balance workload | Monitoring, resolver/workload, priority integrity |
| Catalog / knowledge owner | Keep the knowledge base accurate | Proposals, KB health, KB versions |
| Model / platform owner | Release changes safely; control autonomy | Policy settings, shadow evaluations, audit |

## 3. Features, and why each exists

### 3.1 Ticket decision card (MVP)
Every field shows its value, plus a badge for its source (Rule / Pattern / AI / Fallback), its confidence, and a one-sentence reason. Fallback values look visibly weak. Hovering a rule field shows its trace, e.g. "matrix[High][Medium] = High".
*Why:* reviewers otherwise treat all fields as equally trustworthy. Showing the source tells them where to look.
*Core data:* the decision record's `source`, `confidence`, `confidence_signals`, `reason`, `rule_trace` and `flags`.

### 3.2 Diff view (MVP)
Original versus proposed values, with changed fields highlighted (e.g. "Service: Regulatory Reporting → Tax Reporting"). The words in the ticket that drove each change are highlighted in the ticket text.
*Why:* the AI's value, and its risk, are concentrated in the corrections. Highlighted evidence makes a correction checkable in seconds.
*Core data:* `original_value`, `value`, `effective_value`, `evidence.ticket_spans` (character positions), and the `service_changed` / `work_type_changed` flags.

### 3.3 Evidence panel (MVP)
Shows the retrieved historical patterns with similarity and resolver, and the service card used. For the resolution comment, each phrase is marked by where it came from (ticket, adapted exemplar, or generated), and specific details found in neither source are flagged. A weak-match warning appears when nothing similar exists.
*Why:* it lets humans check that the AI reused a real historical resolution rather than improvising. A plausible but invented root cause in a regulated firm's records is worse than a vague one.
*Core data:* `evidence.patterns`, `evidence.service_card`, and the comment's `segments`, `exemplar_pattern_ids` and `unsupported_specifics`; the `weak_match` flag.

### 3.4 Confidence lanes and risk-ordered queue (MVP)
Three lanes: **Auto-applied**, **Needs review** and **Human-only**, each showing the reasons a ticket landed there. The review queue is sorted by risk (uncertainty × priority × service criticality), not arrival time. Audit-sampled tickets appear for blind review, with the AI's values hidden until the reviewer commits.
*Why:* the risk is lopsided. A misrouted licence request costs hours; a downgraded NAV outage costs a missed NAV deadline. Lanes automate the routine majority and keep people on the risky minority. Blind audits are the only unbiased measure of how accurate the auto-applied decisions really are.
*Core data:* `lane`, `lane_reasons`, `audit_sampled`, `GET /queue?sort=risk`.

### 3.5 Consistent override workflow (MVP)
- Changing the Service updates the Team automatically and offers ranked resolvers for the new service.
- Priority is never typed. The user clicks a cell on a 5×5 Urgency × Impact matrix, and Priority follows.
- Every change shows its consequences before it's saved (the preview).
- Saving requires a reason code.
- A stale resolution comment prompts "regenerate" or "edit".
- If someone else changed the ticket meanwhile, the user sees the newer version instead of overwriting it.
- Accepting as-is is an explicit, one-click action, because acceptances are labels too.

*Why:* corrections must not create inconsistencies, and they must be captured as reason-coded labels. The original data lacked exactly those labels.
*Core data:* `POST /overrides/preview`, `POST /overrides` (using `base_run_id`, with `409` on a stale view), the cascade rules, reason codes, `alternatives` (ranked dropdowns), `POST /accept`, comment regenerate/edit.

### 3.6 Monitoring dashboard
- **Automation and override rates**, by field, service and source.
- **Service confusion heatmap**, showing which services get confused with each other.
- **Calibration chart:** confidence versus human acceptance.
- **Generic-bucket rate** over time. Its decline is the clearest measure of the product's business value.
- **Coverage gap map:** which services have resolver patterns and which rely on fallback.
- **Emerging issues:** clusters of new tickets unlike anything in history. These can be new problem classes or early signs of an outage.
- **Estimated true error rate**, from the audit sample.

*Why:* override rates alone are biased, because humans only see flagged tickets. Leads need unbiased health signals, and early warning when behaviour drifts.
*Core data:* `GET /metrics/*`.

### 3.7 Priority integrity panel
Incidents on critical services by priority; alerts when the AI downgraded urgency or impact on a critical service; the count of forced inconsistencies (should be 0); a required confirmation for every Highest-priority decision.
*Why:* getting priority too low is the costliest error, and the hardest one to learn from history, because historical priorities were random. Regulated asset managers (for example under DORA in the EU and FINMA rules in Switzerland) need defensible, auditable incident classification.
*Core data:* `metrics/priority_integrity`; the `downgrade_on_critical` and `forced_inconsistent` flags; the `human_only` lane rule.

### 3.8 Resolver and workload view
Open load per resolver, availability, and warnings where a problem class has a single resolver (in the historical data, each problem class has exactly one).
*Why:* routing every ticket in a class to "the one person who always fixes it" is accurate but fragile. Leads need to balance accuracy against capacity and see where knowledge depends on one person.
*Core data:* `metrics/resolver_load`; the ranked assignee `alternatives`.

### 3.9 Knowledge-base health and proposals
- A backlog of historical tickets with vague ("Problem fixed.") or missing resolutions, tickets left in the generic bucket, and services with no documented fix.
- A proposal inbox: new patterns harvested from well-documented closures, and service-card or resolver changes suggested by repeated overrides, each with its supporting tickets. The catalog owner approves, edits or rejects.
- A version list with changelogs, promotion and rollback.

*Why:* the AI's resolution notes are only as good as the history they're built from. Proposals turn frontline corrections into improvements for everyone, with a human deciding what changes.
*Core data:* `GET /kb/health`, `/kb/proposals`, `/kb/versions`, and the promote endpoint.

### 3.10 Policy, audit and shadow mode
- Autonomy settings per field and per service (suggest only / auto above threshold / full auto), with an estimate of each setting's impact, and a global pause switch.
- A searchable audit trail of every decision and override, with the model, prompt, KB and policy versions behind it.
- Shadow comparisons, e.g. "the new KB version would change 38 decisions; 29 match human corrections, 9 are new disagreements".

*Why:* "why was this rated Medium and sent to Treasury, three months ago?" must be answerable. Upgrades should be decided on evidence, and the organisation needs a pause switch.
*Core data:* `/policy`, `/policy/preview`, `/policy/pause`, `/audit`, `/evaluations`, and the `versions` on every run.

## 4. Screens (suggested)
1. **Queue:** lane tabs, a risk-sorted list, filters (service, flag, priority), live updates.
2. **Ticket:** the decision card, diff and evidence side by side; the override panel with the matrix; the comment with its sources marked; the history timeline.
3. **Monitoring:** the metric panels from 3.6 and 3.7.
4. **Resolvers:** load and single-resolver warnings.
5. **Knowledge:** proposals, health backlog, versions.
6. **Admin:** policy and pause, shadow evaluations, audit search.

## 5. UX principles
- **Consistent source colours everywhere:** Rule, Pattern, AI and Fallback always look the same.
- **Show consequences before commit** (preview). Never let the UI create an inconsistent ticket.
- **Explain every automatic action in one sentence**, and give the detail on demand.
- **The fast path must be fast:** accepting a correct ticket is one click; a common override is two.
- **Live but calm:** updates arrive through the event stream without reshuffling a list the user is working in.

## 6. What the UI assumes about the Core
- Each field decision is self-explanatory: source, confidence and signals, reason, evidence with character positions, ranked alternatives, flags.
- Consistency (Team follows Service, Priority follows the matrix) is enforced by the Core. The UI only previews it.
- Overrides are pinned across re-triage; conflicts arrive as `decision.conflict`.
- Everything the UI shows can be traced to versioned runs, overrides and KB/policy versions.
- A single event stream (SSE, resumable) keeps the UI current, so it never needs to poll the ticket list.
- The user's identity is passed as `actor` on every write. Authentication is outside the Core.
