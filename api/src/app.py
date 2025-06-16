from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from jose import jwt
import json
import os
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

from src.s3_utils import fetch_s3_object, list_json_keys, S3_BUCKET_DOCS, S3_BUCKET_NC
from src.prompt import PromptTemplate, load_prompts_from_dir
from src.llm import PROVIDERS

# ===============================================================
# Configuration et constantes
# ===============================================================

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "CHANGE_ME")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE", "60"))

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
# Prompts
# ===============================================================
PROMPTS = load_prompts_from_dir()

# ===============================================================
# Routes
# ===============================================================
@app.get("/doc/{file_path:path}", response_class=Response)
async def get_doc(file_path: str):
    data = fetch_s3_object(S3_BUCKET_DOCS, file_path)
    return Response(content=data, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename={os.path.basename(file_path)}"})

@app.get("/json/{file_path:path}", response_class=JSONResponse)
async def get_json(file_path: str):
    data = fetch_s3_object(S3_BUCKET_NC, file_path)
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid JSON file")
    return JSONResponse(content=payload)

@app.get("/nc")
async def list_non_conformities(max_rows: int = 500, id: str | None = None):
    keys: List[str] = list_json_keys(S3_BUCKET_NC)
    records: List[Dict[str, Any]] = []
    for key in keys:
        blob = fetch_s3_object(S3_BUCKET_NC, key)
        try:
            obj = json.loads(blob)
            records.append(obj)
        except Exception:
            continue
        if len(records) >= max_rows:
            break
    if id:
        records = [r for r in records if str(r.get("nc_event_id")) == id]
    return records

async def run_prompt(name: str, provider: str, **variables):
    if name not in PROMPTS:
        raise HTTPException(status_code=404, detail=f"Prompt {name} not found")
    prompt = PROMPTS[name]
    rendered = prompt.render(**variables)
    llm_class = PROVIDERS.get(provider)
    if not llm_class:
        raise HTTPException(status_code=400, detail=f"Provider {provider} not supported")
    llm = llm_class()
    messages = []
    if rendered["system"]:
        messages.append({"role": "system", "content": rendered["system"]})
    messages.append({"role": "user", "content": rendered["user"]})
    return await llm.chat(messages, temperature=prompt.temperature)

@app.post("/ai")
async def ai_endpoint(request: Request):
    body = await request.json()
    prompt_name = body.get("prompt")
    provider = body.get("provider", "openai")
    variables = body.get("variables", {})
    result = await run_prompt(prompt_name, provider, **variables)
    return {"result": result}

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