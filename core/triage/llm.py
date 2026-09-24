"""Ollama wrapper: structured JSON-schema calls, validation retries, on-disk cache."""
import hashlib
import json
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from triage import config

M = TypeVar("M", bound=BaseModel)

_client = None


def get_client():
    global _client
    if _client is None:
        import ollama

        _client = ollama.Client(host=config.OLLAMA_HOST, timeout=config.LLM_TIMEOUT_S)
    return _client


def _options(temperature: float, seed: int) -> dict:
    return {"temperature": temperature, "seed": seed, "num_ctx": config.NUM_CTX}


def cache_key(model: str, messages: list[dict], schema: dict, options: dict) -> str:
    payload = json.dumps(
        {"model": model, "messages": messages, "schema": schema, "options": options},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_path(key: str, cache_dir: Path) -> Path:
    return cache_dir / f"{key}.json"


def chat_structured(
    messages: list[dict],
    output_model: type[M],
    *,
    model: str | None = None,
    temperature: float = config.TEMPERATURE,
    seed: int = config.SEED,
    use_cache: bool = True,
    cache_dir: Path = config.LLM_CACHE_DIR,
    client=None,
) -> M:
    """One structured call. On a validation failure, truncation or timeout, retry up to
    LLM_MAX_RETRIES times (validation errors are fed back; retries use a shifted seed so
    they are deterministic but not identical). Only validated results are cached, under
    the key of the original request, so reruns are instant and identical."""
    model = model or config.TRIAGE_MODEL
    schema = output_model.model_json_schema()
    options = _options(temperature, seed)
    key = cache_key(model, messages, schema, options)  # the output cap is not part of the key
    max_tokens = config.MAX_TOKENS.get(output_model.__name__, config.MAX_TOKENS_DEFAULT)
    path = _cache_path(key, cache_dir)

    if use_cache and path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        return output_model.model_validate_json(cached["content"])

    client = client or get_client()
    convo = list(messages)
    last_error: Exception | None = None
    for attempt in range(1 + config.LLM_MAX_RETRIES):
        call_options = {**options, "seed": options["seed"] + 1000 * attempt, "num_predict": max_tokens}
        try:
            response = client.chat(model=model, messages=convo, format=schema, options=call_options,
                                   keep_alive=config.KEEP_ALIVE)
        except Exception as e:  # noqa: BLE001 - timeouts / transient backend errors are retried
            if not _is_transient(e):
                raise
            last_error = e
            continue
        content = response["message"]["content"]
        if _field(response, "done_reason") == "length":
            last_error = RuntimeError(f"output hit the {max_tokens}-token cap")
            continue  # truncated JSON: retry with the shifted seed, do not feed the garbage back
        try:
            result = output_model.model_validate_json(content)
        except ValidationError as e:
            last_error = e
            convo = convo + [
                {"role": "assistant", "content": content[:2000]},
                {"role": "user", "content": f"That output failed validation:\n{e}\nReturn corrected JSON only."},
            ]
            continue
        if use_cache:
            cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    {"model": model, "attempts": attempt + 1, "schema": output_model.__name__, "content": content},
                    ensure_ascii=False,
                    indent=1,
                ),
                encoding="utf-8",
            )
        return result
    raise RuntimeError(f"{output_model.__name__} failed after {1 + config.LLM_MAX_RETRIES} attempts: {last_error}") from last_error


def _field(response, name: str):
    try:
        return response[name]
    except (KeyError, AttributeError, TypeError):
        return None


def _is_transient(e: Exception) -> bool:
    import httpx

    return isinstance(e, (httpx.TimeoutException, httpx.NetworkError))
