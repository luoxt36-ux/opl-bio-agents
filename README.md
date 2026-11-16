# OPL-Bio three final Agents

This repository contains only the final source versions of the three current
OPL-Bio Agents and the declarative materials supplied to the OPL framework at
construction time. It does not contain self-evolution rounds, candidate
freezes, provider responses, intermediate run outputs, manuscript result tables
or evaluator-only truth.

| Agent | Final source | Initial OPL inputs | Runtime input |
| --- | --- | --- | --- |
| Bulk RNA-seq | `source/examples/opl-bio-agent/runtime/agent_runner/bulk_rna_seq_agent.mjs` | [inputs/bulk-rna-seq](inputs/bulk-rna-seq) | Counts matrix, sample sheet, design and contrast |
| scRNA-seq | `source/examples/opl-bio-agent/runtime/agent_runner/sc_rna_seq_agent.mjs` | [inputs/scrna-seq](inputs/scrna-seq) | Processed matrix or H5AD plus cell/sample metadata |
| Genome Analysis | `source/examples/opl-bio-agent/runtime/agent_runner/genome_analysis_agent.mjs` | [inputs/genome-analysis](inputs/genome-analysis) | Task manifest, reference and alignment/read inputs |

The authoritative three-Agent identity is [metadata/agents.json](metadata/agents.json).
Genome Variant BioBench remains historical code outside this release identity;
Scholar is an external validation module and is not included as a fourth Agent.

## Use

```sh
python3 tools/verify_release.py
python3 tools/smoke.py --agent all --out /tmp/opl-bio-agent-smoke-1
```

The smoke examples are small public or synthetic seeds. They make no model
requests and do not reproduce manuscript results. The Genome seed checks
provenance around a synthetic VCF; it does not run a real caller.

Read [docs/SETUP.md](docs/SETUP.md) for dependencies and external-input rules.
Each Agent's [README](agents) and `BUILD_INPUTS.md` explains the initial OPL
inputs and the final runtime boundary.

## Release boundary

The shared framework source under `source/src`, `source/contracts` and
`source/opl-meta-agent` is the final source snapshot used by this package.
`inputs/` is a readable projection of the original declarative construction
inputs; the same inputs remain in the final source tree where the runner needs
them. `examples/` contains one public or synthetic tutorial case per Agent.

Raw data, reference resources, model endpoints, credentials, external tools and
private scoring truth must be supplied separately. The file list and SHA-256
values are written after validation to `metadata/file-manifest.json` and
`SHA256SUMS.txt`.

Original source files retain their Apache-2.0 licensing. The upstream framework
is [gaofeng21cn/one-person-lab](https://github.com/gaofeng21cn/one-person-lab).
