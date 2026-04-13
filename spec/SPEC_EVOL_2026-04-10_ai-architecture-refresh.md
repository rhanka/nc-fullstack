# SPEC_EVOL - AI Architecture Refresh

- Date: 2026-04-10
- Status: proposal
- Related intent: `SPEC_INTENT_2026-04-10_ai-architecture-refresh.md`
- Last updated: 2026-04-11

## Objectif

Définir une trajectoire réaliste sur quatre axes:

1. routing modèle + reasoning
2. remplacement du chat custom
3. RAG v2 plus pertinent
4. projection API, tests, puis éventuelle migration backend

Note:

- la décision détaillée de remplacement de la vector DB et son plan d'exécution sont désormais cadrés dans `SPEC_EVOL_VECTOR_DB.md`

## Etat actuel observé

### Backend et orchestration

- Le backend est un FastAPI Python compact centré sur `api/src/app.py`.
- Le endpoint `/ai` orchestre directement réécriture de requête, recherche et génération finale.
- Le choix du modèle est éclaté entre:
  - `provider` dans la requête HTTP
  - `llmId` embarqué dans les prompts Dataiku
  - défaut du wrapper provider dans `api/src/llm.py`
- Il n'existe pas de router central par profil de tâche ni de télémétrie coût / latence / promotion.

### LLM et reasoning

- `api/src/llm.py` utilise encore `chat.completions`.
- Le contrat `BaseLLM` ne porte pas d'options de raisonnement par appel.
- Les prompts restent hétérogènes:
  - `gpt-4.1` pour certains prompts
  - `gpt-5` pour d'autres
  - identifiants `retrievalaugmented:*` qui ne gouvernent plus proprement le runtime

### Frontend chat

- Le frontend est bien en Svelte, mais le chat repose sur `deep-chat` avec une logique métier lourde dans `ui/src/routes/Chatbot.svelte`.
- Le projet UI est TypeScript-enabled, mais pas réellement migré:
  - `ui/tsconfig.json` active `allowJs` et `checkJs`
  - la base actuelle est majoritairement en `.js` et en composants Svelte sans `lang="ts"`
- Le composant gère aujourd'hui:
  - mutation du payload sortant
  - parsing SSE maison
  - reconstruction JSON partielle
  - mise à jour du canevas NC en streaming
  - mise à jour de la liste de sources
- En pratique, le widget ne masque pas la complexité: il héberge déjà un runtime custom fragile.

### RAG

- `api/src/search.py` fait essentiellement:
  - Chroma vector search
  - embeddings OpenAI `text-embedding-3-large`
  - reranking Cohere optionnel
- Il n'y a pas:
  - de recherche lexicale BM25 / FTS
  - de fusion de rangs
  - de score de confiance consolidé
  - de mémoire active session / inter-session
  - d'évaluation de pertinence outillée

### Contrats et tests

- Très peu de tests visibles dans le repo.
- `api/test/scenarios.csv` existe, mais il n'y a pas de suite contractuelle ou d'intégration structurée.
- Le contrat HTTP / SSE de `/ai` n'est pas formalisé côté backend.
- Il n'existe pas de types partagés ou générés entre API et frontend.

### Risque infra RAG à vérifier avant refonte

- `api/Dockerfile` copie uniquement `chroma.sqlite3` pour les deux bases, pas les segments binaires présents sous `vectordb/*/`.
- C'est une hypothèse sérieuse de dégradation en environnement prod-like.
- Avant de conclure que l'architecture retrieval est seule en cause, il faut valider ce point de packaging.

## Recherche externe vérifiée

### OpenAI

Constat vérifié le 10 avril 2026 à partir de la doc officielle:

- `gpt-5.4`, `gpt-5.4-mini` et `gpt-5.4-nano` sont bien listés.
- `gpt-5.4` est présenté comme le modèle de référence pour les workflows de raisonnement complexes.
- `gpt-5.4-nano` est présenté comme une cible économique pour les charges rapides / volumineuses.
- La famille 5.4 expose des niveaux de reasoning allant jusqu'à `xhigh`.
- Les modèles sont disponibles via `v1/chat/completions` et `v1/responses`.

