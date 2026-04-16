# SPEC_EVOL - TypeScript Dataprep

- Date: 2026-04-14
- Status: proposal
- Related specs:
  - `SPEC_EVOL_2026-04-10_ai-architecture-refresh.md`
  - `SPEC_EVOL_LLM_WIKI.md`
  - `SPEC_EVOL_VECTOR_DB.md`
  - `SPEC_INTENT_2026-04-10_ai-architecture-refresh.md`

## Objectif

Remplacer la chaîne de dataprep Python par une chaîne TypeScript unique, reproductible et offline, sans changer le périmètre du pipeline actuel.

Cette phase doit:

- conserver les mêmes corpus d'entrée que le pipeline actuel
- produire les artefacts attendus par le backend TS
- préparer les artefacts supplémentaires requis par l'ontologie et le wiki
- retirer Python de la chaîne backend

Cette phase ne doit pas:

- élargir le corpus au-delà du pipeline actuel
- introduire un mode incrémental dans la V1
- déplacer de la logique dataprep sur le chemin runtime `/ai`

## Décisions utilisateur actées

### 1. Corpus source canonique

La source de vérité amont de V1 reste les datasets déjà "prepared" du pipeline actuel.

Pour les documents techniques, cette source amont est d'abord projetée en CSV canonique local afin de restaurer la parité legacy: seuls les chunks dont la page PDF est servie dans `pages/` sont indexables.

Concrètement:

- tech docs:
  - source amont: `api/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_prepared.csv.gz`
  - source canonique RAG: `api/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_canonical.csv.gz`
- non-conformities:
  - le même périmètre que le pipeline actuel, ni plus ni moins
  - en pratique aujourd'hui:
    - `api/data/a220-non-conformities/managed_dataset/NC_types_random_500_pre_embed.csv.gz`

Règle:

- la migration TS ne ré-ouvre pas le périmètre de corpus
- elle remplace la chaîne de production, pas la sélection métier des données

### 2. Mode de reconstruction

La V1 est un **rebuild complet offline**.

Pas d'incrémental en V1.

Conséquences:

- pipeline plus simple
- reproductibilité plus forte
- surface de debug plus faible

### 3. Embeddings

Les embeddings restent générés **offline via OpenAI**.

Conséquence:

- le dataprep TS garde un appel offline aux embeddings
- le runtime `/ai` ne doit pas dépendre de cette étape

### 4. Extraction ontologie / alias

La V1 retient une **extraction assistée LLM**, mais toujours **offline**.

Pourquoi offline:

- parce que cette extraction fait partie du dataprep, pas du runtime
- parce qu'on veut un résultat versionnable et reproductible
- parce qu'on ne veut pas payer cette logique sur chaque requête utilisateur

Position sur `graphify`:

- `graphify` peut éventuellement aider plus tard à explorer, relier ou auditer les entités
- `graphify` n'est pas la base de la V1 d'extraction
- la V1 doit pouvoir produire l'ontologie et le wiki sans dépendre de `graphify`

### 5. Artefacts de sortie V1

La chaîne TS doit produire:

- `vector-export/`
- `lexical/fts.sqlite3`
- `ontology/*.json`
- `wiki/*.md`
- `wiki/index.json`
- un `manifest.json` global de corpus / build

### 6. Compatibilité d'identifiants

La V1 doit préserver autant que possible les identifiants actuels:

- `doc`
- `chunk_id`

Pourquoi:

- éviter de casser les citations
- éviter de casser l'UI
- conserver la comparabilité des benchmarks retrieval

### 7. Format de sortie du wiki

La V1 produit:

- des pages Markdown
- un index JSON

Pas de sortie HTML dédiée en V1.

## Entrées exactes V1

### Tech docs

Entrée amont:

- `managed_dataset/a220_tech_docs_content_prepared.csv.gz`

Entrée canonique consommée par le RAG TS:

- `managed_dataset/a220_tech_docs_content_canonical.csv.gz`
- produite par `make dataprep-prepare-tech-docs`
- les lignes conservées doivent rester identiques au caractère près à l'entrée amont

Colonnes attendues d'après le pipeline actuel:

- `doc`
- `doc_root`
- `json_data`
- `chunk`
- `length`
- `chunk_id`
- `ata`
- `parts`
- `doc_type`

