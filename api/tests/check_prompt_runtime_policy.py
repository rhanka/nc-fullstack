#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = ROOT / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src import core, prompt as prompt_module  # type: ignore  # noqa: E402


class RecordingLlm:
    instances = []

    def __init__(self, model="default-model"):
        self.model = model
        self.chat_calls = []
        self.stream_calls = []
        RecordingLlm.instances.append(self)

    async def chat(self, messages, temperature=0, json_mode=False):
        self.chat_calls.append(
            {
                "messages": messages,
                "temperature": temperature,
                "json_mode": json_mode,
                "model": self.model,
            }
        )
        return "ok"

    async def stream_chat(self, messages, temperature=0, json_mode=False):
        self.stream_calls.append(
            {
                "messages": messages,
                "temperature": temperature,
                "json_mode": json_mode,
                "model": self.model,
            }
        )
        yield "chunk"


async def main() -> None:
    prompts = prompt_module.build_prompt_registry()
    propose_000 = prompts["000"]
    if getattr(propose_000, "legacy_llm_id", "") != "openai:OpenAI-FA:gpt-4.1":
        raise AssertionError("expected legacy llmId metadata to be preserved on prompt load")

    original_prompts = core.PROMPTS
    original_providers = core.PROVIDERS
    core.PROMPTS = prompts
    core.PROVIDERS = {"openai": RecordingLlm}

    try:
        RecordingLlm.instances.clear()
        await core.run_prompt(
            "000",
            "openai",
            role="000",
            user_message="test",
            description="desc",
            search_docs="[]",
            search_nc="[]",
            history="{}",
        )
        if len(RecordingLlm.instances) != 1:
            raise AssertionError("run_prompt should instantiate exactly one provider client")
        run_instance = RecordingLlm.instances[0]
        if run_instance.model != "default-model":
            raise AssertionError("run_prompt should not override the provider model from prompt llmId")

        RecordingLlm.instances.clear()
        chunks = []
        async for chunk in core.stream_prompt(
            "000",
            "openai",
            role="000",
            user_message="test",
            description="desc",
            search_docs="[]",
            search_nc="[]",
            history="{}",
        ):
            chunks.append(chunk)
        if chunks != ["chunk"]:
            raise AssertionError("stream_prompt should keep streaming behavior intact")
        if len(RecordingLlm.instances) != 1:
            raise AssertionError("stream_prompt should instantiate exactly one provider client")
        stream_instance = RecordingLlm.instances[0]
        if stream_instance.model != "default-model":
            raise AssertionError("stream_prompt should not override the provider model from prompt llmId")
    finally:
        core.PROMPTS = original_prompts
        core.PROVIDERS = original_providers

    print("PASS prompts keep legacy llmId metadata but runtime model selection stays centralized")


if __name__ == "__main__":
    asyncio.run(main())