Sources:

- OpenAI models: https://developers.openai.com/api/docs/models
- Compare models: https://developers.openai.com/api/docs/models/compare
- All models: https://developers.openai.com/api/docs/models/all

### AI SDK / Svelte

Constat vérifié:

- L'AI SDK dispose d'une intégration Svelte native via `@ai-sdk/svelte`.
- Le transport est conçu pour fonctionner avec un backend custom.
- Le rendu repose sur `messages` et `message.parts`, ce qui colle bien aux besoins "texte + étapes + données + reasoning".

Sources:

- useChat: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- Svelte quickstart: https://ai-sdk.dev/docs/getting-started/svelte

### Pattern LLM Wiki v2

Le gist référencé ajoute des briques utiles et compatibles avec une mise en oeuvre légère:

- hybrid search = BM25 + vector + traversal
- fusion via reciprocal rank fusion
- mémoire par niveaux: working, episodic, semantic, procedural
- confiance, supersession et rétention

Source:

- https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2

## Recommandation cible

### Axe 1 - Routing modèle et reasoning

Recommandation:

- Introduire un router central par profil de tâche.
- Ajouter un classifieur minimal de complexité, séparé du call final, pour les tours assistant.
- Sortir le choix de modèle des prompts métier.
- Faire évoluer le wrapper OpenAI pour accepter des options par appel, dont `reasoning.effort`.
- Préparer une migration vers `Responses API` pour le runtime OpenAI.
- Important: cet axe est strictement backend. Il ne dépend pas de Vercel.

Matrice initiale proposée:

| Profil | Modèle | Reasoning |
| --- | --- | --- |
| `search_rewrite` | `gpt-5.4-nano` | `low` |
| `draft_simple` | `gpt-5.4-nano` | `none` ou `low` |
| `draft_standard_000` | `gpt-5.4-nano` | `medium` |
| `analysis_standard_100` | `gpt-5.4` | `high` |
| `analysis_deep` | `gpt-5.4` | `xhigh` |

Mécanisme retenu:

- `search_rewrite` bypass le classifieur et reste sur `search_rewrite`
- `000` bypass le classifieur et reste sur `draft_standard_000`
- les autres tours assistant passent par un classifieur minimal `gpt-5.4-nano`
- ce classifieur retourne un seul token `simple|standard|deep`
- le registre de profils reste la source de vérité finale
- `retrievalConfidence === low` peut promouvoir d'un cran même si la complexité classifiée est `standard`
- le classifieur ne choisit jamais le modèle final; il ne pilote que le profil d'exécution et l'effort de reasoning
- le modèle final est choisi par l'utilisateur dans le chat, avec valeur par défaut `gpt-5.4-nano`

Promotion vers `analysis_deep` si:

- plusieurs ATA sont impliqués
- confiance retrieval faible
- sources contradictoires
- demande utilisateur explicitement complexe
- étape métier à partir de `100`

Override utilisateur visé pour le chat:

- un sélecteur `modèle + complexité` sera exposé dans le composeur du chat
- valeur par défaut visée: `gpt-5.4-nano` + `auto`
- `auto` veut dire: laisser le mécanisme de complexité choisir l'effort de reasoning / le profil
- le modèle `gpt-5.4-nano` ou `gpt-5.4` est toujours sélectionné manuellement par l'utilisateur
- une sélection manuelle devra rester observable dans le runtime

Note:

- `openai==1.35.13` dans `api/requirements.txt` paraît trop ancien pour cette trajectoire et devra être réévalué pendant le lot dédié.

### Axe 2 - Remplacement du chat custom

Recommandation:

- Remplacer `deep-chat` par `@ai-sdk/svelte` en priorité.
- Conserver une UI Svelte métier fine pour le rendu du chat, des étapes, des sources et du canevas.
- Préserver deux modes d'hébergement:
  - flottant
  - panneau docké / panel
