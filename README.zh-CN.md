# OPL-Bio 三个最终版智能体

本仓库只包含三个当前 OPL-Bio 智能体的最终源码版本，以及最初提供给 OPL 框架的声明式构建输入。
不包含自进化轮次、候选冻结记录、模型响应、中间运行输出、文章结果表或评测真值。

| 智能体 | 最终源码 | 初始 OPL 输入 | 运行输入 |
| --- | --- | --- | --- |
| Bulk RNA-seq Agent | `source/examples/opl-bio-agent/runtime/agent_runner/bulk_rna_seq_agent.mjs` | `inputs/bulk-rna-seq/` | 表达计数矩阵、样本表、设计和比较方向 |
| scRNA-seq Agent | `source/examples/opl-bio-agent/runtime/agent_runner/sc_rna_seq_agent.mjs` | `inputs/scrna-seq/` | 处理后的矩阵或 H5AD、细胞/样本元数据 |
| Genome Analysis Agent | `source/examples/opl-bio-agent/runtime/agent_runner/genome_analysis_agent.mjs` | `inputs/genome-analysis/` | 任务清单、参考资源、比对或测序输入 |

机器身份以 [metadata/agents.json](metadata/agents.json) 为准。Genome Variant BioBench 是历史评测代码，
Scholar 是分析后的外部验证模块，二者都不计入当前三个智能体。

```sh
python3 tools/verify_release.py
python3 tools/smoke.py --agent all --out /tmp/opl-bio-agent-smoke-1
```

示例使用小型公开输入或合成输入，不调用模型，也不复现论文结果。Genome 示例只检查合成 VCF 的流程和溯源，
不执行真实变异检测。环境和外部输入规则见 [docs/SETUP.md](docs/SETUP.md)，各智能体的 `README.md` 与
`BUILD_INPUTS.md` 说明初始 OPL 输入和最终运行边界。

原始数据、参考资源、模型服务、凭据和私有评分真值需要另行配置。文件清单和 SHA-256 会写入
`metadata/file-manifest.json` 与 `SHA256SUMS.txt`。源码保留 Apache-2.0 许可。
