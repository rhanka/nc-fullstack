#!/usr/bin/env python3
import csv
import gzip
import json
import pathlib
import sys
import os
import chromadb
import chromadb.utils.embedding_functions as embedding_functions
import openai

# Configure logger
import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# --- Configuration ---
DATA_DIR = pathlib.Path("/data")
NC_DIR_NAME = os.getenv("NC_DIR", "a220-non-conformities")
NC_PATH = DATA_DIR / NC_DIR_NAME

DB_PATH = NC_PATH / "vectordb"
SOURCE_FILE = NC_PATH / "managed_dataset/NC_types_random_500_pre_embed.csv.gz"
COLLECTION_NAME = "non_conformities"
BATCH_SIZE = 100
MAX_DOC_CHARS = 30000

def add_batch_individually(collection, documents, metadatas, ids):
    """
    Adds documents to the collection one by one as a fallback mechanism.
    This helps to isolate and skip problematic documents in a batch.
    """
    logger.warning("A batch failed to add. Retrying documents one by one to isolate the issue...")
    success_count = 0
    for i in range(len(documents)):
        try:
            collection.add(
                documents=[documents[i]],
                metadatas=[metadatas[i]],
                ids=[ids[i]]
            )
            success_count += 1
        except Exception as e:
            # Log the specific ID of the failed document and skip it
            logger.error("Could not add document with ID %s. Error: %s. This document will be skipped.", ids[i], e)
    logger.info("Individually added %d out of %d documents from the failed batch.", success_count, len(documents))


def create_nc_db():
    """
    Creates the ChromaDB for non-conformities from a gzipped CSV file.
    """
    logger.info("Starting NC database creation...")

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
    seen_ids = set()

    logger.info("Reading and processing source file: %s", SOURCE_FILE)
    try:
        with gzip.open(SOURCE_FILE, "rt", encoding="utf-8") as f:
            # Utilisation des mêmes options de lecture CSV que pour les documents techniques
            reader = csv.reader(f, delimiter="\t", quotechar='"', escapechar='\\', doublequote=False, quoting=csv.QUOTE_MINIMAL)
            
            # Ce fichier n'a pas d'en-tête

            for i, row in enumerate(reader):
                if len(row) != 3:
                    logger.warning("Skipping malformed row %d (expected 3 columns, got %d): %s", i + 1, len(row), row)
                    continue

                doc, chunk_id, chunk = row
                
                # Ignorer les IDs en double
                if chunk_id in seen_ids:
                    logger.warning("Skipping duplicate chunk_id: %s", chunk_id)
                    continue

                # Ignorer les lignes où le chunk à embedder est vide ou ne contient que des espaces
                if not chunk or not chunk.strip():
                    logger.warning("Skipping row with empty chunk. Doc: %s, Chunk ID: %s", doc, chunk_id)
                    continue
                
                # Le contenu à embedder est le chunk lui-même
                doc_content = chunk

                # Tronquer les documents trop longs pour éviter les erreurs de token
                if len(doc_content) > MAX_DOC_CHARS:
                    logger.warning("Truncating long document for doc %s, chunk_id %s", doc, chunk_id)
                    doc_content = doc_content[:MAX_DOC_CHARS]
                
                documents.append(doc_content)
                metadatas.append({
                    "doc": doc,
                    "chunk_id": chunk_id,
                })
                ids.append(chunk_id)
                seen_ids.add(chunk_id)

                if len(documents) >= BATCH_SIZE:
                    batch_count += 1
                    logger.info("Adding batch %d with %d documents...", batch_count, len(documents))
                    try:
                        collection.add(documents=documents, metadatas=metadatas, ids=ids)
                    except openai.BadRequestError:
                        add_batch_individually(collection, documents, metadatas, ids)
                    documents, metadatas, ids = [], [], []

    except Exception as e:
        logger.error("Failed to process CSV file: %s", e, exc_info=True)
        sys.exit(1)

    if documents:
        batch_count += 1
        logger.info("Adding final batch %d with %d documents...", batch_count, len(documents))
        try:
            collection.add(documents=documents, metadatas=metadatas, ids=ids)
        except openai.BadRequestError:
            add_batch_individually(collection, documents, metadatas, ids)
        except Exception as e:
            logger.error("Failed to add final batch to the collection: %s", e, exc_info=True)
            sys.exit(1)
            
    logger.info("✅ NC Database created successfully.")

if __name__ == "__main__":
    create_nc_db() 