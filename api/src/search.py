import chromadb
import pathlib
import logging
import os
from typing import List, Dict, Any
import chromadb.utils.embedding_functions as embedding_functions
import cohere
from src.lexical_search import search_documents_lexical, search_non_conformities_lexical
from src.query_rewrite import rewrite_retrieval_query

# Configure logger
logger = logging.getLogger(__name__)

# Facteurs pour le seuil de pertinence dynamique
TECH_DOCS_DISTANCE_FACTOR = 1.2
NC_DISTANCE_FACTOR = 1.2

# Limites finales du nombre de résultats
MAX_TECH_DOCS_RESULTS = 10
MAX_NC_RESULTS = 10
RRF_K = int(os.getenv("RETRIEVAL_RRF_K", "60"))
VECTOR_CANDIDATE_LIMIT = int(os.getenv("VECTOR_CANDIDATE_LIMIT", "15"))
LEXICAL_CANDIDATE_LIMIT = int(os.getenv("LEXICAL_CANDIDATE_LIMIT", "15"))

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


def normalize_result_identity(item: Dict[str, Any]) -> str:
    doc = item.get("doc") or item.get("chunk_id") or ""
    normalized = pathlib.Path(str(doc).split(" ")[0]).stem.lower()
    return normalized


def merge_result_payload(existing: Dict[str, Any], incoming: Dict[str, Any], channel: str) -> Dict[str, Any]:
    merged = dict(existing)
    for key, value in incoming.items():
        if key not in merged or merged.get(key) in (None, "", []):
            merged[key] = value

    if channel == "vector" and "distance" in incoming:
        merged["vector_distance"] = incoming["distance"]
    if channel == "lexical" and "bm25_score" in incoming:
        merged["lexical_score"] = incoming["bm25_score"]

    if len(str(incoming.get("content", ""))) > len(str(merged.get("content", ""))):
        merged["content"] = incoming.get("content")

    return merged


def reciprocal_rank_fuse(
    *,
    vector_results: List[Dict[str, Any]],
    lexical_results: List[Dict[str, Any]],
    final_limit: int,
) -> List[Dict[str, Any]]:
    fused: Dict[str, Dict[str, Any]] = {}

    for channel_name, results in (
        ("vector", vector_results),
        ("lexical", lexical_results),
    ):
        for rank, item in enumerate(results, start=1):
            identity = normalize_result_identity(item)
            if not identity:
                continue

            if identity not in fused:
                fused[identity] = {
                    "item": dict(item),
                    "rrf_score": 0.0,
                    "best_rank": rank,
                    "channels": set(),
                }

            fused_entry = fused[identity]
            fused_entry["item"] = merge_result_payload(
                fused_entry["item"],
                item,
                channel_name,
            )
            fused_entry["rrf_score"] += 1.0 / (RRF_K + rank)
            fused_entry["best_rank"] = min(fused_entry["best_rank"], rank)
            fused_entry["channels"].add(channel_name)

    ranked = sorted(
        fused.values(),
        key=lambda entry: (
            -entry["rrf_score"],
            entry["best_rank"],
            str(entry["item"].get("doc", "")),
        ),
    )

    results: List[Dict[str, Any]] = []
    for output_rank, entry in enumerate(ranked[:final_limit], start=1):
        result = dict(entry["item"])
        result["retrieval_channels"] = sorted(entry["channels"])
        result["rrf_score"] = round(entry["rrf_score"], 8)
        result["retrieval_rank"] = output_rank
        results.append(result)
    return results


def reciprocal_rank_fuse_batches(
    *,
    ranked_batches: List[List[Dict[str, Any]]],
    channel: str,
    final_limit: int,
) -> List[Dict[str, Any]]:
    fused: Dict[str, Dict[str, Any]] = {}

    for batch_index, results in enumerate(ranked_batches, start=1):
        for rank, item in enumerate(results, start=1):
            identity = normalize_result_identity(item)
            if not identity:
                continue

            if identity not in fused:
                fused[identity] = {
                    "item": dict(item),
                    "rrf_score": 0.0,
                    "best_rank": rank,
                    "query_batches": set(),
                }

            fused_entry = fused[identity]
            fused_entry["item"] = merge_result_payload(
                fused_entry["item"],
                item,
                channel,
            )
            fused_entry["rrf_score"] += 1.0 / (RRF_K + rank)
            fused_entry["best_rank"] = min(fused_entry["best_rank"], rank)
            fused_entry["query_batches"].add(batch_index)

    ranked = sorted(
        fused.values(),
        key=lambda entry: (
            -entry["rrf_score"],
            entry["best_rank"],
            str(entry["item"].get("doc", "")),
        ),
    )

    results: List[Dict[str, Any]] = []
    for output_rank, entry in enumerate(ranked[:final_limit], start=1):
        result = dict(entry["item"])
        result[f"{channel}_rrf_score"] = round(entry["rrf_score"], 8)
        result[f"{channel}_variant_hits"] = len(entry["query_batches"])
        result[f"{channel}_rank"] = output_rank
        results.append(result)
    return results


