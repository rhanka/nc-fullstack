import chromadb
import pathlib
import logging
import os
from typing import List, Dict, Any
import chromadb.utils.embedding_functions as embedding_functions
import cohere

# Configure logger
logger = logging.getLogger(__name__)

# Facteurs pour le seuil de pertinence dynamique
TECH_DOCS_DISTANCE_FACTOR = 1.2
NC_DISTANCE_FACTOR = 1.2

# Limites finales du nombre de résultats
MAX_TECH_DOCS_RESULTS = 10
MAX_NC_RESULTS = 10

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

# --- Configuration ---
RERANKING_ENABLED = os.getenv("RERANKING_ENABLED", "false").lower() in ("true", "1", "t")

# Cohere Client (initialisé uniquement si le reranking est activé)
co = None
if RERANKING_ENABLED:
    COHERE_API_KEY = os.getenv("COHERE_API_KEY")
    if COHERE_API_KEY:
        logger.info("Reranking is enabled. Initializing Cohere client...")
        co = cohere.Client(COHERE_API_KEY)
    else:
        logger.warning("RERANKING_ENABLED is true, but COHERE_API_KEY is not found. Reranking will be disabled.")
else:
    logger.info("Reranking is disabled.")

def search_documents(query: str, n_results: int = 15) -> List[Dict[str, Any]]:
    """
    Searches for documents, then optionally reranks them using Cohere for relevance.
    """
    if not COLLECTION_TECH_DOCS:
        logger.warning("No tech docs collection available. Returning empty search results.")
        return []
    
    logger.info("Querying tech docs collection '%s' for: '%s'", COLLECTION_TECH_DOCS, query)
    try:
        collection = client_tech_docs.get_collection(name=COLLECTION_TECH_DOCS, embedding_function=openai_ef)
        results = collection.query(query_texts=[query], n_results=n_results)
        
        documents = results.get('documents', [[]])[0]
        metadatas = results.get('metadatas', [[]])[0]

        if not documents:
            return []

        # Reranking avec Cohere si activé et disponible
        if co and RERANKING_ENABLED:
            logger.info("Reranking %d tech docs with Cohere...", len(documents))
            reranked_results = co.rerank(
                model='rerank-english-v2.0',
                query=query,
                documents=[doc for doc in documents],
                top_n=MAX_TECH_DOCS_RESULTS
            )
            
            final_results = []
            for hit in reranked_results.results:
                original_doc = documents[hit.index]
                metadata = metadatas[hit.index]
                metadata['relevance_score'] = hit.relevance_score
                final_results.append({
                    "content": original_doc,
                    **metadata
                })
            logger.info("Returning %d reranked results for tech docs.", len(final_results))
            return final_results
        else:
            # Fallback si Cohere n'est pas utilisé : on retourne les N meilleurs résultats bruts
            logger.info("Returning top %d results for tech docs without reranking.", MAX_TECH_DOCS_RESULTS)
            top_results = []
            distances = results.get('distances', [[]])[0]
            for i in range(len(documents)):
                metadata = metadatas[i]
                metadata['distance'] = distances[i] if i < len(distances) else -1.0
                top_results.append({
                    "content": documents[i],
                    **metadata
                })
            return top_results[:MAX_TECH_DOCS_RESULTS]

    except Exception as e:
        logger.error(f"Failed to query or rerank tech docs. Error: {e}", exc_info=True)
        return []

def search_non_conformities(query: str, n_results: int = 15) -> List[Dict[str, Any]]:
    """
    Searches for non-conformities, then optionally reranks them using Cohere for relevance.
    """
    if not COLLECTION_NC:
        logger.warning("No non-conformities collection available. Returning empty search results.")
        return []
    
    logger.info("Querying non-conformities collection '%s' for: '%s'", COLLECTION_NC, query)
    try:
        collection = client_nc.get_collection(name=COLLECTION_NC, embedding_function=openai_ef)
        results = collection.query(query_texts=[query], n_results=n_results)
        
        documents = results.get('documents', [[]])[0]
        metadatas = results.get('metadatas', [[]])[0]

        if not documents:
            return []

        # Reranking avec Cohere si activé et disponible
        if co and RERANKING_ENABLED:
            logger.info("Reranking %d non-conformities with Cohere...", len(documents))
            reranked_results = co.rerank(
                model='rerank-english-v2.0',
                query=query,
                documents=[doc for doc in documents],
                top_n=MAX_NC_RESULTS
            )
            
            final_results = []
            for hit in reranked_results.results:
                original_doc = documents[hit.index]
                metadata = metadatas[hit.index]
                metadata['relevance_score'] = hit.relevance_score
                final_results.append({
                    "content": original_doc,
                    **metadata
                })
            logger.info("Returning %d reranked results for non-conformities.", len(final_results))
            return final_results
        else:
            logger.info("Returning top %d results for non-conformities without reranking.", MAX_NC_RESULTS)
            top_results = []
            distances = results.get('distances', [[]])[0]
            for i in range(len(documents)):
                metadata = metadatas[i]
                metadata['distance'] = distances[i] if i < len(distances) else -1.0
                top_results.append({
                    "content": documents[i],
                    **metadata
                })
            return top_results[:MAX_NC_RESULTS]

    except Exception as e:
        logger.error(f"Failed to query or rerank non-conformities. Error: {e}", exc_info=True)
        return []

def format_search_results(results: Any) -> Dict[str, Any]:
    """Formate les résultats de recherche pour le frontend pour contenir une clé 'sources'."""
    # Cette fonction reçoit maintenant une liste de dictionnaires déjà formatés
    return {"sources": results if isinstance(results, list) else []} 