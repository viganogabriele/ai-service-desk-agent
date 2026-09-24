# Revised hackathon direction after the advisor conversation

Decision date: 2026-09-24. Source: the expert conversation supplied by the team.
Dataset and implementation evidence: [ANALYSIS.md](ANALYSIS.md). Official output
requirements: [instructions.md](instructions.md).

## Product decision

Build a focused service-agent desktop: an incoming ticket gets proposed routing,
priority and a resolution comment; the agent inspects evidence, edits if needed,
and approves the proposal. Demonstrate this workflow early in the pitch. Use the
historical corpus as a browsable database and a source of resolution examples.

The value proposition is **less manual triage work with explicit human review**.
Time saved remains a hypothesis until measured. The classifier is an implementation
choice whose quality and cost must be measured.

The expert agreed with the data's sparsity and recommended building around it.
They also recommended experimenting with classifiers. Their advice changes the
priority of presentation and product work; it does not remove the seven output
requirements or the ban on hardcoded challenge answers.

## What changes in our assumptions

| Previous working assumption | Revised position | Basis |
|---|---|---|
| Model architecture is the main deliverable. | The agent workflow is the demo centerpiece; the seven correct outputs remain the technical deliverable. | Advisor plus official task. |
| Sparse data forces a keyword-only solution. | Compare rules with the existing language classifier; use history for lookup and examples. | Advisor suggested language models; no comparison has established a winner. |
| Descriptions are accurate and tags are wrong. | Treat this as a hypothesis. Conflicts require evidence and sometimes clarification. | Advisor explicitly did not know where errors were. |
| Local inference is automatically preferable. | Prefer the measured approach meeting required quality at acceptable latency and total cost. | Advisor emphasized economics, not local deployment for its own sake. |
| A larger model is needed for every difficult field. | Keep the current single-model path as the baseline; test escalation if a stronger model fixes meaningful errors. | Avoid adding an unmeasured dependency. |
| English-only is a weakness to fix now. | English is sufficient for the challenge. Defer multilingual work. | Explicit advisor guidance. |
| Historical anomaly detection is required. | An optional extension after the 20-ticket flow works; findings are review candidates. | Advisor suggestion, not official requirement. |
| A graph-heavy explorer is the final application. | Reuse it for history and evidence; prioritize queue, proposal and approval. | Advisor wanted a service agent's day to be visible. |
| Show roles, languages and many features. | Limit the demo to the core flow and at most one or two supporting capabilities. | Explicit advice to avoid overload. |
| Describe precomputed analysis as live execution. | Precomputation is useful; distinguish saved analysis from live inference. | A reliable demo does not require misleading execution claims. |
| Lead by criticizing the dataset. | Lead with the user's task and outcome. Explain label limitations candidly in methodology and Q&A. | Presentation advice without claiming evidence we lack. |

## Minimum application and acceptance criteria

```text
Incoming → Generate proposal → Review / edit → Approve triage → Processed
                               └→ Request clarification / leave pending
```

1. **Queue:** show the 20 incoming tickets and real status counts. Distinguish
   history from the current batch. The corpus has 20,000 records, 16,969 with
   Status `done`, and 3,031 open/in progress; do not call all 20,000 successfully
   solved tickets.
2. **Solver:** an explicit action calls the backend. Show progress, successful
   output or a recoverable error. Preserve the original ticket.
3. **Proposal:** show original versus proposed service, team, assignee, work type,
   urgency/impact/priority, disposition and draft comment. Make changed fields and
   supporting symptoms visible, with historical examples where relevant.
4. **Review:** let the agent edit or defer uncertain suggestions. Surface weak
   assignee evidence and missing examples. Do not present historical vote share
   or model probabilities as verified correctness percentages.
5. **Approval:** persist the accepted proposal and original input, model, timestamp
   and edits in the demo store, then update queue counts. Approving triage does
   not execute an IT repair. A resolved demo state requires an explicit simulated
   resolution step, with the simulation clear.
