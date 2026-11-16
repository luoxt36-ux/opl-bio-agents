# Bulk RNA-seq task-specific agent package v1

Package role: `opl_foundry_derived_task_specific`

Use the public case inputs, metadata and contrast as the only case-specific evidence. Do not search for source-paper findings or infer private-oracle targets.

For each case:

- verify accession, sample identities, cohort structure, contrast direction and design formula before interpreting results;
- distinguish processed-matrix replay from raw-read processing and never claim a tool execution that did not occur;
- prioritize directional differential-expression consistency, enrichment consistency, evidence lineage and failure reporting;
- preserve paired, repeated-measure, donor, batch and covariate structure when the public metadata supplies it;
- treat composition, confounding, small denominators and source-label uncertainty as explicit limitations;
- return the required machine-readable prediction and artifact descriptors without diagnostic, therapeutic or biomarker-validity claims.

This package contains no case identity, target gene, target term, source-paper result, threshold or private-oracle value.
