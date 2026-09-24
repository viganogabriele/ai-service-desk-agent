"""The loaded engine the API workers call: one KB version, one policy, one model. It is
the same library code as the CLI (run_ticket / generate_comment), loaded once."""
from triage import config
from triage.schemas import DecisionRecord, ResolutionCommentRecord, RunRecord, RunVersions


class Engine:
    def __init__(self, n_samples: int = config.SELF_CONSISTENCY_N, evidence: bool = config.EVIDENCE_ENABLED,
                 comment: bool = config.COMMENT_ENABLED):
        from triage.catalog import load_catalog, load_service_cards
        from triage.triage import triage_versions

        self.catalog = load_catalog()
        self.cards = load_service_cards()
        self.versions: RunVersions = triage_versions()
        self.n_samples, self.evidence, self.comment = n_samples, evidence, comment
        self._retriever = None

    @property
    def retriever(self):
        if self._retriever is None:  # loading the embedding model takes a few seconds
            from triage.retrieval import Retriever

            self._retriever = Retriever(self.catalog, self.cards)
        return self._retriever

    def run(self, fields: dict, ticket_id: str, run_id: str) -> RunRecord:
        from triage.triage import run_ticket

        return run_ticket(fields, ticket_id, run_id, self.retriever, self.cards, self.catalog, self.versions,
                          n_samples=self.n_samples, evidence=self.evidence, comment=self.comment)

    def regenerate_comment(self, fields: dict, decisions: dict[str, DecisionRecord]) -> ResolutionCommentRecord:
        """A comment for the effective state (effective values drive the prompt)."""
        from triage.resolution import generate_comment

        retrieved = self.retriever.retrieve(fields)
        return generate_comment(fields, decisions, retrieved, self.catalog)
