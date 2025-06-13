.SILENT:
.PHONY: dev run ui-install ui-build docker-build docker-push build deploy deps env config clean

# ----------------------------
# Variables configurables
# ----------------------------
UI_DIR       ?= ui
IMAGE_NAME   ?= nc-chatbot
TAG          ?= $(shell git rev-parse --short HEAD)
REGISTRY     ?= rg.fr-par.scw.cloud/$(IMAGE_NAME)
VENV_DIR     := api/venv
PIP          := $(VENV_DIR)/bin/pip
UVICORN      := $(VENV_DIR)/bin/uvicorn

# ----------------------------
# Helpers
# ----------------------------
export $(shell sed -n 's/=.*//p' .env 2>/dev/null)

# ----------------------------
# Cibles principales
# ----------------------------

dev: config
	@echo "▶ Starting API in dev mode (reload)…"
	$(UVICORN) api.app:app --reload --host 0.0.0.0 --port 8000 & \
	cd $(UI_DIR) && npm run dev

run: config
	@echo "▶ Running API (prod)…"
	$(UVICORN) api.app:app --host 0.0.0.0 --port 8000

# ----------------------------
# Préparation environnement Python & .env
# ----------------------------

# Si la création du venv échoue, installez manuellement :
# sudo apt update && sudo apt install python3.12-venv python3-pip python3-full
# puis supprimez le dossier venv (rm -rf venv) et relancez.

config: env $(PIP)
	@echo "▶ Installing/updating Python dependencies..."
	$(PIP) install -r api/requirements.txt
	@echo "▶ Environment ready"

$(PIP):
	@echo "▶ Setting up Python virtual environment..."
	@if ! dpkg -l | grep -q python3-venv; then \
		echo "   python3-venv not found. Attempting to install it with sudo..."; \
		sudo apt-get update && sudo apt-get install -y python3-venv; \
	fi
	python3 -m venv $(VENV_DIR)

env:
	@if [ ! -f .env ]; then \
		echo "▶ .env file not found. Creating from template..."; \
		cp env.template .env; \
		echo "▶ Generating random JWT_SECRET_KEY..."; \
		SECRET=$$(openssl rand -hex 32); \
		sed -i "s/^JWT_SECRET_KEY=changeme/JWT_SECRET_KEY=$${SECRET}/" .env; \
	fi

# ----------------------------
# Front-end (UI) helpers
# ----------------------------
ui-install:
	cd $(UI_DIR) && npm install --legacy-peer-deps

ui-build: ui-install
	cd $(UI_DIR) && npm run build

# ----------------------------
# Containerisation
# ----------------------------

docker-build:
	@echo "▶ Building Docker image $(REGISTRY):$(TAG)"
	docker build -t $(REGISTRY):$(TAG) .

docker-push:
	@echo "▶ Pushing image to registry"
	docker push $(REGISTRY):$(TAG)

build: ui-build docker-build

# ----------------------------
# Déploiement (exemple Scaleway CLI)
# ----------------------------

deploy: build docker-push
	@echo "▶ Deploying container to Scaleway Container Registry/Namespace"
	@echo "   (Adapt this command to your infra)"
	# Exemple : scw container container deploy name=$(IMAGE_NAME) image=$(REGISTRY):$(TAG)

.PHONY: deps env config clean
clean:
	@echo "▶ Nettoyage de l'environnement..."
	rm -rf api/venv
	rm -rf api/__pycache__
	rm -rf ui/node_modules
	rm -rf ui/build
	@echo "✔️  Nettoyage terminé." 