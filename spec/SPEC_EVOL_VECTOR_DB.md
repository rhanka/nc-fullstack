# SPEC_EVOL - Vector DB Migration

- Date: 2026-04-12
- Status: proposal
- Related specs:
  - `SPEC_EVOL_2026-04-10_ai-architecture-refresh.md`
  - `SPEC_INTENT_2026-04-10_ai-architecture-refresh.md`
- Last updated: 2026-04-12

## Objectif

Remplacer la dépendance runtime à Chroma par une trajectoire propre, native TypeScript, avec un moteur vectoriel compatible RAG hybride et exploitable dans le même container que l'API TS.

La cible ne doit pas:

- réintroduire un bridge Python runtime
- imposer un service externe supplémentaire si ce n'est pas nécessaire
- dégrader la pertinence retrieval sur les cas NC déjà benchés
- exploser le nombre de dépendances ou la complexité ops

## Contraintes du projet

- backend cible: TypeScript dans `backend-ts`
- mode d'exécution préféré: même process / même container que l'API
- hybrid retrieval requis:
  - vectoriel
  - lexical / BM25
  - fusion de rangs
- stockage local acceptable au runtime
- migration incrémentale exigée
- maintien d'une voie de rollback simple pendant la transition

## Etat actuel observé

### Chroma actuel

- Le dataset vectoriel historique est stocké dans `api/data/*/vectordb/`.
- Le runtime Python historique lit Chroma local persistant via `chromadb.PersistentClient`.
- Les métadonnées utiles sont partiellement visibles dans `chroma.sqlite3`.
- Le vrai store vectoriel repose aussi sur des segments binaires HNSW et sur des métadonnées picklées.

Conséquence:

- Node/TS ne peut pas relire proprement ce format de manière native sans soit:
  - reverse-engineering d'un format interne Chroma
  - dépendance ANN dédiée supplémentaire
  - ou ré-export vers un format neutre

### Etat TS déjà en place

- Le runtime `/ai` par défaut est maintenant TS natif.
- Le retrieval TS sait déjà fonctionner via:
  - export neutre `vector-export-v1`
  - vector search exact L2 sur `Float32Array`
  - lexical SQLite FTS5
  - query rewrite
  - RRF
- Cette voie retire Python du runtime, mais elle reste une étape transitoire:
  - plus lourde en RAM / CPU
  - pas idéale comme cible long terme

## Recherche externe vérifiée

Recherche vérifiée le 12 avril 2026 sur documentation officielle.

### LanceDB OSS

Constats:

- LanceDB OSS est présenté comme une base embarquée qui tourne in-process, "like SQLite".
- Le SDK TypeScript officiel est `@lancedb/lancedb`.
- Le SDK TS supporte une connexion sur chemin local.
- LanceDB supporte:
  - vector search
  - full-text search BM25
  - hybrid search
  - reranking, avec `RRF` par défaut dans le guide hybrid search

Sources:

- Quickstart: https://docs.lancedb.com/quickstart
- FAQ OSS: https://docs.lancedb.com/faq/faq-oss
- API TS: https://lancedb.github.io/lancedb/js/
- connect local path: https://lancedb.github.io/lancedb/js/functions/connect/
- full-text search: https://docs.lancedb.com/search/full-text-search
- hybrid search: https://docs.lancedb.com/search/hybrid-search

### Qdrant

Constats:

- Qdrant a un client JS/TS officiel.
- Qdrant supporte les requêtes hybrides et la fusion `RRF`.
- Mais le mode de déploiement naturel reste un service séparé.

Sources:

- interfaces / clients: https://qdrant.tech/documentation/interfaces/
- hybrid queries: https://qdrant.tech/documentation/search/hybrid-queries/

### libSQL / Turso

Constats:

- libSQL expose un SDK TS propre.
- libSQL supporte le vector search.
- C'est un candidat propre si on veut rester proche de SQLite.
- En revanche, l'hybride applicatif reste davantage à posséder côté repo.

Sources:

- TS SDK: https://docs.turso.tech/sdk/ts/reference
- AI and embeddings: https://docs.turso.tech/features/ai-and-embeddings

### SQLite vec1

Constats:

- `vec1` est prometteur côté SQLite natif.
- Mais la doc officielle indique encore des limites de maturité, dont un niveau de test insuffisant.

Sources:

- overview: https://sqlite.org/vec1
- intro: https://sqlite.org/vec1/doc/trunk/doc/vec1intro.md

## Décision proposée

### Cible retenue

Choix proposé: **LanceDB OSS**.

Raisons:

