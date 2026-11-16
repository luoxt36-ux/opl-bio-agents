# OPL-Bio Gene-Set MVP Skill Policy

Owner: `opl-bio-agent`
Purpose: `opl_bio_gene_set_mvp_skill_policy`
State: `candidate_skill_policy`
Machine boundary: human-readable skill policy; executable checks live in `runtime/authority_functions/`.

The MVP skill path covers literature-grounded gene-set interpretation only.

Required behavior:

- preserve species, gene ID type, background policy, and case id;
- normalize gene names without silently dropping unmapped genes;
- report expected pathway / term support with caveats;
- record unsupported or forbidden claims as typed blockers;
- return artifact refs, evidence refs, score refs, owner receipts, or typed blockers.

Forbidden behavior:

- no clinical diagnosis or treatment recommendation;
- no publication-ready or production-ready claim;
- no direct mutation of OPL runtime queue, attempt ledger, memory body, or artifact body;
- no use of gold private answer keys as model prompt context.
