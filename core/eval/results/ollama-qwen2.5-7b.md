# Ollama qwen2.5:7b on the 300-ticket comparison set

This run used the Mac mini Ollama endpoint and `qwen2.5:7b` from `core/AGENTS.md`. The dataset SHA-256 is `7ec30dec1ca3f0d6fec1f8ff56280e292a9a8967ee39a21f070530262029e07d`; prompt `triage-3fca6d90c2`, KB `v1-7abf0d94`, policy `p1-b8d897c2`.

The main comparison used one temperature-zero triage call per ticket (`--samples 0`), without evidence or draft comments. All 300 completed without warnings. Exact-match results:

| Source | Cases | Service | Work type | Resolution | Urgency | Impact | Priority |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Handwritten | 50 | 44 | 48 | 42 | 32 | 30 | 33 |
| Generated | 250 | 181 | 180 | 209 | 181 | 159 | 171 |
| Total | 300 | 225 | 228 | 251 | 213 | 189 | 204 |

Assignee matched 109 of 137 labelled cases. The [JSON result](ollama-qwen2.5-7b.json) contains the per-ticket labels, predictions, settings and scores. For comparison, Luna matched 289 services, 298 work types, 296 resolutions and 219 priorities on the same 300 cases with the same main-run flags.

The [handwritten-only detailed run](ollama-qwen2.5-7b-handwritten.json) used three consistency samples, evidence extraction and draft comments. All 50 cases completed; 5 of 250 AI fields had a verified ticket evidence span, all 50 draft comments were written, and six comments were flagged for unsupported specifics. The same Luna check found verified spans for 180 of 250 fields and flagged five comments.

Urgency and impact labels are judgments, especially in generated cases. Luna generated 250 tickets, so its scores on that portion may be optimistic. Use the frozen dataset and the same flags for further comparisons.
