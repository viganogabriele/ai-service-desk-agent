"""Structured calls through Ollama, Swisscom, or OpenAI, with retries and disk cache."""
import hashlib
import json
import os
import time
from pathlib import Path
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from triage import config, usage

M = TypeVar("M", bound=BaseModel)

_client = None


def get_client():
    global _client
    if _client is None:
        import ollama

        _client = ollama.Client(host=config.OLLAMA_HOST, timeout=config.LLM_TIMEOUT_S)
    return _client


def resolve_model(model: str) -> tuple[str, str]:
    """Qualified names select a provider per call; bare names keep the CLI default."""
    prefix, separator, name = model.partition("/")
    provider = prefix if separator and prefix in ("ollama", "swisscom", "openai") else config.LLM_PROVIDER
    name = name if separator and prefix == provider else model
    if provider not in ("ollama", "swisscom", "openai"):
        raise ValueError(f"Unknown LLM provider: {provider}")
    if not name.strip():
        raise ValueError("A model name is required after the provider prefix")
    return provider, name


def require_provider_key(provider: str) -> None:
    variable = {"openai": "OPENAI_API_KEY", "swisscom": "APERTUS_API_KEY"}.get(provider)
    if variable and not os.getenv(variable, "").strip():
        raise ValueError(f"Set {variable} in the Core server environment, then restart the Core.")


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


def _swisscom_chat(model: str, messages: list[dict], schema: dict, options: dict) -> dict:
    key = os.getenv("APERTUS_API_KEY")
    if not key:
        raise RuntimeError("APERTUS_API_KEY is required for the Swisscom provider")
    # Swisscom's schema mode hangs on the full triage schema; JSON object mode
    # completes, and the Pydantic validation below enforces the field contract.
    schema_instruction = "Return one JSON object matching this schema exactly:\n" + json.dumps(schema, ensure_ascii=False)
    prompt = [dict(message) for message in messages]
    if prompt and prompt[0]["role"] == "system":
        prompt[0]["content"] += "\n\n" + schema_instruction
    else:
        prompt.insert(0, {"role": "system", "content": schema_instruction})
    started = time.monotonic()
    response = httpx.post(
        config.SWISSCOM_API_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "messages": prompt,
            "response_format": {"type": "json_object"},
            "temperature": options["temperature"],
            "seed": options["seed"],
            "max_tokens": options["num_predict"],
        },
        timeout=config.LLM_TIMEOUT_S,
    )
    response.raise_for_status()
    payload = response.json()
    choice = payload["choices"][0]
    return {"message": {"content": choice["message"]["content"]}, "done_reason": choice["finish_reason"],
            "usage": payload.get("usage"), "elapsed_s": round(time.monotonic() - started, 3)}


