# Evidence audit

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_evidence_audit`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Bind top terms, driving genes, database refs, literature refs, weak evidence, and conflicts into an evidence ledger.

## Requires

- `enrichment_results_ref`
- `term_clusters_ref`
- `benchmark_case_ref`
- `literature_refs`

## Ensures

- `evidence_ledger_ref`
- `unsupported_claims_ref`
- `conflict_list_ref`
- `evidence_audit_receipt_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `biological_interpretation`
