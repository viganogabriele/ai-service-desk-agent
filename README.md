# Local ticket triage PoC

This backend turns a batch of blind Jira tickets into **draft** triage decisions. It is configured for [Ollama](https://docs.ollama.com/macos) and `qwen3:4b-instruct-2507-q4_K_M`; the intended local deployment is a Mac mini M4 with 24 GB. Python 3.10+ is enough for the backend; it has no pip dependencies.

## Direction after the advisor review

Build the demo around an agent's workflow: **incoming ticket → solver proposal → review/edit → approved triage**. English is sufficient for the challenge. Keep historical anomaly review and measured model economics as optional extensions; all seven official output targets still matter. The team has only the supplied training corpus and blind set; no additional cases are expected. Keep the current Qwen 4B pipeline as the working baseline until a model comparison can measure quality as well as speed.

Read [ADVISOR_REVIEW.md](ADVISOR_REVIEW.md) for the revised scope, demo, experiments and scaling assumptions, and [ANALYSIS.md](ANALYSIS.md) for corrected findings and evidence limits. These supersede recommendations in the archived chats and `report-20tickets.md`; [instructions.md](instructions.md) remains the official specification.

The backend and `dashboard.html` explorer already exist. A new [React dashboard](dashboard/README.md) now implements the PRD's phase 1 queue and persisted review workflow using clearly marked mock proposals. Solver integration and cost comparison remain planned. Approval of a proposal does not execute a repair or close a Jira ticket.

## Run on the Mac

1. [Install and open Ollama for macOS](https://docs.ollama.com/macos). Its local API should be available on port 11434.
2. Download the model:

   ```sh
   ollama pull qwen3:4b-instruct-2507-q4_K_M
   ```

3. From this directory, check what was learned from the training file:

   ```sh
   python3 -m triage_poc inspect
   python3 -m triage_poc probe sample_blind_eval_20.json
   ```

   `probe` needs no model. It shows high-specificity content clues, likely label conflicts and request type hints so the blind input can be inspected before a full run.

4. Triage the development set, then compare its two hand-labelled fields:

   ```sh
   python3 -m triage_poc triage fixtures/dev_input.json -o /tmp/dev_predictions.json
   python3 -m triage_poc evaluate /tmp/dev_predictions.json fixtures/dev_reference.json
   python3 -m triage_poc evaluate /tmp/dev_predictions.json fixtures/dev_reference.json --details
   ```

   The development reference labels only **Work type** and **Affected Business or IT Services**. `--details` shows those expected values beside each prediction. It cannot grade priority, assignee, resolution, or the comment without a reference for those fields.

5. Run the format sample or a newly supplied blind file:

   ```sh
   python3 -m triage_poc triage sample_blind_eval_20.json -o /tmp/triaged_sample.json
   python3 -m triage_poc triage /path/to/new_blind.json -o /tmp/triaged_blind.json
   ```

   For a quick end-to-end model check, add `--limit 1` **after** the `triage` command. The sample has no reference answers, so its output cannot establish accuracy. Record the model's field choices, review flags and measured seconds per ticket before changing prompts or models.

   Open a full result with `python3 -m json.tool /tmp/triaged_blind.json | less`. The blind file has no expected answers in this repo; review its predictions and `_triage.review_flags`, or compare it with an external reference if one becomes available.

To test the Python integration without the model:

```sh
python3 -m unittest discover -s tests -v
```

## React integration

Start the local API:

```sh
python3 -m triage_poc serve --port 8765
```

`GET /health` returns the loaded training count and model name. `POST /triage` accepts either a JSON array or the blind-export envelope with a `records` array, and returns the same shape. The server binds to `127.0.0.1` by default and allows browser requests from a local React development server.

```js
const response = await fetch("http://127.0.0.1:8765/triage", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(blindExport),
});
if (!response.ok) throw new Error((await response.json()).error);
const triaged = await response.json();
```

For each record, the service, team, assignee, work type, urgency, impact, priority and resolution fields are populated. `Resolution text` contains a **draft comment** for human review; the API makes no Jira changes. `_triage` contains the model's short reason, review flags, the historical resolution examples, and timings. Low confidence assignee predictions are flagged.

## How it uses the 20,000 tickets

- Learns the unambiguous service → team mapping and validates it on startup.
- Counts historical assignees for each service and entity. This is only a weak routing convention because the training assignee labels contain little predictive signal.
- Deduplicates the 21 concrete resolution narratives and retrieves up to two for the service selected by the model. Generic ticket summaries are not embedded: the corpus has only 173 summary/description pairs and they mostly reveal their service name literally.
- Keeps the 173 patterns for inspection. Their exact wording does not reliably transfer to natural blind tickets, so they do not override the model.
- Ignores the training priority, urgency, impact and resolution labels as supervision. The 4B model applies the official rubric to the blind ticket; Python computes priority from the official matrix and enforces service → team. The model returns constrained JSON enums, which are checked again by Python. [Ollama documents schema constrained output](https://docs.ollama.com/capabilities/structured-outputs).
- Removes obvious instruction-like sentences from untrusted ticket text before model calls. Review flags show when this happened.

The `fixtures/` set contains six separate, hand-labelled cases for service and work type. It is a smoke benchmark, not a claim about the hidden evaluation. Re-evaluating the saved `output/dev_predictions.json` gives 6/6 for both fields and a recorded mean of 4.74 seconds per ticket. The saved `output/triaged.json` has 20 outputs, all matrix-consistent, and records a mean of 5.80 seconds per ticket across classification and comment generation. Neither artifact records hardware or benchmark conditions; these are saved-run measurements, not a new live run or verified Mac throughput. The 20-ticket output has no reference answers.

The supplied `sample_blind_eval_20.json` and checked-in timestamped challenge export contain identical JSON, so they are one set, not two independent evaluations. Earlier dashboard keyword tuning used these tickets. No ticket-specific output is hardcoded. Do not replay saved predictions as fresh challenge inference or tune prompts to individual blind tickets. The six labelled development fixtures test only service and work type; blind-set label swaps, repeated runs and deterministic checks can reveal instability but cannot establish accuracy. Measure actual deployment throughput locally.

The earlier chats suggest direct logit scoring with Rizzo Flow and possibly Apertus Mini 4B. This PoC uses a quantized 4B instruct model with constrained JSON because it is a simpler end-to-end baseline that also writes resolution comments. It makes **two model calls per ticket** (classification, then comment) and deliberately does not claim the logits/KV-cache speedups discussed in those chats. Measure this baseline first; a logit classifier or an Apertus swap can be compared using the same fixtures and output contract.

If Ollama stops a response at the output-token limit, the backend retries that call with twice the token budget (up to two retries). A failed batch still exits without writing the requested output file, so rerunning `triage` currently processes that batch from the beginning.

Saved 20-ticket timing averages 3.06 seconds for classification and 2.73 seconds for comment generation. Token counts and hardware conditions were not captured. Proposed speedups from a smaller model, parallel requests or prompt caching remain unmeasured; shrinking the model cannot be called quality-preserving with the current reference labels. See [ANALYSIS.md](ANALYSIS.md) for the review issues in saved drafts and [the dated model comparison](chats/2026-09-24-jev-local-contextual-models.md) for alternative roles.
