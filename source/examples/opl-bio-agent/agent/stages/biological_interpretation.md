# Biological interpretation

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_biological_interpretation`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Generate evidence-bound biological interpretation, claim table, caveats, and limitations.

## Requires

- `enrichment_results_ref`
- `evidence_ledger_ref`
- `experiment_context_ref`
- `claim_guard_policy_ref`

## Ensures

- `interpretation_ref`
- `claim_table_ref`
- `limitations_ref`
- `interpretation_receipt_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `review_and_red_team`
