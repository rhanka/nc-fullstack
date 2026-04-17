# SPEC EVOL - UI Entities pour la couche connaissance

## Statut

Spec dediee rattachee a:

- `SPEC_EVOL_2026-04-10_ai-architecture-refresh.md`
- `SPEC_EVOL_LLM_WIKI.md`
- `PLAN.md` lot 6

Cette spec corrige le cadrage UI du lot connaissance: le backend produit un canal interne `entities_wiki`, mais l'interface utilisateur doit parler d'`Entities` au premier niveau.

## Decision UX

Le chat ne doit pas contenir un drawer de navigation connaissance.

La navigation cible est applicative:

- dans le chat, le bloc `Sources` affiche un groupe `Entities`
- cliquer une entite dans `Sources > Entities` selectionne cette entite
- le clic bascule sur l'onglet applicatif `Entities` dans la barre de gauche
- le drawer gauche liste les entites retrouvees pour la reponse courante
- le paneau principal affiche la fiche de l'entite selectionnee
- les liens vers documents techniques ouvrent le viewer `/doc` existant
- la navigation libre de noeud en noeud hors contexte retrouve reste hors perimetre V0

## Intention utilisateur consolidee

La couche connaissance doit aider les etapes `000` puis `100` en rendant visibles les objets metier utiles:

- ATA
- piece
- sous-ensemble
- zone
- alias et variantes metier
- documents techniques qui supportent l'entite

Les NC historiques sont fictives a ce stade; la valeur produit attendue porte d'abord sur les documents techniques et les entites aeronautiques.

## Surface UI cible

### Runtime compact

Pendant l'appel, le runtime peut afficher l'etape interne `wiki_search`, mais le libelle utilisateur est `Entities retrieved`.

Exemple attendu:

```text
Retrieval
Technical docs: 10   Similar NC: 3   Entities: 5
Top entities: Door / ATA 52 / Forward zone
```

Le runtime reste compact:

- statut
- nombre de resultats
- deux ou trois titres principaux si disponibles
- pas de dump JSON
- pas de longue liste de fichiers

### Bloc Sources du chat

Le bloc `Sources` reste replie par defaut et expose trois groupes de premier niveau:

```text
Sources 18
Technical documents 10
Similar non-conformities 3
Entities 5
```

Le groupe `Entities` affiche des cartes compactes, pas des chips PDF generiques.

```text
Entities

+ Flight Deck Door Surveillance System      #1
| Entity / part
| Zone forward / Zone left / Zone right
| Alias: flight deck door surveillance system
| Part numbers: 00-04-2, 01-01-13
| 1 primary doc / 10 supporting docs
| [Open entity] [Open primary document]
+
```

Regles:

- jamais de libelle hybride melangeant entite et wiki au premier niveau
- jamais d'action utilisateur nommee comme un wiki
- l'action principale est `Open entity`
- une entite n'est jamais ouverte comme un PDF
- `Open primary document` ouvre le viewer technique existant

### Rail et drawer applicatifs

Ajouter un onglet `Entities` dans la barre gauche, au meme niveau que `Tech Docs` et `History`.

Rail:

```text
Edit
Tech Docs (10)
Entities (5)
History (3)
```

Drawer gauche `Entities`:

```text
Retrieved entities
[Flight Deck Door Surveillance System]      #1
[Door lining panel]                         #2
[A220 Aircraft Door Diagram]                #3
```

Le drawer contient uniquement la liste des entites retrouvees dans la reponse courante. Il ne contient pas le detail complet.

### Paneau principal `Entities`

Le paneau principal affiche la fiche de l'entite selectionnee.

```text
Entity
Flight Deck Door Surveillance System
Used in current answer

Zones: forward, left, right
Aliases: flight deck door surveillance system
Part numbers: 00-04-2, 01-01-13

[Open primary document]

Entity notes
Component linked to the door surveillance system...

Supporting documents (10)
[611795195...page_0052.pdf]
[a220-300-FCOM...page_0052.pdf]

Related entities found in this answer
[Door lining panel]
[A220 Aircraft Door Diagram]

Other links
V0 only exposes entities retrieved for the current answer.
```

Regles de navigation:

