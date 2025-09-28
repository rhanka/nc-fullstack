from typing import Dict, Any, List, AsyncGenerator
import json
from src.prompt import build_prompt_registry
from src.llm import PROVIDERS

PROMPTS = build_prompt_registry()

def _parse_llm_id(llm_id: str) -> tuple[str | None, str | None]:
    """Retourne (provider, model) à partir d'un llmId de type 'openai:xxx:gpt-5-mini'."""
    if not llm_id or ":" not in llm_id:
        return (None, None)
    parts = llm_id.split(":")
    provider = parts[0].strip() if parts else None
    model = parts[-1].strip() if parts else None
    return (provider or None, model or None)

async def run_prompt(name: str, provider: str, **variables):
    if name not in PROMPTS:
        raise ValueError(f"Prompt {name} not found")
    prompt = PROMPTS[name]
    rendered = prompt.render(**variables)
    llm_class = PROVIDERS.get(provider)
    if not llm_class:
        raise ValueError(f"Provider {provider} not supported")
    json_provider, json_model = _parse_llm_id(getattr(prompt, "llm_id", ""))
    llm = llm_class(model=json_model) if (json_provider == provider and json_model) else llm_class()
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
    json_provider, json_model = _parse_llm_id(getattr(prompt, "llm_id", ""))
    llm = llm_class(model=json_model) if (json_provider == provider and json_model) else llm_class()
    messages = []
    if rendered["system"]:
        messages.append({"role": "system", "content": rendered["system"]})
    messages.append({"role": "user", "content": rendered["user"]})
    async for chunk in llm.stream_chat(messages, temperature=prompt.temperature, json_mode=prompt.json_mode):
        yield chunk 