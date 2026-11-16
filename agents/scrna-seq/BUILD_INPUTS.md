# scRNA-seq initial OPL inputs

The initial OPL inputs for the final scRNA Agent are:

- `sc_rna_seq_scenario_domain_pack.json`: accepted input lanes, task families,
  stages, tools, outputs and boundaries.
- `sc_rna_seq_routine_analysis_coverage_v1.json`: declared post-feature-matrix
  capabilities and status/boundary vocabulary.
- `sc_rna_seq_public_label_marker_skill_v1.json` and
  `sc_rna_seq_public_label_marker_support_tool_v1.json`: bounded marker-support
  and candidate-label interfaces.
- `sc-rna-seq-predict.*.schema.json` and
  `sc-rna-seq-routine-analysis-verification.output.schema.json`: input/output
  and coverage contracts.

The shared initial inputs in [`inputs/shared`](../../inputs/shared/) supply the
domain identity, compiler input, stage graph, prompts, skills, knowledge,
quality gates and receipt contracts. They are the declarations provided to the
OPL framework; no later policy proposal or evaluation round is included.

At runtime provide one accepted matrix lane, cell metadata, sample/condition
fields and the analysis goal. The supplied public seed is only a local teaching
input. Author labels, held-out scores, source-paper findings and private oracle
records are evaluator-side resources and are excluded.
