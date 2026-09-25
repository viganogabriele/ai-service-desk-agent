# GPT-6 Luna medium / standard on the 300-ticket comparison set

Dataset SHA-256: `7ec30dec1ca3f0d6fec1f8ff56280e292a9a8967ee39a21f070530262029e07d`. Model `gpt-6-luna`, reasoning effort `medium`, reasoning mode `standard`; KB `v1-7abf0d94`, prompt `triage-3fca6d90c2`, policy `p1-b8d897c2`.

The main run used one deterministic triage call per ticket (`--samples 0`) with no evidence or draft-comment generation. All 300 completed without warnings. Exact-match results:

| Source | Cases | Service | Work type | Resolution | Urgency | Impact | Priority |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Handwritten | 50 | 47 | 50 | 48 | 32 | 42 | 39 |
| Generated | 250 | 242 | 248 | 248 | 193 | 165 | 180 |
| Total | 300 | 289 | 298 | 296 | 225 | 207 | 219 |

Assignee matched 130 of 137 labelled cases. The [JSON result](gpt-6-luna-medium-standard.json) contains all per-ticket predictions, labels, scores and settings. The [handwritten-only JSON result](gpt-6-luna-medium-standard-handwritten.json) used three consistency samples plus evidence and draft comments: 50/50 completed, 180/250 AI fields had a verified evidence span, and all 50 draft comments were written. Five comments were flagged for unsupported specifics.

The urgency and impact labels involve judgment, particularly in generated cases. Luna wrote the generated tickets, so the generated-case score is an optimistic comparison point. Use the frozen dataset hash and the same evaluation flags when comparing another model.
