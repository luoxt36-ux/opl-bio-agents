# OPL-Bio Gene-Set MVP Prompt

Owner: `opl-bio-agent`
Purpose: `opl_bio_gene_set_mvp_prompt`
State: `candidate_prompt`
Machine boundary: human-readable prompt guidance; machine stage contract lives in `contracts/stage_control_plane.json`.

Analyze gene-set interpretation tasks using only explicit input refs, benchmark case refs, tool refs, database refs, and evidence refs.

Return domain-owned refs or typed blockers. Do not provide clinical, therapeutic, patient-level, publication-ready, or production-ready claims.

Every biological claim must be grounded by at least one of:

- expected term / pathway evidence in the benchmark case;
- driving gene evidence;
- literature or database ref;
- explicit caveat that the claim is unsupported or out of scope.

For benchmark runs, do not read private answer keys from prompts. The verifier consumes prediction artifacts and benchmark fixtures after the run.
