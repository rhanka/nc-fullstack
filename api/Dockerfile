FROM python:3.12-slim

WORKDIR /app

# Installation des dépendances système
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copie des dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie du code source uniquement (src et prompts)
COPY src/ src/

# Port exposé
EXPOSE 8000

# Commande de démarrage
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]