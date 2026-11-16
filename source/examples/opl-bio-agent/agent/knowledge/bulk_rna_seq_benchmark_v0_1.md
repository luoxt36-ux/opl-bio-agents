# Bulk RNA-seq Benchmark v0.1

Owner: `opl-bio-agent`
Purpose: `opl_bio_bulk_rna_seq_benchmark_knowledge_v0_1`
State: `candidate_reference`
Machine boundary: human-readable benchmark summary; fixture truth lives in `runtime/fixtures/bulk_rna_seq_benchmark_cases.json`.

## Scope

Bulk RNA-seq v0.1 tests whether the agent can preserve dataset identity, sample/cohort design, contrast, expected biology, artifact plan, evidence refs, limitations, and safety boundary for three public-data replay scenarios.

The current runner can execute the curated human processed-count slices through live `DESeq2` and `clusterProfiler` when an R/Bioconductor environment is supplied with `--env-bin`. Deterministic CPM/log2FC and built-in gene-set overlap remain the smoke fallback and verifier-facing summary projection.

## Cases

| case | source | fixed replay target |
| --- | --- | --- |
| `bulk_gse147507_a549ace2_sarscov2_vs_mock` | Blanco-Melo et al., Cell 2020, `GSE147507` | A549-ACE2 SARS-CoV-2 vs mock; inflammatory chemokine/cytokine signal with interferon caveat. |
| `bulk_gse91061_melanoma_nivolumab_pre_on_response` | Riaz et al., Cell 2017, `GSE91061` | Pre/on-treatment melanoma nivolumab response replay; immune activation and paired design guard. |
| `bulk_gse135251_nafld_fibrosis_progression` | Govaere et al., Science Translational Medicine 2020, `GSE135251` | NAFLD/NASH fibrosis progression replay; ECM/fibrosis and stage-aware analysis guard. |

## Non-goals

- No FASTQ/BAM processing in v0.1.
- No live GEO matrix download claim in v0.1.
- No live DESeq2 or clusterProfiler claim without case-level `live_bioc_receipt.json`.
- No clinical diagnosis, treatment recommendation, individual response prediction, or validated biomarker claim.
