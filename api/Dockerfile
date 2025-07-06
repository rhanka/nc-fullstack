FROM python:3.12-slim

WORKDIR /app

# Installation des dépendances système et de s5cmd pour S3
RUN apt-get update && apt-get install -y \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -L "https://github.com/peak/s5cmd/releases/download/v2.3.0/s5cmd_2.3.0_Linux-64bit.tar.gz" | tar xz -C /usr/local/bin/

# Copie des dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie du script d'entrée
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Copie du code source
COPY src/ src/

# Le volume /data sera monté par le système d'orchestration (ex: CaaS)
# ou par docker-compose pour le développement local.
# Ici, nous nous assurons que les répertoires cibles existent.
RUN mkdir -p /data/a220-tech-docs /data/a220-non-conformities

# Port exposé
EXPOSE 8000

# Le script d'entrée s'occupera de la synchronisation des données avant de lancer uvicorn
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]