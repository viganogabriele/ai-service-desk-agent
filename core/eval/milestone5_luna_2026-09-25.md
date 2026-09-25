# Milestone 5: GPT-6 Luna evaluation

Rerun on 2026-09-25 after rebasing onto `origin/main`. The run used `gpt-6-luna` through the OpenAI Responses API with high reasoning effort and standard mode. It evaluated the same 69 Apertus-generated dev tickets and 11 handwritten tickets as the [earlier Apertus run](milestone5_apertus_2026-09-25.md). Settings were three consistency samples, evidence extraction, draft comments, and concurrency 2. Versions: KB `v1-7abf0d94`, prompt `triage-3fca6d90c2`, policy `p1-b8d897c2`.

| Field | Handwritten: new Luna | Handwritten: old Luna | Handwritten: Apertus | Generated: new Luna | Generated: old Luna | Generated: Apertus |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Completed | 11/11 | 11/11 | 11/11 | 69/69 | 69/69 | 69/69 |
| Service | 11/11 | 11/11 | 10/11 | 67/69 | 67/69 | 63/69 |
| Work type | 11/11 | 11/11 | 9/11 | 68/69 | 68/69 | 30/69 |
| Resolution | 11/11 | 11/11 | 11/11 | 69/69 | 69/69 | 56/69 |
| Urgency | 8/11 | 8/11 | 9/11 | 52/69 | 52/69 | 47/69 |
| Impact | 11/11 | 11/11 | 7/11 | 50/69 | 50/69 | 44/69 |
| Computed priority | 10/11 | 10/11 | 8/11 | 55/69 | 55/69 | 49/69 |
| Assignee, where labelled | 6/6 | 4/6 | 3/6 | 57/60 | 34/60 | 33/60 |

The rebased assignment logic accounts for the assignee improvement. It routes to the documented resolver for the chosen service; for Securities Settlement, it chooses the resolver whose patterns have the highest mean similarity. The older logic gated pattern assignment by a similarity threshold. Service and work-type predictions did not change.

The new handwritten run took 16 seconds, and the generated run took 72 seconds. All 80 tickets completed with no optional-stage warnings. Evidence extraction found a ticket span for 41/55 handwritten and 274/345 generated AI fields. All 80 draft comments were written; the unsupported-specifics checker flagged 1 handwritten and 9 generated comments. These counts do not establish that the other comments are factually supported.

On generated tickets, Luna selected all 42 pattern-derived services and 16/18 card-derived services. The two service errors were D047 (NAV Calculation to Identity & Access Management) and D050 (Portfolio Accounting to Cash Management). It selected the correct service for 29/30 misleading-title tickets. Its top retrieved pattern matched the source pattern in 13/42 pattern cases and the intended resolver in 18/42. Assignment now uses all patterns for the selected service, so this retrieval result no longer limits the assignee score in the same way.

The dev-set work-type, urgency, and impact labels came from Apertus during generation. The 11 handwritten cases offer a small independent check. Both models wrote some closure comments that assert fixes not present in the ticket. Treat comments as drafts for review.

Detailed local artifacts, ignored by Git: `outputs/evaluation_20260925-030929.json`, `outputs/decisions_20260925-030929.json`, `outputs/evaluation_20260925-030951.json`, and `outputs/decisions_20260925-030951.json`. The old Luna runs are `outputs/evaluation_20260925-023633.json` and `outputs/evaluation_20260925-023950.json` with matching decision files. To rerun from `core/`, load `OPENAI_API_KEY` from the project `.env`, set `LLM_PROVIDER=openai` and `TRIAGE_MODEL=gpt-6-luna`, and run `eval/evaluate.py --file eval/handwritten.json --samples 3 --evidence --comment --concurrency 2` and then the same command with `--file eval/devset.json`.
