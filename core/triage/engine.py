"""The loaded engine the API workers call: one live KB version, the current policy, one
model. It is the same library code as the CLI (run_ticket / generate_comment)."""
import threading

from triage import config
from triage.schemas import DecisionRecord, ResolutionCommentRecord, RunRecord, RunVersions


class Engine:
    def __init__(self, n_samples: int = config.SELF_CONSISTENCY_N, evidence: bool = config.EVIDENCE_ENABLED,
                 comment: bool = config.COMMENT_ENABLED, kb_store=None, model: str | None = None,
                 kb_version: str | None = None, embedder=None):
        from triage.kb import KBStore

        self.kb_store = kb_store or KBStore()
        self.n_samples, self.evidence, self.comment = n_samples, evidence, comment
        self.model = model or config.TRIAGE_MODEL
        self._embedder = embedder
        self._lock = threading.Lock()
        self.use_kb(kb_version or self.kb_store.live() or config.KB_VERSION)

    def variant(self, kb_version: str | None = None, model: str | None = None) -> "Engine":
        """A shadow engine: another KB version and/or model, same embedder (loaded once),
        no evidence or comment calls (shadow runs only compare decisions)."""
        return Engine(n_samples=self.n_samples, evidence=False, comment=False, kb_store=self.kb_store,
                      model=model or self.model, kb_version=kb_version or self.kb_version,
                      embedder=self.retriever.embedder)

    def embed(self, texts: list[str]):
        return self.retriever.embedder.encode(texts)

    def use_kb(self, version: str) -> None:
        """Load a KB version; runs started afterwards use it, earlier runs keep theirs."""
        from triage.triage import triage_versions

        catalog, cards = self.kb_store.load(version)
        kb_dir = self.kb_store.dir(version)
        with self._lock:
            self.kb_version, self.kb_dir = version, kb_dir
            self.catalog, self.cards = catalog, cards
            self.versions: RunVersions = triage_versions(kb_dir, version).model_copy(update={"model": self.model})
            self._retriever = None

    @property
    def retriever(self):
        with self._lock:
            if self._retriever is None:  # loading the embedding model takes a few seconds
                from triage.retrieval import Retriever

                self._retriever = Retriever(self.catalog, self.cards, embedder=self._embedder,
                                            cache_path=self.kb_dir / "embeddings.npz")
            return self._retriever

    def run(self, fields: dict, ticket_id: str, run_id: str, policy: dict | None = None,
            policy_version: str | None = None) -> RunRecord:
        from triage.triage import run_ticket

        from functools import partial

        from triage.llm import chat_structured

        versions = self.versions.model_copy(update={"policy": policy_version}) if policy_version else self.versions
        return run_ticket(fields, ticket_id, run_id, self.retriever, self.cards, self.catalog, versions,
                          chat=partial(chat_structured, model=self.model), n_samples=self.n_samples,
                          evidence=self.evidence, comment=self.comment, policy=policy)

    def regenerate_comment(self, fields: dict, decisions: dict[str, DecisionRecord]) -> ResolutionCommentRecord:
        """A comment for the effective state (effective values drive the prompt)."""
        from triage.resolution import generate_comment

        return generate_comment(fields, decisions, self.retriever.retrieve(fields), self.catalog)

    def demo_ticket(self) -> dict:
        """A new incoming ticket in the challenge format, written by the model from the live KB."""
        import random
        from functools import partial

        from triage.generate import demo_ticket
        from triage.llm import chat_structured

        return demo_ticket(self.catalog, self.cards, random.Random(), chat=partial(chat_structured, model=self.model))

    def generate_cards(self, catalog: dict) -> dict:
        """Draft service cards for a freshly mined catalog (one LLM call per service)."""
        from triage.catalog import build_service_cards

        return build_service_cards(catalog)
