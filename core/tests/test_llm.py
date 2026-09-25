import json

import httpx
import pytest
from pydantic import BaseModel

from triage.llm import cache_key, chat_structured


class Out(BaseModel):
    level: str
    n: int


class FakeClient:
    """Replies are strings (content), dicts (full response) or exceptions (raised)."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def chat(self, **kwargs):
        self.calls.append(kwargs)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r if isinstance(r, dict) else {"message": {"content": r}}


MSG = [{"role": "user", "content": "hi"}]


def test_valid_call_is_cached(tmp_path):
    client = FakeClient([json.dumps({"level": "Low", "n": 1})])
    first = chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client)
    again = chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=FakeClient([]))
    assert first == again == Out(level="Low", n=1)
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["format"] == Out.model_json_schema()
    assert call["options"]["temperature"] == 0 and call["options"]["num_ctx"] >= 8192


def test_retry_feeds_error_back(tmp_path):
    client = FakeClient(['{"level": "Low"}', json.dumps({"level": "Low", "n": 2})])
    assert chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client).n == 2
    assert len(client.calls) == 2
    assert "failed validation" in client.calls[1]["messages"][-1]["content"]


def test_gives_up_after_two_retries(tmp_path):
    client = FakeClient(["{}"] * 3)
    with pytest.raises(RuntimeError):
        chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client)
    assert len(client.calls) == 3
    assert not list(tmp_path.iterdir())  # failures are not cached


def test_cache_key_depends_on_model_prompt_schema():
    s = Out.model_json_schema()
    base = cache_key("m", MSG, s, {})
    assert base != cache_key("m2", MSG, s, {})
    assert base != cache_key("m", [{"role": "user", "content": "x"}], s, {})
    assert base != cache_key("m", MSG, {**s, "title": "x"}, {})


def test_output_is_capped_and_cap_not_in_cache_key(tmp_path):
    client = FakeClient([json.dumps({"level": "Low", "n": 1})])
    chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client)
    assert client.calls[0]["options"]["num_predict"] > 0
    key_opts = {"temperature": 0, "seed": 0, "num_ctx": client.calls[0]["options"]["num_ctx"]}
    assert (tmp_path / f"{cache_key('m', MSG, Out.model_json_schema(), key_opts)}.json").exists()


def test_truncated_output_retried_with_shifted_seed(tmp_path):
    client = FakeClient([{"message": {"content": "{  "}, "done_reason": "length"}, json.dumps({"level": "L", "n": 3})])
    assert chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client).n == 3
    s0, s1 = (c["options"]["seed"] for c in client.calls)
    assert s1 == s0 + 1000 and client.calls[1]["messages"] == MSG  # garbage not fed back


def test_timeout_retried_other_errors_raised(tmp_path):
    import httpx
    client = FakeClient([httpx.ReadTimeout("slow"), json.dumps({"level": "L", "n": 4})])
    assert chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client).n == 4
    with pytest.raises(ValueError):
        chat_structured(MSG, Out, model="m2", cache_dir=tmp_path, client=FakeClient([ValueError("bug")]))


def test_swisscom_uses_json_object_and_validates_result(tmp_path, monkeypatch):
    from triage import config

    sent = []

    def post(url, **kwargs):
        sent.append(kwargs["json"])
        return httpx.Response(
            200, json={"choices": [{"message": {"content": '{"level":"Low","n":2}'},
                                     "finish_reason": "stop"}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(config, "LLM_PROVIDER", "swisscom")
    monkeypatch.setenv("APERTUS_API_KEY", "test-key")
    monkeypatch.setattr("triage.llm.httpx.post", post)
    assert chat_structured(MSG, Out, model="swiss-ai/Apertus-v1.5-70B", cache_dir=tmp_path) == Out(level="Low", n=2)
    assert sent[0]["response_format"] == {"type": "json_object"}
    assert "level" in sent[0]["messages"][0]["content"]


def test_swisscom_unwraps_schema_named_object(tmp_path, monkeypatch):
    from triage import config

    def post(url, **kwargs):
        return httpx.Response(
            200, json={"choices": [{"message": {"content": '{"Out":{"level":"Low","n":2}}'},
                                     "finish_reason": "stop"}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(config, "LLM_PROVIDER", "swisscom")
    monkeypatch.setenv("APERTUS_API_KEY", "test-key")
    monkeypatch.setattr("triage.llm.httpx.post", post)
    assert chat_structured(MSG, Out, model="m", cache_dir=tmp_path) == Out(level="Low", n=2)


def test_openai_uses_high_standard_responses_and_validates(tmp_path, monkeypatch):
    from triage import config

    sent = []

    def post(url, **kwargs):
        sent.append(kwargs["json"])
        return httpx.Response(
            200, json={"status": "completed", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": '{"level":"Low","n":2}'}]}], "usage": {}},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(config, "LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("triage.llm.httpx.post", post)
    assert chat_structured(MSG, Out, model="gpt-6-luna", cache_dir=tmp_path) == Out(level="Low", n=2)
    assert sent[0]["reasoning"] == {"effort": "high", "mode": "standard"}
    assert sent[0]["text"] == {"format": {"type": "json_object"}}
    assert sent[0]["store"] is False
