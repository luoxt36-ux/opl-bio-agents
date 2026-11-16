# scRNA-seq Agent

Final Agent identity: `opl_bio_sc_rna_seq_agent`.

The Agent starts from a processed count matrix, a 10x feature-barcode matrix or
an H5AD object with cell and sample metadata. It covers QC, normalization,
feature selection, dimensionality reduction, clustering, marker and candidate
annotation, condition response, sample-aware pseudobulk candidates and bounded
diagnostics. Raw FASTQ processing and specialized modalities remain upstream or
outside this Agent.

Run the bounded example from the repository root:

```sh
python3 tools/smoke.py --agent scrna-seq --out /tmp/opl-bio-scrna-smoke-1
```

The example uses one public tutorial matrix and runs the packaged Scanpy lane.
It makes no model request, and its labels are tutorial inputs rather than an
independent benchmark.

The final source runner, Scanpy adapter and verifier are under
`source/examples/opl-bio-agent/`. Initial declarations are under
[`inputs/scrna-seq`](../../inputs/scrna-seq/).

The Agent does not claim universal annotation, corrected integration, validated
doublet or trajectory inference, clinical validity or article-grade reproduction.
