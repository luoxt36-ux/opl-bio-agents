# Delivery

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_delivery`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Assemble final report, run summary, artifact manifest, benchmark scorecard, and closeout refs.

## Requires

- `review_receipt_ref`
- `artifact_manifest_ref`
- `report_body_ref`
- `run_summary_ref`

## Ensures

- `report_ref`
- `artifact_manifest_ref`
- `benchmark_scorecard_ref`
- `domain_closeout_receipt_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- No next stage; delivery closeout returns report and artifact refs.
