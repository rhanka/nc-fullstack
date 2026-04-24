# PLAN

- Status date: 2026-04-18
- Specs actives:
  - `spec/SPEC_INTENT_2026-04-10_ai-architecture-refresh.md`
  - `spec/SPEC_EVOL_2026-04-10_ai-architecture-refresh.md`
  - `spec/SPEC_EVOL_VECTOR_DB.md`
  - `spec/SPEC_EVOL_LLM_WIKI.md`
  - `spec/SPEC_EVOL_DATAPREP_TS.md`
  - `spec/SPEC_EVOL_OCR_MISTRAL_PACKAGE.md`
- Tags:
  - `AUTO`: validation statique ou déterministe
  - `TEST`: validation par tests, benchmarks ou evals
  - `UAT`: validation utilisateur explicite

## Lot 0 - Baseline et cadrage exécutable

- [x] L0.1 Figer le contrat actuel de `/ai` en entrée, sortie et streaming. Recette: fixtures documentées + au moins un test contractuel backend repo-local. `TEST`
- [x] L0.2 Valider l'hypothèse d'index Chroma incomplet en build/run et corriger si nécessaire. Recette: preuve repo-locale que `chroma.sqlite3` référence des segments vectoriels requis, qu'un snapshot `sqlite-only` les perd, et que le `Dockerfile` copie désormais `vectordb/` complet. `TEST`
- [x] L0.3 Construire un baseline de pertinence à partir de `api/test/scenarios.csv` et de quelques cas NC représentatifs. Recette: `hit@k`, revue qualitative des sources et mini-jeu d'eval conservé dans le repo. `TEST`
- [x] L0.4 Figer le niveau de détail du reasoning visible et la forme de transition backend TS. Recette: arbitrage utilisateur documenté dans la spec active. `UAT`

## Lot 1 - Backend TypeScript foundation + routing modèle et reasoning

- [x] L1.1 Formaliser le contrat source `/ai` et le contrat cible `/ai/v2` pour la transition TS. Recette: schémas versionnés et fixtures de compatibilité. `TEST`
- [x] L1.2 Monter un backend TypeScript incrémental dans le même repo, sans façade séparée, avec couches `contracts / retrieval / llm / services / routes`. Recette: squelette exécutable et endpoint de smoke test. `TEST`
- [x] L1.3 Introduire un registre de profils d'exécution (`search_rewrite`, `draft_simple`, `draft_standard_000`, `analysis_standard_100`, `analysis_deep`) dans le runtime TS. Recette: tests unitaires sur le routing. `TEST`
- [x] L1.4 Faire évoluer l'abstraction LLM pour porter des options par appel dont `reasoning.effort`, `json_mode`, `stream` et limites de sortie. Recette: API interne clarifiée et couverte par tests. `TEST`
- [x] L1.5 Migrer l'intégration OpenAI vers un runtime compatible GPT-5.4 et préparer l'usage de `Responses API`. Recette: smoke tests non-stream et stream. `TEST`
- [x] L1.6 Router le profil d'exécution et l'effort de reasoning via un analyseur de complexité `gpt-5.4-nano`, tout en gardant le modèle final (`gpt-5.4-nano` ou `gpt-5.4`) à la main de l'utilisateur avec défaut `gpt-5.4-nano`. Recette: logs de décision + revue coût / latence sur cas réels + validation utilisateur du mécanisme `auto`. `TEST` + `UAT`
- [x] L1.7 Retirer la responsabilité du choix final de modèle des prompts Dataiku. Recette: prompts métier conservés, politique runtime centralisée. `AUTO`
- Note: ce lot est backend only. Aucun usage de Vercel ici.
- Note: le backend TS commence ici pour éviter de faire le routing/reasoning une première fois en Python puis une seconde fois en TS.

## Lot 2 - Migration UI chat

