# Workflow Spec

Ce dossier sert de conducteur documentaire léger pour les évolutions produit et architecture.
Le but est d'éviter d'ajouter un framework de pilotage tant qu'un workflow simple par fichiers suffit.

## Cycle

1. Capturer l'intention dans `SPEC_INTENT_YYYY-MM-DD_slug.md`.
2. Faire une phase de recherche ciblée par axe.
3. Consolider options, décisions proposées, risques et questions ouvertes dans `SPEC_EVOL_YYYY-MM-DD_slug.md`.
4. Traduire les décisions validées dans [`PLAN.md`](../PLAN.md) avec des lots cochables et des critères de recette.
5. Exécuter les lots en code en mettant à jour le plan au fil de l'avancement.

## Rôle des fichiers

- `SPEC_INTENT_*`: expression figée du besoin utilisateur au début de l'initiative.
- `SPEC_EVOL_*`: proposition d'évolution argumentée après lecture du repo et recherche externe.
- `SPEC_EVOL_*` dédiées: sous-specs techniques rattachées à la spec active principale quand un lot mérite une formalisation plus exécutable.
- `PLAN.md`: backlog d'exécution racine avec validation technique, tests et UAT.

## Tags de validation

- `AUTO`: validation Codex seule ou contrôle statique déterministe.
- `TEST`: validation par tests automatisés, benchmarks, ou evals répétables.
- `UAT`: validation utilisateur explicite dans le produit.

## Règles

- Préférer une seule paire active `SPEC_INTENT` / `SPEC_EVOL` par initiative.
- Des specs dédiées supplémentaires sont acceptables pour un sous-sujet technique précis si elles restent explicitement rattachées à la spec active principale.
- Garder les dépendances nouvelles explicites et limitées.
- Ne pas lancer de réécriture structurelle avant qu'un lot correspondant existe dans [`PLAN.md`](../PLAN.md).
- Toute évolution qui change un contrat d'API, de stream, ou d'UX doit être reflétée dans la spec active.
