# Bulk RNA-seq initial OPL inputs

These are the declarative inputs used to define the final Bulk Agent surface.
They are kept separate from the final runner and from any later evaluation data.

- `bulk_rna_seq_scenario_domain_pack.json`: accepted task types, stages, tools,
  artifacts and scientific boundaries.
- `bulk_rna_seq_analysis_protocol_v1.json`: count scale, design, contrast,
  filtering, FDR, effect threshold and sensitivity requirements.
- `bulk_rna_seq_toolchain_profile.json`: local analysis tool bindings and
  required environment information.
- `bulk-rna-seq-predict.*.schema.json` and `bulk-rna-seq-benchmark.*.schema.json`:
  input/output contracts.
- `bulk_rna_seq_task_specific_package_v1.md` and
  `bulk_rna_seq_generalist_package_v1.md`: task-facing domain package
  descriptions supplied to the OPL domain surface.

The shared initial inputs are in [`inputs/shared`](../../inputs/shared/): domain
identity, pack compiler input, stage control plane, action catalog, quality and
receipt contracts, prompts, skills, knowledge and stage descriptions.

At runtime the minimum data contract is a compatible expression matrix, a
sample sheet containing `sample_id` and `condition`, a species, design formula
and explicit case/control contrast. Reference gene-set extraction and model
evaluation truth are separate evaluator resources and are not included here.

The final implementation is under `source/examples/opl-bio-agent/`. No OMA
proposal, evolution round, candidate freeze or provider response is an input
to this release.
