# Data readiness

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_data_readiness`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Normalize gene identifiers, check species/background fit, and record data quality blockers.

## Requires

- `scope_ref`
- `input_gene_list_or_case_ref`
- `species_ref`
- `gene_id_type_ref`

## Ensures

- `mapping_report_ref_or_typed_blocker_ref`
- `normalized_genes_ref`
- `background_universe_policy_ref`
- `data_readiness_receipt_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `analysis_plan`
