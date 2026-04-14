#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="/tmp/nc_fullstack_lot0_runner.py"

cat >"${SCRIPT_PATH}" <<'PY'
import importlib
import json
import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path("/home/antoinefa/src/nc-fullstack")
API_ROOT = ROOT / "api"
FIXTURES = API_ROOT / "test" / "fixtures"
DOCKERFILE = API_ROOT / "Dockerfile"

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

FINAL_JSON = (
    '{"label":"Windshield skin rivet flushness out of tolerance",'
    '"description":{"designation":{"aircraft_id":"0070","aircraft_zone":"Right windshield lower skin",'
    '"ATA_code":"ATA-56","part_id":"[to be completed]","nc_event_date":"[to be completed]"},'
    '"observation":"Measured rivet flushness between -0.20 mm and -0.25 mm below the right windshield.",'
    '"root_cause":"[to be completed]",'
    '"dimensions":"- Flushness: -0.20 mm to -0.25 mm",'
    '"references":"- A220-300ARP-Issue098-00-16May2024_page_0031.md: equivalent tools and fixture usage constraints"},'
    '"comment":"Draft updated with technical references."}'
)

TECH_DOC_RESULTS = [
    {
        "doc": "A220-300ARP-Issue098-00-16May2024_page_0031.md",
        "chunk": "page_0031",
        "content": "The tools, fixtures, and test equipment that are necessary for a given maintenance task are listed in a table.",
    }
]

NC_RESULTS = [
    {
        "doc": "ATA-56-demo-case",
        "ATA_code": "ATA-56",
        "ATA_category": "WINDOWS",
        "content": "Similar windshield area flushness discrepancy detected during quality inspection.",
    }
]

def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

def parse_sse_payload(raw_text: str) -> list[dict]:
    events = []
    for block in raw_text.strip().split("\n\n"):
        event_name = None
        data_lines = []
        for line in block.splitlines():
            if line.startswith("event: "):
                event_name = line[len("event: ") :]
            elif line.startswith("data: "):
                data_lines.append(line[len("data: ") :])
        data_blob = "\n".join(data_lines)
        try:
            payload = json.loads(data_blob)
        except json.JSONDecodeError:
            payload = data_blob
        events.append({"event": event_name, "data": payload})
    return events

core_module = types.ModuleType("src.core")

async def run_prompt(name: str, provider: str, **variables):
    if name == "query":
        return "ATA 56 windshield rivet flushness below tolerance"
    if name == "000":
        return FINAL_JSON
    raise AssertionError(f"Unexpected prompt key: {name}")

async def stream_prompt(name: str, provider: str, **variables):
    if name != "000":
        raise AssertionError(f"Unexpected stream prompt key: {name}")
    for chunk in [
        '{"label":"Windshield skin rivet flushness out of tolerance",',
        '"description":{"designation":{"aircraft_id":"0070","aircraft_zone":"Right windshield lower skin","ATA_code":"ATA-56","part_id":"[to be completed]","nc_event_date":"[to be completed]"},"observation":"Measured rivet flushness between -0.20 mm and -0.25 mm below the right windshield.","root_cause":"[to be completed]","dimensions":"- Flushness: -0.20 mm to -0.25 mm","references":"- A220-300ARP-Issue098-00-16May2024_page_0031.md: equivalent tools and fixture usage constraints"},',
        '"comment":"Draft updated with technical references."}',
    ]:
        yield chunk

core_module.run_prompt = run_prompt
core_module.stream_prompt = stream_prompt
core_module.PROMPTS = {}
core_module.PROVIDERS = {"openai": object()}

search_module = types.ModuleType("src.search")
search_module.search_documents = lambda query, n_results=15: TECH_DOC_RESULTS
search_module.search_non_conformities = lambda query, n_results=15: NC_RESULTS
search_module.format_search_results = lambda results: {"sources": results if isinstance(results, list) else []}

ai_stream_module = types.ModuleType("src.ai_stream")
ai_stream_module.AGENTS = {}
ai_stream_module.AGENTS_MSG = {}
ai_stream_module.exec_agent = lambda *args, **kwargs: None
ai_stream_module.stream_agent = lambda *args, **kwargs: iter(())

def sse_encode(event, data):
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n" if event else f"data: {payload}\n\n"

ai_stream_module.sse_encode = sse_encode

sys.modules["src.core"] = core_module
sys.modules["src.search"] = search_module
sys.modules["src.ai_stream"] = ai_stream_module
sys.modules.pop("src.app", None)

app_module = importlib.import_module("src.app")
client = TestClient(app_module.app)

request_payload = load_fixture("ai_request_minimal.json")
expected_non_stream = load_fixture("ai_response_non_stream.json")
expected_stream = load_fixture("ai_stream_events.json")

response = client.post("/ai", json=request_payload)
assert response.status_code == 200, response.text
assert response.json() == expected_non_stream
print("PASS ai_non_stream_contract", flush=True)

with client.stream(
    "POST",
    "/ai",
    json=request_payload,
    headers={"Accept": "text/event-stream"},
) as response:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    raw_text = "".join(response.iter_text())

assert parse_sse_payload(raw_text) == expected_stream
print("PASS ai_stream_contract", flush=True)

response = client.post("/ai", json={"provider": "openai", "messages": []})
assert response.status_code == 400
assert response.json() == {"detail": "messages field required"}
print("PASS ai_requires_messages", flush=True)

dockerfile_text = DOCKERFILE.read_text(encoding="utf-8")
tech_files = list((API_ROOT / "data" / "a220-tech-docs" / "vectordb").glob("*/*"))
nc_files = list((API_ROOT / "data" / "a220-non-conformities" / "vectordb").glob("*/*"))
assert any(path.name == "data_level0.bin" for path in tech_files)
assert any(path.name == "data_level0.bin" for path in nc_files)
assert "COPY data/a220-non-conformities/vectordb/ /app/data/a220-non-conformities/vectordb/" in dockerfile_text
assert "COPY data/a220-tech-docs/vectordb/ /app/data/a220-tech-docs/vectordb/" in dockerfile_text
print("PASS dockerfile_packaging", flush=True)
PY

/tmp/nc-fullstack-lot0-mini-venv/bin/python -u "${SCRIPT_PATH}"
python api/tests/check_chroma_packaging.py
