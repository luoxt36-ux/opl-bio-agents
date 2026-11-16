# Intake and scope

Owner: `opl-bio-agent`
Purpose: `opl_bio_stage_intake_and_scope`
State: `candidate_stage_policy`
Machine boundary: human-readable stage policy; machine stage contract lives in `contracts/stage_control_plane.json`.

## Goal

Turn the user request, species, gene identifiers, and experiment context into a non-clinical gene-set analysis scope.

## Requires

- `task_kind_ref`
- `species_ref`
- `gene_id_type_ref`
- `input_gene_list_or_case_ref`

## Ensures

- `scope_ref_or_typed_blocker_ref`
- `next_stage_recommendation_ref`
- `authority_boundary_ref`
- `non_clinical_scope_guard_ref`

## Gate

This stage closes only with a domain receipt or typed blocker. OPL provider completion, generated-surface readiness, or schema completeness cannot claim OPL-Bio quality, publication readiness, or production readiness.

## Next

- `data_readiness`
