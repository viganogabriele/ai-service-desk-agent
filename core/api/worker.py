"""In-process background queue: 1-2 worker threads (a local LLM cannot serve more), first
in first out, with priority 0 jumping ahead (human-requested re-triage / comments)."""
import itertools
import queue
import threading


class WorkerPool:
    def __init__(self, core, workers: int):
        self.core, self.workers = core, workers
        self.q: queue.PriorityQueue = queue.PriorityQueue()
        self._order = itertools.count()
        self._threads: list[threading.Thread] = []
        core.submit = self.submit

    def submit(self, kind: str, priority: int, **payload) -> None:
        if self.workers == 0:  # inline mode (tests, scripts): run now, deterministically
            self._handle(kind, payload)
        elif kind == "blind_test":
            # Minutes of cloud calls on a judge's file: its own thread, so live tickets keep their workers.
            threading.Thread(target=self._handle, args=(kind, payload), daemon=True,
                             name=f"blind-test-{payload['pipeline']}").start()
        else:
            self.q.put((priority, next(self._order), kind, payload))

    def _handle(self, kind: str, payload: dict) -> None:
        if kind == "run":
            self.core.process_run(payload["run_id"])
        elif kind == "comment":
            self.core.process_comment(payload["ticket_id"])
        elif kind == "kb_build":
            self.core.process_kb_build(payload["actor"])
        elif kind == "evaluation":
            self.core.process_evaluation(payload["evaluation_id"])
        elif kind == "blind_test":
            self.core.process_blind_test(payload["blind_test_id"], payload["pipeline"])

    def _loop(self) -> None:
        while True:
            _, _, kind, payload = self.q.get()
            if kind == "stop":
                return
            try:
                self._handle(kind, payload)
            finally:
                self.q.task_done()

    def start(self) -> None:
        for i in range(self.workers):
            t = threading.Thread(target=self._loop, name=f"triage-worker-{i}", daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        for _ in self._threads:
            self.q.put((99, next(self._order), "stop", {}))
        for t in self._threads:
            t.join(timeout=5)

    def depth(self) -> int:
        return self.q.qsize()