6. **Deliverable:** export all seven targets in the accepted JSON shape, including
   the drafted resolution comment. Recompute priority after urgency/impact edits
   and team after service edits. Verify the export round trip.

The backend provides proposal fields and a local HTTP endpoint. The dashboard
provides exploration. Human approval, durable state and endpoint integration are
implementation work, not completed features. The API returns the batch when it
finishes; use single-ticket calls for the interactive demo rather than implying
it already streams batch progress.

## Keep the extra features small

**First extension: historical review.** Reuse the explorer to show a small set of
candidate inconsistencies with original evidence and proposed corrections.
Distinguish deterministic checks from semantic judgements. Saved analysis should
identify its source, method/model, date and records examined. Review flagged and
unflagged records to estimate precision and missed cases. Never turn known
randomized priorities into a claimed real error rate.

**Second extension, only if measured: cost/quality comparison.** Compare runs of a
small local model and an accessible stronger model on the same cases. A selector
must change execution or clearly select a saved benchmark. Do not animate cost
down while holding invented accuracy constant. Role-based model access is a later
story idea, not needed for the demo.

Multilingual UI/data, fine-tuning, a general agent framework, more dashboards and
specialist roles are deferred. If time gets tight, cut both extensions before
cutting review, correct export or the live ticket demonstration.

## Bounded experiment plan

Use a short experiment budget alongside building the core UI. Do not rewrite the
working backend simply to chase model novelty.

| Candidate | What it tests | Current evidence |
|---|---|---|
| Rules / keyword baseline | How much routing and work-type inference can be done cheaply; where lexical matching breaks. | Existing clue/probe logic, not a complete scored solver. |
| Current local constrained-JSON model | End-to-end proposal quality and latency with the existing contract. | Saved six-case results: service 6/6 and work type 6/6; no labels for the other targets. |
| One accessible language model alternative | Whether another model meaningfully improves ambiguous cases. | No comparable run. Exact model/API must be verified before use. |

Keep the current Qwen 4B model for the complete path. A smaller model is a speed
experiment, not a safe substitution: the existing six labels cover only two fields,
and the 20 outputs have no reference answers. Decision-only candidates such as
Laya, Rizzo Flow or hosted Jev still need a generative comment step. See the
[dated model comparison](chats/2026-09-24-jev-local-contextual-models.md).

The team has confirmed that no additional cases will be available: use the supplied
training corpus and blind set only. The checked-in challenge JSON and
`sample_blind_eval_20.json` contain identical records, so the saved 20-ticket run
is not an independent blind evaluation. Keep the six hand-labelled development
cases as smoke checks. Do not turn manual review of the scored blind tickets into
answer lookup or iterative ticket-specific tuning.

Use label-free checks on the blind set: change or hide intake labels and look for
unjustified changes in predictions; compare rules with the model and flag
disagreements; repeat runs to measure instability; validate enums, team mapping,
priority and disposition/comment consistency. These reveal fragility and review
needs, not field accuracy. The training corpus can validate lookups and provide
resolution examples, but its repeated templates and explicit service names cannot
measure routing from symptoms. Record any human judgement as review feedback,
not as a hidden reference score.

Use the same inputs, rubric, service catalogue and output checks. Report service
and work-type accuracy only for the six existing labelled cases; record agreement
and stability separately from accuracy on the blind set. Record priority
consistency separately from urgency/impact quality, invalid outputs, unsupported
resolution claims, human edits and escalation rate. Review comments
for specificity, supporting evidence and appropriate uncertainty. Measure complete
pipeline latency, failures/retries, token usage when available, and warm/cold
behavior. Record model version, quantization, hardware and concurrency.

Prefer the cheapest measured approach only when the available evidence can show
that it meets an agreed quality bar. The present labels cannot establish quality
parity across all seven targets. For a cascade, establish that escalation catches
errors and improves quality; vote shares or uncalibrated confidence alone are not
a reliable escalation policy. Do not claim equal quality from six examples or
compare category-only latency with a pipeline that also writes resolution comments.

## Unit economics and scaling