- [x] L2.0 Produire une étude fonction par fonction entre `nc-fullstack` et `../top-ai-ideas-fullstack/ui` pour geler ce qui est repris, ce qui est écarté et ce qui passe via `@ai-sdk/svelte`. Recette: matrice documentée dans la spec active. `AUTO`
- [x] L2.1 Remplacer `deep-chat` par une base `@ai-sdk/svelte` en priorité. Recette: `npm run build` vert + absence de nouvelles erreurs `svelte-check` sur `Chatbot.svelte`; le `npm run check` global reste bloqué par la dette `checkJs` legacy hors zone chat. `TEST`
- [x] L2.2 Représenter les étapes métier, les sources et les mises à jour du canevas via des `parts` structurées plutôt qu'un parsing SSE ad hoc. Recette: streaming complet lisible et stable sur un cas réel. `TEST`
- [x] L2.3 Conserver un mode flottant avec fallback panel / docked. Recette: layout `floating/docked` branché, build UI vert et fallback mobile explicite; validation utilisateur consolidée en `L5.2`. `TEST`
- [x] L2.4 Implémenter l'affichage du reasoning dans l'UI via un résumé court, collapsible, embarqué dans le chat. Recette: bloc `reasoning_summary` visible et repliable dans le flux assistant; validation utilisateur consolidée en `L5.2`. `TEST`
- [x] L2.5 Si nécessaire, extraire ou adapter le shell `ChatWidget` / `ChatPanel` de `../top-ai-ideas-fullstack/ui` au lieu de reconstruire ce comportement depuis zéro. Recette: décision d'intégration documentée et shell fonctionnel. `TEST`
- [x] L2.6 Migrer en TypeScript les modules UI critiques du chat, des stores et des contrats. Recette: disparition des principaux `.js` sur la zone chat et build UI vert; le `svelte-check` global reste encore bloqué par la dette legacy hors zone chat. `TEST`
- Note: `Vercel` ici veut dire SDK UI du chat uniquement, pas plateforme backend.
- Note: la cible n'est pas un transplant complet de `ChatWidget` / `ChatPanel`; on vise un hybride `@ai-sdk/svelte` + shell / patterns repris sélectivement + rendu métier NC spécifique.
- Note: le composeur devra exposer un sélecteur `modèle + niveau de réflexion`, par défaut `gpt-5.4-nano` + `auto`.
- Note: l'étude lot 2 est déjà rédigée dans `spec/SPEC_EVOL_2026-04-10_ai-architecture-refresh.md`, mais ne doit être cochée qu'au moment où l'exécution atteint réellement ce lot.
- Note: pour rendre `@ai-sdk/svelte` buildable sur ce repo, l'UI est passée à `svelte@5.55.3` et `@ai-sdk/svelte@2.1.12`; `svelte-pdf` garde un peer warning `^4.2.12`, sans casser le build actuel.
- Note: `L2.2` a nécessité une normalisation du payload final legacy quand `/ai` encapsule encore le JSON complet dans `text` avec des retours ligne littéraux; le bridge AI SDK reconstruit désormais `text + sources + nc_update` avant rendu.
- Note: conformément à l'arbitrage utilisateur, les validations UX manuelles intermédiaires sont reportées à `L5.2`; les lots UI intermédiaires sont fermés sur critères techniques reproductibles.

## Lot 3 - RAG v2 light

- [x] L3.1 Ajouter un canal lexical séparé au vector search, idéalement via SQLite FTS5. Recette: index généré localement sans nouveau service externe, validé par `python api/tests/run_l3_1_checks.py`. `TEST`
- [x] L3.2 Fusionner lexical + vectoriel avec Reciprocal Rank Fusion. Recette: benchmark comparatif `vector / rrf / rrf+rewrite` versionné par `python api/test/run_rrf_eval.py`; sur ce mini-corpus, `rrf` seul est benchmarké mais ne crée pas le gain sans `L3.3`. `TEST`
- [x] L3.3 Ajouter un query rewrite léger piloté par `gpt-5.4-nano` pour ATA, zones, pièces et synonymes métier. Recette: comparaison avant / après versionnée via `python api/tests/run_l3_3_checks.py` et `python api/test/run_rrf_eval.py`, avec gain NC `hit@5` de `0.8` à `1.0`. `TEST`
- [x] L3.4 Introduire une mémoire légère à deux niveaux, session et épisodique, avec confiance minimale et supersession simple. Recette: lecture / écriture testées via `python api/tests/run_l3_4_checks.py`, persistance épisodique limitée aux sorties validées, session récupérée via cookie `nc_session_id`. `TEST`
- [x] L3.5 Ajouter une politique de réponse prudente quand la confiance retrieval est basse. Recette: garde-fou technique vérifié par `python api/tests/run_l3_5_checks.py` sur cas pauvres; validation utilisateur consolidée en `L5.2`. `TEST` + `UAT`

## Lot 4 - Migration des endpoints TS, parité et cutover