- Important: `Vercel` est ici seulement un choix de primitives UI / stream pour le chat.
- Le backend reste piloté séparément, sans pivot plateforme vers Vercel.

Pourquoi:

- on réduit fortement le code custom de transport et d'état
- on évite un composant opaque non natif Svelte
- on garde la liberté de rendre des `parts` spécialisées

Formulation importante:

- Il n'y a pas de "widget Svelte zéro code" qui couvre exactement ce besoin.
- Le bon compromis est une base standard d'état / stream plus un renderer métier léger.
- Si les primitives `@ai-sdk/svelte` ne suffisent pas à livrer vite un shell UX correct, un fallback réaliste existe dans `../top-ai-ideas-fullstack/ui`:
  - `src/lib/components/ChatWidget.svelte`
  - `src/lib/components/ChatPanel.svelte`
  Ces composants gèrent déjà un mode `floating` et un mode `docked`.

Migration cible:

1. figer le contrat de stream
2. remplacer le parsing SSE ad hoc par un flux structuré
3. rendre les statuts, sources, updates canevas et éventuellement le reasoning via des `parts` explicites

#### Etude comparative fonction par fonction vs `../top-ai-ideas-fullstack/ui`

Constat important:

- `../top-ai-ideas-fullstack/ui` n'utilise pas aujourd'hui `@ai-sdk/svelte`.
- Son shell chat est lui-même largement custom, mais il est mieux structuré que `nc-fullstack`.
- Donc le bon cadrage n'est pas "prendre Vercel ou prendre top-ai".
- Le bon cadrage est:
  - `@ai-sdk/svelte` pour l'état message / stream / `parts`
  - réutilisation ciblée de patterns ou de composants issus de `top-ai-ideas-fullstack`
  - renderer métier spécifique pour les besoins NC

Matrice fonctionnelle:

