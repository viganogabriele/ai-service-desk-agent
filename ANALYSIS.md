# Ticket triage: revised findings and assumptions

Revised 2026-09-24 after the hackathon advisor conversation supplied by the team.
This supersedes the technical conclusions in the archived chats and
`report-20tickets.md`. [ADVISOR_REVIEW.md](ADVISOR_REVIEW.md) records the product,
demo, experiment and economics decisions. [instructions.md](instructions.md)
remains the official specification; the advisor did not replace it.

## Evidence and its limits

The advisor agreed that the data is sparse, recommended an application demo
around the service agent's workflow, suggested trying a language classifier,
and said English is sufficient for the challenge. They did **not** identify
which fields are wrong, confirm that descriptions are ground truth, provide hidden
answers, or establish any model's accuracy, cost or throughput.

Counts below were recomputed from local files. Statements about unseen tickets
remain hypotheses. Dashboard flags are review candidates, not verified errors.
A model's disagreement with a field is not a reference label.

## 1. What the historical corpus establishes

Source: `jira_first_20000_requested_fields_synthetic.json`.
SHA-256: `6f3ad42cbe5095d6541c47095258c233554c1da46fbc47c529735667876f8844`.

| Finding | Verified value | Consequence |
|---|---|---|
| Historical records | 20,000 | Useful as an application database; not 20,000 independent problem descriptions. |
| Distinct summaries / descriptions / pairs | 173 / 173 / 173 | Random row splits would duplicate wording across train and test. |
| Summary shapes after replacing the service name | 11 | Earlier wording implying every template exists for every service was misleading. |
| Summaries containing their labelled service | 20,000 / 20,000 | Training classification can succeed through name matching; this does not validate routing from symptoms. |
| Services / distinct teams / entities | 20 / 11 / 5 | Each service has one observed team; multiple services share teams. |
| Reporters / assignees | 92 / 30 | Person-level ownership is not established by the catalogue. |
| Generic Emailed Support Tickets | 5,423 (27.115%) | Reclassify only when content supports a more specific service. |
| Tickets with concrete `Resolution:` narratives | 5,814 (29.07%) | Extract and deduplicate useful examples. |
| Distinct concrete narratives / services covered | 21 / **10** | Corrects the earlier claim of 11 covered services and nine without examples. |
| Priority consistent with supplied urgency and impact | 7,804 / 20,000 (39.02%) | Apply the official matrix instead of learning priority from historical labels. |
| Status counts | `done`: 16,969; `in progress`: 2,064; `open`: 967 | Historical status is not a verified successful fix. |
| Resolution counts | `done`: 4,236; `cannot reproduce`: 4,322; `clarification`: 4,243; `cancelled`: 4,168; empty: 3,031 | Approximately balanced among nonempty labels; this alone does not prove random generation. |

The ten services with no concrete narrative are Trading Platform, Fund Pricing,
NAV Calculation, Portfolio Accounting, Rimes Data Feed, Risk & Compliance
Monitoring, CRM & Client Portal, Identity & Access Management, SharePoint & File
Storage, and **Emailed Support Tickets**. The last was missing from our earlier list.

The official instructions explicitly state that historical Priority, Urgency and
Impact are independently random. They do not say the same about Assignee or
Resolution. Their weak observed signals justify a cautious baseline, not an
impossibility theorem about predicting them.

## 2. Revised decisions by field

| Field | Evidence and revised policy |
|---|---|
| Work type | Classify the actual request or failure using summary, description and relevant comments. Request type is a useful but fallible hint. All 6,913 historical `sa_*` reports are incidents; retain this as a prior, not a universal rule. |
| Affected service | Compare symptoms and business workflow with the service catalogue. Intake labels and linked issue prefixes are weak hints. Neither the body nor the title is inherently correct. Preserve uncertainty when evidence conflicts. |
| Service Team(s) | Use the observed service → team lookup. Its 100% historical consistency validates the lookup within this corpus, not every historical service label or a future organization's ownership map. |
| Assignee | The implementation uses the most frequent historical assignee for service and entity, falling back to service. This is a disclosed convention needing review. The 6.22% majority fit versus 3.59% global majority is **in-sample**, not held-out accuracy. Historical vote share is not calibrated confidence. |
| Urgency / Impact | Apply the official rubric to scope, duration, deadlines and workarounds. Criticality informs impact; it is not an automatic severity cap. Security or regulatory consequences can matter even for a listed Non-Critical service. Corrections are optional under the challenge rules. |
| Priority | Always compute from the final Urgency and Impact using the official matrix. Mathematical consistency is separate from judging severity correctly. |
| Resolution | Produce a proposed disposition supported by ticket evidence and consistent with the draft note. A plausible generated fix is not proof of completion. Missing detail supports clarification; misrouting alone does not imply cancellation, and an uninvestigated alert is not proof of failure to reproduce. |
| Resolution text | Retrieve relevant historical patterns as examples, then draft a concrete diagnosis/action/validation proposal. State uncertainty. Do not claim an action was executed or let the generated narrative become its own evidence. |

Do not train directly on all historical target fields. Prefer the existing
pretrained classifier plus deterministic checks and a compact knowledge base.
Trying classifiers, as the advisor suggested, does not require fine-tuning.

## 3. Retrieval and anomaly analysis

History has two uses: browsing tickets and providing evidence for a proposal.
It supports the first even when repetitive language limits supervised learning.

Start retrieval from the 21 deduplicated narratives and service cards already in
code. The backend selects up to two examples within the predicted service. A
wrong service can select the wrong examples, and a service match does not prove
a matching root cause. The retriever has no minimum relevance threshold. Review
the fit before using a narrative in a draft.

