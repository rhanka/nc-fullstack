# SPEC_EVOL - LLM Wiki and Ontology

- Date: 2026-04-14
- Status: proposal
- Related specs:
  - `SPEC_EVOL_2026-04-10_ai-architecture-refresh.md`
  - `SPEC_EVOL_VECTOR_DB.md`
  - `SPEC_INTENT_2026-04-10_ai-architecture-refresh.md`

## Objectif

Définir la forme minimale utile de la couche connaissance au-dessus du RAG actuel.

Cette couche ne doit pas:

- remplacer les documents source
- introduire un graphe complexe sans preuve d'utilité
- dépendre de `graphify` par défaut
- redonner un rôle central aux NC historiques fictives

Cette couche doit:

- rester sur le même dataset que le RAG
- être navigable par un humain
- améliorer l'analyse et la résolution de problème
- introduire une structure métier exploitable par:
  - le query rewrite
  - le retrieval
  - la synthèse finale

## Décision de périmètre

### Ce qui est inclus dans la V0

- une ontologie minimale A220
- un `LLM Wiki` compilé à partir du même corpus que le RAG
- une vue retrieval `entities/wiki` au même niveau que:
  - `tech docs`
  - `similar NC`
- la gestion explicite des alias et variantes métier

### Ce qui n'est pas inclus dans la V0

- graphe de connaissances généraliste
- clustering automatique ou communautés comme livrable principal
- `graphify` en dépendance obligatoire
- pages canoniques pilotées par les NC historiques
- taxonomie complète des symptômes, défauts et actions correctives

## Corpus source

Le wiki et l'ontologie sont construits à partir du même corpus canonique que le RAG:

- documents techniques A220
- chunks et métadonnées déjà produits pour `vector-export`
- index lexical `SQLite FTS5`
- NC historiques comme occurrences secondaires uniquement

Conséquence:

- il n'existe pas de "dataset wiki" séparé
- le wiki est une projection structurée du corpus source
- la vérité de référence reste dans les documents techniques

## Ontologie minimale V0

### Types d'entités

#### `ata`

Concept canonique représentant un système ATA ou sous-système de premier niveau utile au projet.

Champs minimaux:

- `id`
- `code`
- `title`
- `aliases[]`

Exemples:

- `ATA-52`
- `ATA-27`

#### `part`

Concept canonique principal de la V0.

La page wiki canonique est portée par cette entité.

Champs minimaux:

- `id`
- `canonical_name`
- `aliases[]`
- `part_numbers[]`
- `short_description`

Exemples:

- `RH passenger door`
- `door frame 20/21`
- `cargo door seal`

#### `zone`

Concept canonique représentant une zone avion exploitable pour la recherche et la synthèse.

Champs minimaux:

- `id`
- `canonical_name`
- `aliases[]`
- `zone_codes[]`

Exemples:

- `RH forward fuselage`
- `door surround`
- `frame 20/21 area`

#### `document_source`

Document technique source de référence.

Champs minimaux:

- `id`
- `doc_name`
- `doc_type`
- `uri`

#### `nc_occurrence`

Occurrence secondaire de non-conformité.

Cette entité n'est pas canonique; elle sert comme preuve ou cas observé.

Champs minimaux:

- `id`
- `source_ref`
- `summary`
- `confidence`

### Relations minimales

- `part -> ata`
- `part -> zone`
- `document_source -> supports -> ata`
- `document_source -> supports -> part`
- `document_source -> supports -> zone`
- `nc_occurrence -> evidences -> part`
- `nc_occurrence -> evidences -> zone`
- `nc_occurrence -> evidences -> ata`

### Gestion des alias

La couche connaissance doit capter explicitement:

- variantes de désignation
- abréviations et raccourcis métier
- références pièce
- variantes de zones

Format minimal par entité:

- `canonical_name`
- `aliases[]`
- `normalized_terms[]`

Règle:

