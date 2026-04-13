# SPEC_INTENT - AI Architecture Refresh

- Date: 2026-04-10
- Status: captured
- Scope: routing modèle, UX chat Svelte, RAG, projection API et gouvernance delivery

## Demande capturée

Le produit a quatre enjeux principaux:

1. Gérer explicitement le reasoning et passer vers `gpt-5.4-nano` pour les appels rapides / peu coûteux, avec promotion vers `gpt-5.4` pour les cas complexes.
2. Arrêter la croissance du code custom du chat et s'appuyer sur une base Svelte plus standard si elle préserve streaming, reasoning et rendu métier.
3. Refaire un RAG jugé peu pertinent vers une approche inspirée de LLM Wiki v2, avec recherche hybride et mémoire légère, sans empiler les dépendances.
4. Étudier une migration backend TypeScript, ou au minimum durcir l'API et les tests pour éviter les évolutions cassantes.

## Livrables attendus

- Un répertoire `spec/` avec:
  - `SPEC_INTENT_*`
  - `SPEC_EVOL_*`
- Un [`PLAN.md`](../PLAN.md) avec des lots cochables.
- Une phase de recherche par question avant l'implémentation.
- Une itération avec questions ciblées plutôt qu'un questionnaire massif.
- Des critères de recette séparant validation `AUTO`, `TEST` et `UAT`.

## Contraintes exprimées

- Limiter les nouvelles dépendances.
- Préserver Svelte côté frontend.
- Éviter les réécritures big-bang si un durcissement incrémental suffit.
- Garder la possibilité d'un cadre de conduite plus formel seulement si le workflow documentaire léger ne suffit plus.

## Non-objectifs de cette phase

- Ne pas réécrire frontend et backend en parallèle sans contrats stabilisés.
- Ne pas refaire le RAG "sur papier" sans baseline de pertinence.
- Ne pas ajouter de nouvelle couche d'abstraction si elle ne retire pas une douleur réelle du repo actuel.

## Signaux de succès

- Le choix modèle / reasoning devient explicite, centralisé et testable.
- Le chat n'est plus prisonnier d'un widget et d'un parsing SSE fragile.
- La pertinence retrieval s'améliore de manière mesurable sur des cas NC représentatifs.
- L'API devient gouvernée par des contrats et des tests avant toute migration de langage.