The advisor's 8,000 tickets/day is a **scenario**, not verified customer volume.
It implies 2.92 million tickets/year at 365 days, or 2.0 million at 250 business
days. State the assumption, arrival peaks and review staffing.

The saved 20-ticket output records about 5.80 s/ticket for classification plus
comment generation. If reproducible under the same conditions, a serial worker
would handle roughly 621 tickets/hour; 8,000 tickets require about 12.9
worker-hours/day. An eight-hour processing window needs at least two such workers
**before** utilization headroom, spikes and failures. A 24-hour window has a
different capacity requirement. Independent workers and shared-hardware
concurrency must be benchmarked; throughput does not scale for free.

The saved stages average about 3.06 s for classification and 2.73 s for the
comment. They contain no Ollama token counts, so the thread's decode/prefill rates
and projected speedups from smaller models, parallel requests or prompt caching
are hypotheses, not measured deployment results. Capture token counts, token
durations, hardware, context length and concurrency before making that comparison.

At the same serial rate, 50 tickets take about 4.8 minutes and 20,000 about 32.2
hours. These are arithmetic extrapolations from a saved small run, not load tests.
They do not substantiate the team's “20,000 with a 1B model in 20 seconds” claim.
That might refer to another task or method; require the model, hardware, command,
dataset, output scope and correctness check before using it.

Use measured inputs in these formulas; this review establishes no provider prices
or dollar savings:

```text
cloud inference cost/ticket = sum across actual model calls and retries of
    (input_tokens × input_price_per_million
     + output_tokens × output_price_per_million) / 1,000,000

local annual cost = annualized hardware + electricity + hosting/operations
local cost/ticket = local annual cost / actual annual tickets processed

hybrid model cost/ticket = local/base cost per ticket
                          + escalation_fraction × extra cloud cost per escalation

review cost/ticket = review_fraction × average_review_minutes × hourly_labor_cost / 60
total cost/ticket = model cost/ticket + review cost/ticket + other allocated costs
annual cost = annual_ticket_volume × total cost/ticket
```

For local energy, use measured average power × powered hours × electricity tariff.
Avoid double-counting hosting, hardware or energy. Include idle capacity, retries,
maintenance and paid orchestration. In the proposed approval workflow,
review_fraction initially equals 1: every ticket is reviewed. Measure manual
triage time and assisted review time before claiming labor savings. Low marginal
inference cost is not zero total cost. Local processing alone does not establish
a compliance certification.

Outputs contain stage timings but no token accounting or cost ledger. Use a
parameterized estimate until those measurements exist; label assumptions and
distinguish model cost from total workflow cost.

## Demo story and work order

Open with at most one framing slide or a short sentence: “We help a service agent
turn an incoming ticket into a reviewed triage decision.” Then show the application.

Use one representative ticket with a clear correction: receive it, run the solver,
show proposed fields and evidence, edit or accept, and move it out of the pending
queue. If time permits, show an ambiguous case that requests clarification. Use
fixtures in rehearsals; run the available challenge tickets through the solver
without answer lookup.

If ready, briefly show a historical review candidate and measured economics.
Close on the exported deliverable and the agent's approval role. Keep a clearly
labelled replay for infrastructure failures; distinguish replay from live
inference. The advisor offered presentation coaching; use it after the flow works.

Implement in this order:

1. Connect the service-desk queue and proposal view to the backend.
2. Add review/edit, persisted approval, consistent counters and correct export.
3. Tighten disposition/evidence handling as recorded in ANALYSIS.md, benchmark
   the complete path and review all seven required outputs.
4. Compare rules and the current model with the available label-free checks; add
   another model only if a meaningful quality question can be answered.
5. Add historical review and measured economics if time remains.
6. Rehearse on the available inputs, including uncertainty and error recovery;
   label any saved replay explicitly.

We can already defend the deterministic mappings, priority calculation and compact
historical knowledge base. Remaining claims to earn are representative quality,
justified assignee choices, reliable draft resolutions, measured agent time savings
and throughput at the proposed operating volume.
