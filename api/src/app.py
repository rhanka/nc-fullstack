from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, Response, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from jose import jwt
import json
import os
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import logging
import time
import asyncio
import pathlib

from src.s3_utils import fetch_s3_object, list_json_keys, S3_BUCKET_DOCS, S3_BUCKET_NC
from src.core import run_prompt, PROMPTS, PROVIDERS
from src.ai_stream import AGENTS, AGENTS_MSG, exec_agent, stream_agent, sse_encode
from src.search import search_documents, search_non_conformities, format_search_results

# ===============================================================
# Configuration et constantes
# ===============================================================

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "CHANGE_ME")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE", "60"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("nc_api")

# ===============================================================
# Initialisation
# ===============================================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="NC Chatbot API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://nc.genai-cgi.com", "http://localhost", "http://localhost:80", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory mock user DB (à remplacer par un vrai store si besoin)
users: Dict[str, str] = {}

# ===============================================================
# Utils
# ===============================================================

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

# ===============================================================
# Routes
# ===============================================================
@app.get("/doc/{filename}", response_class=FileResponse)
async def get_doc(filename: str):
    # Sécuriser le nom de fichier pour éviter les traversées de répertoire
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Construire le chemin local
    script_dir = pathlib.Path(__file__).parent.parent
    file_path = script_dir / "data/a220-tech-docs/pages" / filename

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename={filename}"})

@app.get("/json/{file_path:path}", response_class=JSONResponse)
async def get_json(file_path: str):
    data = await asyncio.to_thread(fetch_s3_object, S3_BUCKET_NC, file_path)
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid JSON file")
    return JSONResponse(content=payload)

@app.get("/nc")
async def list_non_conformities(max_rows: int = 500, id: str | None = None):
    # Construire le chemin local
    script_dir = pathlib.Path(__file__).parent.parent
    json_dir = script_dir / "data/a220-non-conformities/json"

    if not json_dir.is_dir():
        return []

    records: List[Dict[str, Any]] = []

    # Limiter le nombre de fichiers à lire si aucun ID n'est spécifié
    file_paths = list(json_dir.glob("*.json"))
    if not id:
        file_paths = file_paths[:max_rows]

    for file_path in file_paths:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = {
                    "doc": file_path.name.replace(".json", ""),
                    "nc_event_id": file_path.name.replace(".json", ""),
                    "analysis_history": json.load(f)
                }
                if isinstance(data, dict):
                    records.append(data)
                else:
                    logger.warning(f"Skipping non-object JSON from local file: {file_path.name}")
        except json.JSONDecodeError:
            logger.warning(f"Failed to decode JSON from local file: {file_path.name}")
        except Exception as e:
            logger.error(f"Failed to read local file {file_path.name}: {e}")

    if id:
        records = [r for r in records if str(r.get("nc_event_id")) == id]

    return records[:max_rows] if not id else records

# ===============================================================
# AI Endpoint (Streaming / Non-Streaming)
# ===============================================================