| Fonctionnalité | `nc-fullstack` actuel | `top-ai-ideas-fullstack` | Réutilisable tel quel | A reconstruire | Couverture plausible par `@ai-sdk/svelte` |
| --- | --- | --- | --- | --- | --- |
| Conteneur chat flottant | Bouton flottant + panneau show/hide simple dans `ui/src/routes/App.svelte` et `ui/src/routes/Chatbot.svelte`. | Shell complet `floating` / `docked`, responsive et mobile dans `src/lib/components/ChatWidget.svelte`. | Partiellement, surtout le pattern de layout. | Oui, pour enlever la dépendance aux tabs extension / comments / queue. | Non, hors scope AI SDK. |
| Fallback panel / docked | Absent. | Présent avec persistance de mode et largeur dockée. | Oui pour le pattern et le store `chatWidgetLayout`. | Oui, adaptation nécessaire au layout NC. | Non. |
| Transport chat | `deep-chat` + interceptors `requestInterceptor` / `responseInterceptor`. | Transport custom via `apiPost`, `streamHub`, historique NDJSON. | Non. | Oui, car les deux chemins actuels sont spécifiques. | Oui, c'est précisément la partie à basculer. |
| Parsing du stream | Parsing SSE ad hoc et dispatch par `metadata` dans `Chatbot.svelte`. | Runtime custom plus propre via `streamHub` + `StreamMessage`. | Non tel quel. | Oui. | Oui, via flux structuré et `parts`. |
| Résumé de reasoning collapsible | Absent. | Présent via `StreamMessage.svelte` avec résumé runtime et détails repliables. | Partiellement, au moins comme pattern UI. | Oui, pour l'adapter à un résumé court et au contrat NC. | Oui en partie, mais le renderer reste à écrire. |
| Affichage des appels outils / étapes runtime | Couvert implicitement par du texte / JSON partiel. | Couvert explicitement dans `StreamMessage.svelte`. | Partiellement comme pattern. | Oui, adaptation nécessaire. | Oui en partie, via `parts`. |
| Sessions de chat | Absentes. | Multi-sessions complètes dans `ChatWidget.svelte` + `ChatPanel.svelte`. | Non comme priorité lot 2. | Optionnel plus tard si le backend expose ce contrat. | Non directement. |
| Historique hydraté / replay | Limité au store local métier. | Hydratation d'historique, projection de runtime, replay SSE. | Non tel quel. | Oui si on veut ce niveau d'historique. | Partiellement seulement. |
| Upload de documents dans le chat | Absent. | Présent dans le composer de `ChatPanel.svelte`. | Non, hors besoin immédiat. | Seulement si ce besoin entre au scope. | Non directement. |
| Toggle d'outils | Absent. | Présent avec scopes et permissions. | Non, hors scope NC immédiat. | Non prioritaire. | Non. |
| Permissions outils locaux | Absent. | Présent pour extension / VS Code / navigateur. | Non. | Non prioritaire. | Non. |
| Feedback / retry / checkpoints | Absent. | Présent dans `ChatPanel.svelte`. | Non en première passe. | Oui si on choisit de monter en maturité plus tard. | Non directement. |
| Commentaires / queue / extension config | Absent. | Présent, mais très spécifique à Top AI. | Non. | Non, hors scope. | Non. |
| Injection de contexte métier NC | Oui, via mutation du payload sortant: `role`, `history`, `description`, `sources`. | Oui mais sur un autre modèle de contexte métier. | Non. | Oui, car le contexte NC doit rester spécifique. | Partiellement, en enveloppant les messages sortants. |
| Mise à jour du canevas NC | Oui, via JSON partiel et `updateCreatedItem`. | Pas d'équivalent direct. | Non. | Oui, c'est du métier NC pur. | Oui, mais sous forme de `parts` ou d'événements métier custom. |
| Mise à jour des sources NC / docs | Oui, via `referencesList` consommée par les panneaux latéraux. | Pas d'équivalent direct. | Non. | Oui, car c'est couplé au layout NC. | Oui, mais via données structurées et mapping custom. |

Références code observées:

- `nc-fullstack`
  - `ui/src/routes/App.svelte`: bouton flottant et container show/hide du chat.
  - `ui/src/routes/Chatbot.svelte`: usage `deep-chat`, interceptors, parsing stream, injection métier, updates canevas et sources.
  - `ui/src/routes/store.js`: stores métier `createdItem`, `referencesList`, `showChatbot`, historique par tâche.
- `top-ai-ideas-fullstack`
  - `ui/src/lib/components/ChatWidget.svelte`: shell `floating` / `docked`, persistance de mode, handoff d'état, header de sessions.
  - `ui/src/lib/components/ChatPanel.svelte`: composer riche, sessions, runtime, feedback, checkpoints, documents, toggles d'outils.
  - `ui/src/lib/components/StreamMessage.svelte`: résumé runtime, détail collapsible, reasoning, tool calls.
  - `ui/src/lib/stores/streamHub.ts`: bus SSE/history plus structuré.
  - `ui/src/lib/stores/chatWidgetLayout.ts`: état de layout du widget.

Décision de conception:

- Ne pas transplanter `ChatWidget.svelte` / `ChatPanel.svelte` en bloc.
- Réutiliser sélectivement:
  - le pattern `floating` / `docked`
  - le store de layout
  - le pattern de résumé runtime collapsible inspiré de `StreamMessage`
- Ne pas reprendre:
  - comments
  - queue
  - extension config
  - permissions outils locaux
  - sessions avancées dès la première passe
- Construire la cible UI lot 2 comme un hybride:
  - base de chat = `@ai-sdk/svelte`
  - shell visuel = inspiré / extrait partiellement de `top-ai-ideas-fullstack`
  - rendu métier NC = spécifique à `nc-fullstack`

Conclusion opérationnelle:

- Oui, `Vercel` reste prévu, mais uniquement pour la couche primitives chat (`messages`, stream, `parts`).
- Non, ce n'est pas une décision "one-shot" suffisante.
- La vraie stratégie est:
  1. reprendre le shell UX utile de `top-ai-ideas-fullstack`
  2. remplacer le transport custom par `@ai-sdk/svelte`
  3. recoder les parties strictement métier NC au-dessus
- En conséquence, la migration UI doit être menée comme une décomposition fonctionnelle, pas comme un simple remplacement de composant.

#### Contrat de rendu UI cible V1

Objectif:

- Spécifier explicitement comment migrer l'affichage du chat, des bulles, du reasoning et des futures traces d'outils.
- Eviter toute ambiguïté du type "on garde le chat actuel" ou "on prend un composant Vercel tout fait".

Principes:

- `deep-chat` est une base à supprimer, pas une base à conserver.
- `@ai-sdk/svelte` sert de moteur UI pour:
  - l'état des messages
  - l'envoi
  - le stream
  - les `parts`
- Le rendu visuel final des messages reste custom en Svelte.
- Aucune chaîne de pensée brute ne doit être affichée.
- Le reasoning visible est uniquement un résumé court, collapsible, produit côté backend.
- Le shell conversationnel cible doit se rapprocher explicitement des UX modernes `ChatGPT / Claude / Gemini`, avec `../top-ai-ideas-fullstack` comme référence comportementale primaire.
- Aucun faux message assistant de transition ne doit être rendu; les états d'exécution vivent dans un runtime panel compact, séparé de la bulle assistant finale.

Architecture de rendu visée:

1. shell de chat
   - conteneur flottant + fallback panel / docked
   - inspiré du pattern `ChatWidget.svelte`
   - ergonomie visée: proche `ChatGPT`, avec header compact, timeline lisible et composeur conversationnel

2. panneau de conversation
   - liste des messages
   - composer
   - rendu des états de stream
   - spécifique NC, mais aligné sur les comportements utiles de `ChatPanel.svelte`

3. renderer de message
   - un composant central parcourt `message.parts`
   - chaque `part.type` délègue vers un sous-composant dédié

4. renderer runtime
   - un composant dédié rend les états transitoires, le reasoning et les étapes d'outillage
   - ce renderer doit être distinct de la bulle assistant finale
   - il s'inspire directement de `StreamMessage.svelte`

Structure visuelle visée:

- bulle utilisateur
  - texte simple
  - markdown léger si nécessaire
  - pas de bloc auxiliaire complexe

- bulle assistant
  - bloc principal = réponse markdown
  - blocs secondaires empilés sous la réponse
  - les blocs secondaires couvrent:
    - reasoning court
    - sources
    - update NC
    - jamais l'état transitoire "thinking / preparing"

- états de traitement
  - état "thinking / preparing" discret, hors bulle assistant
  - résumé runtime compact
  - détail collapsible si des données utiles existent
  - étapes retrieval / génération visibles comme runtime steps ou tool calls

Composeur cible:

- champ de saisie principal orienté conversation
- pas de gros CTA métier du type `Propose task description` comme contrôle principal
- sélecteur visible de modèle
- sélecteur visible de niveau de réflexion / effort
- bouton send / stop aligné sur les conventions des chats modernes
- rendu inspiré directement du footer `ChatPanel.svelte` de `../top-ai-ideas-fullstack`:
  - contrôles plus compacts
  - police plus petite
  - sélecteurs sur une seule ligne quand l'espace le permet
  - passage multi-ligne adaptatif si la largeur devient insuffisante
  - le libellé visible doit utiliser un vocabulaire produit explicite (`Reasoning effort` / `Auto`, pas un jargon ambigu)
- le prompt d'accueil doit rester présent dans la session vide sous forme de quick actions, comme dans le shell d'origine, mais pas comme un gros CTA dans la barre de saisie
- la bulle fermée doit reprendre l'esprit visuel de `ChatWidget.svelte`, avec icône compacte et propre au produit
- le favicon / identité visuelle du chat doit être réaligné avec `../sentech-forge`