def collect_query_variants(
    query: str,
    *,
    corpus: str,
    use_query_rewrite: bool,
) -> List[str]:
    normalized_query = str(query).strip()
    if not use_query_rewrite:
        return [normalized_query]

    rewrite = rewrite_retrieval_query(normalized_query, corpus=corpus)
    return list(rewrite.variants) or [normalized_query]


def search_documents_vector(
    query: str,
    n_results: int = VECTOR_CANDIDATE_LIMIT,
    result_limit: int = MAX_TECH_DOCS_RESULTS,
) -> List[Dict[str, Any]]:
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
                top_n=result_limit
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
            return top_results[:result_limit]

    except Exception as e:
        logger.error(f"Failed to query or rerank tech docs. Error: {e}", exc_info=True)
        return []


def search_non_conformities_vector(
    query: str,
    n_results: int = VECTOR_CANDIDATE_LIMIT,
    result_limit: int = MAX_NC_RESULTS,
) -> List[Dict[str, Any]]:
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
                top_n=result_limit
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
            return top_results[:result_limit]

    except Exception as e:
        logger.error(f"Failed to query or rerank non-conformities. Error: {e}", exc_info=True)
        return []


def search_documents(
    query: str,
    n_results: int = 15,
    *,
    use_query_rewrite: bool = True,
) -> List[Dict[str, Any]]:
    final_limit = min(max(n_results, 1), MAX_TECH_DOCS_RESULTS)
    candidate_limit = max(final_limit, VECTOR_CANDIDATE_LIMIT, LEXICAL_CANDIDATE_LIMIT)
    query_variants = collect_query_variants(
        query,
        corpus="tech_docs",
        use_query_rewrite=use_query_rewrite,
    )
    vector_results = reciprocal_rank_fuse_batches(
        ranked_batches=[
            search_documents_vector(
                variant,
                n_results=candidate_limit,
                result_limit=candidate_limit,
            )
            for variant in query_variants
        ],
        channel="vector",
        final_limit=candidate_limit,
    )
    lexical_results = reciprocal_rank_fuse_batches(
        ranked_batches=[
            search_documents_lexical(variant, n_results=candidate_limit)
            for variant in query_variants
        ],
        channel="lexical",
        final_limit=candidate_limit,
    )
    return reciprocal_rank_fuse(
        vector_results=vector_results,
        lexical_results=lexical_results,
        final_limit=final_limit,
    )


def search_non_conformities(
    query: str,
    n_results: int = 15,
    *,
    use_query_rewrite: bool = True,
) -> List[Dict[str, Any]]:
    final_limit = min(max(n_results, 1), MAX_NC_RESULTS)
    candidate_limit = max(final_limit, VECTOR_CANDIDATE_LIMIT, LEXICAL_CANDIDATE_LIMIT)
    query_variants = collect_query_variants(
        query,
        corpus="non_conformities",
        use_query_rewrite=use_query_rewrite,
    )
    vector_results = reciprocal_rank_fuse_batches(
        ranked_batches=[
            search_non_conformities_vector(
                variant,
                n_results=candidate_limit,
                result_limit=candidate_limit,
            )
            for variant in query_variants
        ],
        channel="vector",
        final_limit=candidate_limit,
    )
    lexical_results = reciprocal_rank_fuse_batches(
        ranked_batches=[
            search_non_conformities_lexical(variant, n_results=candidate_limit)
            for variant in query_variants
        ],
        channel="lexical",
        final_limit=candidate_limit,
    )
    return reciprocal_rank_fuse(
        vector_results=vector_results,
        lexical_results=lexical_results,
        final_limit=final_limit,
    )

def format_search_results(results: Any) -> Dict[str, Any]:
    """Formate les résultats de recherche pour le frontend pour contenir une clé 'sources'."""
    # Cette fonction reçoit maintenant une liste de dictionnaires déjà formatés
    return {"sources": results if isinstance(results, list) else []} 
