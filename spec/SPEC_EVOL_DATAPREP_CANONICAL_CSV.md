# SPEC_EVOL - Canonical Tech Docs CSV

- Date: 2026-04-16
- Status: accepted
- Related specs:
  - `SPEC_EVOL_DATAPREP_TS.md`
  - `SPEC_EVOL_LLM_WIKI.md`

## Objectif

Ajouter une étape de préparation canonique du CSV technique avant la construction RAG.

Le CSV amont reste:

- `api/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_prepared.csv.gz`

La sortie canonique devient:

- `api/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_canonical.csv.gz`
- `api/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_canonical.audit.json`

## Problème

Le CSV amont peut contenir des lignes dont `doc` référence une page PDF absente de:

- `api/data/a220-tech-docs/pages/`

Le legacy Python ne les indexait pas dans Chroma.

Le portage TS a consommé le CSV amont sans refaire cette sélection de corpus, ce qui permet au RAG de retourner des sources que `/doc` ne peut pas ouvrir.

## Décision

La correction se fait dans la préparation de corpus, pas dans le runtime chat.

Règles:

- ne pas filtrer les sources après retrieval
- ne pas masquer le top-k côté UI
- ne pas modifier le CSV amont
- produire un CSV canonique servant de source au dataprep RAG
- préserver les lignes conservées caractère par caractère

## Algorithme V1

Entrées:

- CSV amont gzippé
- dossier `pages/`

Etapes:

1. Lire le CSV amont avec le dialecte existant: TSV, quote `"`, escape `\`.
2. Conserver la ligne header telle quelle.
3. Pour chaque ligne de donnée:
   - rejeter les lignes malformées
   - rejeter les lignes sans `doc` ou sans `chunk_id`
   - rejeter les lignes dont `pages/<doc>` n'existe pas
   - rejeter les doublons de `chunk_id`
   - conserver toutes les autres lignes
4. Ecrire le CSV canonique gzippé.
5. Ecrire un audit JSON.

## Garantie de diff

La préparation ne re-sérialise pas les lignes conservées.

Pour les documents communs entre le CSV amont et le CSV canonique:

- le texte brut de chaque ligne conservée est recopié depuis la source
- aucun champ n'est reformaté
- aucun quoting n'est recalculé
- les champs multi-lignes restent inchangés

Le test de recette doit comparer au caractère près:

- les lignes conservées extraites du CSV amont
- les lignes produites dans le CSV canonique

## Audit attendu

Le fichier audit contient au minimum:

- `sourceRows`
- `keptRows`
- `droppedRows`
- `droppedMalformedRows`
- `droppedMissingPageRows`
- `droppedDuplicateChunkRows`
- `missingPageRoots`
- `duplicateChunkIds`
- `keptRowsCharExact`
- `sourceKeptRowsSha256`
- `canonicalRowsSha256`

## Commandes

Commande dédiée:

- `make dataprep-prepare-tech-docs`

Commandes qui doivent déclencher cette préparation:

- `make dataprep`
- `make dataprep-tech-docs`
- `make dataprep-knowledge`
- `make dataprep-knowledge-tech-docs`
- `make api-prepare-data-ci`

## Critères de recette

1. Le CSV canonique est produit sans modifier le CSV amont.
2. Les lignes conservées sont identiques au caractère près à la source.
3. Les lignes dont `doc` n'existe pas dans `pages/` ne sont plus indexées.
4. `vector-export`, `lexical`, `ontology` et `wiki` consomment le CSV canonique.
5. L'UAT `sources RAG -> /doc` ne montre plus de 404 pour les sources techniques affichées.
