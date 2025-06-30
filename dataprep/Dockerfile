FROM python:3.12-slim

WORKDIR /app

# Copier et installer les dépendances dédiées
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier les scripts
COPY src/ .

# Rendre les scripts exécutables
RUN chmod +x *.py 