Runtime panel cible:

- le panneau runtime doit rester discret et compact
- le titre, les badges et les étapes doivent occuper sensiblement moins d'espace que la version actuelle
- le comportement de référence est `StreamMessage.svelte`:
  - résumé inline minimal pendant l'exécution
  - détails dépliables seulement si nécessaire
  - étapes outils / retrieval réduites à des lignes compactes par défaut
  - aucun pavé "intense" qui pousse la réponse hors écran

Rendu des sources cible:

- la citation des sources ne doit pas être une simple longue liste verticale de noms de fichiers
- il faut un pattern compact inspiré des références/citations modernes:
  - références compactes par défaut
  - détail dépliable
  - capacité de pointer vers le document
  - si pertinent, réutilisation du pattern de positionnement document déjà présent dans `../top-ai-ideas-fullstack`
- la cible V1 raisonnable est:
  - un résumé compact par groupe (`tech docs`, `similar NC`)
  - des chips ou lignes courtes cliquables
  - un bloc "show more" / `details`

Contrat initial de `parts`:

| `part.type` | Usage | Affichage V1 |
| --- | --- | --- |
| `text` | réponse principale assistant ou user | bulle markdown standard |
| `reasoning_summary` | résumé court du raisonnement | encart collapsible compact |
| `sources` | sources retrieval structurées | liste compacte avec doc / chunk / type |
| `nc_update` | update métier sur le canevas NC | lien compact et éventuellement dépliable vers la task amendée dans l'application; pas de dump détaillé du canevas dans le chat |

Types réservés pour plus tard:

| `part.type` | Usage futur | Affichage visé |
| --- | --- | --- |
| `tool_call` | appel outil en cours ou terminé | ligne/runtime card compacte |
| `tool_result` | résultat outil | détail repliable sous le runtime |

Décision importante sur le tooling:

- Le produit n'a pas encore de tooling utilisateur généraliste.
- En revanche, le pipeline retrieval historique expose déjà des étapes métier lisibles:
  - `query`
  - `doc_search`
  - `nc_search`
  - `final`
- Ces étapes doivent être rendues dans l'UI cible comme des étapes runtime / tool calls de premier rang.
- Il ne faut donc ni les masquer, ni les rendre comme simple texte parasite dans la bulle assistant.
- La V1 doit afficher au minimum ces étapes comme runtime cards compactes, avec statut et détail court.

Comportement reasoning V1:

- visible dans le runtime panel, pas seulement dans la bulle assistant
- résumé très court
- replié par défaut
- formulation attendue:
  - arbitrage de confiance
  - nombre/type de sources croisées
  - escalade éventuelle de niveau d'analyse
- jamais de verbatim de chaîne de pensée interne
- comportement attendu:
  - apparition dès le début de la génération
  - enrichissement progressif pendant le stream
  - conservation en résumé final après complétion

Migration des composants UI:

- source actuelle
  - `ui/src/routes/App.svelte`
  - `ui/src/routes/Chatbot.svelte`
  - `ui/src/routes/store.js`

- cible de responsabilité
  - shell widget / panel: nouveau composant Svelte dédié, inspiré de `ChatWidget.svelte`
  - panneau NC: composant de conversation dédié, plus léger que `ChatPanel.svelte`
  - renderer de bulles: composant dédié
  - stores chat/layout: migrés en TypeScript
  - contrats message / `parts`: explicités en TypeScript

Décomposition recommandée des composants:

- `ChatShell.svelte`
  - gère `floating` / `docked`

- `ChatConversation.svelte`
  - gère la liste de messages et le stream

- `ChatMessageBubble.svelte`
  - rend la bulle principale selon le rôle

- `ChatRuntimeMessage.svelte`
  - rend l'état de progression, le reasoning streamé et les étapes / tools
  - inspiré directement du pattern `StreamMessage.svelte`