- [x] L4.1 Implémenter progressivement les endpoints critiques dans le runtime TS. Recette: parité fonctionnelle sur `/ai`, `/nc` puis `/doc` ou décision explicite d'exclusion. `TEST`
- [x] L4.2 Générer ou maintenir des types partagés consommés côté UI. Recette: build UI propre et suppression des principales zones implicites. `TEST`
- [x] L4.3 Ajouter des tests de parité et d'intégration pour le backend TS, `/ai/v2`, `/nc` et le stream. Recette: suite locale verte, reproductible, avec mocks et snapshots suffisants pour autoriser un switch sans UAT intermédiaire. `TEST`
- [x] L4.4 Préparer soit une coexistence courte, soit un cutover final unique Python -> TS selon la confiance de la suite de parité. Recette: arbitrage documenté avec rollback simple. `TEST`

## Lot 4B - Migration Vector DB native TS

- [x] L4B.1 Formaliser le choix de la cible vector DB et la stratégie de migration depuis Chroma. Recette: spec dédiée versionnée avec comparaison LanceDB / Qdrant / libSQL / vec1 et décision exécutable. `AUTO`
- [x] L4B.2 Introduire une abstraction explicite de moteur retrieval avec au moins `export_exact` et `lancedb`. Recette: sélection par configuration observable, backend TS testable sans fork applicatif. `TEST`
- [x] L4B.3 Ajouter l'ingestion LanceDB OSS locale par corpus dans le même container que l'API TS. Recette: artefacts `api/data/*/lancedb/` générés repo-localement ou au build. `TEST`
- [x] L4B.4 Brancher le runtime `/ai` sur LanceDB pour le vectoriel + BM25 / FTS + hybrid search, avec fallback temporaire `export_exact`. Recette: tests backend verts et runtime status explicite. `TEST`
- [x] L4B.5 Comparer `lancedb` vs `export_exact` sur le mini-corpus retrieval et choisir le défaut runtime. Recette: benchmark versionné et décision de cutover documentée. `TEST`
- Note: ce lot documente une exploration déjà exécutée. La direction active suivante n'est plus "pousser LanceDB", mais décider si cette intégration doit être supprimée pour revenir à un seul moteur runtime.

## Lot 5 - Cutover et nettoyage

