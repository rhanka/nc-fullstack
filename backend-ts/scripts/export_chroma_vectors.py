#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import struct
import sys
import tempfile
from dataclasses import dataclass
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[2]
API_ROOT = ROOT / "api"


@dataclass(frozen=True)
class CorpusConfig:
    key: str
    source_root: pathlib.Path
    collection_name: str
    output_root: pathlib.Path


CORPORA: dict[str, CorpusConfig] = {
    "tech_docs": CorpusConfig(
        key="tech_docs",
        source_root=API_ROOT / "data" / "a220-tech-docs" / "vectordb",
        collection_name="langchain",
        output_root=API_ROOT / "data" / "a220-tech-docs" / "vector-export",
    ),
    "non_conformities": CorpusConfig(
        key="non_conformities",
        source_root=API_ROOT / "data" / "a220-non-conformities" / "vectordb",
        collection_name="non_conformities",
        output_root=API_ROOT / "data" / "a220-non-conformities" / "vector-export",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export persisted Chroma embeddings to a TS-friendly neutral format.",
    )
    parser.add_argument(
        "corpus",
        choices=["tech_docs", "non_conformities", "all"],
        help="Corpus to export.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=512,
        help="Number of embeddings fetched from Chroma per batch.",
    )
    return parser.parse_args()


def require_chromadb():
    try:
        import chromadb  # type: ignore
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "chromadb is required for export. Install api requirements before running this script."
        ) from exc
    return chromadb


def ensure_clean_tmpdir(target_root: pathlib.Path) -> pathlib.Path:
    target_root.mkdir(parents=True, exist_ok=True)
    return pathlib.Path(
        tempfile.mkdtemp(prefix=f".tmp-{target_root.name}-", dir=target_root.parent)
    )


def build_item(
    embedding_id: str,
    metadata: dict[str, Any] | None,
    document: str | None,
) -> dict[str, Any]:
    item = dict(metadata or {})
    item.setdefault("doc", item.get("doc") or embedding_id)
    item.setdefault("chunk_id", item.get("chunk_id") or embedding_id)
    item["content"] = document or ""
    item["embedding_id"] = embedding_id
    return item


def export_corpus(config: CorpusConfig, batch_size: int) -> dict[str, Any]:
    chromadb = require_chromadb()

    if not config.source_root.is_dir():
        raise SystemExit(f"Missing Chroma source directory: {config.source_root}")

    client = chromadb.PersistentClient(path=str(config.source_root))
    collection = client.get_collection(name=config.collection_name)
    total_count = collection.count()
    if total_count <= 0:
        raise SystemExit(f"Collection {config.collection_name} is empty")

    tmp_root = ensure_clean_tmpdir(config.output_root)
    vectors_path = tmp_root / "vectors.f32"
    squared_norms_path = tmp_root / "squared_norms.f32"
    items_path = tmp_root / "items.jsonl"
    manifest_path = tmp_root / "manifest.json"

    dimensions: int | None = None
    exported_count = 0

    with (
        vectors_path.open("wb") as vectors_fp,
        squared_norms_path.open("wb") as squared_norms_fp,
        items_path.open("w", encoding="utf-8") as items_fp,
    ):
        offset = 0
        while True:
            payload = collection.get(
                include=["embeddings", "metadatas", "documents"],
                offset=offset,
                limit=batch_size,
            )
            ids = payload.get("ids")
            if ids is None:
                ids = []
            if not ids:
                break

            embeddings = payload.get("embeddings")
            if embeddings is None:
                embeddings = []
            metadatas = payload.get("metadatas")
            if metadatas is None:
                metadatas = []
            documents = payload.get("documents")
            if documents is None:
                documents = []

            for index, embedding_id in enumerate(ids):
                embedding = embeddings[index]
                metadata = metadatas[index] if index < len(metadatas) else None
                document = documents[index] if index < len(documents) else None

                if embedding is None or len(embedding) == 0:
                    raise SystemExit(f"Missing embedding payload for id={embedding_id}")

                if dimensions is None:
                    dimensions = len(embedding)
                elif len(embedding) != dimensions:
                    raise SystemExit(
                        f"Inconsistent dimensions in {config.key}: expected {dimensions}, got {len(embedding)}"
                    )

                squared_norm = 0.0
                for value in embedding:
                    float_value = float(value)
                    vectors_fp.write(struct.pack("<f", float_value))
                    squared_norm += float_value * float_value

                squared_norms_fp.write(struct.pack("<f", squared_norm))
                items_fp.write(
                    json.dumps(
                        build_item(str(embedding_id), metadata, document),
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                exported_count += 1

            offset += len(ids)

    if dimensions is None:
        raise SystemExit(f"Failed to infer embedding dimensions for {config.key}")

    manifest = {
        "version": "vector-export-v1",
        "corpus": config.key,
        "embeddingModel": "text-embedding-3-large",
        "metric": "l2",
        "dimensions": dimensions,
        "count": exported_count,
        "vectorsPath": vectors_path.name,
        "squaredNormsPath": squared_norms_path.name,
        "itemsPath": items_path.name,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if config.output_root.exists():
        shutil.rmtree(config.output_root)
    tmp_root.replace(config.output_root)

    return {
        "corpus": config.key,
        "collection": config.collection_name,
        "count": exported_count,
        "dimensions": dimensions,
        "output_root": str(config.output_root),
        "manifest": str(config.output_root / "manifest.json"),
    }


def main() -> int:
    args = parse_args()
    selected = (
        [CORPORA["tech_docs"], CORPORA["non_conformities"]]
        if args.corpus == "all"
        else [CORPORA[args.corpus]]
    )
    results = [export_corpus(config, args.batch_size) for config in selected]
    json.dump(results, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