- `ReasoningSummary.svelte`
  - rend le résumé collapsible

- `SourcesBlock.svelte`
  - rend les sources retrieval

- `NcUpdateCard.svelte`
  - rend les updates du canevas NC

- `ChatComposer.svelte`
  - gère l'envoi, le choix du modèle et le niveau de réflexion

Ce qui est repris de `top-ai-ideas-fullstack`:

- le pattern de shell flottant / docked
- le pattern de runtime inline compact inspiré de `StreamMessage.svelte`
- le pattern de résumé runtime collapsible inspiré de `StreamMessage.svelte`
- le pattern de composeur conversationnel avec sélecteur de modèle inspiré de `ChatPanel.svelte`
- éventuellement le store de layout

Ce qui n'est pas repris en V1:

- comments
- queue
- sessions avancées
- feedback
- checkpoints
- permissions outils locaux
- configuration extension

Conclusion de migration UI:

- Oui, les bulles de chat font partie explicite de la migration.
- Oui, l'affichage du reasoning fait partie explicite de la migration.
- Oui, les étapes retrieval / génération historiques doivent être visibles dès la V1 comme runtime steps.
- Non, une bulle assistant factice de chargement n'est pas acceptable en cible.

Ajustement UAT après première implémentation lot 2 / lot 5:

- La première passe `nc-fullstack` a restauré une partie du stream, mais pas le bon shell UX.
- Le comportement cible est désormais explicitement ré-ancré sur `../top-ai-ideas-fullstack/ui`, pas seulement comme inspiration abstraite mais comme référence fonctionnelle pour:
  - le runtime inline
  - le reasoning streamé
  - l'affichage des étapes / tools
  - le composeur et ses sélecteurs
- La prochaine passe UI ne doit donc pas prolonger le bricolage local de `Chatbot.svelte`; elle doit converger vers une architecture `ChatPanel / StreamMessage` simplifiée pour NC.
- L'écart identifié est un écart de rendu et d'architecture UI, pas un écart de backend streaming pur.

### Axe 3 - RAG v2 light, inspiré LLM Wiki v2

Recommandation:

- Ne pas viser tout de suite graphe complet ni memkit.
- Construire un RAG hybride minimal, local et peu dépendant.

Architecture cible minimale:

1. flux vectoriel:
   garder Chroma au premier lot

2. flux lexical:
   ajouter un index SQLite FTS5 si possible
   option de repli: BM25 Python léger

3. fusion:
   reciprocal rank fusion entre lexical et vectoriel

4. query rewrite:
   requête normalisée et variantes ATA / zone / pièce via `gpt-5.4-nano`

5. mémoire légère:
   - working memory: contexte de session et sources retenues
   - episodic memory: résumés de cas validés et corrections utilisateur validées

6. confiance:
   stocker pour chaque résultat fusionné:
   - score lexical
   - score vectoriel
   - score fusion
   - fraîcheur
   - poids éventuel lié au feedback utilisateur

Pourquoi cette trajectoire:

- elle capture l'essentiel de LLM Wiki v2 sans explosion de deps
- elle améliore la pertinence avant d'ouvrir un chantier "knowledge graph"
- elle garde une porte vers une mémoire plus riche plus tard
- par défaut, elle évite de polluer la mémoire persistante avec des brouillons intermédiaires

Causes probables de la baisse de pertinence, par ordre de priorité:

1. packaging Chroma incomplet en prod-like
2. retrieval mono-flux vectoriel
3. même requête brute envoyée aux deux corpus
4. absence de canal lexical pour ATA / part numbers / termes exacts
5. dépendance Cohere optionnelle et périphérique
6. absence de métriques de qualité
7. injection trop brute des sources dans le prompt final

### Axe 4 - Backend, API, TypeScript

Recommandation pragmatique:

- cible retenue: backend TypeScript
- migration à mener de façon incrémentale, contract-first, sans big-bang
- ne pas retarder ce choix jusqu'à une hypothétique revue ultérieure

