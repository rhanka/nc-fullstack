import chromadb
import pathlib
import logging
import os
from typing import List, Dict, Any
import chromadb.utils.embedding_functions as embedding_functions

# Configure logger
logger = logging.getLogger(__name__)

# Build paths relative to this script's location
SCRIPT_DIR = pathlib.Path(__file__).parent.parent
DB_TECH_DOCS_PATH = str(SCRIPT_DIR / "data/a220-tech-docs/vectordb")
DB_NC_PATH = str(SCRIPT_DIR / "data/a220-non-conformities/vectordb")

# This will use the OPENAI_API_KEY environment variable.
# We specify the model that matches the embedding dimensions (3072).
openai_ef = embedding_functions.OpenAIEmbeddingFunction(
                api_key=os.getenv("OPENAI_API_KEY"),
                model_name="text-embedding-3-large"
            )

# Initialize ChromaDB clients
logger.info("Initializing ChromaDB client for tech docs at: %s", DB_TECH_DOCS_PATH)
client_tech_docs = chromadb.PersistentClient(path=DB_TECH_DOCS_PATH)
logger.info("Initializing ChromaDB client for non-conformities at: %s", DB_NC_PATH)
client_nc = chromadb.PersistentClient(path=DB_NC_PATH)

# Get collection names dynamically
def get_collection_name(client, db_name: str):
    """Get the first available collection name and log findings."""
    logger.info("Listing collections for %s...", db_name)
    try:
        collections = client.list_collections()
        if collections:
            collection_names = [c.name for c in collections]
            logger.info("Found collections for %s: %s", db_name, collection_names)
            return collections[0].name
        logger.warning("No collections found for %s.", db_name)
        return None
    except Exception as e:
        logger.error("Failed to list collections for %s: %s", db_name, e)
        return None

# Assume collection names are known or can be discovered.
# For now, let's use a placeholder name. You may need to adjust this.
COLLECTION_TECH_DOCS = "langchain"
COLLECTION_NC = "non_conformities"

logger.info("Using tech docs collection: %s", COLLECTION_TECH_DOCS)
logger.info("Using non-conformities collection: %s", COLLECTION_NC)

def search_documents(query: str, n_results: int = 10) -> List[Dict[str, Any]]:
    """
    Searches for documents in the technical documentation ChromaDB.
    Gracefully handles a corrupted database by returning empty results.
    """
    if not COLLECTION_TECH_DOCS:
        logger.warning("No tech docs collection available. Returning empty search results.")
        return {"documents": [[]], "metadatas": [[]], "distances": [[]]}
    
    logger.info("Querying tech docs collection '%s' for: '%s'", COLLECTION_TECH_DOCS, query)
    try:
        collection = client_tech_docs.get_collection(
            name=COLLECTION_TECH_DOCS,
            embedding_function=openai_ef
        )
        results = collection.query(
            query_texts=[query],
            n_results=n_results
        )
        count = len(results.get('documents', [[]])[0])
        logger.info("Found %d results for tech docs.", count)
        return results
    except Exception as e:
        logger.error(f"Failed to query tech docs collection '{COLLECTION_TECH_DOCS}'. This is likely due to a corrupted database. Returning empty results. Error: {e}")
        return {"documents": [[]], "metadatas": [[]], "distances": [[]]}

def search_non_conformities(query: str, n_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for similar non-conformities in the vector database.
    """
    if not COLLECTION_NC:
        logger.warning("No non-conformities collection available. Returning empty search results.")
        return {"documents": [[]], "metadatas": [[]], "distances": [[]]}
    
    logger.info("Querying non-conformities collection '%s' for: '%s'", COLLECTION_NC, query)
    try:
        collection = client_nc.get_collection(
            name=COLLECTION_NC,
            embedding_function=openai_ef
        )
        results = collection.query(
            query_texts=[query],
            n_results=n_results
        )
        
        count = len(results.get('documents', [[]])[0])
        logger.info("Found %d results for non-conformities.", count)
        return results
    except Exception as e:
        logger.error(f"Failed to query non-conformities collection '{COLLECTION_NC}': {e}")
        return {"documents": [[]], "metadatas": [[]], "distances": [[]]}

def format_search_results(results: Any) -> Dict[str, Any]:
    """Formate les résultats de recherche pour le frontend pour contenir une clé 'sources'."""
    # ChromaDB retourne un dictionnaire avec 'documents', 'metadatas', 'distances', etc.
    if isinstance(results, dict) and 'documents' in results:
        documents = results['documents'][0] if results['documents'] else []
        metadatas = results['metadatas'][0] if results['metadatas'] else []
        
        # Formater les documents avec leurs métadonnées au premier niveau
        formatted_docs = []
        for i, doc in enumerate(documents):
            # On fusionne le contenu et les métadonnées
            doc_info = {
                "content": doc,
                **(metadatas[i] if i < len(metadatas) and metadatas[i] is not None else {})
            }
            formatted_docs.append(doc_info)
    else:
        # Fallback si ce n'est pas le format attendu
        formatted_docs = results if isinstance(results, list) else []
    
    return {"sources": formatted_docs} 