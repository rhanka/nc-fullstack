.SILENT:
.PHONY: dev run ui-install ui-build docker-build docker-push build deploy deps env config clean help check-db create-tech-docs-db create-nc-db create-db

# ----------------------------
# Helpers
# ----------------------------
-include .env

# ----------------------------
# Env variables
# ----------------------------
export UI_DIR          ?= ui
export API_IMAGE_NAME  ?= nc-chatbot-api
export TAG             ?= $(shell git rev-parse --short HEAD)
export REGISTRY        ?= rg.fr-par.scw.cloud
export S3_BUCKET_DOCS  ?= a220-tech-docs
export S3_BUCKET_NC    ?= a220-non-conformities
export S3_REGION       ?= fr-par
export S3_ENDPOINT_URL ?= https://s3.fr-par.scw.cloud
export VITE_API_URL    ?=
export TECH_DOCS_DIR   ?= a220-tech-docs
export NC_DIR          ?= a220-non-conformities

# Options par défaut pour Docker Compose. Peut être surchargé.
# Ex: make dev DC_OPTS=""
DC_OPTS ?= --build --force-recreate

# ----------------------------
# Main targets
# ----------------------------

dev:
	@echo "▶ Starting API and UI in dev mode with Docker..."
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up ${DC_OPTS}

dev-stop:
	@echo "▶ Stopping API and UI in dev mode with Docker..."
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

up:
	@echo "▶ Running API and UI in production mode with Docker..."
	docker compose -f docker-compose.yml up ${DC_OPTS} -d

down:
	@echo "▶ Stopping API and UI in dev mode with Docker..."
	docker compose -f docker-compose.yml down

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

api-build:
	@echo "▶ Building Docker image for API: $(REGISTRY)/$(API_IMAGE_NAME):$(TAG)"
	docker compose build api

docker-login:
	@echo "▶ Logging in to registry"
	@echo "$(SCW_SECRET_KEY)" | docker login $(REGISTRY) -u nologin --password-stdin

api-docker-image-push: docker-login
	@echo "▶ Pushing image to registry"
	docker push $(REGISTRY)/$(API_IMAGE_NAME):$(TAG)

build: ui-build api-build

# ----------------------------
# Deployment Steps
# ----------------------------

check-jq:
	@if ! command -v jq >/dev/null 2>&1; then \
		echo "ℹ️ jq not found. Attempting to install with apt-get..."; \
		sudo apt-get update -y && sudo apt-get install -y jq; \
	fi

check-scw:
	@if ! command -v scw >/dev/null 2>&1; then \
		echo "ℹ️ scw (Scaleway CLI) not found. Attempting to install..."; \
		curl -sL https://raw.githubusercontent.com/scaleway/scaleway-cli/master/scripts/get.sh | sh && \
		echo "✅ Scaleway CLI installed. You might need to start a new shell for it to be in your PATH."; \
	fi

deploy-container: check-jq check-scw
	@echo "▶️ Deploying new container $(REGISTRY)/$(API_IMAGE_NAME):$(TAG) to Scaleway..."
	@scw container container deploy --image="$(REGISTRY)/$(API_IMAGE_NAME):$(TAG)" --region=$(SCW_REGION) -o json > .deploy_output.json
	@echo "✅ New container deployment initiated."

wait-for-container: check-jq check-scw
	@echo "⌛ Waiting for container to become ready..."
	@if [ ! -f .deploy_output.json ]; then echo "❌ .deploy_output.json not found. Run 'make deploy-container' first."; exit 1; fi
	@NEW_CONTAINER_ID=$$(\
		jq -r '.[0].id' .deploy_output.json); \
	scw container container wait --container-id=$$NEW_CONTAINER_ID --region=$(SCW_REGION); \
	echo "⌛ Giving 30s for data sync and app startup..."; \
	sleep 30; \
	echo "🔎 Checking health of new container..."; \
	NEW_CONTAINER_HOSTNAME=$$(\
		jq -r '.[0].domain_name' .deploy_output.json); \
	HEALTH_STATUS=$$(curl -s -o /dev/null -w "%{http_code}" "https://$$NEW_CONTAINER_HOSTNAME/ping"); \
	if [ "$$HEALTH_STATUS" -ne 200 ]; then \
		echo "❌ New container is not healthy (HTTP status: $$HEALTH_STATUS). Aborting deployment."; \
		exit 1; \
	fi; \
	echo "✅ New container is healthy."