- [x] L5.1 Décommissionner les chemins Python devenus obsolètes une fois la parité TS atteinte. Recette: inventaire supprimé sans rupture de contrat. `TEST`
- [x] L5.2 Lancer l'UAT utilisateur de fin de chantier sur le système unifié. Recette: validation utilisateur finale avant nettoyage complet. `UAT`
- [x] L5.2a Rétablir un état visible de requête dès le clic côté chat. Recette: transition explicite `idle -> submitted -> generating -> done/error` visible dans le widget sans ambiguïté utilisateur. `TEST` + `UAT`
- [x] L5.2b Rétablir le streaming du texte assistant dans le chat. Recette: la bulle assistant se remplit progressivement au lieu d'attendre uniquement la finalisation JSON. `TEST` + `UAT`
- [x] L5.2c Rétablir le streaming optimiste des mises à jour du rapport / UI métier. Recette: les updates JSON partielles réapparaissent pendant la génération, pas seulement après finalisation. `TEST` + `UAT`
- [x] L5.2d Rétablir l'affichage du reasoning visible dans l'UI. Recette: résumé collapsible présent et alimenté par le runtime, avec état cohérent pendant et après génération. `TEST` + `UAT`
- [x] L5.2e Remplacer la fausse bulle assistant de transition par un shell runtime type `ChatGPT / Claude / top-ai-ideas`. Recette: aucun message parasite du type `Drafting the response...`; l'état courant vit dans un bloc runtime distinct de la réponse finale. `TEST` + `UAT`
- [x] L5.2f Rétablir un sélecteur de modèle visible dans le composeur. Recette: l'utilisateur choisit explicitement `gpt-5.4-nano` ou `gpt-5.4` avant envoi, avec défaut `gpt-5.4-nano`, et le choix est observable dans la requête. `TEST` + `UAT`
- [x] L5.2g Rétablir un sélecteur visible du niveau de réflexion / complexité. Recette: l'utilisateur choisit `auto` ou un niveau explicite dans le composeur, et ce choix pilote bien le runtime sans détour par un CTA générique. `TEST` + `UAT`
- [x] L5.2h Rendre les étapes `query`, `doc_search`, `nc_search` et `final` comme étapes runtime / tool calls de premier rang. Recette: chaque étape est visible pendant l'exécution, avec statut, détail et résultat compact, sans passer par du texte ad hoc dans la bulle assistant. `TEST` + `UAT`
- [ ] L5.2i Aligner l'ergonomie générale du chat sur le comportement `../top-ai-ideas-fullstack` et un shell moderne type ChatGPT. Recette: runtime inline compact, détails repliables, reasoning streamé, outils streamés et composeur orienté conversation plutôt qu'action métier figée. `TEST` + `UAT`
- [ ] L5.2j Aligner visuellement le composeur sur `../top-ai-ideas-fullstack`, avec contrôles plus petits et disposition adaptative mono-ligne puis multi-ligne. Recette: modèle + effort restent lisibles, compacts et s'empilent proprement quand l'espace manque. `TEST` + `UAT`
- [x] L5.2k Réintroduire les quick actions d'accueil dans la session vide sans les remettre dans la barre de saisie. Recette: les actions type `Propose task description` restent disponibles dans l'écran vide; l'ouverture du chat n'auto-envoie rien. `TEST` + `UAT`
- [ ] L5.2l Réduire l'encombrement du runtime panel pour converger vers `StreamMessage.svelte`. Recette: runtime plus compact, détails repliés par défaut, lecture plus proche de `top-ai-ideas`. `TEST` + `UAT`
- [x] L5.2m Refaire le rendu des sources en citations compactes et dépliables. Recette: plus de longue liste brute de fichiers; les références deviennent compactes, groupées et actionnables. `TEST` + `UAT`
- [ ] L5.2n Réaligner l'identité visuelle du widget fermé et du favicon sur les assets produit. Recette: bubble fermée plus proche de `top-ai-ideas`; favicon issu de `../sentech-forge`. `TEST` + `UAT`
- [x] L5.2o Retirer le dump `NC update` du chat et le remplacer par un lien compact vers la task amendée. Recette: le chat n'affiche plus les champs du canevas; il propose seulement un accès court à l'objet amendé (`000`, `100`, etc.) dans l'application. `TEST` + `UAT`
- [x] L5.2p Ajouter une quick action `Random non conformity description` sur l'accueil vierge du chat. Recette: le bouton tire au hasard une des 4 descriptions `Description du Problème` de `api/test/scenarios.csv`, remplit la description du rapport `000` en pseudo streaming de saisie avec listes Markdown lisibles, puis lance l'assistant une fois la saisie terminée. `TEST` + `UAT`
- [x] L5.2q Ajouter un mode demo propose apres 15 secondes sur chat et rapport `000` vierges. Recette: si le chat task `000` et le rapport restent vides et inactifs, meme widget ferme, un modal plein écran propose de remplir la description du rapport `000` avec une random non conformity; après confirmation, la saisie simulée se termine avant le lancement assistant. `TEST` + `UAT`
- [x] L5.2r Corriger les quick actions par rôle. Recette: task `000` affiche la proposition de description + random NC; task `100` n'affiche jamais `Propose task description` ni random NC, même après changement de tâche ou réouverture du chat. `TEST` + `UAT`
- [x] L5.2s Préserver les paragraphes Markdown des descriptions demo avant `Détails techniques`. Recette: les descriptions random NC gardent un saut de ligne visible avant le titre `Détails techniques` et avant la liste de détails, sans triple saut de ligne. `TEST` + `UAT`
- [ ] L5.3 Nettoyer la dette de transition côté UI et backend. Recette: plus de double chemin critique non justifié. `AUTO`
- Note: l'UAT de portage Python -> TS est considérée comme passée en prod pour les aspects fonctionnels de base du chat. Les items encore ouverts du lot 5 portent désormais surtout sur le design UI, le polissage ergonomique et le nettoyage final.
- Checklist UAT `L5.2` à exécuter sur un cas `000` réaliste:
  1. Ouvrir le widget en mode flottant, vérifier la présence des quick actions de session vide, puis vérifier que rien n'est auto-envoyé.
  2. Si le chat et le rapport `000` restent vierges pendant 15 secondes, widget ferme inclus, vérifier que le modal demo plein écran apparaît, que `Not now` le ferme, et que `Start demo` remplit la description du rapport en pseudo streaming, avec retours ligne sur les listes, puis lance l'assistant après la fin de saisie; vérifier aussi qu'il ne s'affiche pas si la description ou le label du rapport est déjà renseigné.
  3. Passer sur la task `100`, ouvrir un chat vide et vérifier que les quick actions affichent `Propose analysis summary` / traduction, sans `Propose task description` ni random NC.
  4. Vérifier que le composeur expose `Model` et `Reasoning effort`, avec défaut `GPT-5.4 Nano` + `Auto`.
  5. Envoyer un prompt `000` depuis le chat et vérifier la transition visible `submitted -> streaming -> ready`, sans bulle parasite de type `Drafting the response...`.
  6. Pendant la génération, vérifier que le runtime affiche au moins les étapes `Request prepared`, `Technical documents retrieved`, `Similar non-conformities retrieved` et, quand disponible, `Entities retrieved`.
  7. Pendant la génération, vérifier qu'un résumé de reasoning est visible et dépliable, puis qu'il reste cohérent une fois la réponse terminée.
  8. Vérifier que le texte assistant apparaît avant la fin de génération et que les mises à jour du rapport sont poussées dans l'application sans dump brut dans le chat.
  9. Ouvrir `Sources`, vérifier le rendu compact par groupes, puis ouvrir au moins une source `tech docs`, une source `similar NC` et, si présente, une source `Entities`.
  10. Vérifier que `Updated report` ou `Updated task` renvoie bien vers l'objet amendé dans l'application.
