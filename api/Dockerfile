# Stage 1: Base avec dépendances communes
FROM python:3.12-slim as base
WORKDIR /app

RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ /app/src/

# Stage 2: Cible de développement (utilisée par docker-compose.dev.yml)
FROM base as dev
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/src"]

# Stage 3: Cible de production avec données "bakées"
FROM base as prod
WORKDIR /app

# Copier les données directement dans l'image
COPY data/a220-non-conformities/json/ /app/data/a220-non-conformities/json/
COPY data/a220-non-conformities/vectordb/chroma.sqlite3 /app/data/a220-non-conformities/vectordb/
COPY data/a220-tech-docs/pages/ /app/data/a220-tech-docs/pages/
COPY data/a220-tech-docs/vectordb/chroma.sqlite3 /app/data/a220-tech-docs/vectordb/

EXPOSE 8000
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]