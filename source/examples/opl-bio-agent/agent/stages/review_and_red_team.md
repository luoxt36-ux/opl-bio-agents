# Review and red team

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_review_and_red_team`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Independently review mapping, statistics, evidence grounding, overclaim, negative controls, and benchmark rubric.

## Requires

- `all_prior_stage_receipts_ref`
- `artifact_manifest_ref`
- `benchmark_rubric_ref`
- `claim_table_ref`

## Ensures

- `review_receipt_ref`
- `critical_blockers_ref`
- `route_back_ref`
- `no_regression_evidence_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `delivery`
