from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from jose import jwt
import boto3
import json
import os
import io
from datetime import datetime, timedelta
from typing import Dict, Any, List, AsyncGenerator, Optional

# ===============================================================
# Configuration et constantes
# ===============================================================

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "CHANGE_ME")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE", "60"))

BUCKET_DOCS = os.getenv("BUCKET_DOCS", "a220-tech-docs")
BUCKET_NC = os.getenv("BUCKET_NC", "a220-non-conformities")

AWS_REGION = os.getenv("AWS_REGION", "fr-par")  # Scaleway region
AWS_ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL", "https://s3." + AWS_REGION + ".scw.cloud")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")

# ===============================================================
# Initialisation
# ===============================================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="NC Chatbot API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://nc.genai-cgi.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# S3 client (Scaleway compatible)
s3 = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    endpoint_url=AWS_ENDPOINT_URL,
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
# S3 helpers
# ===============================================================

def fetch_s3_object(bucket: str, key: str) -> bytes:
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()
    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail=f"File {key} not found in bucket {bucket}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===============================================================
# Routes – Docs & NC JSON
# ===============================================================

@app.get("/doc/{file_path:path}", response_class=Response)
async def get_doc(file_path: str):
    data = fetch_s3_object(BUCKET_DOCS, file_path)
    return Response(content=data, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename={os.path.basename(file_path)}"})


@app.get("/json/{file_path:path}", response_class=JSONResponse)
async def get_json(file_path: str):
    data = fetch_s3_object(BUCKET_NC, file_path)
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid JSON file")
    return JSONResponse(content=payload)


@app.get("/nc")
async def list_non_conformities(max_rows: int = 500, id: str | None = None):
    # Hypothèse : chaque NC est stockée dans BUCKET_NC avec un nom d'obj unique .json
    paginator = s3.get_paginator("list_objects_v2")
    keys: List[str] = []
    for page in paginator.paginate(Bucket=BUCKET_NC):
        keys += [item["Key"] for item in page.get("Contents", []) if item["Key"].endswith(".json")]
    records: List[Dict[str, Any]] = []
    for key in keys:
        blob = fetch_s3_object(BUCKET_NC, key)
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

# ===============================================================
# Prompt & LLM abstraction
# ===============================================================

class PromptTemplate:
    """Charge et rend une template .prompt exportée depuis Dataiku"""

    def __init__(self, file_path: str):
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        p = data["prompt"]
        self.system_template: str = p["textPromptSystemTemplate"]
        self.user_template: str = p["textPromptTemplate"]
        self.input_names: List[str] = [i["name"] for i in p["textPromptTemplateInputs"]]
        self.temperature: float = data.get("completionSettings", {}).get("temperature", 0)

    def render(self, **kwargs) -> Dict[str, str]:
        system = self.system_template
        user = self.user_template
        for k, v in kwargs.items():
            system = system.replace(f"{{{{{k}}}}}", str(v))
            user = user.replace(f"{{{{{k}}}}}", str(v))
        return {"system": system, "user": user}

# ---------------------------------------------------------------
# LLM providers (simplifié)
# ---------------------------------------------------------------

class BaseLLM:
    async def chat(self, messages: List[Dict[str, str]], temperature: float = 0) -> str:
        raise NotImplementedError

class OpenAILLM(BaseLLM):
    def __init__(self, model="gpt-4o"):
        import openai  # lazy import
        self.client = openai
        self.client.api_key = os.getenv("OPENAI_API_KEY")
        self.model = model

    async def chat(self, messages, temperature=0):
        resp = self.client.ChatCompletion.create(model=self.model, messages=messages, temperature=temperature)
        return resp.choices[0].message["content"]

class AnthropicLLM(BaseLLM):
    def __init__(self, model="claude-3-opus-20240229"):
        import anthropic
        self.client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.model = model

    async def chat(self, messages, temperature=0):
        # Convert OpenAI-style to Anthropic
        prompt = "".join([f"\n\n{m['role'].upper()}: {m['content']}" for m in messages]) + "\n\nASSISTANT:"
        resp = self.client.completions.create(
            model=self.model,
            max_tokens=1024,
            temperature=temperature,
            prompt=prompt,
        )
        return resp.completion.strip()

# Gemini et Mistral peuvent être ajoutés de façon similaire selon la disponibilité des SDK

class GeminiLLM(BaseLLM):
    def __init__(self, model="gemini-pro"):
        import google.generativeai as genai # lazy import
        self.client = genai
        self.client.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        self.model = self.client.GenerativeModel(model)

    async def chat(self, messages, temperature=0):
        # Gemini a un format de message légèrement différent (pas de 'system')
        # On concatène le system prompt au premier message user si besoin.
        gemini_messages = []
        system_prompt = ""
        for m in messages:
            if m["role"] == "system":
                system_prompt += m["content"] + "\n\n"
            else:
                # Le rôle doit être 'user' ou 'model'
                role = "user" if m["role"] == "user" else "model"
                content = m["content"]
                if role == "user" and system_prompt:
                    content = system_prompt + content
                    system_prompt = "" # Ne l'appliquer qu'une fois
                gemini_messages.append({"role": role, "parts": [content]})
        
        generation_config = genai.types.GenerationConfig(temperature=temperature)
        resp = self.model.generate_content(gemini_messages, generation_config=generation_config)
        return resp.text

class MistralLLM(BaseLLM):
    def __init__(self, model="mistral-large-latest"): # 'mistral-large-latest' supporte Magistral
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

# Charge les templates lors du boot
PROMPT_DIR = os.path.dirname(__file__)
PROMPTS = {
    "query": PromptTemplate(os.path.join(PROMPT_DIR, "compute_nc_scenarios_query.prompt")),
    "nc_search": PromptTemplate(os.path.join(PROMPT_DIR, "compute_nc_scenarios_search_nc.prompt")),
    "doc_search": PromptTemplate(os.path.join(PROMPT_DIR, "compute_nc_scenarios_search_techdocs.prompt")),
    "000": PromptTemplate(os.path.join(PROMPT_DIR, "compute_nc_scenarios_propose_000.prompt")),
    # Ajoutez d'autres templates ici (100, 200…)
}

# ===============================================================
# Orchestrateur (simplifié, non-streaming pour l'instant)
# ===============================================================

async def run_prompt(name: str, provider: str, **variables):
    tmpl = PROMPTS[name]
    rendered = tmpl.render(**variables)
    llm = PROVIDERS[provider]()
    messages = [
        {"role": "system", "content": rendered["system"]},
        {"role": "user", "content": rendered["user"]},
    ]
    return await llm.chat(messages, temperature=tmpl.temperature)

# ===============================================================
# Endpoint /ai (non-streaming pour commencer)
# ===============================================================

@app.post("/ai")
async def ai_endpoint(request: Request):
    data = await request.json()
    messages = data.get("messages")
    if not messages:
        raise HTTPException(status_code=400, detail="messages field required")

    last = messages[-1]
    role = last.get("role", "000")
    user_message = last.get("text")
    description = last.get("description", "")
    history = last.get("history", {})
    sources = last.get("sources")

    provider = data.get("provider", "openai")  # choix du modèle

    # Étape 1 : query
    query_result = await run_prompt("query", provider, role=role, user_message=user_message, description=description)

    # Étape 2 : recherche docs (non-conformities / techdocs)
    docs = await run_prompt("doc_search", provider, input=query_result)
    ncs = await run_prompt("nc_search", provider, input=query_result)

    # Étape 3 : réponse finale selon rôle
    final_json = await run_prompt(role if role in PROMPTS else "000", provider,
                                  role=role,
                                  user_message=user_message,
                                  description=description,
                                  search_docs=json.dumps(docs),
                                  search_nc=json.dumps(ncs),
                                  history=json.dumps(history))

    # La plupart des prompts sont au format JSON string
    try:
        final_payload = json.loads(final_json)
    except Exception:
        final_payload = {"comment": final_json}

    return {
        "text": final_payload.get("comment"),
        "label": final_payload.get("label"),
        "description": final_payload.get("description"),
        "sources": {"tech_docs": docs, "non_conformities": ncs},
        "user_query": user_message,
        "input_description": description,
        "knowledge_query": query_result,
        "role": "ai",
        "user_role": role,
    }

# ===============================================================
# Auth routes (register / login)
# ===============================================================

@app.post("/register")
async def register(payload: Dict[str, str]):
    username = payload.get("username")
    password = payload.get("password")
    if not username or not password:
        raise HTTPException(status_code=400, detail="username & password required")
    if username in users:
        raise HTTPException(status_code=400, detail="user already exists")
    users[username] = get_password_hash(password)
    return {"message": "User registered"}

@app.post("/login")
async def login(payload: Dict[str, str]):
    username = payload.get("username")
    password = payload.get("password")
    hashed = users.get(username)
    if not hashed or not verify_password(password, hashed):
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = create_access_token({"sub": username})
    return {"access_token": token, "token_type": "bearer"}

# ===============================================================
# Healthcheck
# ===============================================================

@app.get("/ping")
async def ping():
    return {"status": "ok"} 