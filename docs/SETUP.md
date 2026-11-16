# Setup

Run from the repository root:

```sh
python3 tools/verify_release.py
python3 tools/smoke.py --agent all --out /tmp/opl-bio-agent-smoke-1
```

The shared OPL source is under `source/`. Its framework build uses the retained
Node lockfile; OMA source requires Node.js 24.2 or newer. Biological runtime
tools are separate:

- Bulk requires R with DESeq2, clusterProfiler, org.Hs.eg.db and AnnotationDbi.
- scRNA requires Python with NumPy, pandas, SciPy, AnnData, Scanpy, h5py,
  statsmodels and the Scanpy clustering dependencies.
- Genome real analysis requires compatible local genomic tools, an indexed
  reference and the profile artifacts named by the task manifest.

Use `--rscript` and `--python` with `tools/smoke.py` to select interpreters.
The output directory must be new. Missing dependencies cause a failed check.

The `inputs/` directories are the initial OPL declarations: domain identity,
accepted input lanes, stage and quality contracts, tool policies, schemas and
boundary rules. They do not contain biological data or evaluator labels.

For a real run, provide your own data and external tools. Keep private labels,
truth variants, oracle gene sets and held-out scores out of model-visible inputs.
Record exact source and input hashes for every run. The example inputs are
bounded and do not establish manuscript reproduction, caller accuracy, clinical
validity or publication readiness.
