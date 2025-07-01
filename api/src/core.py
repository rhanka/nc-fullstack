from typing import Dict, Any, List, AsyncGenerator
import json
from src.prompt import build_prompt_registry
from src.llm import PROVIDERS

PROMPTS = build_prompt_registry()

async def run_prompt(name: str, provider: str, **variables):
    if name not in PROMPTS:
        raise ValueError(f"Prompt {name} not found")
    prompt = PROMPTS[name]
    rendered = prompt.render(**variables)
    llm_class = PROVIDERS.get(provider)
    if not llm_class:
        raise ValueError(f"Provider {provider} not supported")
    llm = llm_class()
    messages = []
    if rendered["system"]:
        messages.append({"role": "system", "content": rendered["system"]})
    messages.append({"role": "user", "content": rendered["user"]})
    return await llm.chat(messages, temperature=prompt.temperature, json_mode=prompt.json_mode)

async def stream_prompt(name: str, provider: str, **variables) -> AsyncGenerator[str, None]:
    if name not in PROMPTS:
        raise ValueError(f"Prompt {name} not found")
    prompt = PROMPTS[name]
    rendered = prompt.render(**variables)
    llm_class = PROVIDERS.get(provider)
    if not llm_class:
        raise ValueError(f"Provider {provider} not supported")
    llm = llm_class()
    messages = []
    if rendered["system"]:
        messages.append({"role": "system", "content": rendered["system"]})
    messages.append({"role": "user", "content": rendered["user"]})
    async for chunk in llm.stream_chat(messages, temperature=prompt.temperature, json_mode=prompt.json_mode):
        yield chunk 