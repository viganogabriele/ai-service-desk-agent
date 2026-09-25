# 300-ticket comparison set

`comparison_300.json` contains 50 handwritten tickets (`H01`–`H50`) and 250 generated tickets (`D001`–`D250`). The handwritten cases were drafted independently from generic asset-management operations and the training catalog. The generated cases use only the reviewed service cards and training-derived resolution patterns; neither source uses the challenge tickets.

The generated tickets were written with `gpt-6-luna`, medium reasoning effort and standard mode. Their service, resolution and pattern-based assignee labels follow the source scenario. Work type, urgency and impact come from the generator and are softer labels. Many tickets deliberately report the wrong service or have a misleading title. The set includes actionable incidents and requests, incomplete requests, self-cleared alerts and nonsense.

From `core/`, with the project `.env` loaded:

```sh
LLM_PROVIDER=openai TRIAGE_MODEL=gpt-6-luna OPENAI_REASONING_EFFORT=medium OPENAI_REASONING_MODE=standard \
  .venv/bin/python eval/make_devset.py --concurrency 8
.venv/bin/python eval/make_comparison_set.py
LLM_PROVIDER=openai TRIAGE_MODEL=gpt-6-luna OPENAI_REASONING_EFFORT=medium OPENAI_REASONING_MODE=standard \
  .venv/bin/python eval/evaluate.py --file eval/comparison_300.json --samples 0 \
  --concurrency 8 --results-file eval/results/gpt-6-luna-medium-standard.json
```

For another model, evaluate the frozen `comparison_300.json` with the same evaluation flags and use a different `--results-file`. The main run measures label decisions with one deterministic triage call per ticket. The result records the dataset SHA-256, model and prompt versions, settings, per-ticket predictions and aggregate metrics. Because Luna wrote the generated tickets, its score on those 250 cases may be optimistic; compare the 50 handwritten cases separately as an independent check. The handwritten-only result in `results/` also includes three consistency samples, evidence and draft comments.

The local Ollama comparison uses the configured Mac mini endpoint and its installed `qwen2.5:7b` model:

```sh
LLM_PROVIDER=ollama TRIAGE_MODEL=qwen2.5:7b .venv/bin/python eval/evaluate.py \
  --file eval/comparison_300.json --samples 0 --concurrency 2 \
  --results-file eval/results/ollama-qwen2.5-7b.json
LLM_PROVIDER=ollama TRIAGE_MODEL=qwen2.5:7b .venv/bin/python eval/evaluate.py \
  --file eval/handwritten.json --samples 3 --evidence --comment --concurrency 2 \
  --results-file eval/results/ollama-qwen2.5-7b-handwritten.json
```
