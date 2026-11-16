# Analysis plan

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_analysis_plan`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Pre-register enrichment databases, thresholds, background policy, and expected artifacts before execution.

## Requires

- `data_readiness_receipt_ref`
- `normalized_genes_ref`
- `allowed_database_policy_ref`
- `benchmark_case_ref`

## Ensures

- `analysis_plan_ref`
- `tool_invocation_plan_ref`
- `expected_artifact_manifest_ref`
- `analysis_plan_receipt_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `execution`
