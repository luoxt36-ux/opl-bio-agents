# Execution

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_execution`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Run or simulate gene-set enrichment and produce result tables, term clusters, tool logs, and artifact refs.

## Requires

- `analysis_plan_ref`
- `normalized_genes_ref`
- `background_universe_policy_ref`
- `tool_catalog_ref`

## Ensures

- `enrichment_results_ref`
- `term_clusters_ref`
- `tool_version_manifest_ref`
- `execution_receipt_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `evidence_audit`
