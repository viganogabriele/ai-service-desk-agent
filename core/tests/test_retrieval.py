import numpy as np

from triage.retrieval import Retriever, cached_encode, ticket_text, top_k

VOCAB = ["lock", "sync", "mailbox", "nav", "price", "allocation", "broker"]


class BagEmbedder:
    """Deterministic toy embedder: normalised keyword counts."""

    model_name = "bag"

    def __init__(self):
        self.calls = 0

    def encode(self, texts):
        self.calls += 1
        m = np.array([[t.lower().count(w) for w in VOCAB] for t in texts], dtype=np.float32) + 1e-3
        return m / np.linalg.norm(m, axis=1, keepdims=True)


CATALOG = {
    "patterns": [
        {"id": "P01", "service": "SimCorp Dimension", "resolver": "a", "text": "Resolution: Cleared the lock and reran the sync."},
        {"id": "P02", "service": "Outlook & Email", "resolver": "b", "text": "Resolution: Provisioned the shared mailbox."},
        {"id": "P03", "service": "Trade Matching", "resolver": "c", "text": "Resolution: Fixed the broker allocation mapping."},
    ]
}
CARDS = {"cards": [
    {"service": "NAV Calculation", "scope": "NAV strike and tolerance breaches.", "boundary": None},
    {"service": "Fund Pricing", "scope": "Security price feeds.", "boundary": "NAV breaches go to NAV Calculation."},
]}


def test_top_k_orders_by_cosine():
    m = np.eye(3, dtype=np.float32)
    q = np.array([0.1, 0.9, 0.3], dtype=np.float32)
    assert [i for i, _ in top_k(q, m, 2)] == [1, 2]


def test_ticket_text_strips_authors_and_reported_service():
    rec = {"Summary": "S", "Description": "D", "Affected Business or IT Services": ["Wrong Service"],
           "All Comments": ["a@x.com: first", "b@x.com: second"]}
    text = ticket_text(rec)
    assert text == "D\nfirst\nsecond"  # no title, no reported service


def test_retriever_ranks_patterns_and_cards(tmp_path):
    r = Retriever(CATALOG, CARDS, embedder=BagEmbedder(), cache_path=tmp_path / "e.npz")
    out = r.retrieve({"Summary": "Position sync stuck", "Description": "A table lock blocks the sync job."}, 2, 1)
    assert out["patterns"][0]["id"] == "P01" and len(out["patterns"]) == 2
    assert out["patterns"][0]["score"] >= out["patterns"][1]["score"]
    assert len(out["cards"]) == 1


def test_embedding_cache_reused_until_texts_change(tmp_path):
    emb, path = BagEmbedder(), tmp_path / "e.npz"
    a = cached_encode(emb, ["lock", "nav"], "x", path)
    b = cached_encode(emb, ["lock", "nav"], "x", path)
    assert emb.calls == 1 and np.array_equal(a, b)
    cached_encode(emb, ["lock", "price"], "x", path)
    assert emb.calls == 2