- Checklist UAT `L5.2` à exécuter sur un cas `100` réel:
  1. Refaire la même séquence avec `currentTask = 100`.
  2. Vérifier que les quick actions et le texte produit sont adaptés à l'analyse plutôt qu'à la seule observation factuelle.
  3. Vérifier que le niveau de reasoning visible et les étapes runtime restent lisibles avec une réponse plus longue.

## Lot 6 - Couche connaissance, dataprep TS et LLM Wiki

- [x] L6.1 Mener une session de QA produit / technique pour préciser l'utilité attendue de `LLM Wiki` sur le même dataset que le RAG. Recette: questions/réponses versionnées dans la spec active, avec arbitrages explicites sur audience, artefacts, cycle de mise à jour et critères de valeur. `UAT`
- [x] L6.2 Définir une ontologie minimale A220 utile au retrieval et à la synthèse. Recette: taxonomie versionnée couvrant au minimum `ATA / système / pièce / zone`, avec gestion des alias et variantes métier. `AUTO`
- [x] L6.3 Migrer le dataprep en TypeScript autour d'un corpus manifest canonique unique. Recette: pipeline TS produisant `vector-export`, `lexical/fts.sqlite3` et manifestes sans dépendance Python dans la chaîne backend. `TEST`
- [x] L6.4 Prototyper un `LLM Wiki` humain-navigable sur le même dataset que le RAG, branché sur `vector-export + SQLite FTS5 + RRF`. Recette: pages compilées par pièce / sous-ensemble, liens utiles vers les docs, et troisième vue `Entities` au même niveau que `tech docs` et `NC` pendant la recherche. `TEST`
- [x] L6.5 Décider explicitement si `graphify` apporte une valeur additionnelle après ontologie + wiki; sinon le différer sans ambiguïté. Recette: note de décision versionnée, sans intégration implicite. `AUTO` + `UAT`
- [x] L6.6 Superséder la cible LanceDB et supprimer l'intégration `lancedb` devenue inutile du runtime, du build et de la documentation si aucun besoin concret ne justifie son maintien. Recette: plus de dépendance `@lancedb/lancedb`, plus de copies `api/data/*/lancedb/`, plus de chemin moteur `lancedb`, et spec réalignée sur un seul moteur runtime. `TEST`
- [x] L6.7 Intégrer la préparation `ontology/wiki` au CI/CD de l'image API. Recette: `api-image-check` et `api-build` téléchargent les données minimales depuis Scaleway, régénèrent les artefacts knowledge via dataprep, excluent les fichiers horodatés du hash d'image, et embarquent `ontology/`, `wiki/` et `knowledge-manifest.json` dans le container. `TEST`
- [x] L6.7a Faire construire l'image API par la PR CI, sans push registry. Recette: le workflow `PR CI` exécute `make api-build` après les tests backend pour valider Dockerfile + données minimales avant merge. `TEST`
- [x] L6.8 Étudier le remplacement du codage OCR amont par le package npm `mistral-ocr`. Recette: spec dédiée décrivant l'état actuel, les contrats RAG à préserver, les adaptateurs nécessaires et les critères de migration progressive. `AUTO`
- [x] L6.8a Spécifier le prompt de description image et la politique retrieval associée. Recette: prompt `a220_image_caption_v1` versionné, sortie JSON stricte, description des images extraites par Mistral OCR avec contexte Markdown immédiat, aucun rendu image pleine page PDF envoyé aux LLM, classification `cover/index/front matter/blank/separation`, et règles `index/downweight/exclude` pour éviter la pollution du rappel. `AUTO`
- [x] L6.9 Implémenter le dataprep OCR TS avec `mistral-ocr` côté code et runner. Recette: commande `dataprep:ocr-tech-docs`, mode `existing` sans appel réseau, mode `live` optionnel via `mistral-ocr`, génération CSV préparé compatible, artefacts enrichis `__with_img_desc.*`, envoi testé des images extraites OCR aux LLM avec contexte Markdown, interdiction des rendus pleine page PDF, et audit déterministe pages/OCR/CSV couverts par tests. `TEST`
- [x] L6.10a Benchmarker `gpt-5.4-nano` vs `gpt-5.4` pour la caption des images OCR. Recette: cible Make reproductible sur échantillon déterministe, sorties comparatives versionnées en rapport, décision `nano seul` / `cascade` / `5.4 obligatoire`. Décision révisée: pas de `low-signal`; calibrer une cascade par typage de contenu, avec valeur RAG + LLM Wiki. `TEST`
- [x] L6.10b Spécifier le test de calibration `a220_image_caption_v2` / `routing_profile_v1` avant toute cascade. Recette: schema v2, matrice candidate, critères de comparaison RAG + LLM Wiki et protocole de replay documentés; aucune décision de cascade considérée validée à ce stade. `AUTO`
- [x] L6.10c Exécuter le replay de calibration `routing_profile_v1` sur l'échantillon benchmark. Recette: `gpt-5.4-nano` produit caption + typage de contenu + indices RAG/Wiki; le replay compare les décisions de routage aux gains observés de `gpt-5.4`, mesure faux `nano` / faux `5.4`, puis fige ou rejette la matrice. `TEST`
- [x] L6.10d Implémenter la cascade OCR caption seulement si le replay la valide. Recette: fallback technique séparé des deep pass, logs/audit du modèle réellement utilisé par page, tests unitaires du routeur et rapport de calibration référencé. `TEST`
- [ ] L6.10e Basculer le traitement image OCR sur OpenAI Batch au moins pour la passe primaire `gpt-5.4-nano`, avec deep pass `gpt-5.4` sur le sous-ensemble routé. Recette: cibles Make `create/status/import`, requêtes Batch `/v1/responses`, images OCR référencées par `file_id` vision, manifest de batch versionné, import des captions/audits, mode sync conservé seulement comme fallback/debug petit volume. `TEST`
- [ ] L6.10 Exécuter le rebuild complet RAG/wiki depuis la sortie OCR TS. Recette: génération complète `ocr/` + CSV préparé, `dataprep-prepare-tech-docs`, `dataprep-tech-docs`, `dataprep-knowledge-tech-docs`, audit zéro incohérence source servable, puis smoke UAT `000/100`. `TEST` + `UAT`

