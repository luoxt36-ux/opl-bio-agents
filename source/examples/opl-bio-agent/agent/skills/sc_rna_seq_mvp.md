# scRNA-seq MVP Skill Policy

Owner: `opl-bio-agent`
Purpose: `opl_bio_sc_rna_seq_mvp_skill_policy`
State: `candidate_skill_policy`
Machine boundary: human-readable direct-domain skill policy; command action truth lives in `contracts/action_catalog.json`.

## Direct Actions

- `sc_rna_seq_predict`: generate curated scRNA-seq benchmark predictions.
- `sc_rna_seq_benchmark_verify`: verify curated scRNA-seq benchmark predictions against domain-owned oracle targets.
- `sc_rna_seq_routine_analysis_predict`: run the expanded routine workflow and emit coverage-bound artifacts.
- `sc_rna_seq_routine_analysis_verify`: verify core-workflow coverage and explicit specialized-modality boundaries.

## Stage Use

Use this skill when the task is single-cell RNA-seq data readiness, processed gene-by-cell matrix replay, cell metadata validation, QC/normalization, gene-wise scaling, highly-variable-gene selection, PCA/UMAP, graph clustering, cell-type marker recovery, sample-aware pseudobulk differential candidates, condition response, cell-composition summaries, cell-cycle scoring, gene-set/module scoring, pathway-overlap candidates, batch diagnostics, doublet screening, trajectory readiness, evidence grounding, or benchmark verification.

## Guardrails

- The expanded v0.8 lane executes Scanpy on processed TSV, 10x Matrix Market, and H5AD inputs when the configured environment is available. It emits a 17-capability core-workflow receipt covering QC, normalization, scaling preparation, HVG, PCA/UMAP, neighbors/Leiden, markers/annotation, pseudobulk candidates, condition response, composition, cell-cycle and module scoring, plus batch/doublet/trajectory diagnostics.
- Raw FASTQ alignment and feature-barcode counting are upstream prerequisites. The Agent starts from a canonical counts matrix plus cell metadata and does not silently claim Cell Ranger, STARsolo, or equivalent raw-read processing.
- It does not claim that integration correction was executed, that heuristic doublet flags are validated, or that trajectory proxies are lineage inference. Ambient-RNA correction, RNA velocity, CNV, cell-cell communication, TCR/BCR clonotyping, spatial and multiome analysis remain explicitly unsupported until their required inputs and dedicated models are bound.
- Do not claim live GEO download, patient-level inference, clinical validity, new cell-type discovery, or biological quality verdict without separate domain-owned receipts.
- Keep oracle targets in fixtures or oracle artifacts, not in long-term prompts.