1. compatible avec la contrainte "même container"
2. SDK TypeScript officiel
3. support natif du triplet utile au projet:
   - vector
   - BM25 / FTS
   - hybrid search
4. permet de sortir de Chroma sans réintroduire un service séparé
5. réduit la quantité de plomberie retrieval possédée par le repo par rapport à la voie `vector-export exact + SQLite FTS`

### Non-cibles

- **Chroma runtime**:
  - rejeté pour le backend TS natif
  - format persistant non proprement exploitable depuis Node
- **Qdrant**:
  - bon moteur, mais service séparé non désiré à ce stade
- **libSQL comme cible principale**:
  - trop proche d'une possession maison de l'hybride
- **vec1**:
  - trop immature pour devenir la cible principale maintenant

## Architecture cible

### Exécution

- `backend-ts` reste le seul service applicatif
- LanceDB OSS tourne in-process dans le même container
- stockage local par corpus dans:
  - `api/data/a220-tech-docs/lancedb/`
  - `api/data/a220-non-conformities/lancedb/`

### Schéma cible

Colonnes minimales par table:

- `doc`
- `chunk_id`
- `content`
- `vector`
- `source_kind`
- `ata_code` si disponible
- `metadata_json` si nécessaire pendant la transition

### Recherche cible

Pour chaque corpus:

1. vector query
2. BM25 / FTS query
3. hybrid search LanceDB
4. rerank par défaut:
   - d'abord avec les primitives LanceDB
   - puis conservation possible d'une logique applicative de post-filtrage métier si nécessaire

### Query rewrite et mémoire

- restent pilotés par l'application TS
- ne sont pas délégués à LanceDB
- LanceDB remplace le stockage / moteur retrieval, pas l'orchestration métier NC

## Stratégie de migration

### Phase A - Découplage déjà engagé

Objectif:

- supprimer Chroma du runtime TS avant de changer de moteur cible

Moyen:

- export neutre `vector-export-v1`
- runtime TS exact L2

Statut:

- déjà engagé et utile comme filet de sécurité

### Phase B - Introduction LanceDB derrière une abstraction

Objectif:

- brancher un backend retrieval `lancedb`
- conserver temporairement `export_exact` comme fallback

Principe:

- variable d'environnement de sélection du moteur, par exemple:
  - `NC_RETRIEVAL_ENGINE=export_exact`
  - `NC_RETRIEVAL_ENGINE=lancedb`

### Phase C - Ingestion LanceDB

Objectif:

- générer les tables LanceDB à partir des corpus existants

Source de vérité transitoire:

- à court terme:
  - `vector-export-v1`
  - `ocr/`, `md/`, `json/`
- à moyen terme:
  - pipeline d'ingestion LanceDB dédié, sans dépendre de Chroma

### Phase D - Cutover par benchmark

Objectif:

- faire passer le runtime par défaut sur LanceDB uniquement si:
  - parité fonctionnelle acceptable
  - pertinence stable ou meilleure
  - packaging Docker simplifié

### Phase E - Nettoyage

- supprimer `vector-export exact` si LanceDB tient la charge
- retirer les chemins Chroma restants du runtime TS
- garder un éventuel script d'import offline depuis l'historique seulement si utile

## Risques

### Dépendance native Node

Le SDK TS LanceDB est une librairie native via `napi-rs`.

Conséquences:

- vérifier le support exact sur l'image Linux cible
- valider le build Docker final
- surveiller la taille d'image et le temps d'install

### Ingestion initiale

Le passage vers LanceDB nécessite une source d'embeddings fiable.

Options:

- importer depuis l'export neutre déjà produit
- ou ré-ingérer depuis les données source avec embeddings régénérés

Préférence:

- importer d'abord depuis l'export neutre pour limiter le risque

### Qualité retrieval

Même si LanceDB supporte l'hybride nativement, la pertinence métier dépendra encore:

- du query rewrite
- du choix de colonnes FTS
- du shaping des chunks
- du post-tri métier

Il faut donc benchmarker, pas supposer.

## Critères de recette

- le moteur `lancedb` tourne dans le même container que l'API TS
- le backend TS ne dépend plus de Chroma au runtime
- le packaging Docker n'a plus besoin de `vectordb/` Chroma pour servir `/ai`
- le benchmark retrieval sur le mini-corpus repo n'est pas inférieur au mode `export_exact`
- la sélection du moteur retrieval est explicite, observable, et réversible

## Décision exécutable

Décision proposée pour exécution:

- **adopter LanceDB OSS comme cible vector DB native TS**
- **garder `vector-export-v1` uniquement comme étape transitoire et fallback**
- **ne pas réintroduire de service externe type Qdrant à ce stade**
