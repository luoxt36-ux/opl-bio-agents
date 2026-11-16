# Genome Analysis initial OPL inputs

The initial OPL inputs for the final Genome Analysis Agent are:

- `genome_sequencing_analysis_scenario_domain_pack.json`: accepted genome task
  families, stages, artifacts and boundaries.
- `genome_analysis_execution_profile_registry_v3.json`: released profile
  catalog used by the profile-bound runner.
- `genome_analysis_execution_profile_decision_v3.schema.json`: decision output
  contract and truth-separation rules.
- `genome-sequencing-analysis-predict.*.schema.json`,
  `genome-sequencing-analysis-verify.*.schema.json`,
  `genome-analysis-execution-v2-*.schema.json`: task, result and verification
  contracts.
- `genome_analysis_common_tool_loop_protocol_v1.json` and
  `genome_analysis_coverage_ontology_v1.json`: public execution and domain
  coverage declarations.

The shared initial OPL declarations are in [`inputs/shared`](../../inputs/shared/).
The final source is under `source/examples/opl-bio-agent/`. This release does
not include a candidate-freeze record, development search, confirmation result,
private truth, raw genomic records or intermediate evolution material.

At runtime provide a public task manifest, compatible reference and indexed
alignment/read inputs. The model may select a released profile from visible
task semantics; local tools bind and execute it; private truth, if used by a
separate evaluator, remains outside model-visible inputs.