Précision:

- le besoin utilisateur n'est plus "décider plus tard", mais "partir maintenant vers TypeScript"
- cela ne change pas la méthode: on garde des contrats d'API et des tests comme garde-fous de transition
- il n'y aura pas de façade TS séparée: la migration se fait dans le même repo

Trajectoire proposée:

- figer le contrat `/ai` actuel pour éviter les régressions pendant la transition
- définir un contrat cible `/ai/v2`
- monter un backend TypeScript dans le même repo, par modules ou endpoints isolés
- séquençage retenu: la fondation TS doit commencer avant le lot de routing / reasoning, pour éviter une première implémentation en Python puis une seconde en TS
- implémenter le routing / reasoning directement dans le runtime TS cible
- basculer progressivement les endpoints critiques vers le runtime TS
- générer des types partagés pour le frontend
- ajouter tests contractuels, d'intégration et evals retrieval
- autoriser un cutover final unique si la suite de parité backend est jugée suffisante

Pourquoi:

- la dette de contrat et de tests reste le premier problème à traiter
- choisir TS maintenant évite de refaire une seconde phase de cadrage plus tard
- la migration doit rester progressive pour ne pas cumuler risque langage + risque produit dans un seul cutover
- comme l'utilisateur ne prévoit pas d'UAT intermédiaire, la couverture de parité automatique devient le garde-fou principal avant le switch final

Conséquence frontend:

- l'UI est déjà compatible TypeScript mais pas réellement migrée
- il faut profiter du chantier chat pour convertir les modules les plus sensibles en `lang="ts"` / `.ts`, au moins sur la couche chat, stores et contrats API

## Décisions proposées

- Oui au couple `gpt-5.4-nano` + `gpt-5.4 xhigh`, piloté par un router central.
- Oui au remplacement de `deep-chat`, via `@ai-sdk/svelte` pour l'UI du chat uniquement, avec fallback possible par export / adaptation du shell de `../top-ai-ideas-fullstack/ui`.
- Non à tout pivot backend vers Vercel; le backend reasoning reste séparé et piloté via OpenAI côté serveur.
- Oui à un RAG "LLM Wiki v2 light": hybride + mémoire légère d'abord.
- Oui à une migration backend TypeScript, mais conduite de manière incrémentale et contract-first.
- Oui à une montée en TypeScript du frontend sur la zone chat et les contrats partagés.
- Oui à une projection forte de l'API et à plus de tests pendant la bascule structurelle.

## Arbitrages utilisateur intégrés le 2026-04-11

1. Le reasoning doit être visible dans l'UI, via des features embarquées dans le chat.
   Forme retenue: résumé court, repliable / collapsible.
2. Le `000` reste sur `gpt-5.4-nano`.
3. Par défaut, la mémoire persistante ne conserve que les sorties et corrections validées.
4. Le produit doit conserver un mode flottant avec fallback panel / docked.
5. La cible backend TypeScript est actée dès maintenant.
6. L'UI doit aussi être migrée plus franchement vers TypeScript là où cela réduit le risque de dette.
7. Pas de façade backend séparée; migration TS dans le même repo, avec possibilité de cutover final unique si la parité est bien couverte.
8. L'utilisateur ne prévoit pas de tester avant la fin; les validations intermédiaires doivent donc être automatisées autant que possible.
9. Le mécanisme de complexité inspiré de `../top-ai-ideas-fullstack` doit piloter l'effort de reasoning et le profil d'exécution, pas choisir automatiquement le modèle final.
10. Le chat devra exposer en bas un sélecteur `modèle + niveau de réflexion`; valeur par défaut visée: `gpt-5.4-nano` + `auto`.
11. `auto` s'applique au niveau de réflexion / effort de reasoning; le choix du modèle final reste manuel et observable côté utilisateur.

## Questions ciblées pour la prochaine itération

Aucun arbitrage produit bloquant restant à ce stade. La prochaine itération peut attaquer le lot 0.
