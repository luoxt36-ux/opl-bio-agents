# Literature-Grounded Benchmark v0.1

Owner: `opl-bio-agent`
Purpose: `opl_bio_literature_benchmark_knowledge`
State: `candidate_benchmark_knowledge`
Machine boundary: human-readable benchmark summary; fixture truth lives in `runtime/fixtures/literature_benchmark_cases.json`.

The first benchmark suite fixes public literature cases before running the agent:

- `lit_ifnb_pbmc_kang_2018`: IFN-beta stimulated PBMC, expected type I interferon / ISG / antiviral response.
- `lit_sars_cov2_blanco_melo_2020`: SARS-CoV-2 host-response, expected inflammatory chemokine / cytokine response plus muted or imbalanced interferon response caveat.
- `lit_cell_cycle_whitfield_2002`: HeLa cell-cycle genes, expected cell cycle, DNA replication, mitosis / chromosome segregation.
- `lit_tgf_beta_emt_chang_2016`: TGF-beta EMT time-course, expected EMT, cell adhesion / migration, mesenchymal marker induction.
- `lit_tgf_beta_a549_gds3710`: A549 TGF-beta EMT microarray cross-platform consistency case.

Public summaries can be read by humans. Private answer keys, synonym maps, checksums, and scorer thresholds belong in benchmark artifacts and should not be used as prompt content during agent execution.
