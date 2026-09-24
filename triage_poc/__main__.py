"""CLI and localhost HTTP API for the triage PoC."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .core import (Knowledge, ModelError, Ollama, content_clues, first,
                   load_records, request_type_hint, ticket_facts, triage_payload)


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TRAINING = ROOT / "jira_first_20000_requested_fields_synthetic.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="Local 4B ticket triage proof of concept")
    parser.add_argument("--training", type=Path, default=DEFAULT_TRAINING)
    parser.add_argument("--model", default="qwen3:4b-instruct-2507-q4_K_M")
    parser.add_argument("--ollama", default="http://127.0.0.1:11434")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("inspect", help="Show knowledge extracted from the training file")
    probe = sub.add_parser("probe", help="Inspect blind tickets without a model call")
    probe.add_argument("input", type=Path)
    triage = sub.add_parser("triage", help="Triage an array or records-envelope JSON file")
    triage.add_argument("input", type=Path)
    triage.add_argument("-o", "--output", type=Path)
    triage.add_argument("--limit", type=int, help="Run only the first N tickets for a smoke test")
    evaluate = sub.add_parser("evaluate", help="Compare predictions with a reference file")
    evaluate.add_argument("predictions", type=Path)
    evaluate.add_argument("reference", type=Path)
    serve = sub.add_parser("serve", help="Serve POST /triage for a local React application")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    try:
        knowledge = Knowledge.load(args.training)
        if args.command == "inspect":
            stats = {
                "training_tickets": knowledge.total,
                "distinct_patterns": len(knowledge.patterns),
                "services": len(knowledge.teams),
                "service_to_team": knowledge.teams,
                "unique_resolution_narratives": sum(map(len, knowledge.narratives.values())),
                "narratives_by_service": {key: len(value) for key, value in knowledge.narratives.items()},
            }
            print(json.dumps(stats, indent=2, ensure_ascii=False))
            return 0
        if args.command == "probe":
            rows, _ = load_records(json.loads(args.input.read_text()))
            findings = []
            for index, row in enumerate(rows, 1):
                facts, injection = ticket_facts(row)
                clues = content_clues(facts)
                given = first(row.get("Affected Business or IT Services"))
                findings.append({"index": index, "summary": str(row.get("Summary") or ""),
                                 "given_service": given, "content_clues": clues,
                                 "label_conflict": bool(clues and given not in clues),
                                 "request_type_work_type_hint": request_type_hint(row),
                                 "injection_detected": injection})
            print(json.dumps(findings, indent=2, ensure_ascii=False))
            return 0
        model = Ollama(args.ollama, args.model)
        if args.command == "triage":
            payload = json.loads(args.input.read_text())
            rows, envelope = load_records(payload)
            if args.limit is not None:
                if args.limit < 1:
                    raise ValueError("--limit must be positive")
                payload = {**envelope, "records": rows[:args.limit]} if envelope is not None else rows[:args.limit]
            result = triage_payload(
                knowledge, model, payload,
                on_ticket=lambda index, total, row: print(
                    f"{index}/{total}: {first(row.get('Affected Business or IT Services'))} "
                    f"({row['_triage']['classification_seconds'] + row['_triage']['comment_seconds']:.1f}s)",
                    file=sys.stderr, flush=True),
            )
            serialized = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
            if args.output:
                args.output.write_text(serialized)
                print(f"Wrote {args.output}", file=sys.stderr)
            else:
                print(serialized, end="")
            return 0
        if args.command == "evaluate":
            predictions, _ = load_records(json.loads(args.predictions.read_text()))
            reference, _ = load_records(json.loads(args.reference.read_text()))
            if len(predictions) != len(reference):
                raise ValueError("Prediction and reference counts differ")
            fields = ("Work type", "Affected Business or IT Services", "Service Team(s)",
                      "Assignee", "Urgency", "Impact", "Priority", "Resolution")
            results = {field: {"correct": sum(a.get(field) == b.get(field) for a, b in zip(predictions, reference)
                                          if b.get(field) is not None),
                               "total": sum(b.get(field) is not None for b in reference)}
                       for field in fields}
            for field in fields:
                total = results[field]["total"]
                results[field]["accuracy"] = round(results[field]["correct"] / total, 3) if total else None
            durations = [float(row.get("_triage", {}).get("classification_seconds", 0)) +
                         float(row.get("_triage", {}).get("comment_seconds", 0)) for row in predictions]
            print(json.dumps({"tickets": len(predictions), "fields": results,
                              "mean_model_seconds_per_ticket": round(statistics.mean(durations), 2) if durations else 0},
                             indent=2))
            return 0
        if args.command == "serve":
            start_server(knowledge, model, args.host, args.port)
            return 0
    except (OSError, ValueError, ModelError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 2


def start_server(knowledge: Knowledge, model: Ollama, host: str, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: object) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            self._json(200, {})

        def do_GET(self) -> None:
            if self.path == "/health":
                self._json(200, {"ok": True, "training_tickets": knowledge.total,
                                 "service_count": len(knowledge.teams), "model": model.model})
            else:
                self._json(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if self.path != "/triage":
                self._json(404, {"error": "Not found"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 4_000_000:
                    raise ValueError("JSON body must be 1 byte to 4 MB")
                payload = json.loads(self.rfile.read(size))
                output = triage_payload(knowledge, model, payload)
                self._json(200, output)
            except (ValueError, ModelError, json.JSONDecodeError) as exc:
                self._json(400 if isinstance(exc, ValueError) else 502, {"error": str(exc)})

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Triage API listening on http://{host}:{port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