update-dns: check-jq
	@echo "▶️ Updating DNS record $(API_DNS_RECORD) on Cloudflare..."
	@if [ ! -f .deploy_output.json ]; then echo "❌ .deploy_output.json not found. Run 'make deploy-container' first."; exit 1; fi
	@NEW_CONTAINER_HOSTNAME=$$(\
		jq -r '.[0].domain_name' .deploy_output.json); \
	DNS_RECORD_ID=$$(\
		curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$(CLOUDFLARE_ZONE_ID)/dns_records?type=CNAME&name=$(API_DNS_RECORD)" \
	  	-H "Authorization: Bearer $(CLOUDFLARE_API_TOKEN)" -H "Content-Type: application/json" | jq -r '.result[0].id'); \
	if [ -z "$$DNS_RECORD_ID" ] || [ "$$DNS_RECORD_ID" == "null" ]; then \
	    echo "❌ DNS record not found on Cloudflare. Please create a CNAME record for $(API_DNS_RECORD)."; \
	    exit 1; \
	fi; \
	curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$(CLOUDFLARE_ZONE_ID)/dns_records/$$DNS_RECORD_ID" \
	  -H "Authorization: Bearer $(CLOUDFLARE_API_TOKEN)" \
	  -H "Content-Type: application/json" \
	  --data '{"type":"CNAME","name":"'$(API_DNS_RECORD)'","content":"'$$NEW_CONTAINER_HOSTNAME'","ttl":1,"proxied":false}'; \
	echo "✅ DNS updated successfully."

cleanup-old-containers: check-jq check-scw
	@echo "▶️ Cleaning up old containers..."
	@if [ ! -f .deploy_output.json ]; then echo "❌ .deploy_output.json not found. Run 'make deploy-container' first."; exit 1; fi
	@NEW_CONTAINER_ID=$$(\
		jq -r '.[0].id' .deploy_output.json); \
	OLD_CONTAINERS=$$(\
		scw container container list --region=$(SCW_REGION) --name=$(API_IMAGE_NAME) -o json | jq -r --arg id "$$NEW_CONTAINER_ID" '.[] | select(.id != $$id) | .id'); \
	for OLD_ID in $$OLD_CONTAINERS; do \
	  echo "🗑️ Deleting old container $$OLD_ID..."; \
	  scw container container delete --container-id=$$OLD_ID --region=$(SCW_REGION); \
	done; \
	rm -f .deploy_output.json; \
	echo "✅ Cleanup complete."

# ----------------------------
# Main Deployment Target
# ----------------------------
deploy: build api-docker-image-push deploy-container wait-for-container update-dns cleanup-old-containers
	@echo "🚀 Deployment successful! API is live at https://$(API_DNS_RECORD)"

# ----------------------------
# Data upload to Scaleway
# ----------------------------

check-s5cmd:
	@if ! command -v s5cmd >/dev/null 2>&1; then \
		echo "❌ s5cmd not found. Installing..."; \
		curl -L https://github.com/peak/s5cmd/releases/download/v2.3.0/s5cmd_2.3.0_Linux-64bit.tar.gz | tar xz -C /tmp; \
		sudo mv /tmp/s5cmd /usr/local/bin/; \
	fi

check-env:
	@echo "Checking environment variables..."
	@test -n "$(S3_DATAPREP_ACCESS_KEY)" || (echo "❌ S3_DATAPREP_ACCESS_KEY not set" && exit 1)
	@test -n "$(S3_DATAPREP_SECRET_KEY)" || (echo "❌ S3_DATAPREP_SECRET_KEY not set" && exit 1)
	@test -n "$(S3_ENDPOINT_URL)" || (echo "❌ S3_ENDPOINT_URL not set" && exit 1)
	@test -n "$(S3_BUCKET_NC)" || (echo "❌ S3_BUCKET_NC not set" && exit 1)
	@test -n "$(S3_BUCKET_DOCS)" || (echo "❌ S3_BUCKET_DOCS not set" && exit 1)
	@echo "✅ All environment variables are set"

dataprep-upload-nc-data: check-s5cmd
	@if [ -z "${S3_DATAPREP_ACCESS_KEY}" ] || [ -z "${S3_DATAPREP_SECRET_KEY}" ]; then \
		echo "❌ Error: S3_DATAPREP_ACCESS_KEY and S3_DATAPREP_SECRET_KEY must be set in env"; \
		exit 1; \
	fi
	@echo "▶ Uploading non-conformities data to Scaleway..."
	export AWS_ACCESS_KEY_ID=${S3_DATAPREP_ACCESS_KEY} &&\
	export AWS_SECRET_ACCESS_KEY=${S3_DATAPREP_SECRET_KEY} &&\
	s5cmd --endpoint-url ${S3_ENDPOINT_URL} \
		sync 'api/data/${S3_BUCKET_NC}/*' s3://${S3_BUCKET_NC}/

dataprep-upload-tech-docs: check-s5cmd
	@if [ -z "${S3_DATAPREP_ACCESS_KEY}" ] || [ -z "${S3_DATAPREP_SECRET_KEY}" ]; then \
		echo "❌ Error: S3_DATAPREP_ACCESS_KEY and S3_DATAPREP_SECRET_KEY must be set in env"; \
		exit 1; \
	fi
	@echo "▶ Uploading technical documentation to Scaleway..."
	export AWS_ACCESS_KEY_ID=${S3_DATAPREP_ACCESS_KEY} &&\
	export AWS_SECRET_ACCESS_KEY=${S3_DATAPREP_SECRET_KEY} &&\
	s5cmd --endpoint-url ${S3_ENDPOINT_URL} \
		sync 'api/data/${S3_BUCKET_DOCS}/*' s3://${S3_BUCKET_DOCS}/

dataprep-upload-all: dataprep-upload-nc-data dataprep-upload-tech-docs
	@echo "✔️  All data upload completed."

# ----------------------------
# Data download from Scaleway
# ----------------------------

dataprep-download-nc-data: check-s5cmd
	@if [ -z "${S3_API_ACCESS_KEY}" ] || [ -z "${S3_API_SECRET_KEY}" ]; then \
		echo "❌ Error: S3_API_ACCESS_KEY and S3_API_SECRET_KEY must be set in env"; \
		exit 1; \
	fi
	@echo "▶ Downloading non-conformities data from Scaleway..."
	export AWS_ACCESS_KEY_ID=${S3_API_ACCESS_KEY} &&\
	export AWS_SECRET_ACCESS_KEY=${S3_API_SECRET_KEY} &&\
	s5cmd --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/* 'api/data/${S3_BUCKET_NC}/'

dataprep-download-tech-docs: check-s5cmd
	@if [ -z "${S3_API_ACCESS_KEY}" ] || [ -z "${S3_API_SECRET_KEY}" ]; then \
		echo "❌ Error: S3_API_ACCESS_KEY and S3_API_SECRET_KEY must be set in env"; \
		exit 1; \
	fi
	@echo "▶ Downloading technical documentation from Scaleway..."
	export AWS_ACCESS_KEY_ID=${S3_API_ACCESS_KEY} &&\
	export AWS_SECRET_ACCESS_KEY=${S3_API_SECRET_KEY} &&\
	s5cmd --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/* 'api/data/${S3_BUCKET_DOCS}/'

dataprep-download-all: dataprep-download-nc-data dataprep-download-tech-docs
	@echo "✔️  All data download completed."

# ==============================================================================
# Data
# ==============================================================================

create-tech-docs-db:
	@echo "Creating tech docs ChromaDB from source CSV..."
	@docker-compose -f docker-compose.dataprep.yml run --rm dataprep python create_tech_docs_db.py

create-nc-db:
	@echo "Creating non-conformities ChromaDB from source CSV..."
	@docker-compose -f docker-compose.dataprep.yml run --rm dataprep python create_nc_db.py

create-db: create-tech-docs-db create-nc-db
	@echo "All databases created."

.PHONY: deps env config clean
clean:
	@echo "▶ Cleaning environment..."
	rm -rf api/venv
	rm -rf api/__pycache__
	rm -rf ui/node_modules
	rm -rf ui/build
	@echo "✔️  Cleaning done."

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  help          Show this help message"
	@echo "  dev           Start all services in development mode with hot-reloading"
	@echo "  build         Build or rebuild services"
	@echo "  up            Start services in detached mode"
	@echo "  down          Stop and remove containers, networks"
	@echo "  logs          Follow log output"
	@echo "  shell         Access the api container shell"
	@echo "  dataprep-nc-csv-to-json  Extract JSON data from the source CSV"
	@echo "  clean         Remove build artifacts"
	@echo "  check-db      Check the health of ChromaDB databases"
	@echo "  create-tech-docs-db  Create the tech docs ChromaDB"
	@echo "  create-nc-db       Create the non-conformities ChromaDB"
	@echo "  create-db          Create all databases"

# ==============================================================================
# Utils
# ==============================================================================

check-db:
	@echo "Rebuilding dataprep service to ensure dependencies are up to date..."
	@docker-compose -f docker-compose.dataprep.yml build --no-cache dataprep
	@echo "Running ChromaDB health check..."
	@docker-compose -f docker-compose.dataprep.yml run --rm dataprep python check_chroma_health.py