## Lot 6.2 - UAT couche connaissance

- [ ] L6U.1 Verifier en UAT la presence visible du canal `Entities` au meme niveau que `tech docs` et `similar NC`. Recette: sur un cas `000` et un cas `100`, le runtime affiche une etape `Entities retrieved` et le bloc `Sources` contient un groupe distinct `Entities`. `UAT`
- [ ] L6U.2 Verifier en UAT le rendu des cartes `Entities`. Recette: au moins une carte affiche un titre canonique, un type metier (`ATA`, `part`, `zone` ou `entity`), un resume/extrait et un compteur ou lien de documents support quand disponible. `UAT`
- [ ] L6U.3 Verifier en UAT la navigation chat -> rail/drawer `Entities`. Recette: depuis une carte `Sources > Entities`, basculer sur l'onglet rail `Entities`, voir le drawer gauche et lire la fiche dans le paneau principal. `UAT`
- [ ] L6U.4 Verifier en UAT la pertinence des liens `entity -> doc technique primaire`. Recette: au moins 3 parcours reels ou l'ouverture depuis `Entities` aide reellement l'analyse et ouvre le viewer `/doc` sans 404. `UAT`
- [ ] L6U.5 Verifier en UAT que les fiches `part / sous-ensemble / zone` ameliorent la resolution de probleme, et pas seulement la navigation. Recette: retour utilisateur explicite sur au moins 2 cas, avec jugement `utile / neutre / inutile`. `UAT`
- [ ] L6U.6 Verifier en UAT la coherence `sources RAG -> /doc`: toutes les sources `tech docs` affichees doivent ouvrir une page servie, sans filtrage runtime qui reduise artificiellement le top-k. Recette: sur un cas `000` et un cas `100`, ouvrir les sources techniques retournees; aucun 404 et aucune disparition de sources attendues. `UAT`
- Gate: cette UAT ne demarre qu'apres un full rebuild TS des artefacts `vector-export / lexical / ontology / wiki` sur le corpus canonique, afin d'eviter une validation sur un etat hybride.

