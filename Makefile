.SILENT:
.PHONY: dev run ui-install ui-build docker-build docker-push build deploy deps env config clean help dataprep-nc-csv-to-json

# ----------------------------
# Helpers
# ----------------------------
-include .env

# ----------------------------
# Env variables
# ----------------------------
export UI_DIR          ?= ui
export IMAGE_NAME      ?= nc-chatbot
export TAG             ?= $(shell git rev-parse --short HEAD)
export REGISTRY        ?= rg.fr-par.scw.cloud/$(IMAGE_NAME)
export S3_BUCKET_DOCS  ?= a220-tech-docs
export S3_BUCKET_NC    ?= a220-non-conformities
export S3_REGION       ?= fr-par
export S3_ENDPOINT_URL ?= https://s3.fr-par.scw.cloud
export VITE_API_URL    ?=


# ----------------------------
# Main targets
# ----------------------------

dev:
	@echo "▶ Starting API and UI in dev mode with Docker..."
	docker-compose up --build

run:
	@echo "▶ Running API and UI in production mode with Docker..."
	docker-compose up --build

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
# Deployment (example Scaleway CLI)
# ----------------------------

deploy: build docker-push
	@echo "▶ Deploying container to Scaleway Container Registry/Namespace"
	@echo "   (Adapt this command to your infra)"
	# Example: scw container container deploy name=$(IMAGE_NAME) image=$(REGISTRY):$(TAG)

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

dataprep-nc-csv-to-json:
	@echo "Extracting non-conformity JSON files from source CSV..."
	@chmod +x dataprep/extract_jsons.py
	@./dataprep/extract_jsons.py

.PHONY: deps env config clean
clean:
	@echo "▶ Cleaning environment..."
	rm -rf api/venv
	rm -rf api/__pycache__
	rm -rf ui/node_modules
	rm -rf ui/build
	@echo "✔️  Cleaning done." 