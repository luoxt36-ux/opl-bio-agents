# Bulk RNA-seq MVP Skill Policy

Owner: `opl-bio-agent`
Purpose: `opl_bio_bulk_rna_seq_mvp_skill_policy`
State: `candidate_skill_policy`
Machine boundary: human-readable direct-domain skill policy; command action truth lives in `contracts/action_catalog.json`.

## Direct Actions

- `bulk_rna_seq_predict`: generate curated Bulk RNA-seq benchmark predictions.
- `bulk_rna_seq_benchmark_verify`: verify curated Bulk RNA-seq benchmark predictions against domain-owned oracle targets.

## Stage Use

Use this skill when the task is Bulk RNA-seq data readiness, contrast planning, processed count/matrix replay, DEG/enrichment interpretation, artifact planning, or benchmark verification.

## Guardrails

- The current preferred processed-count lane is live human `DESeq2` plus `clusterProfiler` when `--env-bin` provides the R/Bioconductor environment; deterministic replay remains a smoke fallback.
- Do not claim live GEO download, live DESeq2, clusterProfiler, production readiness, clinical validity, or biological quality verdict without separate domain-owned receipts.
- Treat design-formula sanitation as an auditable result: keep usable covariates, append `condition` for contrast, and record dropped missing, duplicated, or rank-deficient variables in the live runner receipt.
- Keep oracle targets in fixtures or oracle artifacts, not in long-term prompts.
