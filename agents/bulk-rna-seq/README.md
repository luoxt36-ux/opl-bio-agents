# Bulk RNA-seq Agent

Final Agent identity: `opl_bio_bulk_rna_seq_agent`.

The Agent starts from a processed expression matrix and sample metadata. It
records data readiness, design/contrast handling, differential-expression
outputs, evidence and delivery artifacts. The public boundary demonstrated by
this release is processed-matrix analysis; raw FASTQ processing is upstream.

Run the bounded example from the repository root:

```sh
python3 tools/smoke.py --agent bulk-rna-seq --out /tmp/opl-bio-bulk-smoke-1
```

The example uses one public tutorial case and a local DESeq2 decision-bound
executor. It makes no model request and is not an evaluation of unseen data.

For a real run, use `runtime/agent_runner/bulk_rna_analysis_decision_bound_executor_v1.mjs`
with a case file and a separate decision file. The case must provide counts,
sample IDs, conditions, species, design formula and contrast. The R environment
is selected with `--rscript` or the host PATH.

The final source runner, verifier and adapter are under
`source/examples/opl-bio-agent/`. Construction declarations are under
[`inputs/bulk-rna-seq`](../../inputs/bulk-rna-seq/).

The Agent does not claim clinical validity, raw-read article-grade replay or
automatic superiority. Its scientific result boundary is owned by the domain
verifier and the supplied input/evaluation contract.
