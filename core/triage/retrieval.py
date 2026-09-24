"""Embeddings (bge-small, CPU) and numpy cosine top-k over patterns and service cards."""
import hashlib
import json
import threading
from pathlib import Path

import numpy as np

from triage import config
from triage.catalog import split_comment


def ticket_text(record: dict) -> str:
    """Description + comment bodies (authors stripped). The title and the reported
    service are deliberately left out: both are misleading on purpose in the challenge."""
    parts = [record.get("Description") or ""]
    parts += [split_comment(c)[1] for c in record.get("All Comments") or []]
    return "\n".join(p for p in parts if p).strip()


def pattern_text(pattern: dict) -> str:
    return pattern["text"].removeprefix(config.RESOLUTION_PREFIX)


def card_text(card: dict) -> str:
    return " ".join(x for x in (f"{card['service']}.", card["scope"], card.get("boundary") or "") if x)


def top_k(query: np.ndarray, matrix: np.ndarray, k: int) -> list[tuple[int, float]]:
    """Indices and cosine scores of the k best rows (rows and query L2-normalised)."""
    scores = matrix @ query
    order = np.argsort(-scores, kind="stable")[:k]
    return [(int(i), float(scores[i])) for i in order]


class Embedder:
    def __init__(self, model_name: str = config.EMBED_MODEL):
        self.model_name = model_name
        self._model = None

    def encode(self, texts: list[str]) -> np.ndarray:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name, device="cpu")
        return np.asarray(
            self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False), dtype=np.float32
        )


def _texts_key(model_name: str, texts: list[str]) -> str:
    return hashlib.sha256(json.dumps([model_name, texts], ensure_ascii=False).encode()).hexdigest()


def cached_encode(embedder, texts: list[str], name: str, path: Path | None = config.EMBEDDINGS_PATH) -> np.ndarray:
    """Encode `texts`, reusing artifacts/embeddings.npz when the texts and model are unchanged."""
    key = _texts_key(getattr(embedder, "model_name", "?"), texts)
    store = {}
    if path is not None and path.exists():
        with np.load(path) as f:
            store = dict(f)
        if f"{name}__key" in store and str(store[f"{name}__key"]) == key:
            return store[name]
    vectors = embedder.encode(texts)
    if path is not None:
        store.update({name: vectors, f"{name}__key": np.array(key)})
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, **store)
    return vectors


class Retriever:
    def __init__(self, catalog: dict, cards: dict, embedder=None, cache_path: Path | None = config.EMBEDDINGS_PATH):
        self.embedder = embedder or Embedder()
        self.patterns = catalog["patterns"]
        self.cards = cards["cards"]
        self.pattern_vecs = cached_encode(self.embedder, [pattern_text(p) for p in self.patterns], "patterns", cache_path)
        self.card_vecs = cached_encode(self.embedder, [card_text(c) for c in self.cards], "cards", cache_path)
        self._lock = threading.Lock()  # the embedder is shared across worker threads

    def retrieve(self, record: dict, k_patterns: int = config.TOP_K_PATTERNS, k_cards: int = config.TOP_K_CARDS) -> dict:
        with self._lock:
            q = self.embedder.encode([ticket_text(record)])[0]
        card_scores = self.card_vecs @ q
        pattern_scores = self.pattern_vecs @ q
        return {
            "pattern_scores": {p["id"]: float(s) for p, s in zip(self.patterns, pattern_scores)},
            "card_scores": {c["service"]: float(s) for c, s in zip(self.cards, card_scores)},
            "patterns": [{**self.patterns[i], "score": s} for i, s in top_k(q, self.pattern_vecs, k_patterns)],
            "cards": [{**self.cards[i], "score": s} for i, s in top_k(q, self.card_vecs, k_cards)],
        }
