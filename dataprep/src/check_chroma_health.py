#!/usr/bin/env python3
import chromadb
import pathlib
import sys
import os
import chromadb.utils.embedding_functions as embedding_functions

# Build paths relative to the script's location
DATA_ROOT = pathlib.Path("/data")
DB_TECH_DOCS_PATH = str(DATA_ROOT / "a220-tech-docs/vectordb")
DB_NC_PATH = str(DATA_ROOT / "a220-non-conformities/vectordb")

def check_db_health(name: str, path: str):
    """
    Attempts to connect to a ChromaDB, list its collections, and run a test query.
    """
    print(f"Checking health of '{name}' database at {path}...")
    try:
        client = chromadb.PersistentClient(path=path)
        collections = client.list_collections()
        
        if not collections:
            print("⚠️  No collections found.")
            return

        collection_names = [c.name for c in collections]
        print(f"✅ SUCCESS: Found {len(collections)} collection(s): {collection_names}")
        
        # This will use the OPENAI_API_KEY environment variable.
        openai_ef = embedding_functions.OpenAIEmbeddingFunction(
                        api_key=os.getenv("OPENAI_API_KEY"),
                        model_name="text-embedding-3-large"
                    )

        # Attempt to query each collection
        for collection_name in collection_names:
            print(f"  - Querying collection '{collection_name}'...")
            collection = client.get_collection(
                name=collection_name,
                embedding_function=openai_ef
            )
            collection.query(query_texts=["test"], n_results=1)
            print(f"  ✅ Query successful.")

    except Exception as e:
        print(f"❌ FAILED: An error occurred with '{name}'. Error: {e}")
        print()

if __name__ == "__main__":
    check_db_health("Tech Docs", DB_TECH_DOCS_PATH)
    print("-" * 50)
    check_db_health("Non-Conformities", DB_NC_PATH) 