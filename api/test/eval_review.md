# Retrieval Baseline Review

- Date: 2026-04-11
- Scope: mini-jeu d'eval lot 0 sur 5 cas NC
- Harness: `python api/test/run_retrieval_baseline.py`

## Summary

- `tech_hit@5`: 3 / 5
- `tech_hit@10`: 4 / 5
- `nc_hit@5`: 2 / 5
- `nc_hit@10`: 2 / 5

## Case Notes

- `NC-2024-003`
  - Le baseline lexical retrouve bien des pages `MODULE 4 AIRFRAME`, mais ne remonte pas encore les prefixes attendus `A220-300ARP` ou `Aide au traitement des Non Conformite`.
  - Cote NC, les premiers hits tombent surtout en `ATA-52`, ce qui confirme une derive de similarite sur le vocabulaire "door/frame" au lieu d'un vrai ciblage cockpit / ATA-56.

- `NC-2024-005`
  - Le corpus technique remonte partiellement des docs fuel au top 10, mais le top 5 reste bruite.
  - Le corpus NC remonte surtout `ATA-73/74`, pas `ATA-28`; ce cas montre bien qu'un matching lexical brut n'est pas suffisant pour la famille carburant.

- `NC-2024-006`
  - Cas le plus sain du jeu initial: les signaux ESD / grounding / electrical sont visibles des deux cotes.
  - Le fait que `ATA-28` apparaisse dans les 5 premiers NC est encourageant, meme si le top 3 reste melange.

- `NC-2024-004`
  - Le top technique est plausible sur le volet structure / airframe.
  - Le volet NC reste mauvais: le matching lexical tire encore trop vers `ATA-52`.

- `NC-2025-007`
  - Cas le plus propre cote porte / structure: `MODULE 4 AIRFRAME` ressort bien.
  - Les NC `ATA-52` sont visibles des le top 5.

## Conclusions

- Ce baseline lexical est suffisant comme point zero de comparaison.
- Il confirme deja deux limites qui justifient la refonte RAG:
  - forte confusion entre familles ATA proches quand le vocabulaire est generique
  - manque de ciblage sur les identifiants metier sans signal lexical / structurel mieux pilote
- Il ne faut pas interpreter ce baseline comme une mesure du RAG actuel en production.
- Il sert a conserver:
  - un mini-jeu d'eval stable
  - des attentes explicites par cas
  - un score comparatif avant / apres pour le lot 3
