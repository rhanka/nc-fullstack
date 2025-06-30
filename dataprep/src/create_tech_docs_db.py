#!/usr/bin/env python3
import csv
import gzip
import json
import pathlib
import sys
import os
import chromadb
import chromadb.utils.embedding_functions as embedding_functions

# Configure logger
import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# --- Configuration ---
SCRIPT_DIR = pathlib.Path(__file__).parent.parent.parent
DB_PATH = SCRIPT_DIR / "/data/a220-tech-docs/vectordb"
SOURCE_FILE = SCRIPT_DIR / "/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_prepared.csv.gz"
COLLECTION_NAME = "langchain"
BATCH_SIZE = 500  # Réduire la taille du lot

def create_tech_docs_db():
    """
    Creates the ChromaDB for technical documentation from a gzipped CSV file.
    """
    logger.info("Starting database creation...")

    if not SOURCE_FILE.exists():
        logger.error("Source file not found: %s", SOURCE_FILE)
        sys.exit(1)

    # Clean up existing database if it exists
    if DB_PATH.exists():
        logger.info("Removing existing database at %s", DB_PATH)
        import shutil
        shutil.rmtree(DB_PATH)
    
    DB_PATH.mkdir(parents=True, exist_ok=True)
    logger.info("Database will be created at: %s", DB_PATH)

    # Initialize ChromaDB client and embedding function
    client = chromadb.PersistentClient(path=str(DB_PATH))
    openai_ef = embedding_functions.OpenAIEmbeddingFunction(
        api_key=os.getenv("OPENAI_API_KEY"),
        model_name="text-embedding-3-large"
    )
    
    collection = client.create_collection(
        name=COLLECTION_NAME,
        embedding_function=openai_ef
    )

    documents = []
    metadatas = []
    ids = []
    batch_count = 0

    logger.info("Reading and processing source file: %s", SOURCE_FILE)
    try:
        with gzip.open(SOURCE_FILE, "rt", encoding="utf-8") as f:
            reader = csv.reader(f, delimiter="\t", quotechar='"', escapechar='\\', doublequote=False, quoting=csv.QUOTE_MINIMAL)
            
            header = next(reader, None) # Skip header
            if not header:
                logger.warning("Source file is empty.")
                return

            for i, row in enumerate(reader):
                if len(row) < 9:
                    logger.warning("Skipping malformed row %d: %s", i + 2, row)
                    continue

                doc, doc_root, json_data, chunk, length, chunk_id, ata, parts, doc_type = row
                
                documents.append(chunk)
                metadatas.append({
                    "doc": doc,
                    "doc_root": doc_root,
                    "json_data": json_data,
                    "length": int(length) if length.isdigit() else 0,
                    "chunk_id": chunk_id,
                    "ATA": ata,
                    "parts": parts,
                    "doc_type": doc_type,
                })
                ids.append(chunk_id)

                # Si le lot est plein, on l'ajoute à la collection
                if len(documents) >= BATCH_SIZE:
                    batch_count += 1
                    logger.info("Adding batch %d with %d documents...", batch_count, len(documents))
                    collection.add(
                        documents=documents,
                        metadatas=metadatas,
                        ids=ids
                    )
                    # On réinitialise les listes pour le prochain lot
                    documents, metadatas, ids = [], [], []

    except Exception as e:
        logger.error("Failed to process CSV file: %s", e)
        sys.exit(1)

    # Ajouter le dernier lot s'il n'est pas vide
    if documents:
        batch_count += 1
        logger.info("Adding final batch %d with %d documents...", batch_count, len(documents))
        try:
            collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )
        except Exception as e:
            logger.error("Failed to add final batch to the collection: %s", e)
            sys.exit(1)
            
    logger.info("✅ Database created successfully.")

if __name__ == "__main__":
    create_tech_docs_db() 