- les alias servent autant au rewrite qu'à la navigation humaine
- ils ne doivent pas être déduits uniquement "à la volée" par le LLM

## Forme du wiki V0

### Unité canonique

La page canonique du wiki est la page par `part / sous-ensemble`.

Raison:

- c'est le niveau le plus utile pour l'analyse et la résolution de problème
- il relie naturellement:
  - un système ATA
  - une zone
  - des docs techniques
  - des occurrences NC secondaires

### Structure minimale d'une page wiki

Chaque page wiki doit contenir au minimum:

1. identité canonique
   - nom canonique
   - alias
   - références pièce si disponibles

2. rattachement métier
   - ATA principal
   - zones usuelles liées

3. résumé utile
   - ce que représente la pièce / le sous-ensemble
   - à quoi elle sert dans l'avion

4. sources techniques
   - documents techniques liés
   - ancres ou références exploitables

5. occurrences secondaires
   - NC liées, si elles apportent un signal utile

6. backlinks
   - autres pages wiki liées

### Exemple de slug cible

- `wiki/parts/rh-passenger-door.md`
- `wiki/parts/door-frame-20-21.md`

## Intégration au retrieval

### Trois canaux visibles pendant `000` puis `001`

La recherche doit pouvoir exposer trois groupes au même niveau:

1. `tech docs`
2. `similar NC`
3. `entities/wiki`

### Rôle de `entities/wiki`

Ce canal expose:

- entités canoniques détectées
- pages wiki pertinentes
- liens vers les documents de support

Ce canal ne remplace pas `tech docs`.
Il sert à expliquer et structurer ce que le moteur trouve.

### Rôle dans le rewrite

Le rewrite peut s'appuyer sur:

- alias de pièces
- variantes de zones
- rattachement ATA connu

Exemple:

- requête utilisateur: `delamination frame 20 21 RH door`
- enrichissement possible:
  - `frame 20/21`
  - `ATA-52`
  - `RH passenger door`

## Rôle des NC historiques

Les NC historiques ne doivent pas structurer le wiki.

Règle V0:

- une NC historique est une occurrence secondaire
- elle peut enrichir une page wiki comme exemple ou preuve
- elle ne définit pas le concept canonique

Conséquence:

- si la qualité des NC historiques est faible ou fictive, le wiki reste utile
- la valeur principale vient des docs techniques et de l'ontologie

## Dataprep cible

La chaîne de préparation cible doit produire à partir d'un corpus manifest canonique:

- `vector-export`
- `lexical/fts.sqlite3`
- `wiki/`
- tables ou manifestes d'ontologie

La cible est TypeScript.

Le backend ne doit plus dépendre de Python pour:

- préparer le corpus
- produire les artefacts retrieval
- compiler le wiki

## Critères de succès

La V0 est considérée utile si elle améliore au moins un des points suivants:

- meilleure contribution à l'analyse
- meilleure contribution à la résolution de problème
- meilleur rewrite des requêtes pièce / zone / ATA
- meilleure lisibilité des résultats retrieval

Le critère principal retenu est:

- **meilleure contribution à l'analyse et à la résolution de problème**

## Décision sur `graphify`

Position actuelle:

- `graphify` n'est pas requis pour la V0
- il reste une option à évaluer après:
  - ontologie minimale
  - wiki compilé
  - vue `entities/wiki`

Seuil de réouverture:

- si le simple modèle `ontology + wiki + backlinks + liens docs` ne suffit pas à relier proprement les concepts
- ou si un besoin d'exploration / audit des trous de couverture apparaît clairement

## Sorties attendues pour le lot 6

### `L6.2`

- taxonomie versionnée
- alias versionnés
- relations minimales versionnées

### `L6.3`

- dataprep TS alimentant les artefacts canoniques

### `L6.4`

- wiki compilé
- vue `entities/wiki`
- liens vers docs techniques

### `L6.5`

- décision explicite `graphify: oui/non plus tard`

### `L6.6`

- suppression de l'intégration `lancedb` si toujours inutile