## Lot 6.3 - Fix post-UAT couche connaissance

- [x] L6F.1 Corriger les écarts de retrieval ou de rendu révélés par l'UAT `Lot 6.2`. Recette: liste de fixes fermée, sans dérive de périmètre vers un graphe généraliste. `TEST`
- [x] L6F.2 Ajuster l'ontologie minimale `ATA / part / zone / alias` si l'UAT révèle des trous bloquants. Recette: spec et artefacts réalignés, IDs stables préservés. `TEST`
- [x] L6F.3 Implementer la spec UI `Entities`. Recette: rendu compact dans `Sources`, action `Open entity`, bascule vers l'onglet rail `Entities`, drawer gauche liste des entites, action `Open primary document`. `TEST`
- [x] L6F.3a Ajouter une fiche entite lisible hors du chat. Recette: onglet rail `Entities` + drawer gauche + paneau principal permettant de lire les notes d'entite et d'ouvrir ses documents support. `TEST`
- [ ] L6F.3b Ajouter les tests UI du canal `Entities`. Recette: couverture des cartes completes, champs partiels, bascule rail/drawer, ouverture document primaire, et non-regression des sources `tech docs` / `similar NC`. `TEST`
- [x] L6F.4 Corriger la cohérence corpus/RAG si l'UAT révèle des sources techniques non servies par `/doc`. Recette: audit reproductible `managed_dataset / pages / vector-export / lexical / wiki`, correction à la source des données ou de la préparation, puis rebuild complet sans filtre runtime masquant le top-k. `TEST`
- [x] L6F.4a Spécifier la préparation canonique du CSV tech docs avant indexation. Recette: spec dédiée décrivant entrée amont, sortie canonique, audit et garantie de diff caractère par caractère sur les lignes conservées. `AUTO`
- [x] L6F.4b Implémenter `dataprep-prepare-tech-docs`. Recette: génération de `a220_tech_docs_content_canonical.csv.gz` + audit JSON, lignes conservées recopiées sans re-sérialisation, lignes sans page servie exclues du corpus canonique. `TEST`
- [x] L6F.4c Brancher le RAG TS sur le CSV canonique. Recette: `dataprep`, `dataprep-tech-docs`, `dataprep-knowledge*` et `api-prepare-data-ci` consomment le canonique sans filtre runtime. `TEST`
- [x] L6F.4d Rebuilder les artefacts tech docs depuis le CSV canonique. Recette: `vector-export / lexical / ontology / wiki` régénérés et audit local montrant zéro source technique non servable dans les artefacts. `TEST`
- [x] L6F.4e Dédupliquer les pages techniques equivalentes avant indexation. Recette: le CSV canonique remappe les alias FCOM `long / court` vers un seul document court, puis supprime ces doublons jusque dans `vector-export`, `lexical`, `supporting_docs`, `primary_doc` et les artefacts publics image/wiki. `TEST`
- [x] L6F.5 Injecter les entites knowledge dans la synthese du rapport `100`. Recette: `search_entities_wiki` est consomme par le prompt `100`, contient un resume exploitable, et un test prouve que le contexte entites atteint la generation d'analyse. `TEST`
- [x] L6F.6 Spécifier `Wiki Image Intelligence` comme extension de la fiche `Entities`. Recette: spec dédiée validant `Linked images` avant `Supporting documents`, artefacts publics dérivés, absence de drawer image, et regroupement simple des related entities par classes. `AUTO`
- [x] L6F.7 Générer les artefacts publics image/entity. Recette: `ontology/images.json`, `ontology/image_relations.json` et `wiki/images/*` sont produits depuis les OCR/captions existants sans exposer les sidecars batch bruts. `TEST`
- [x] L6F.8 Brancher les images liées dans le wiki. Recette: `wiki/index.json` expose `linked_images`, les articles `wiki/parts/*.md` ajoutent une section `Linked images`, et le tri limite le bruit par score déterministe. `TEST`
- [x] L6F.9 Afficher `Linked images` dans `EntityDetail`. Recette: section située avant `Supporting documents`, cartes image compactes, miniature si disponible, caption utile, action `Open document`, et aucun nouveau drawer. `TEST`
- [x] L6F.9a Refaire le rendu `Linked images` en preuve lisible. Recette: image pleine largeur dans `EntityDetail`, caption sous l'image, clic ouvrant un modal lisible, sans nouveau niveau de navigation. `TEST`
- [x] L6F.10 Grouper les related entities par classes simples. Recette: `Same answer`, `Image-linked`, `Same document`, `Same ATA`, `Same zone` sont affichés en chips cliquables sans canvas graphe complet. `TEST`
- [x] L6F.11 Brancher le CI/CD data associé. Recette: les artefacts publics image/wiki sont rebuild/uploadés avec les targets dataprep existantes sans relancer automatiquement les batches OpenAI caption. `TEST`
- [x] L6F.11a Corriger le rebuild CI des images wiki. Recette: la cible CI télécharge aussi les artefacts source `ocr/` enrichis depuis Scaleway, nettoie les images générées périmées, et échoue si `tech_docs` produit zéro image/relation liée. `TEST`