Dépendances de support encore utiles:

- `api/data/a220-tech-docs/pages/`

### Non-conformities

Entrée canonique:

- `managed_dataset/NC_types_random_500_pre_embed.csv.gz`

Colonnes attendues d'après le pipeline actuel:

- `doc`
- `chunk_id`
- `chunk`

## Sorties exactes V1

### Retrieval

- `api/data/*/vector-export/`
- `api/data/*/lexical/fts.sqlite3`

### Knowledge layer

- `api/data/*/ontology/`
- `api/data/*/wiki/`
- `api/data/*/knowledge-manifest.json`

## Pipeline cible

### Etape 1 - Read manifest

Lire un corpus manifest TS décrivant:

- corpus
- source file
- colonnes attendues
- répertoire de sortie

### Etape 2 - Normalize rows

Transformer chaque ligne source en enregistrement canonique:

- `doc`
- `chunk_id`
- `content`
- `source_kind`
- `metadata`

### Etape 3 - Embeddings offline

Produire ou rafraîchir les embeddings nécessaires au `vector-export`.

Contraintes:

- batch offline
- reproductible
- journalisation claire des erreurs

### Etape 4 - Lexical index

Construire `SQLite FTS5` à partir du même contenu canonique.

### Etape 5 - Ontology extraction

Construire:

- `ata`
- `part`
- `zone`
- alias / variantes

Approche V1:

- extraction assistée LLM offline
- consolidation déterministe minimale des doublons / alias

### Etape 6 - Wiki compilation

Compiler des pages wiki par `part / sous-ensemble` avec:

- identité canonique
- alias
- rattachement ATA
- zones liées
- sources techniques
- occurrences NC secondaires éventuelles

### Etape 7 - Global manifest

Produire un manifest de build décrivant:

- version de pipeline
- entrées utilisées
- sorties produites
- date de build

## Commandes repo cibles

La V1 doit exposer des commandes repo-locales explicites, par exemple:

- `make dataprep`
- `make dataprep-tech-docs`
- `make dataprep-nc`
- `make dataprep-knowledge`
- `make api-prepare-data-ci`

## Intégration CI/CD

La préparation `ontology/wiki` doit être exécutée dans le chemin CI/CD de l'image API, pas manuellement avant déploiement.

Règles:

- `api/data/` reste hors Git
- les sources et artefacts lourds sont récupérés depuis Scaleway Object Storage
- `make api-prepare-data-ci` télécharge le dataset minimal et relance le dataprep knowledge-only
- `make api-image-check` prépare les artefacts avant de calculer le tag d'image
- `make api-build` prépare les artefacts avant de construire l'image
- le `Dockerfile` embarque `ontology/`, `wiki/` et `knowledge-manifest.json`
- les fichiers horodatés ne doivent pas rendre le hash d'image instable

Le nom exact pourra évoluer, mais la règle est:

- pas de script TS orphelin sans cible repo

## Critères de recette L6.3

La phase est fermable seulement si:

1. la chaîne TS produit `vector-export` et `lexical/fts.sqlite3`
2. la chaîne TS produit aussi `ontology/*.json`, `wiki/*.md` et `wiki/index.json`
3. les identifiants `doc/chunk_id` restent compatibles au maximum
4. aucun appel Python n'est requis dans la chaîne backend pour produire ces artefacts
5. le rebuild complet offline est exécutable via commandes repo-locales
6. la spec `LLM Wiki` reste satisfaite sans dépendre de `graphify`

## Risques connus

### Qualité de l'extraction LLM offline

Risque:

- alias trop agressifs
- entités dupliquées
- rattachements ATA imprécis

Réponse V1:

- garder la sortie structurée et auditable
- introduire des règles simples de consolidation
- ne pas masquer les ambiguïtés

### Divergence avec le pipeline Python

Risque:

- la migration TS change subtilement les sorties

Réponse V1:

- préserver `doc/chunk_id`
- comparer les artefacts et benchmarks
- traiter la TS migration comme remplacement technique, pas comme refonte de corpus

## Hors scope V1

- incrémental
- HTML wiki
- `graphify` requis
- enrichissement exhaustif symptômes / défauts / actions
- extension du corpus au-delà du périmètre actuel