@app.post("/ai")
async def ai_endpoint(request: Request):
    body = await request.json()

    # --- Parsing du payload ---
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="messages field required")
    last = messages[-1]
    role = last.get("role", "000")
    user_message = last.get("text", "")
    description = last.get("description", "")
    history = last.get("history", {}) or {}
    sources = last.get("sources")

    provider = body.get("provider", "openai")

    # Détecter si le client veut un stream
    accept_header = request.headers.get("accept", "")
    wants_stream = "text/event-stream" in accept_header

    async def compute_non_stream():
        nonlocal sources
        if not sources:
            logger.info("Sources not provided, performing search...")
            query = await run_prompt("query", provider, role=role, user_message=user_message, description=description)
            
            logger.info("doc_search")
            tech_docs_results = await asyncio.to_thread(search_documents, query)
            
            logger.info("nc_search")
            nc_results = await asyncio.to_thread(search_non_conformities, query)
            
            sources = {
                "tech_docs": format_search_results(tech_docs_results),
                "non_conformities": format_search_results(nc_results),
            }
        final_json = await run_prompt(role, provider,
                                      role=role,
                                      user_message=user_message,
                                      description=description,
                                      search_docs=json.dumps(sources["tech_docs"]),
                                      search_nc=json.dumps(sources["non_conformities"]),
                                      history=json.dumps(history))
        try:
            final_payload = json.loads(final_json)
        except Exception:
            final_payload = {"comment": final_json}
        return {
            "text": final_payload.get("comment"),
            "label": final_payload.get("label"),
            "description": final_payload.get("description"),
            "sources": sources,
            "user_query": user_message,
            "input_description": description,
            "role": "ai",
            "user_role": role,
        }

    if not wants_stream:
        return await compute_non_stream()

    # --- Version streaming SSE ---
    async def event_generator():
        # delta encoding header
        yield sse_encode("delta_encoding", json.dumps("v1"))

        # Steps
        query = None
        if not sources:
            # action query
            yield sse_encode(None, json.dumps({"type": "action", "text": "Build appropriate request", "metadata": "query"}))
            query = await run_prompt("query", provider, role=role, user_message=user_message, description=description)
            yield sse_encode(None, json.dumps({"type": "result", "text": query, "metadata": "query"}))

            # doc_search - utiliser directement la recherche vectorielle
            logger.info("doc_search")
            yield sse_encode(None, json.dumps({"type": "action", "text": "Search for relevant technical documents", "metadata": "doc_search"}))
            tech_docs_results = await asyncio.to_thread(search_documents, query)
            tech_docs = format_search_results(tech_docs_results)
            yield sse_encode(None, {"type": "result", "text": tech_docs, "metadata": "doc_search"})

            # nc_search - utiliser directement la recherche vectorielle
            logger.info("nc_search")
            yield sse_encode(None, json.dumps({"type": "action", "text": "Search for similar non-conformities", "metadata": "nc_search"}))
            nc_results = await asyncio.to_thread(search_non_conformities, query)
            non_conf = format_search_results(nc_results)
            yield sse_encode(None, {"type": "result", "text": non_conf, "metadata": "nc_search"})

            current_sources = {"tech_docs": tech_docs, "non_conformities": non_conf}
        else:
            current_sources = sources

        # final action
        yield sse_encode(None, json.dumps({"type": "action", "text": "Generate final answer", "metadata": role}))
        final_json = await run_prompt(role, provider,
                                      role=role,
                                      user_message=user_message,
                                      description=description,
                                      search_docs=json.dumps(current_sources["tech_docs"]),
                                      search_nc=json.dumps(current_sources["non_conformities"]),
                                      history=json.dumps(history))
        try:
            final_payload = json.loads(final_json)
        except Exception:
            final_payload = {"comment": final_json}
        result_block = {
            "text": final_payload.get("comment"),
            "label": final_payload.get("label"),
            "description": final_payload.get("description"),
            "sources": current_sources,
            "user_query": user_message,
            "input_description": description,
            "role": "ai",
            "user_role": role,
        }
        yield sse_encode(None, json.dumps({"type": "result", "text": result_block, "metadata": "final"}))

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.post("/register")
async def register(payload: Dict[str, str]):
    username = payload.get("username")
    password = payload.get("password")
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if username in users:
        raise HTTPException(status_code=400, detail="User already exists")
    users[username] = get_password_hash(password)
    return {"msg": "User registered"}

@app.post("/login")
async def login(payload: Dict[str, str]):
    username = payload.get("username")
    password = payload.get("password")
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    hashed = users.get(username)
    if not hashed or not verify_password(password, hashed):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token({"sub": username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/ping")
async def ping():
    return {"status": "ok"}

# Middleware de log des requêtes
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000  # ms
    logger.info("%s %s - %s - %.2fms", request.client.host, request.method, request.url.path, process_time)
    return response 