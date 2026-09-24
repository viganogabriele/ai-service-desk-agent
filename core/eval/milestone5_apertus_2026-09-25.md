# Milestone 5: Apertus 1.5 production-shaped evaluation

Run date: 2026-09-25. Provider: Swisscom Apertus 1.5 70B. Knowledge base: `v1-7abf0d94`; prompt: `triage-3fca6d90c2`; policy: `p1-ea44d5a0`. Temperature 0, three consistency samples, evidence extraction, draft resolution comment, concurrency 2. The run used the same `run_batch` / `run_ticket` path as the Core, with the real KB, embedding retriever, decision records, and lane policy. It made no Jira changes.

## Data

`devset.json` was regenerated from KB patterns and service cards with Apertus. It contains 69 unique tickets: 42 pattern cases, 18 card cases, and three each for clarification, cannot reproduce, and nonsense. It covers all 21 resolver patterns and all 20 services. Thirty pattern or card tickets have misleading titles. The actual service name is absent from all 69 descriptions and summaries, including after generation retries. Challenge tickets were not used to generate or tune this set.

The separate `handwritten.json` has 11 independently written cases. Dev-set service, assignee and resolution labels are derived from the source pattern/card or scenario. Its work type, urgency and impact labels were supplied by the generator and are weaker ground truth. The generator and evaluator used the same model, so dev-set results are optimistic; the handwritten set is small.

## Results

| Field | Handwritten (11) | Generated (69) |
| --- | ---: | ---: |
| Service | 10/11 (91%) | 63/69 (91%) |
| Work type | 9/11 (82%) | 30/69 (43%) |
| Resolution | 11/11 (100%) | 56/69 (81%) |
| Urgency | 9/11 (82%) | 47/69 (68%) |
| Impact | 7/11 (64%) | 44/69 (64%) |
| Computed priority | 8/11 (73%) | 49/69 (71%) |
| Assignee, where labelled | 3/6 (50%) | 33/60 (55%) |

All 80 tickets completed. The handwritten run took 119 seconds; the generated run took 992 seconds (14.4 seconds per ticket). There was one optional-stage warning on handwritten cases and four on generated cases, including two rate-limit responses; these did not invalidate the final decisions. Across the generated run, 410 successful uncached API calls consumed 705,442 input and 25,856 output tokens. This excludes failed attempts and cache hits, so it is a lower bound on provider activity.

Evidence extraction located at least one exact ticket span for 15/55 AI fields in the handwritten run and 128/345 in the generated run. All 80 comments were generated. Twelve generated comments were flagged for unsupported specifics; the checker missed or cannot assess broader invented actions. For example, D017 says a distribution list was recreated and a test alert delivered, although the ticket only reports lost access. D052 asserts re-indexing finished at `03:60 UTC`, an invalid and unsupported time. These are drafts requiring human review, especially when resolution is `done`.

Service selection was 39/42 on pattern cases, 15/18 on card cases, and 28/30 on misleading-title cases. On generated cases with service confidence at least 0.60, it was correct 28/28, covering 41% of tickets; on handwritten cases, 6/6, covering 55%. These small, in-sample slices do not establish calibrated probabilities. The remaining service mistakes often chose a nearby system or symptom: D017/D018 routed Outlook distribution-list issues to Identity & Access Management; D050 routed Portfolio Accounting reconciliation to Cash Management; D052 routed risk-model failure to NAV Calculation.

The 43% generated work-type agreement needs care. All 39 disagreements were labelled `Incident` but predicted `Service Request`; several descriptions clearly describe active failures (for example D005 has blank fee disclosures and failed re-generation). This is a real prompt/prior weakness, though the generator-supplied labels are not independent truth. Resolution errors were mainly `done` predicted as `clarification` (12 cases), with one `cannot reproduce` predicted as `done`.

## Assignee threshold decision

The current 0.60 similarity threshold gives 33/60 generated assignees and 3/6 handwritten assignees. Thresholds 0.55 through 0.68 give the same generated result; higher thresholds reduce it. On the 42 pattern cases, retrieval's top pattern exactly matched the source pattern 13 times and had the intended resolver 18 times. Keep 0.60. Improving pattern retrieval or resolver selection is the next useful change; threshold tuning alone cannot recover those misses. No decisions were auto-applied: the lane policy put 30 generated tickets in `human_only` and 39 in `needs_review`.

## Reproduce

Export `APERTUS_API_KEY` into the process environment, then run from `core/`:

```sh
LLM_PROVIDER=swisscom TRIAGE_MODEL=swiss-ai/Apertus-v1.5-70B .venv/bin/python eval/make_devset.py
LLM_PROVIDER=swisscom TRIAGE_MODEL=swiss-ai/Apertus-v1.5-70B .venv/bin/python eval/evaluate.py --file eval/handwritten.json --samples 3 --evidence --comment --concurrency 2
LLM_PROVIDER=swisscom TRIAGE_MODEL=swiss-ai/Apertus-v1.5-70B .venv/bin/python eval/evaluate.py --file eval/devset.json --samples 3 --evidence --comment --concurrency 2
```

The detailed local artifacts are `outputs/evaluation_20260925-004703.json`, `outputs/decisions_20260925-004703.json`, `outputs/evaluation_20260925-004935.json`, and `outputs/decisions_20260925-004935.json`. They are ignored by Git. Regenerating the set calls Apertus; evaluation reruns use the validated response cache when inputs and versions match.
