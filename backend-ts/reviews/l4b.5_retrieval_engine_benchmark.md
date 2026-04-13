# L4B.5 Retrieval Engine Benchmark

- Generated at: 2026-04-13T00:47:41.219Z
- Scope: offline engine comparison on the repo mini-corpus
- Method: same rewritten queries and representative in-corpus vectors reused across `export_exact` and `lancedb`
- Decision: `export_exact`
- Rationale: export_exact keeps a better hit@10 total on the offline engine benchmark, so the fallback remains the default.

## Summary

- `export_exact_techDocs_hit@5`: 5/5 (1)
- `export_exact_techDocs_hit@10`: 5/5 (1)
- `export_exact_nonConformities_hit@5`: 5/5 (1)
- `export_exact_nonConformities_hit@10`: 5/5 (1)
- `lancedb_techDocs_hit@5`: 4/5 (0.8)
- `lancedb_techDocs_hit@10`: 4/5 (0.8)
- `lancedb_nonConformities_hit@5`: 5/5 (1)
- `lancedb_nonConformities_hit@10`: 5/5 (1)

## Cases

### NC-2024-003 - Pare-brise droit / rivets / desaffleurement

- Query: `pare-brise droit rivets desaffleurement flushness windshield frame structural repair`
- Tech docs: export_exact hit@10=true, lancedb hit@10=true
- Non-conformities: export_exact hit@10=true, lancedb hit@10=true
- Top tech docs: export_exact=`A220-300ARP-Issue098-00-16May2024_page_0003.pdf`, lancedb=`A220-300ARP-Issue098-00-16May2024_page_0003.pdf`
- Top NC: export_exact=`ATA-30-cf4f5f50f00f6f2-f7ac.md`, lancedb=`ATA-56-f8c9af644308786a-554d`

### NC-2024-005 - Reservoir principal aile gauche / debit faible

- Query: `fuel tank left wing low flow suction screen reservoir debit carburant`
- Tech docs: export_exact hit@10=true, lancedb hit@10=true
- Non-conformities: export_exact hit@10=true, lancedb hit@10=true
- Top tech docs: export_exact=`611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0003.pdf`, lancedb=`611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0003.pdf`
- Top NC: export_exact=`ATA-28-5015904cf182848e-bfc2`, lancedb=`ATA-28-5015904cf182848e-bfc2`

### NC-2024-006 - Decharge electrostatique / reservoir secondaire aile droite

- Query: `electrostatic discharge reservoir tank right wing grounding electrical esd`
- Tech docs: export_exact hit@10=true, lancedb hit@10=true
- Non-conformities: export_exact hit@10=true, lancedb hit@10=true
- Top tech docs: export_exact=`MODULE 4 AIRFRAME_page_0017.pdf`, lancedb=`MODULE 4 AIRFRAME_page_0017.pdf`
- Top NC: export_exact=`ATA-28-5015904cf182848e-bfc2`, lancedb=`ATA-28-5015904cf182848e-bfc2`

### NC-2024-004 - Rayure structure aluminium zone C2-2

- Query: `aluminum structure scratch zone c2-2 surface damage repair structural`
- Tech docs: export_exact hit@10=true, lancedb hit@10=true
- Non-conformities: export_exact hit@10=true, lancedb hit@10=true
- Top tech docs: export_exact=`Aide au traitement des Non Conformités - MAP_page_0001.pdf`, lancedb=`Aide au traitement des Non Conformités - MAP_page_0001.pdf`
- Top NC: export_exact=`ATA-52-c41d3405459a02e-3217.md`, lancedb=`ATA-55-22d4e37b1b7bbbc0-367c`

### NC-2025-007 - Porte avant droite / delaminage / ATA-52

- Query: `front right door delamination ATA-52 composite structure frame 20 21`
- Tech docs: export_exact hit@10=true, lancedb hit@10=false
- Non-conformities: export_exact hit@10=true, lancedb hit@10=true
- Top tech docs: export_exact=`MODULE 4 AIRFRAME_page_0003.pdf`, lancedb=`MODULE 1 GENERAL FAMILIARIZATION_page_0003.pdf`
- Top NC: export_exact=`ATA-52-04a58fc2c1f4ffbf-da7e`, lancedb=`ATA-51-03c4e3c5584aabbb06c-e212`

