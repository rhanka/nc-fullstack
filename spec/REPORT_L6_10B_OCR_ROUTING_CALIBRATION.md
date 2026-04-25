# L6.10b OCR Routing Calibration

## Scope

Replay calibration for `a220_image_caption_v2` / `routing_profile_v1`. This report validates or rejects the candidate route matrix before any OCR caption cascade is implemented.

## Run

- Model replayed: `gpt-5.4-nano`
- Samples replayed: 30
- Labels: `/home/antoinefa/src/nc-fullstack/spec/L6_10B_OCR_ROUTING_CALIBRATION_LABELS.json`
- Output directory: `/home/antoinefa/src/nc-fullstack/api/data/a220-tech-docs/benchmarks/ocr-routing-calibration-2026-04-20T01-07-14-640Z`
- Decision: `accept_matrix`

## Metrics

- Total pages replayed: 30
- Routed nano: 22
- Routed gpt-5.4: 8
- False nano: 0
- False gpt-5.4: 0
- Ambiguous pages: 0
- Unlabeled pages: 0
- Estimated gpt-5.4 call ratio: 26.7%

## Samples

| Doc | Type | Route | Label | Outcome | Reasons |
| --- | --- | --- | --- | --- | --- |
| `461065572-A220-Suppliers-Quality-Requirements_page_0006.pdf` | `front_matter` | `nano` | `nano_sufficient` | `match` | non-content visual type |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0008.pdf` | `technical_table` | `nano` | `nano_sufficient` | `match` | OCR/table/photo content stays on nano unless classified as a high-value diagram |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0065.pdf` | `other` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0068.pdf` | `other` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0149.pdf` | `technical_procedure` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0154.pdf` | `technical_photo` | `nano` | `nano_sufficient` | `match` | OCR/table/photo content stays on nano unless classified as a high-value diagram |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_0922.pdf` | `cockpit_panel_or_display` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_1502.pdf` | `technical_procedure` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_1893.pdf` | `other` | `gpt-5.4` | `deep_useful_for_wiki` | `match` | unclear visual type but dense relationships and entities |
| `611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_1974.pdf` | `cockpit_panel_or_display` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `a220-300-FCOM-1-1-13_page_0410.pdf` | `cockpit_panel_or_display` | `gpt-5.4` | `deep_useful_for_wiki` | `match` | cockpit panel with high-value operational mode/state relationships |
| `a220-300-FCOM-1-1-13_page_0537.pdf` | `technical_procedure` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `a220-300-FCOM-1-1-13_page_1154.pdf` | `cockpit_panel_or_display` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `a220-300-FCOM-1-1-13_page_1279.pdf` | `cockpit_panel_or_display` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `a220-300-FCOM-1-1-13_page_1963.pdf` | `other` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `a220-300-FCOM-1-1-13_page_2393.pdf` | `cockpit_panel_or_display` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `a220-300-FCOM-2-2-13_page_0376.pdf` | `technical_table` | `nano` | `nano_sufficient` | `match` | OCR/table/photo content stays on nano unless classified as a high-value diagram |
| `A220-ACP-Issue004-00-20Jun2024_page_0132.pdf` | `simple_labeled_component_view` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `A220-ACP-Issue004-00-20Jun2024_page_0414.pdf` | `simple_labeled_component_view` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `MODULE 1 GENERAL FAMILIARIZATION_page_0411.pdf` | `cockpit_panel_or_display` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `MODULE 1 GENERAL FAMILIARIZATION_page_0851.pdf` | `system_architecture_diagram` | `gpt-5.4` | `deep_useful_for_wiki` | `match` | relationship-heavy visual type: system_architecture_diagram |
| `MODULE 3 AVIONICS_page_0057.pdf` | `cockpit_panel_or_display` | `gpt-5.4` | `deep_useful_for_wiki` | `match` | cockpit panel with high-value operational mode/state relationships |
| `MODULE 3 AVIONICS_page_0353.pdf` | `technical_procedure` | `nano` | `nano_sufficient` | `match` | nano sufficient by candidate matrix |
| `MODULE 4 AIRFRAME_page_0285.pdf` | `simple_labeled_component_view` | `gpt-5.4` | `deep_useful_for_wiki` | `match` | dense component hierarchy in labeled component view |
| `MODULE 4 AIRFRAME_page_0693.pdf` | `technical_photo` | `nano` | `nano_sufficient` | `match` | OCR/table/photo content stays on nano unless classified as a high-value diagram |
| `MODULE 5 POWER PLANT_page_0341.pdf` | `flow_diagram` | `gpt-5.4` | `deep_required` | `match` | relationship-heavy visual type: flow_diagram |
| `MODULE 5 POWER PLANT_page_1203.pdf` | `cockpit_panel_or_display` | `gpt-5.4` | `deep_useful_for_rag` | `match` | cockpit panel with high-value operational mode/state relationships |
| `MODULE 5 POWER PLANT_page_1273.pdf` | `technical_table` | `nano` | `nano_sufficient` | `match` | OCR/table/photo content stays on nano unless classified as a high-value diagram |
| `MODULE 5 POWER PLANT_page_1275.pdf` | `system_architecture_diagram` | `gpt-5.4` | `deep_required` | `match` | relationship-heavy visual type: system_architecture_diagram |
| `MODULE 5 POWER PLANT_page_1277.pdf` | `technical_table` | `nano` | `nano_sufficient` | `match` | OCR/table/photo content stays on nano unless classified as a high-value diagram |

## Confusion Examples

### False nano

- None

### False gpt-5.4

- None

### Ambiguous

- None

### Unlabeled

- None

## Gate

The candidate matrix is accepted for `L6.10d` implementation.
