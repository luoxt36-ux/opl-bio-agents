# Genome Analysis Agent

Final Agent identity: `opl_bio_genome_analysis_agent`.

The Agent binds a public genome-analysis task to a compatible execution profile,
records the decision and provenance, and runs the local profile-bound workflow.
The final source includes the profile registry, decision schemas, local runner
and verifier. Genome Variant BioBench is a historical comparator and is not
this Agent.

Run the bounded example from the repository root:

```sh
python3 tools/smoke.py --agent genome-analysis --out /tmp/opl-bio-genome-smoke-1
```

The example uses synthetic SAM, FASTA and candidate VCF files. It checks input
and output provenance only; it does not run a real caller or establish variant
accuracy.

For a real profile-bound run, supply a compatible public manifest, reference,
alignments or reads, profile artifacts and local toolchain. The final runner's
manifest and execution options are documented in
`source/examples/opl-bio-agent/runtime/agent_runner/genome_analysis_agent.mjs`.
Initial declarations are under [`inputs/genome-analysis`](../../inputs/genome-analysis/).