Embedding all 20,000 summaries is lower priority given duplication, not proven
universally useless. Revisit retrieval with more representative history. Where
no relevant history exists, propose investigation or request missing facts;
general model knowledge is not case-specific evidence.

Distinguish two kinds of historical finding:

- **Reproducible consistency checks:** a stored priority disagrees with the matrix,
  or a team differs from the observed service mapping.
- **Semantic review candidates:** text, service, work type or resolution appear
  inconsistent. Show original fields, proposed changes and supporting text.

The known randomized priority fields generate many consistency flags. That is a
dataset property, not evidence of real operational savings. Measure semantic flag
precision through human review before calling candidates actual errors.

## 4. What the 20-ticket inputs tell us

The local sample and timestamped challenge export both have 20 records, nine
Request type values and 20/20 matrix-consistent supplied priorities. Both use a
`records` envelope. Preserve metadata and accept arrays as the backend already does.

The sample adds Request type, Business Critical for Entity, Severity, Linked
issues and Due date. Its Team, Assignee, Resolution and Business Critical for
Entity fields are empty, and Status is open. **Empty does not imply required:**
Business Critical for Entity is not one of the seven requested output targets.
Preserve extra columns; do not invent a requirement to populate every blank.

Earlier manual inspection proposed two service corrections and possible matches
to historical narratives in 11 sample tickets. These are interpretations, not
hidden-reference results. Claims such as “exactly two wrong labels” and “no false
positives on the other 18” are withdrawn. Text saying “this label may be wrong”
is neither proof of error nor proof of correctness.

Request type values explicitly mentioning misclassification are strong clues in
this sample, but must be checked against content. Linked issue prefixes do not
establish ownership. Sample observations do not guarantee the final challenge's
makeup. Do not hardcode sample answers or replay saved answers as fresh inference
on new challenge tickets.

## 5. Actual implementation and observed results

`triage_poc` processes tickets sequentially with two model calls per ticket:
constrained classification, then a draft comment. Python enforces the team lookup
and priority matrix. A CLI and `POST /triage` record stage timings and mark outputs
`draft_only`. They do not perform fixes or update Jira.

`dashboard.html` is an explorer with filters, charts, heuristic flags and export.
It is not yet the queue → solve → review → approve application. Approval state,
persistence, a solver connection, measured model comparison and business economics
still need to be built.

The revised evidence policy also identifies implementation follow-ups: the current
classification prompt still permits cancellation for misrouting without work and
`done` for a plausible fix. Tighten these instructions and check disposition against
the draft before presenting the policy as enforced. The UI should show the exact
examples used for generation; currently comment generation ranks with comments
included, while `_triage.resolution_examples` is recomputed from summary and
description alone and can differ. These are recorded gaps, not changes made by
this documentation review.

| Existing artifact | Rechecked result | Limits |
|---|---|---|
| `output/dev_predictions.json` vs `fixtures/dev_reference.json` | Work type 6/6; service 6/6. Recorded classification + comment time: 28.43 s total, 4.74 s mean. | Six hand-labelled development cases, only two graded fields; not an independent accuracy benchmark. |
| `output/triaged.json` | 20 outputs; priority consistent with final levels on 20/20. Recorded classification + comment time: 115.94 s total, 5.80 s mean, 5.06–6.91 s range. | No reference answers; consistency does not establish routing or resolution quality. |

Both outputs name `qwen3:4b-instruct-2507-q4_K_M`. They do not record hardware,
runtime version, warm/cold state, token counts or external batch wall time. These
numbers summarize saved artifacts, not a new live run or verified Mac benchmark.
Inspect the knowledge base and reproduce the development comparison with:

```sh
python3 -m triage_poc inspect
python3 -m triage_poc evaluate output/dev_predictions.json fixtures/dev_reference.json --details
```

Unit tests use a fake model and check integration, not model quality. The code
does not implement Rizzo Flow, logit scoring, KV-cache sharing across decisions,
a 1B model or a cloud-model comparison.

## 6. Assumptions retired or deferred

- **“Pattern matching is the only viable option.”** Keep it as a baseline; test the
  language classifier on paraphrases, missing clues and conflicting labels.
- **“The description is the source of truth.”** The advisor could not identify
  which fields contain errors. Use evidence across fields and review conflicts.
- **“A 4B/1B/local model is sufficient and equally accurate.”** An experiment, not
  an established outcome. Likewise, 20,000 tickets in 20 seconds is a team claim
  without a reproducible benchmark in this repository.
- **Earlier latency, training-time and model-compatibility estimates.** Archived
  estimates are not measurements of this implementation. “Jev” is unclear in the
  transcript; no provider/model identity is inferred. Verify exact availability
  and runtime support when choosing an experiment.
- **“Hidden answers use our narrative pool or special L2 agents.”** Unsupported;
  remove from implementation and pitch decisions.
- **“Multilingual support is necessary.”** English is the agreed hackathon scope.
  Translation can be a later experiment, not evidence about real traffic.
- **“Regex filters and enums solve prompt injection.”** Partial controls only.
  Enums constrain format, not correctness; injected text can still influence
  Urgency/Impact and therefore Priority. Zero regex hits do not prove absence.
- **“A polished wrapper makes the AI irrelevant.”** The advisor recommended trying
  approaches; the official challenge still scores actual field outputs.

Keep sanitation, validation and review flags, without claiming comprehensive
security. Prioritize a complete, honest ticket workflow over speculative traps
or additional charts.