- une carte `Sources > Entities` ouvre l'onglet rail `Entities`
- la fiche selectionnee garde un badge `Used in current answer`
- les documents primaires et supports sont actionnables vers `/doc`
- les entites liees affichees en V0 sont uniquement celles retrouvees dans la meme reponse
- les autres liens de graphe restent hors perimetre tant que l'ontologie n'est pas validee
- si une navigation hors contexte est ajoutee plus tard, elle devra indiquer explicitement qu'elle n'est pas une preuve de la reponse courante

## Mapping donnees -> UI

| Champ backend | Affichage UI |
| --- | --- |
| `title` ou `doc` | titre de carte et titre de fiche |
| `path` | identifiant interne de l'article connaissance |
| `ata_codes` | badge ou ligne `ATA` si non vide |
| `zones` | ligne `Zones` |
| `aliases` | ligne `Aliases`, limitee |
| `part_numbers` | ligne `Part numbers`, limitee |
| `supporting_docs` | compteur + liste collapsible dans la fiche |
| `primary_doc` | action `Open primary document` |
| `wiki_rank` | rang discret `#1`, `#2` |
| `wiki_score` | debug discret ou title attribute, jamais dominant |
| `content` | fallback resume/extrait si les champs structures manquent |

## Hors perimetre V0

- Pas de graphe visuel.
- Pas de navigation libre de noeud en noeud.
- Pas de drawer interne au chat.
- Pas de modal de connaissance dans le chat.
- Pas de libelle produit `wiki` au premier niveau du chat.
- Pas d'ouverture d'une entite comme si c'etait un PDF.
- Pas de duplication de l'update NC dans le chat.

## Contrat fonctionnel UI

### 1. Runtime `Entities`

Attendu:

- une etape visible quand le retrieval entites est execute
- libelle utilisateur `Entities retrieved`
- nombre de resultats si disponible
- apercu compact des principales entites si disponible

### 2. Sources du chat

Attendu:

- groupes `Technical documents`, `Similar non-conformities`, `Entities`
- cartes compactes pour `Entities`
- action `Open entity`
- action `Open primary document` quand disponible
- clic carte ou `Open entity` bascule vers le rail `Entities`

### 3. Rail / drawer

Attendu:

- icone rail `Entities` visible avec compteur
- drawer gauche listant les entites retrouvees
- selection stable entre clic chat et clic drawer
- aucune fiche detaillee dans le chat

### 4. Fiche entite

Attendu:

- titre canonique
- badge `Used in current answer`
- zones / ATA / alias / part numbers si disponibles
- notes lisibles issues de l'article connaissance
- documents supports collapsibles
- entites associees limitees au contexte retrouve
- liens docs ouvrables sans 404

## UAT

### Cas `000`

1. Envoyer un prompt `000` realiste.
2. Verifier le runtime: `Request prepared`, `Technical documents retrieved`, `Similar non-conformities retrieved`, et si disponible `Entities retrieved`.
3. Ouvrir `Sources`.
4. Verifier que le groupe s'appelle `Entities`, sans suffixe wiki.
5. Cliquer une carte `Entities`.
6. Verifier que l'onglet rail `Entities` est selectionne et que le drawer gauche liste les entites.
7. Verifier que la fiche principale affiche la bonne entite.
8. Ouvrir le document primaire et au moins un document support; aucun 404.

### Cas `100`

1. Rejouer la sequence sur une analyse `100`.
2. Verifier que les entites restent utiles a l'analyse et ne noient pas les documents techniques.
3. Ouvrir deux entites differentes depuis le drawer.
4. Confirmer si les fiches ameliorent la resolution du probleme: `utile`, `neutre` ou `inutile`.

## Tests attendus

- test de rendu avec `entities_wiki` present
- test de libelle `Entities`
- test d'action `Open entity`
- test de bascule `activeTabValue = 4`
- test d'ouverture document primaire
- test de non-regression `tech docs` et `similar NC`

## Criteres d'acceptation

- l'utilisateur voit explicitement `Entities` dans les sources
- l'utilisateur ne voit pas de libelle hybride entite/wiki au premier niveau
- l'utilisateur peut ouvrir une entite depuis le chat vers le drawer gauche
- l'utilisateur peut lire une fiche entite hors du chat
- l'utilisateur peut ouvrir un document support depuis la fiche
- l'utilisateur peut juger si les entites aident l'analyse
