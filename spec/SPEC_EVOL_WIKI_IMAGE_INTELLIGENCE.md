# SPEC EVOL - Wiki Image Intelligence

## Statut

Spec dediee rattachee a:

- `SPEC_EVOL_WIKI_UI.md`
- `SPEC_EVOL_DATAPREP_TS.md`
- `PLAN.md` lot 6

Cette evolution prolonge l'onglet applicatif `Entities` existant. Elle ne remplace pas l'UI actuelle et ne cree pas de navigation image separee.

## Intention produit

Les descriptions d'images OCR sont deja integrees au corpus RAG et au wiki comme texte. La prochaine valeur produit est de rendre les images elles-memes visibles comme preuves rattachees aux entites.

Objectif V1:

- afficher les images pertinentes dans la fiche `Entities`
- placer la section `Linked images` juste avant `Supporting documents`
- permettre d'ouvrir le document source depuis une image
- eviter une navigation globale par image
- garder le drawer `Entities` et la fiche entite actuels

## Hors perimetre V1

- Pas de nouveau drawer `Images`.
- Pas de refonte du chat.
- Pas de graphe canvas/SVG complet.
- Pas d'exposition runtime des fichiers batch OpenAI ni des audits bruts.
- Pas de relance obligatoire des batches image caption si les captions existent deja.

## Contrat data public

Les artefacts publics sont derives et nettoyes. Ils ne sont pas les sidecars bruts OpenAI.

### `ontology/images.json`

Liste les images OCR pertinentes extraites depuis les pages techniques.

Champs attendus:

- `id`: identifiant stable, par exemple `image:<doc-base>:<index>`
- `doc`: page PDF source ouvrable par `/doc`
- `doc_root`: document racine si disponible
- `image_index`: index de l'image dans la page OCR
- `asset_path`: chemin public de l'image exportee, par exemple `wiki/images/<id>.png`
- `caption`: description courte exploitable par l'UI
- `technical_description`: description technique longue
- `page_category`: categorie issue de la caption
- `figure_or_table_refs`: references de figure/table
- `visible_identifiers`: identifiants visibles
- `part_or_zone_candidates`: candidats entite/zone issus de la caption
- `relationships_or_flows`: relations ou flux decrits
- `retrieval_action`: `index`, `downweight` ou `exclude`

### `ontology/image_relations.json`

Relie les images aux entites.

Champs attendus:

- `from`: `part:<entity-slug>`
- `relation`: `illustrated_by`
- `to`: `image:<image-id>`
- `doc`: page PDF source
- `score`: score deterministe de pertinence
- `reasons`: raisons lisibles, par exemple `alias_match`, `caption_candidate`, `visible_identifier`, `supporting_doc`

### `wiki/index.json`

Chaque entree entite peut porter:

- `linked_images`: top images pertinentes pour cette entite

Ces images sont limitees pour ne pas faire grossir les sources chat:

- maximum 6 images par entite dans l'index
- tri par score desc puis par document stable
- aucune image avec `retrieval_action = exclude`

### `wiki/parts/<slug>.md`

Chaque article wiki peut inclure une section Markdown:

```md
## Linked images

- ![Figure 02-02-4 - Engine bleed air schematic](../images/<image-id>.png)
  - Source: [611795...page_0180.pdf](../../pages/611795...page_0180.pdf)
  - Summary: Starter Air Valve, ATS, IPCV/PRSOV, HPV, precooler, BTS.
```

## Regles de selection des images

Une image est eligible si:

- elle provient d'une page servable par `/doc`
- elle possede une caption non vide ou des identifiants visibles
- sa politique retrieval n'est pas `exclude`

Une image est reliee a une entite si au moins un signal existe:

- alias de l'entite present dans `part_or_zone_candidates`
- alias de l'entite present dans `visible_identifiers`
- alias de l'entite present dans `technical_description`
- document source dans `supporting_docs` de l'entite, avec signal image non vide

Le score est deterministe:

- `caption_candidate`: +5
- `visible_identifier`: +4
- `description_alias`: +3
- `supporting_doc`: +1
- `figure_or_table_refs` non vide: +1
- `relationships_or_flows` non vide: +1

Une relation est conservee si `score >= 3`. Le signal `supporting_doc` seul ne suffit pas.

## UI cible

### Drawer `Entities`

Inchange.

Ajout possible dans les cartes:

- compteur discret `n images` si `linked_images` existe

### Fiche `EntityDetail`

La structure devient:

1. Header entite
2. `Entity notes`
3. `Linked images (n)`
4. `Supporting documents (n)`
5. `Related entities found in this answer`

La section `Linked images` est un `details` ouvert par defaut si `n <= 3`, replie au-dela.

Carte image:

- miniature si `asset_path` est disponible
- titre `figure_or_table_refs[0]` ou nom du document
- caption courte
- badges discrets pour `diagram`, `photo`, `table` si disponibles
- bouton `Open document`
- bouton optionnel `Open image context` si l'article wiki contient l'ancre/contexte

## Related entities: clique + classes

La zone actuelle `Related entities found in this answer` reste dans la fiche.

V1 ne fait pas un graphe visuel. Elle ajoute une lecture par classes de voisinage, proche de l'intention graphify mais compatible avec l'UI actuelle:

- `Same answer`: entites retrouvees dans la meme reponse
- `Image-linked`: entites partageant au moins une image liee
- `Same document`: entites partageant un document support
- `Same ATA`: entites partageant un ATA
- `Same zone`: entites partageant une zone

Affichage:

- groupes de chips cliquables
- pas de canvas
- pas de layout force-directed
- chaque chip garde l'action actuelle: selectionner l'entite dans le panneau `Entities`

Cette V1 sert a valider les classes utiles avant une eventuelle PR graphe visuel.

## CI/CD

Le CI/CD doit distinguer:

- generation/rebuild des artefacts publics `images / image_relations / wiki`
- execution couteuse des batches caption OpenAI

Regles:

- `dataprep-knowledge*` peut regenerer `images.json`, `image_relations.json` et `wiki` si les captions/enriched OCR sont deja presentes
- les targets batch `create/status/import` restent explicites et `workflow_dispatch`
- aucun deploy API ne doit relancer un batch caption automatiquement
- l'upload S3 publie les artefacts publics requis par le runtime: `ontology/images.json`, `ontology/image_relations.json`, `wiki/images/*`, `wiki/index.json`, `wiki/parts/*`
- les sidecars `*.image-caption.json`, audits et manifests batch restent hors runtime public sauf decision separee

## UAT

Cas minimal:

1. Ouvrir une analyse qui remonte une entite issue d'un schema technique.
2. Cliquer `Sources > Entities > Open entity`.
3. Verifier que la fiche affiche `Linked images` avant `Supporting documents`.
4. Verifier qu'au moins une image a une caption utile et un document source ouvrable.
5. Cliquer `Open document`; le viewer `/doc` ouvre la page source sans 404.
6. Verifier que `Related entities found in this answer` reste lisible et que les groupes par classes n'ajoutent pas de bruit.

## Criteres d'acceptation

- les images liees sont visibles dans la fiche entite existante
- les images ne creent pas de nouveau niveau de navigation
- les liens documents des images ouvrent `/doc`
- les artefacts publics sont regenerables sans relancer les batches caption
- les sidecars/audits OpenAI ne sont pas requis au runtime
- les related entities sont groupees par classes simples sans graphe visuel complet
