import os
from typing import List, Dict, AsyncGenerator

class BaseLLM:
    async def chat(self, messages: List[Dict[str, str]], temperature: float = 0) -> str:
        raise NotImplementedError

    async def stream_chat(self, messages: List[Dict[str, str]], temperature: float = 0) -> AsyncGenerator[str, None]:
        # Fallback pour les modèles qui ne supportent pas le streaming
        yield await self.chat(messages, temperature)

class OpenAILLM(BaseLLM):
    def __init__(self, model="gpt-5-nano"):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model = model

    async def chat(self, messages, temperature=0, json_mode=False):
        params = {
            "model": self.model,
            "messages": messages,
        }
        # Ne pas envoyer "temperature" aux modèles GPT-5 (incluant nano/mini/full)
        if not (isinstance(self.model, str) and self.model.startswith("gpt-5")):
            params["temperature"] = temperature
        if json_mode:
            params["response_format"] = {"type": "json_object"}

        resp = await self.client.chat.completions.create(**params)
        return resp.choices[0].message.content

    async def stream_chat(self, messages: List[Dict[str, str]], temperature: float = 0, json_mode=False) -> AsyncGenerator[str, None]:
        params = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }
        # Ne pas envoyer "temperature" aux modèles GPT-5 (incluant nano/mini/full)
        if not (isinstance(self.model, str) and self.model.startswith("gpt-5")):
            params["temperature"] = temperature
        if json_mode:
            params["response_format"] = {"type": "json_object"}

        stream = await self.client.chat.completions.create(**params)
        async for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            if content:
                yield content

class AnthropicLLM(BaseLLM):
    def __init__(self, model="claude-3-opus-20240229"):
        import anthropic
        self.client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.model = model

    async def chat(self, messages, temperature=0):
        prompt = "".join([f"\n\n{m['role'].upper()}: {m['content']}" for m in messages]) + "\n\nASSISTANT:"
        resp = self.client.completions.create(
            model=self.model,
            max_tokens=1024,
            temperature=temperature,
            prompt=prompt,
        )
        return resp.completion.strip()

class GeminiLLM(BaseLLM):
    def __init__(self, model="gemini-pro"):
        import google.generativeai as genai
        self.client = genai
        self.client.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        self.model = self.client.GenerativeModel(model)

    async def chat(self, messages, temperature=0):
        gemini_messages = []
        system_prompt = ""
        for m in messages:
            if m["role"] == "system":
                system_prompt += m["content"] + "\n\n"
            else:
                role = "user" if m["role"] == "user" else "model"
                content = m["content"]
                if role == "user" and system_prompt:
                    content = system_prompt + content
                    system_prompt = ""
                gemini_messages.append({"role": role, "parts": [content]})
        generation_config = self.client.types.GenerationConfig(temperature=temperature)
        resp = self.model.generate_content(gemini_messages, generation_config=generation_config)
        return resp.text

class MistralLLM(BaseLLM):
    def __init__(self, model="mistral-large-latest"):
        from mistralai.client import MistralClient
        from mistralai.models.chat_completion import ChatMessage
        self.client = MistralClient(api_key=os.getenv("MISTRAL_API_KEY"))
        self.model = model
        self.ChatMessage = ChatMessage

    async def chat(self, messages, temperature=0):
        mistral_messages = [self.ChatMessage(role=m["role"], content=m["content"]) for m in messages]
        resp = self.client.chat(
            model=self.model,
            messages=mistral_messages,
            temperature=temperature,
        )
        return resp.choices[0].message.content

PROVIDERS = {
    "openai": OpenAILLM,
    "anthropic": AnthropicLLM,
    "google": GeminiLLM,
    "mistral": MistralLLM,
} 