def _openai_chat(model: str, messages: list[dict], schema: dict, options: dict) -> dict:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is required for the OpenAI provider")
    prompt = [dict(message) for message in messages]
    instruction = "Return one JSON object matching this schema exactly:\n" + json.dumps(schema, ensure_ascii=False)
    if prompt and prompt[0]["role"] == "system":
        prompt[0]["content"] += "\n\n" + instruction
    else:
        prompt.insert(0, {"role": "system", "content": instruction})
    started = time.monotonic()
    response = httpx.post(
        config.OPENAI_API_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "input": prompt,
            "text": {"format": {"type": "json_object"}},
            "reasoning": {"effort": config.OPENAI_REASONING_EFFORT, "mode": config.OPENAI_REASONING_MODE},
            "max_output_tokens": options["num_predict"],
            "store": False,
        },
        timeout=config.OPENAI_TIMEOUT_S,
    )
    response.raise_for_status()
    payload = response.json()
    content = "".join(
        item.get("text", "") for output in payload.get("output", []) if output.get("type") == "message"
        for item in output.get("content", []) if item.get("type") == "output_text"
    )
    return {"message": {"content": content}, "done_reason": "length" if payload.get("status") == "incomplete" else payload.get("status"),
            "usage": payload.get("usage"), "elapsed_s": round(time.monotonic() - started, 3)}


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
    LLM_MAX_RETRIES times (validation errors are fed back; retries use a shifted seed
    where the provider supports it). Only validated results are cached, under
    the key of the original request, so reruns are instant and identical."""
    model = model or config.TRIAGE_MODEL
    schema = output_model.model_json_schema()
    options = _options(temperature, seed)
    provider, model = resolve_model(model)
    key_model = model if provider == "ollama" else f"{provider}:{model}"
    if provider != "ollama":
        endpoint = config.OPENAI_API_URL if provider == "openai" else config.SWISSCOM_API_URL
        key_model += f":{endpoint}"
    if provider == "openai":
        key_model += f":{config.OPENAI_REASONING_EFFORT}:{config.OPENAI_REASONING_MODE}"
    key = cache_key(key_model, messages, schema, options)  # the output cap is not part of the key
    max_tokens = config.MAX_TOKENS.get(output_model.__name__, config.MAX_TOKENS_DEFAULT)
    if provider == "swisscom" and output_model.__name__ == "TriageSample":
        max_tokens = max(max_tokens, 200)
    if provider == "openai":
        max_tokens = max(2048, max_tokens * 6)
    path = _cache_path(key, cache_dir)

    schema_name = output_model.__name__
    if use_cache and path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        # entries written before the ledger carry only the provider's raw usage
        usage.record(provider, model, schema_name, "cache_hit", cached.get("tokens") or usage.tokens(provider, cached))
        return output_model.model_validate_json(cached["content"])

    if provider == "ollama":
        client = client or get_client()
    convo = list(messages)
    last_error: Exception | None = None
    for attempt in range(1 + config.LLM_MAX_RETRIES):
        call_options = {**options, "seed": options["seed"] + 1000 * attempt, "num_predict": max_tokens}
        started = time.monotonic()
        try:
            if provider == "ollama":
                response = client.chat(model=model, messages=convo, format=schema, options=call_options,
                                       keep_alive=config.KEEP_ALIVE)
            elif provider == "swisscom":
                response = _swisscom_chat(model, convo, schema, call_options)
            else:
                response = _openai_chat(model, convo, schema, call_options)
        except Exception as e:  # noqa: BLE001 - timeouts / transient backend errors are retried
            usage.record(provider, model, schema_name, "error", latency_ms=_ms_since(started))
            if not _is_transient(e):
                raise
            last_error = e
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429:
                time.sleep(min(float(e.response.headers.get("retry-after", "5")), 60))
            continue
        content = response["message"]["content"]
        counts, latency = usage.tokens(provider, response), _ms_since(started)
        if _field(response, "done_reason") == "length":
            usage.record(provider, model, schema_name, "retry", counts, latency)
            last_error = RuntimeError(f"output hit the {max_tokens}-token cap")
            continue  # truncated JSON: retry with the shifted seed, do not feed the garbage back
        if provider in ("swisscom", "openai"):
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict) and list(parsed) == [output_model.__name__]:
                content = json.dumps(parsed[output_model.__name__], ensure_ascii=False)
        try:
            result = output_model.model_validate_json(content)
        except ValidationError as e:
            usage.record(provider, model, schema_name, "retry", counts, latency)
            last_error = e
            convo = convo + [
                {"role": "assistant", "content": content[:2000]},
                {"role": "user", "content": f"That output failed validation:\n{e}\nReturn corrected JSON only."},
            ]
            continue
        usage.record(provider, model, schema_name, "ok", counts, latency)
        if use_cache:
            cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    {"provider": provider, "model": model, "attempts": attempt + 1,
                     "schema": schema_name, "content": content, "usage": _field(response, "usage"),
                     "tokens": counts, "elapsed_s": _field(response, "elapsed_s")},
                    ensure_ascii=False,
                    indent=1,
                ),
                encoding="utf-8",
            )
        return result
    raise RuntimeError(f"{schema_name} failed after {1 + config.LLM_MAX_RETRIES} attempts: {last_error}") from last_error


def _field(response, name: str):
    try:
        return response[name]
    except (KeyError, AttributeError, TypeError):
        return None


def _ms_since(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def _is_transient(e: Exception) -> bool:
    return (isinstance(e, (httpx.TimeoutException, httpx.NetworkError)) or
            isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (429, 500, 502, 503, 504))