## Lot 6.4 - Smoke tests UAT couche connaissance

- [ ] L6S.1 Rejouer un smoke test `000` après les fixes post-UAT. Recette: `Entities` present, liens ouvrables, aucune régression chat/réponse/rapport. `TEST` + `UAT`
- [ ] L6S.2 Rejouer un smoke test `100` après les fixes post-UAT. Recette: même validation sur un cas d'analyse plus riche. `TEST` + `UAT`
- [x] L6S.3 Vérifier qu'aucune dépendance `graphify` ou `lancedb` n'a été réintroduite pendant les fixes. Recette: grep repo-local propre + checks backend verts. `TEST`
- [ ] L6S.4 Rejouer un smoke test `Linked images`. Recette: une entité issue d'un schéma technique affiche des images liées, ouvre le document source sans 404, et conserve une fiche `Entities` lisible. `TEST` + `UAT`
- [ ] L6S.4a Rejouer un smoke test `Linked images` sans doublons documentaires. Recette: sur une entité issue d'un schéma FCOM, ni `Supporting documents` ni `Linked images` ne montrent de couple `long / court` pour la meme page. `TEST` + `UAT`

- Note: smoke technique repo-local rejoué le 2026-04-24 sur `000`, `100` et `Linked images`; les items `TEST + UAT` restent volontairement ouverts jusqu'à validation utilisateur explicite.

- Note: un bloqueur pré-UAT du lot 6 a été corrigé: si `ontology/` ou `wiki/` manque, le backend TS bootstrap désormais la couche connaissance en mode déterministe sans embeddings, et filtre les faux concepts documentaires génériques (`1. Scope`, `Reference`, etc.).
- Note: ce bootstrap local sert uniquement à débloquer le runtime et les checks techniques; il ne remplace pas le full rebuild TS attendu avant l'UAT utilisateur du lot 6.

## Critères de sortie

- [x] Le choix modèle / reasoning est explicite et observable. `TEST`
- [x] Le chat expose un état de progression explicite pendant l'appel. `TEST` + `UAT`
- [x] Le streaming du texte assistant dans le chat est rétabli. `TEST` + `UAT`
- [x] Le streaming optimiste des updates du rapport / UI est rétabli. `TEST` + `UAT`
- [x] Le reasoning visible est présent et cohérent dans l'UI. `TEST` + `UAT`
- [x] Le runtime n'utilise plus de fausse bulle assistant de chargement. `TEST` + `UAT`
- [x] Le composeur expose le choix modèle + niveau de réflexion. `TEST` + `UAT`
- [x] Les étapes retrieval / génération sont rendues comme runtime / tool calls lisibles. `TEST` + `UAT`
- [ ] Le shell conversationnel est aligné sur `../top-ai-ideas-fullstack` et les UX modernes type ChatGPT / Claude / Gemini. `TEST` + `UAT`
- [ ] Le chat ne dépend plus d'un parsing ad hoc dans `Chatbot.svelte`. `TEST`
- [ ] La pertinence retrieval progresse sur benchmark et en revue utilisateur. `TEST` + `UAT`
- [x] L'API TS est protégée par contrats et contrôles répétables. `TEST`
