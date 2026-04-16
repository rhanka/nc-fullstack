.SILENT:
.PHONY: dev dev-stop up down ui-install ui-build ui-check docker-build docker-push build deploy deps env config clean help api-prepare-data-ci api-build api-install api-image-publish api-test api-smoke api-contracts api-review-routing check deploy-api dataprep dataprep-prepare-tech-docs dataprep-tech-docs dataprep-nc dataprep-knowledge dataprep-knowledge-tech-docs dataprep-knowledge-ci

# ----------------------------
# Helpers
# ----------------------------
-include .env

# ----------------------------
# Env variables
# ----------------------------
export UI_DIR          ?= ui
export API_IMAGE_NAME  ?= nc-chatbot-api
export API_VERSION     ?= $(shell echo "backend-ts/src backend-ts/scripts backend-ts/package.json backend-ts/package-lock.json backend-ts/Dockerfile shared api/src api/requirements.txt api/data/${TECH_DOCS_DIR}/ontology api/data/${TECH_DOCS_DIR}/wiki api/data/${NC_DIR}/ontology api/data/${NC_DIR}/wiki" | tr ' ' '\n' | xargs -I '{}' sh -c 'test -e "$$1" && find "$$1" -type f || true' sh '{}' | egrep -v '(__pycache__|/ontology/index\.json)' | sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export API_CPU_LIMIT   ?= 250
export API_MEM_LIMIT   ?= 512
export UI_VERSION      ?= $(shell echo "ui/src ui/static ui/package.json ui/Dockerfile ui/vite.config.ts ui/svelte.config.js ui/tsconfig.json" | tr ' ' '\n' | xargs -I '{}' find {} -type f | egrep -v '__pycache__'  | sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export REGISTRY        ?= rg.fr-par.scw.cloud
export S3_BUCKET_DOCS  ?= a220-tech-docs
export S3_BUCKET_NC    ?= a220-non-conformities
export S3_REGION       ?= fr-par
export S3_ENDPOINT_URL ?= https://s3.fr-par.scw.cloud
export VITE_API_URL    ?=
export TECH_DOCS_DIR   ?= a220-tech-docs
export NC_DIR          ?= a220-non-conformities
export API_PORT        ?= 8000
export UI_PORT         ?= 5177
export NGINX_PORT      ?= 8080
export DC_OPTS         ?= --build --force-recreate

# ----------------------------
# Main targets
# ----------------------------

version:
	@echo ui:$(UI_VERSION)-api:$(API_VERSION)

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
	@echo "▶ Building UI..."
	cd $(UI_DIR) && VITE_API_URL=$(VITE_API_URL) npm run build

ui-check: ui-install
	@echo "▶ Checking UI..."
	cd $(UI_DIR) && npm run check

# ----------------------------
# Containerisation
# ----------------------------

api-prepare-data-ci: dataprep-knowledge-ci
	@echo "✔️ API data artifacts ready for CI image build."

api-build: api-prepare-data-ci
	@echo "▶ Building Docker image for API: $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)"
	docker compose build api

api-install:
	@echo "▶ Installing backend dependencies..."
	cd backend-ts && npm ci

api-test: api-install
	@echo "▶ Running backend tests..."
	cd backend-ts && npm run test

api-smoke: api-install
	@echo "▶ Running backend smoke test..."
	cd backend-ts && npm run smoke

api-contracts: api-install
	@echo "▶ Checking backend contracts..."
	cd backend-ts && npm run contracts:check

api-review-routing: api-install
	@echo "▶ Reviewing backend routing decisions..."
	cd backend-ts && npm run review:routing

dataprep-prepare-tech-docs: api-install
	@echo "▶ Preparing canonical tech docs CSV..."
	cd backend-ts && npm run dataprep:prepare-tech-docs

dataprep: api-install
	@echo "▶ Running dataprep for all corpora..."
	cd backend-ts && npm run dataprep

dataprep-tech-docs: api-install
	@echo "▶ Running dataprep for tech docs..."
	cd backend-ts && npm run dataprep:tech-docs

dataprep-nc: api-install
	@echo "▶ Running dataprep for non-conformities..."
	cd backend-ts && npm run dataprep:nc

dataprep-knowledge: api-install
	@echo "▶ Running knowledge-only dataprep for all corpora..."
	cd backend-ts && npm run dataprep:knowledge

dataprep-knowledge-tech-docs: api-install
	@echo "▶ Running knowledge-only dataprep for tech docs..."
	cd backend-ts && npm run dataprep:knowledge:tech-docs

dataprep-knowledge-ci: dataprep-download-minimal api-install
	@echo "▶ Preparing knowledge artifacts for API image..."
	cd backend-ts && npm run dataprep:knowledge

check: ui-build api-test api-contracts
	@echo "✔️ UI build and backend checks completed."

docker-login:
	@echo "▶ Logging in to registry"
	@echo "$(DOCKER_PASSWORD)" | docker login $(REGISTRY) -u $(DOCKER_USERNAME) --password-stdin

api-image-check: api-prepare-data-ci docker-login
	@echo "▶ Checking if image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) exists"
	docker manifest inspect $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) exists" || (echo "❌ Image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) does not exist" && exit 1)

api-image-publish: docker-login
	@echo "▶ Pushing API image to registry"
	docker push $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)

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

# ----------------------------
# Deploy API container
# ----------------------------

deploy-api-container: check-scw
	@echo "▶️ Updating container $(API_IMAGE_NAME) to image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)..."
	API_CONTAINER_ID=$$(scw container container list | awk '($$2=="$(API_IMAGE_NAME)"){print $$1}'); \
	scw container container update $${API_CONTAINER_ID} registry-image="$(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)" > .deploy_output.log
	@echo "✅ API deployment initiated."

