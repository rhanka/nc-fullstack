# API Test Baseline

Ce dossier sert de point de départ pour le lot 0.

## Contenu

- `scenarios.csv`: corpus brut fourni dans le repo.
- `build_baseline_cases.py`: normalise `scenarios.csv` en JSON exploitable.
- `baseline_cases.json`: export généré servant de jeu d'évaluation initial.
- `eval_cases.json`: attentes explicites par cas pour le baseline retrieval.
- `run_retrieval_baseline.py`: harness lexical minimal pour produire un premier `hit@k`.
- `eval_report.json`: rapport généré par le harness.
- `eval_review.md`: lecture qualitative courte des premiers résultats.
- `fixtures/`: charge utile et réponses gelées pour le contrat `/ai`.

## Objectif lot 0

1. figer le contrat actuel de `/ai`
2. sécuriser le packaging de Chroma en prod
3. disposer d'un jeu de cas minimal pour les prochains benchmarks retrieval

## Vérifications repo-locales

- `bash api/tests/run_lot0_checks.sh`
  - vérifie le contrat non-stream `/ai`
  - vérifie le contrat stream `/ai`
  - vérifie l'erreur sur `messages=[]`
  - vérifie le packaging Chroma via:
    - les copies `vectordb/` dans `api/Dockerfile`
    - la présence locale des segments vectoriels référencés par `chroma.sqlite3`
    - le fait qu'un snapshot "sqlite-only" perdrait ces segments
- `python api/test/run_retrieval_baseline.py`
  - génère `eval_report.json`
  - calcule un baseline `hit@5` / `hit@10`
  - sert de point zero avant refonte retrieval
- `python api/tests/run_l3_1_checks.py`
  - valide un index `SQLite FTS5` minimal sur corpus temporaire
  - vérifie la présence ou la génération locale des index lexicaux sur les deux corpus réels
  - exécute une requête de contrôle sur les tech docs et les non-conformités
- `python api/tests/run_l3_3_checks.py`
  - vérifie le rewrite métier léger sur un cas carburant + grounding
  - vérifie que `search.py` consomme bien les variantes de requête
- `python api/tests/run_l3_4_checks.py`
  - vérifie la working memory par session
  - vérifie que l'épisodique n'est persisté que si `validated=true`
  - vérifie la supersession simple des épisodes validés
- `python api/tests/run_l3_5_checks.py`
  - vérifie le scoring de confiance retrieval
  - vérifie le payload prudent sur cas pauvre
- `python api/test/run_rrf_eval.py`
  - compare `vector`, `rrf` et `rrf + rewrite`
  - régénère `rrf_eval_report.json`
  - s'appuie sur les embeddings/OpenAI comme le runtime réel

## Limites à ce stade

- les métriques `hit@k` / `precision@k` ne sont pas encore produites automatiquement
- le baseline sert d'abord de corpus de référence stable pour la prochaine étape d'évaluation
- le benchmark retrieval actuel reste volontairement petit et human-reviewed; il sert de garde-fou rapide, pas de vérité statistique exhaustive
