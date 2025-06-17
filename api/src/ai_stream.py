import json, asyncio, re
from typing import Dict, Any, AsyncGenerator, Generator
from src.core import run_prompt

# Mapping agents -> prompt keys
AGENTS: Dict[str, str] = {
    "query": "query",
    "nc_search": "nc_search",
    "doc_search": "doc_search",
    "000": "000",
    "propose_000": "000",
    "100": "100",
    "propose_100": "100",
}

AGENTS_MSG = {
    "query": "Build appropriate request",
    "nc_search": "Search for similar non-conformities",
    "doc_search": "Search for relevant technical documents",
    "000": "Propose structured non-conformity report",
    "propose_000": "Propose structured non-conformity report",
    "100": "Analysing non-conformity",
    "propose_100": "Analysing non-conformity",
}

# ------------------------------------------------------------
# Helper pour encoder SSE
# ------------------------------------------------------------

def sse_encode(event: str | None, data: Any) -> str:
    payload = data if isinstance(data, str) else json.dumps(data)
    if event:
        return f"event: {event}\ndata: {payload}\n\n"
    else:
        return f"data: {payload}\n\n"

# ------------------------------------------------------------
# Exécution synchrone (non-stream)
# ------------------------------------------------------------

def exec_agent(agent_key: str, provider: str, **inputs):
    prompt_key = AGENTS.get(agent_key, agent_key)
    return asyncio.run(run_prompt(prompt_key, provider, **inputs))

# ------------------------------------------------------------
# Streaming très simplifié : on simule des chunks en découpant la
# réponse sur les sauts de ligne. Si provider futur supporte le
# streaming natif, il suffira de remplacer cette logique.
# ------------------------------------------------------------

def stream_agent(agent_key: str, provider: str, **inputs) -> Generator[str, None, str]:
    prompt_key = AGENTS.get(agent_key, agent_key)
    full_resp: str = asyncio.run(run_prompt(prompt_key, provider, **inputs))
    # On tente de parser JSON
    try:
        parsed = json.loads(full_resp)
        yield sse_encode("delta", json.dumps({"v": full_resp.replace("\n", "\\n")}))
        return parsed  # valeur finale
    except Exception:
        # Sinon, émettre ligne par ligne comme delta
        for line in full_resp.split("\n"):
            yield sse_encode("delta", json.dumps({"v": line.replace("\n", "\\n")}))
        return full_resp 