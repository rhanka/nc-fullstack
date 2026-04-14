# L3 Retrieval Review

Date: 2026-04-12

## Summary

- `vector` seul reste à `hit@5 = 0.8` sur les non-conformités.
- `rrf` seul n'améliore pas ce mini-jeu d'éval et dégrade même `hit@10` NC à `0.8`.
- `rrf + query rewrite` remonte les non-conformités à `hit@5 = 1.0` et `hit@10 = 1.0`.
- Les tech docs restent stables à `1.0`.

## Reading

- Le vrai cas bloquant était `NC-2024-006`, mélangeant réservoir / aile / grounding / ESD.
- Le canal lexical seul ne savait pas faire le pont entre ce vocabulaire et les documents `ATA-28-*`.
- Le rewrite léger ajoute ce pont via des variantes métier ciblées `ATA 28 / fuel tank / wiring / grounding`.
- Le chemin `gpt-5.4-nano` existe, mais il est borné aux requêtes carburant + électrique pour éviter des régressions sur les cas structure.

## Decision

- `L3.2` est validé comme fondation technique benchmarkée, mais le gain métier n'apparaît qu'une fois `L3.3` empilé dessus.
- `L3.3` est la couche qui convertit réellement le benchmark NC de `0.8` à `1.0` sur ce jeu de cas.