wait-for-container: check-scw
	@printf "⌛ Waiting for container to become ready.."
	API_CONTAINER_STATUS="pending"; \
	while [ "$${API_CONTAINER_STATUS}" != "ready" ]; do \
		API_CONTAINER_STATUS=$$(scw container container list | awk '($$2=="$(API_IMAGE_NAME)"){print $$4}'); \
		printf "."; \
		sleep 1; \
	done; \
	printf "\n✅ New container is ready.\n"

deploy-api: deploy-api-container wait-for-container

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
		cp --acl "public-read" 'api/data/${S3_BUCKET_NC}/*' s3://${S3_BUCKET_NC}/

dataprep-upload-tech-docs: check-s5cmd
	@if [ -z "${S3_DATAPREP_ACCESS_KEY}" ] || [ -z "${S3_DATAPREP_SECRET_KEY}" ]; then \
		echo "❌ Error: S3_DATAPREP_ACCESS_KEY and S3_DATAPREP_SECRET_KEY must be set in env"; \
		exit 1; \
	fi
	@echo "▶ Uploading technical documentation to Scaleway..."
	export AWS_ACCESS_KEY_ID=${S3_DATAPREP_ACCESS_KEY} &&\
	export AWS_SECRET_ACCESS_KEY=${S3_DATAPREP_SECRET_KEY} &&\
	s5cmd --endpoint-url ${S3_ENDPOINT_URL} \
		cp --acl "public-read" 'api/data/${S3_BUCKET_DOCS}/*' s3://${S3_BUCKET_DOCS}/

dataprep-upload-all: dataprep-upload-nc-data dataprep-upload-tech-docs
	@echo "✔️  All data upload completed."

# ----------------------------
# Data download from Scaleway
# ----------------------------

dataprep-download-nc-data: check-s5cmd
	@echo "▶ Downloading non-conformities data from Scaleway..."
	@s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/* 'api/data/${NC_DIR}/'

dataprep-download-tech-docs: check-s5cmd
	@echo "▶ Downloading technical documentation from Scaleway..."
	@s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/* 'api/data/${TECH_DOCS_DIR}/'

dataprep-download-all: dataprep-download-nc-data dataprep-download-tech-docs
	@echo "✔️  All data download completed."

dataprep-download-minimal: check-s5cmd
	@echo "▶ Downloading minimal data from Scaleway..."
	@mkdir -p 'api/data/${TECH_DOCS_DIR}/managed_dataset/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/managed_dataset/* 'api/data/${TECH_DOCS_DIR}/managed_dataset/'
	@mkdir -p 'api/data/${TECH_DOCS_DIR}/vector-export/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/vector-export/* 'api/data/${TECH_DOCS_DIR}/vector-export/' 2>/dev/null || true
	@mkdir -p 'api/data/${TECH_DOCS_DIR}/lexical/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/lexical/* 'api/data/${TECH_DOCS_DIR}/lexical/' 2>/dev/null || true
	@mkdir -p 'api/data/${TECH_DOCS_DIR}/ontology/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/ontology/* 'api/data/${TECH_DOCS_DIR}/ontology/' 2>/dev/null || true
	@mkdir -p 'api/data/${TECH_DOCS_DIR}/wiki/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/wiki/* 'api/data/${TECH_DOCS_DIR}/wiki/' 2>/dev/null || true
	@s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		cp s3://${S3_BUCKET_DOCS}/knowledge-manifest.json 'api/data/${TECH_DOCS_DIR}/knowledge-manifest.json' 2>/dev/null || true
	@mkdir -p 'api/data/${TECH_DOCS_DIR}/pages/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_DOCS}/pages/* 'api/data/${TECH_DOCS_DIR}/pages/'
	@mkdir -p 'api/data/${NC_DIR}/managed_dataset/' && \
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/managed_dataset/* 'api/data/${NC_DIR}/managed_dataset/'
	@mkdir -p 'api/data/${NC_DIR}/vector-export/' &&\
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/vector-export/* 'api/data/${NC_DIR}/vector-export/' 2>/dev/null || true
	@mkdir -p 'api/data/${NC_DIR}/lexical/' && \
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/lexical/* 'api/data/${NC_DIR}/lexical/' 2>/dev/null || true
	@mkdir -p 'api/data/${NC_DIR}/ontology/' && \
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/ontology/* 'api/data/${NC_DIR}/ontology/' 2>/dev/null || true
	@mkdir -p 'api/data/${NC_DIR}/wiki/' && \
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/wiki/* 'api/data/${NC_DIR}/wiki/' 2>/dev/null || true
	@s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		cp s3://${S3_BUCKET_NC}/knowledge-manifest.json 'api/data/${NC_DIR}/knowledge-manifest.json' 2>/dev/null || true
	@mkdir -p 'api/data/${NC_DIR}/json/' && \
	s5cmd --no-sign-request --endpoint-url ${S3_ENDPOINT_URL} \
		sync s3://${S3_BUCKET_NC}/json/* 'api/data/${NC_DIR}/json/'
	@echo "✔️  Minimal data download completed."

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
	@echo "  dataprep-prepare-tech-docs  Build canonical tech docs CSV"
	@echo "  dataprep      Rebuild retrieval and knowledge artifacts"
	@echo "  dataprep-knowledge  Rebuild ontology and wiki artifacts"
	@echo "  clean         Remove build artifacts"
