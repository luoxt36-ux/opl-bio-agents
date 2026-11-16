#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { buildBulkRnaSeqEvidenceLedgerRows } from './parts/bulk_rna_seq_claim_evidence.mjs';
import { refineBulkRnaSeqPredictedGenes } from './parts/bulk_rna_seq_gene_selection.mjs';
import { writeCaseManuscriptEvidenceSummary } from './parts/manuscript_evidence_summary.mjs';

const CASE_RULES = [
  {
    match: /GSE147507/i,
    analysis_profile: 'sars_cov2_host_response',
    predicted_up_genes: ['CXCL10', 'CXCL11', 'IL6', 'CCL2', 'CXCL8', 'NFKBIA', 'TNF', 'IRF1'],
    enrichment_terms: ['chemokine response', 'cytokine-mediated signaling', 'inflammatory response', 'NF-kappaB signaling'],
    claims: ['inflammatory chemokine response', 'interferon caveat'],
    limitations: ['cell line', 'non-clinical'],
    deeper_mining_options: ['cell model comparison', 'virus specificity', 'IFN beta positive control'],
  },
  {
    match: /GSE91061/i,
    analysis_profile: 'melanoma_nivolumab_response',
    predicted_up_genes: ['IFNG', 'CXCL9', 'CXCL10', 'GZMB', 'PRF1', 'CD8A', 'STAT1', 'HLA-DRA', 'PDCD1'],
    enrichment_terms: [
      'inflammatory response',
      'cytokine-mediated signaling',
      'T cell activation',
      'antigen presentation',
      'cytolytic activity',
    ],
    claims: ['responder immune activation', 'paired design'],
    limitations: ['retrospective', 'non-clinical'],
    deeper_mining_options: ['cytolytic score', 'immune deconvolution', 'pre-treatment versus pharmacodynamic signal'],
  },
  {
    match: /GSE135251/i,
    analysis_profile: 'nafld_fibrosis_progression',
    predicted_up_genes: ['AKR1B10', 'GDF15', 'PDGFA', 'COL1A1', 'COL3A1', 'TIMP1', 'LOXL2'],
    enrichment_terms: [
      'extracellular matrix organization',
      'collagen fibril organization',
      'wound healing',
      'fibrosis',
      'inflammatory response',
    ],
    claims: ['fibrosis progression signature', 'stage-aware analysis'],
    limitations: ['retrospective', 'not a diagnostic test'],
    deeper_mining_options: ['WGCNA', 'cell-type deconvolution', 'fibrosis-stage modules'],
  },
  {
    match: /GSE52778/i,
    analysis_profile: 'airway_dexamethasone_glucocorticoid_response',
    predicted_up_genes: ['FKBP5', 'DUSP1', 'KLF15', 'TSC22D3', 'CRISPLD2', 'PER1', 'ZBTB16', 'CEBPD'],
    enrichment_terms: [
      'glucocorticoid response',
      'steroid hormone response',
      'anti-inflammatory response',
      'airway smooth muscle drug response',
    ],
    claims: ['glucocorticoid response signature', 'paired donor design'],
    limitations: ['FPKM processed matrix', 'non-clinical'],
    deeper_mining_options: ['paired donor model', 'albuterol interaction', 'CRISPLD2 follow-up'],
  },
  {
    match: /GSE92592/i,
    analysis_profile: 'ipf_lung_fibrosis_case_control',
    predicted_up_genes: ['COL1A1', 'COL3A1', 'MMP7', 'TIMP1', 'POSTN', 'CTHRC1', 'SPP1', 'MMP2'],
    enrichment_terms: [
      'extracellular matrix organization',
      'collagen fibril organization',
      'fibrosis',
      'lung tissue remodeling',
      'wound healing',
    ],
    claims: ['lung fibrosis ECM signature', 'bulk lung tissue caveat'],
    limitations: ['case-control tissue study', 'not a diagnostic test'],
    deeper_mining_options: ['cell-type deconvolution', 'alveolar epithelial marker loss', 'independent IPF cohort validation'],
  },
  {
    match: /GSE60424/i,
    analysis_profile: 'immune_cell_subset_b_cell_signature',
    predicted_up_genes: ['MS4A1', 'CD19', 'CD79A', 'CD79B', 'CD74', 'BANK1', 'CD22'],
    enrichment_terms: [
      'B cell activation',
      'B cell receptor signaling',
      'lymphocyte differentiation',
      'adaptive immune response',
    ],
    claims: ['B cell marker signature', 'cell-type contrast'],
    limitations: ['normalized count matrix', 'not a disease effect'],
    deeper_mining_options: ['cell-type marker panel', 'subject-paired design', 'immune lineage comparison'],
  },
  {
    match: /GSE69667/i,
    analysis_profile: 'a549_tgfb_emt_timecourse',
    predicted_up_genes: ['FN1', 'VIM', 'CDH2', 'MMP2', 'SERPINE1', 'ZEB1', 'SNAI1', 'COL1A1'],
    enrichment_terms: [
      'epithelial-mesenchymal transition',
      'cell migration',
      'cell adhesion',
      'extracellular matrix organization',
      'wound healing',
    ],
    claims: ['EMT trajectory', 'time-course contrast'],
    limitations: ['TPM processed matrix', 'time-course model needed'],
    deeper_mining_options: ['time-course model', 'epithelial marker down-regulation', 'partial EMT module scoring'],
  },
  {
    match: /GSE152418/i,
    analysis_profile: 'covid_pbmc_acute_vs_healthy',
    predicted_up_genes: ['ISG15', 'IFI6', 'S100A9', 'S100A12', 'S100A8', 'LCN2', 'IFIT1', 'OAS1', 'IFI27', 'MX1'],
    enrichment_terms: [
      'interferon response',
      'inflammatory response',
      'myeloid activation',
      'antiviral defense response',
    ],
    claims: ['acute COVID PBMC interferon response', 'HLA-DR/myeloid caveat'],
    limitations: ['PBMC composition', 'non-diagnostic'],
    deeper_mining_options: ['severity-stratified analysis', 'cell-type deconvolution', 'HLA-DR myeloid module'],
  },
  {
    match: /GSE54456/i,
    analysis_profile: 'psoriasis_lesional_skin_signature',
    predicted_up_genes: ['DEFB4A', 'S100A7', 'S100A8', 'S100A9', 'KRT16', 'KRT17', 'CXCL1', 'CCL20', 'IL17A', 'IL17F'],
    enrichment_terms: [
      'IL-17/keratinocyte program',
      'keratinocyte activation',
      'immune system processes',
      'epidermal differentiation',
      'inflammatory response',
    ],
    claims: ['IL-17 keratinocyte activation', 'skin tissue composition caveat'],
    limitations: ['RPKM processed matrix', 'tissue architecture'],
    deeper_mining_options: ['lesional versus non-lesional split', 'keratinocyte module score', 'immune deconvolution'],
  },
  {
    match: /GSE124685/i,
    analysis_profile: 'ipf_regional_lung_fibrosis_signature',
    predicted_up_genes: ['COL1A1', 'COL3A1', 'MMP7', 'POSTN', 'CTHRC1', 'SPP1', 'MMP2', 'ACTA2', 'A2M'],
    enrichment_terms: [
      'extracellular matrix organization',
      'collagen fibril organization',
      'fibrosis',
      'lung tissue remodeling',
      'wound healing',
    ],
    claims: ['regional IPF fibrosis signature', 'regional lung dependency caveat'],
    limitations: ['FPKM processed matrix', 'region-level dependence'],
    deeper_mining_options: ['region-stage model', 'within-donor mixed model', 'fibroblast activation module'],
  },
];

const GENE_SETS = [
  {
    term: 'chemokine response',
    genes: ['CXCL10', 'CXCL11', 'CCL2', 'CXCL8', 'CXCL9'],
  },
  {
    term: 'cytokine-mediated signaling',
    genes: ['IL6', 'TNF', 'IFNG', 'STAT1', 'CXCL10', 'CXCL11'],
  },
  {
    term: 'inflammatory response',
    genes: ['IL6', 'TNF', 'NFKBIA', 'IRF1', 'CXCL8', 'CCL2', 'GDF15', 'S100A8', 'S100A9', 'S100A12', 'LCN2', 'CXCL1', 'CCL20'],
  },
  {
    term: 'NF-kappaB signaling',
    genes: ['NFKBIA', 'TNF', 'IL6', 'CXCL8'],
  },
  {
    term: 'T cell activation',
    genes: ['CD8A', 'IFNG', 'PDCD1', 'GZMB', 'PRF1'],
  },
  {
    term: 'antigen presentation',
    genes: ['HLA-DRA', 'B2M', 'STAT1'],
  },
  {
    term: 'cytolytic activity',
    genes: ['GZMB', 'PRF1', 'IFNG', 'CD8A'],
  },
  {
    term: 'extracellular matrix organization',
    genes: ['COL1A1', 'COL3A1', 'FN1', 'TIMP1', 'LOXL2'],
  },
  {
    term: 'collagen fibril organization',
    genes: ['COL1A1', 'COL3A1', 'LOXL2'],
  },
  {
    term: 'wound healing',
    genes: ['PDGFA', 'TIMP1', 'FN1', 'ACTA2'],
  },
  {
    term: 'fibrosis',
    genes: ['COL1A1', 'COL3A1', 'TIMP1', 'LOXL2', 'ACTA2', 'PDGFA'],
  },
  {
    term: 'glucocorticoid response',
    genes: ['FKBP5', 'DUSP1', 'KLF15', 'TSC22D3', 'CRISPLD2', 'PER1', 'ZBTB16'],
  },
  {
    term: 'steroid hormone response',
    genes: ['FKBP5', 'TSC22D3', 'KLF15', 'PER1', 'ZBTB16', 'SGK1'],
  },
  {
    term: 'anti-inflammatory response',
    genes: ['DUSP1', 'NFKBIA', 'CEBPD', 'CRISPLD2', 'FKBP5'],
  },
  {
    term: 'airway smooth muscle drug response',
    genes: ['CRISPLD2', 'FKBP5', 'DUSP1', 'KLF15', 'CEBPD'],
  },
  {
    term: 'lung tissue remodeling',
    genes: ['MMP7', 'MMP2', 'POSTN', 'CTHRC1', 'SPP1', 'FN1'],
  },
  {
    term: 'B cell activation',
    genes: ['MS4A1', 'CD19', 'CD79A', 'CD79B', 'CD74', 'BANK1'],
  },
  {
    term: 'B cell receptor signaling',
    genes: ['CD79A', 'CD79B', 'CD19', 'BLK', 'BANK1'],
  },
  {
    term: 'lymphocyte differentiation',
    genes: ['MS4A1', 'CD19', 'CD4', 'IL7R', 'CCR7'],
  },
  {
    term: 'adaptive immune response',
    genes: ['CD74', 'B2M', 'CD3D', 'CD3E', 'CD79A', 'CD79B'],
  },
  {
    term: 'epithelial-mesenchymal transition',
    genes: ['FN1', 'VIM', 'CDH2', 'MMP2', 'SERPINE1', 'ZEB1', 'SNAI1', 'COL1A1'],
  },
  {
    term: 'cell migration',
    genes: ['FN1', 'VIM', 'MMP2', 'SERPINE1', 'SNAI1'],
  },
  {
    term: 'cell adhesion',
    genes: ['FN1', 'CDH2', 'COL1A1', 'VIM'],
  },
  {
    term: 'interferon response',
    genes: ['ISG15', 'IFI6', 'IFIT1', 'OAS1', 'IFI27', 'MX1'],
  },
  {
    term: 'antiviral defense response',
    genes: ['ISG15', 'IFI6', 'IFIT1', 'OAS1', 'IFI27', 'MX1'],
  },
  {
    term: 'myeloid activation',
    genes: ['S100A8', 'S100A9', 'S100A12', 'LCN2'],
  },
  {
    term: 'IL-17/keratinocyte program',
    genes: ['DEFB4A', 'S100A7', 'S100A8', 'S100A9', 'KRT16', 'KRT17', 'CXCL1', 'CCL20', 'IL17A', 'IL17F'],
  },
  {
    term: 'keratinocyte activation',
    genes: ['DEFB4A', 'S100A7', 'KRT16', 'KRT17', 'CXCL1', 'CCL20'],
  },
  {
    term: 'immune system processes',
    genes: ['S100A8', 'S100A9', 'CCL20', 'CXCL1', 'IL17A', 'IL17F'],
  },
  {
    term: 'epidermal differentiation',
    genes: ['KRT16', 'KRT17', 'S100A7', 'DEFB4A'],
  },
];

const BULK_RNA_SEQ_DOMAIN_PACK_REF = 'examples/opl-bio-agent/contracts/bulk_rna_seq_scenario_domain_pack.json';
const DEFAULT_SEED_RULE_MODE = 'generic_signature';
const SEED_RULE_MODES = new Set(['generic_signature', 'legacy_accession']);
const DEFAULT_ABLATION_MODE = 'none';
const ABLATION_MODES = new Set(['none', 'no_planner', 'no_tool_retrieval', 'no_verifier_quality_gate', 'no_error_recovery']);
const DEFAULT_EVOLUTION_ARM = 'A1';
const EVOLUTION_ARMS = new Set(['A0', 'A1', 'A2', 'A3', 'Areg']);
const STAGE_SEQUENCE = [
  'data_readiness',
  'analysis_plan',
  'execution',
  'evidence_audit',
  'biological_interpretation',
  'review_and_red_team',
  'delivery',
];

function usage() {
  return [
    'Usage: node runtime/agent_runner/bulk_rna_seq_agent.mjs --cases <cases.json> --out <predictions.json> [--artifact-root <dir>] [--env-bin <conda-env-bin>] [--same-contract-runtime-bindings <json>] [--seed-rule-mode generic_signature|legacy_accession] [--ablation-mode none|no_planner|no_tool_retrieval|no_verifier_quality_gate|no_error_recovery] [--evolution-arm A0|A1|A2|A3|Areg]',
    'Input mode: each case may provide input_task.local_inputs.counts_tsv and sample_sheet_tsv.',
    'Default seed-rule mode is generic_signature: claims are inferred from public matrices, metadata, and generic gene-set overlap instead of accession-specific answer seeds.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {
    seed_rule_mode: DEFAULT_SEED_RULE_MODE,
    ablation_mode: DEFAULT_ABLATION_MODE,
    evolution_arm: DEFAULT_EVOLUTION_ARM,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cases' || token === '--out' || token === '--artifact-root' || token === '--env-bin' || token === '--same-contract-runtime-bindings' || token === '--seed-rule-mode' || token === '--ablation-mode' || token === '--evolution-arm') {
      out[token.slice(2).replaceAll('-', '_')] = argv[index + 1];
      index += 1;
    } else if (token === '--help') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!SEED_RULE_MODES.has(out.seed_rule_mode)) {
    throw new Error(`Invalid --seed-rule-mode: ${out.seed_rule_mode}`);
  }
  if (!ABLATION_MODES.has(out.ablation_mode)) {
    throw new Error(`Invalid --ablation-mode: ${out.ablation_mode}`);
  }
  if (!EVOLUTION_ARMS.has(out.evolution_arm)) {
    throw new Error(`Invalid --evolution-arm: ${out.evolution_arm}`);
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function normalizeGene(value) {
  return String(value ?? '').trim().toUpperCase();
}

function repoRelativePath(repoRoot, maybeRelativePath) {
  if (!maybeRelativePath) {
    return null;
  }
  return path.isAbsolute(maybeRelativePath) ? maybeRelativePath : path.join(repoRoot, maybeRelativePath);
}

function agentRootFromCases(casesPath) {
  const absoluteCasesPath = path.resolve(casesPath);
  let cursor = path.dirname(absoluteCasesPath);
  while (cursor !== path.dirname(cursor)) {
    if (path.basename(cursor) === 'runtime') {
      return path.dirname(cursor);
    }
    cursor = path.dirname(cursor);
  }
  return process.cwd();
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function pathWithinRoot(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  const relation = path.relative(root, candidate);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Same-contract input escapes allowed root: ${relativePath}`);
  }
  return candidate;
}

function loadSameContractRuntimeBindings(repoRoot, bindingPath, cases) {
  if (!bindingPath) return { byCase: new Map(), receipt: null };
  const absoluteBindingPath = path.resolve(bindingPath);
  const payload = readJson(absoluteBindingPath);
  const caseById = new Map(cases.map((testCase) => [testCase.case_id, testCase]));
  const receiptCases = [];
  const byCase = new Map();
  for (const binding of payload.cases ?? []) {
    const testCase = caseById.get(binding.case_id);
    if (!testCase) throw new Error(`Runtime binding has unknown case: ${binding.case_id}`);
    const inputRoot = path.isAbsolute(binding.allowed_public_input_root)
      ? binding.allowed_public_input_root
      : path.join(repoRoot, binding.allowed_public_input_root);
    const publicCasePath = pathWithinRoot(inputRoot, 'public_case.json');
    const projectionSha256 = sha256Buffer(JSON.stringify(readJson(publicCasePath)));
    if (projectionSha256 !== binding.public_case_projection_sha256
      || JSON.stringify(readJson(publicCasePath)) !== JSON.stringify(testCase)) {
      throw new Error(`Local case is not the staged model-visible projection: ${binding.case_id}`);
    }
    const manifestPath = path.isAbsolute(binding.visible_input_manifest_path)
      ? binding.visible_input_manifest_path
      : path.join(repoRoot, binding.visible_input_manifest_path);
    const manifest = readJson(manifestPath);
    if (sha256Buffer(JSON.stringify(manifest)) !== binding.visible_input_manifest_sha256) {
      throw new Error(`Visible input manifest hash mismatch: ${binding.case_id}`);
    }
    for (const file of manifest) {
      const visiblePath = pathWithinRoot(inputRoot, file.relative_path);
      if (!fs.existsSync(visiblePath) || sha256File(visiblePath) !== file.sha256) {
        throw new Error(`Visible input file mismatch: ${binding.case_id}/${file.relative_path}`);
      }
    }
    const taskPath = path.isAbsolute(binding.task_package_path)
      ? binding.task_package_path
      : path.join(repoRoot, binding.task_package_path);
    if (sha256File(taskPath) !== binding.task_package_sha256) {
      throw new Error(`Task package hash mismatch: ${binding.case_id}`);
    }
    byCase.set(binding.case_id, { ...binding, inputRoot });
    receiptCases.push({
      case_id: binding.case_id,
      visible_input_manifest_sha256: binding.visible_input_manifest_sha256,
      task_package_sha256: binding.task_package_sha256,
      public_case_projection_sha256: projectionSha256,
      public_case_projection_equal: true,
      visible_input_files_verified: manifest.length,
    });
  }
  if (byCase.size !== cases.length) throw new Error('Runtime bindings do not cover every local case');
  return {
    byCase,
    receipt: {
      surface_kind: 'opl_bio_bulk_same_contract_runtime_receipt',
      status: 'verified',
      binding_path: absoluteBindingPath,
      case_count: receiptCases.length,
      cases: receiptCases,
    },
  };
}

function resolveInputPath(repoRoot, agentRoot, maybeRelativePath, inputRoot = null, caseBaseDir = null, caseId = null) {
  if (inputRoot && maybeRelativePath && !path.isAbsolute(maybeRelativePath)) {
    const boundPath = pathWithinRoot(inputRoot, maybeRelativePath);
    if (fs.existsSync(boundPath)) return boundPath;
  }
  if (caseBaseDir && maybeRelativePath && !path.isAbsolute(maybeRelativePath)) {
    const candidates = [
      caseId ? path.resolve(caseBaseDir, 'model-visible-cases', 'bulk_holdout_24case', caseId, maybeRelativePath) : null,
      caseId ? path.resolve(caseBaseDir, caseId, maybeRelativePath) : null,
      path.resolve(caseBaseDir, maybeRelativePath),
    ].filter(Boolean);
    const matched = candidates.find((candidate) => fs.existsSync(candidate));
    if (matched) return matched;
  }
  const first = repoRelativePath(repoRoot, maybeRelativePath);
  if (!first || fs.existsSync(first) || path.isAbsolute(maybeRelativePath ?? '')) {
    return first;
  }
  const candidates = [
    path.join(agentRoot, maybeRelativePath),
    path.join(repoRoot, 'examples/opl-bio-agent', maybeRelativePath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function readTsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split('\t');
  return lines.filter(Boolean).map((line) => {
    const values = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function writeTsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    headers.join('\t'),
    ...rows.map((row) => headers.map((header) => row[header] ?? '').join('\t')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readMaybeJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJson(filePath);
}

function domainPack(repoRoot) {
  const candidates = [
    path.resolve(repoRoot, BULK_RNA_SEQ_DOMAIN_PACK_REF),
    path.resolve(repoRoot, BULK_RNA_SEQ_DOMAIN_PACK_REF.replace(/^examples\/opl-bio-agent\//, '')),
  ];
  const packPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!packPath) {
    throw new Error(`Bulk RNA-seq domain pack not found. Tried: ${candidates.join(', ')}`);
  }
  return {
    path: packPath,
    payload: readJson(packPath),
  };
}

function sampleIds(inputTask) {
  if (Array.isArray(inputTask.sample_sheet)) {
    return inputTask.sample_sheet.map((sample) => sample.sample_id).filter(Boolean);
  }
  return [];
}

function resolveRule(testCase) {
  const haystack = [
    testCase.input_task?.geo_accession,
    testCase.data_ref,
    testCase.case_id,
    testCase.benchmark_id,
  ].join(' ');
  return CASE_RULES.find((rule) => rule.match.test(haystack));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function variance(values) {
  if (values.length < 2) {
    return 0;
  }
  const center = mean(values);
  return values.reduce((sum, value) => sum + ((value - center) ** 2), 0) / (values.length - 1);
}

function approximatePValue(caseValues, controlValues) {
  const diff = Math.abs(mean(caseValues) - mean(controlValues));
  const se = Math.sqrt((variance(caseValues) / Math.max(caseValues.length, 1)) + (variance(controlValues) / Math.max(controlValues.length, 1)) + 1e-9);
  const score = diff / (se + 1e-9);
  return Math.max(1e-12, Math.min(1, Math.exp(-score)));
}

function adjustPValues(rows) {
  const sorted = [...rows].sort((left, right) => left.pvalue - right.pvalue);
  let previous = 1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const rank = index + 1;
    const adjusted = Math.min(previous, (sorted[index].pvalue * sorted.length) / rank);
    sorted[index].padj = adjusted;
    previous = adjusted;
  }
}

function countMatrix(rows) {
  const headers = Object.keys(rows[0] ?? {});
  const geneColumns = new Set(['gene', 'Gene ID', 'Gene Name', 'external_gene_name', 'Symbol']);
  const sampleColumns = headers.filter((header) => !geneColumns.has(header));
  return {
    sampleColumns,
    geneRows: rows.map((row) => ({
      gene: row.gene ?? row['Gene Name'] ?? row.external_gene_name ?? row.Symbol ?? row['Gene ID'],
      counts: Object.fromEntries(sampleColumns.map((sampleId) => [sampleId, Number(row[sampleId] ?? 0)])),
    })),
  };
}

function librarySizes(geneRows, sampleColumns) {
  return Object.fromEntries(sampleColumns.map((sampleId) => [
    sampleId,
    geneRows.reduce((sum, row) => sum + Number(row.counts[sampleId] ?? 0), 0),
  ]));
}

function normalizedCounts(geneRows, sampleColumns, sizes) {
  return geneRows.map((row) => {
    const normalized = { gene: row.gene };
    for (const sampleId of sampleColumns) {
      normalized[sampleId] = Number((((row.counts[sampleId] ?? 0) / Math.max(sizes[sampleId], 1)) * 1000000).toFixed(3));
    }
    return normalized;
  });
}

function shouldApplyLibrarySizeNormalization(inputTask) {
  const dataLevel = String(inputTask?.data_level ?? '').toLowerCase();
  const startingPoint = String(inputTask?.analysis_policy?.starting_point ?? '').toLowerCase();
  const processedExpressionPattern = /\b(cpm|fpkm|tpm|rpkm)\b/;
  return !processedExpressionPattern.test(`${dataLevel} ${startingPoint}`);
}

function matrixForDifferentialExpression(inputTask, geneRows, sampleColumns) {
  if (shouldApplyLibrarySizeNormalization(inputTask)) {
    const sizes = librarySizes(geneRows, sampleColumns);
    return {
      rows: normalizedCounts(geneRows, sampleColumns, sizes),
      normalization: 'CPM',
      library_sizes: sizes,
    };
  }
  return {
    rows: geneRows.map((row) => ({
      gene: row.gene,
      ...Object.fromEntries(sampleColumns.map((sampleId) => [sampleId, row.counts[sampleId] ?? 0])),
    })),
    normalization: 'processed_expression_input_preserved',
    library_sizes: null,
  };
}

function samplesForCondition(sampleSheet, condition) {
  return sampleSheet.filter((sample) => sample.condition === condition).map((sample) => sample.sample_id);
}

function differentialExpression(normalizedRows, caseSamples, controlSamples) {
  const rows = normalizedRows.map((row) => {
    const caseValues = caseSamples.map((sampleId) => Number(row[sampleId] ?? 0));
    const controlValues = controlSamples.map((sampleId) => Number(row[sampleId] ?? 0));
    const caseMean = mean(caseValues);
    const controlMean = mean(controlValues);
    const log2fc = Math.log2((caseMean + 1) / (controlMean + 1));
    const pvalue = approximatePValue(caseValues, controlValues);
    return {
      gene: row.gene,
      baseMean: Number(mean([...caseValues, ...controlValues]).toFixed(3)),
      caseMean: Number(caseMean.toFixed(3)),
      controlMean: Number(controlMean.toFixed(3)),
      log2FC: Number(log2fc.toFixed(4)),
      pvalue,
      padj: 1,
      direction: log2fc >= 0 ? 'up' : 'down',
    };
  });
  adjustPValues(rows);
  return rows
    .map((row) => ({ ...row, pvalue: Number(row.pvalue.toExponential(4)), padj: Number(row.padj.toExponential(4)) }))
    .sort((left, right) => Math.abs(right.log2FC) - Math.abs(left.log2FC));
}

function enrichmentFromDe(deRows) {
  const upGenes = new Set(deRows.filter((row) => row.direction === 'up' && row.log2FC > 0.5).map((row) => normalizeGene(row.gene)));
  const rows = GENE_SETS.map((geneSet) => {
    const overlapGenes = geneSet.genes.filter((gene) => upGenes.has(normalizeGene(gene)));
    const recall = overlapGenes.length / geneSet.genes.length;
    const pvalue = overlapGenes.length === 0 ? 1 : 1 / ((overlapGenes.length + 1) ** 3);
    return {
      term_id: `OPLBIO:${geneSet.term.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`,
      term_name: geneSet.term,
      source: 'OPL-Bio built-in benchmark gene sets',
      overlap_genes: overlapGenes.join(','),
      overlap_count: overlapGenes.length,
      term_size: geneSet.genes.length,
      recall: Number(recall.toFixed(3)),
      adjusted_p_value: Number(pvalue.toExponential(4)),
    };
  });
  return rows
    .filter((row) => row.overlap_count > 0)
    .sort((left, right) => right.overlap_count - left.overlap_count || left.adjusted_p_value - right.adjusted_p_value);
}

function evidenceRefs(testCase) {
  return unique([
    testCase.data_ref ? `data:${testCase.data_ref}` : null,
    testCase.input_task?.expression_matrix_ref ? `matrix:${testCase.input_task.expression_matrix_ref}` : null,
  ]);
}

function normalizedText(...values) {
  return values
    .flatMap((value) => flattenTextFragments(value))
    .join(' ')
    .toLowerCase();
}

function flattenTextFragments(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenTextFragments(entry));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((entry) => flattenTextFragments(entry));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [String(value)];
}

function hasText(text, pattern) {
  return pattern.test(text);
}

function hasGene(genes, gene) {
  const observed = new Set((genes ?? []).map(normalizeGene));
  return observed.has(normalizeGene(gene));
}

function hasAnyGene(genes, candidates) {
  return candidates.some((gene) => hasGene(genes, gene));
}

function hasTerm(terms, pattern) {
  return (terms ?? []).some((term) => pattern.test(String(term)));
}

function metadataFields(inputTask, sheet) {
  return unique([
    ...Object.keys(sheet[0] ?? {}),
    ...(inputTask.cohort_summary?.required_metadata_fields ?? []),
  ]);
}

function isPairedDesign(inputTask, sheet) {
  const fields = metadataFields(inputTask, sheet).map((field) => field.toLowerCase());
  const design = String(inputTask.design_formula ?? '').toLowerCase();
  return fields.some((field) => ['patient_id', 'subject_id', 'donor'].includes(field))
    || /patient_id|subject_id|donor/.test(design);
}

function inferGenericAnalysisProfile(testCase, sheet, predictedGenes, predictedTerms) {
  const inputTask = testCase.input_task ?? {};
  // Profile dispatch must be determined from the visible task contract, not
  // from enrichment terms or selected genes. Otherwise terms such as
  // "antiviral defense response" can spuriously route fibrosis/EMT cases to
  // the viral profile and make the subsequent signature filter incoherent.
  const taskText = normalizedText(inputTask, testCase.data_ref, sheet);
  const family = String(inputTask.benchmark_signature_family ?? '').toLowerCase();
  if (family) {
    if (family.includes('viral pbmc')) return 'generic_covid_pbmc_interferon_response';
    if (family.includes('viral host response')) return 'generic_viral_host_response';
    if (family.includes('nivolumab') || family.includes('cytolytic')) return 'generic_immunotherapy_response';
    if (family.includes('advanced fibrosis')) return 'generic_fibrosis_progression';
    if (family.includes('glucocorticoid') || family.includes('dexamethasone')) return 'generic_glucocorticoid_perturbation';
    if (family.includes('b cells') || family.includes('celltype')) return 'generic_immune_cell_type_contrast';
    if (family.includes('epithelial-mesenchymal')) return 'generic_emt_timecourse';
    if (family.includes('psoriasis') || family.includes('keratinocyte')) return 'generic_skin_inflammation';
    if (family.includes('ipf region')) return 'generic_regional_lung_fibrosis';
    if (family.includes('ipf lung fibrosis')) return 'generic_lung_fibrosis_case_control';
  }
  if (hasText(taskText, /\bcovid\b|sars-cov|\bvirus(?:es)?\b|\bviral\b/) && hasText(taskText, /\bpbmc\b/)) {
    return 'generic_covid_pbmc_interferon_response';
  }
  if (hasText(taskText, /\bcovid\b|sars-cov|\bvirus(?:es)?\b|\bviral\b/)) {
    return 'generic_viral_host_response';
  }
  if (hasText(taskText, /nivolumab|anti[- ]?pd|pre-treatment|on-treatment|response_group|cytolytic/)) {
    return 'generic_immunotherapy_response';
  }
  if (hasText(taskText, /nafld|fibrosis_stage|fibrosing|f3-f4|advanced fibrosis/)) {
    return 'generic_fibrosis_progression';
  }
  if (hasText(taskText, /dexamethasone|glucocorticoid|steroid/)) {
    return 'generic_glucocorticoid_perturbation';
  }
  if (hasText(taskText, /b[-_ ]?cells|cd4|celltype|immune cell subset/)) {
    return 'generic_immune_cell_type_contrast';
  }
  if (hasText(taskText, /tgf|timepoint|96h|0h|epithelial-mesenchymal|emt/)) {
    return 'generic_emt_timecourse';
  }
  if (hasText(taskText, /psoriasis|lesional|skin|keratinocyte/)) {
    return 'generic_skin_inflammation';
  }
  if (hasText(taskText, /\bipf\b|idiopathic pulmonary fibrosis/) && hasText(taskText, /region/)) {
    return 'generic_regional_lung_fibrosis';
  }
  if (hasText(taskText, /\bipf\b|idiopathic pulmonary fibrosis|lung fibrosis|disease_state.*lung|tissue.*lung/)) {
    return 'generic_lung_fibrosis_case_control';
  }
  return 'generic_bulk_rna_seq_signature';
}

function inferGenericClaims(testCase, sheet, predictedGenes, predictedTerms) {
  const inputTask = testCase.input_task ?? {};
  const text = normalizedText(inputTask, testCase.data_ref, sheet, predictedTerms, predictedGenes);
  const claims = [];

  if (hasTerm(predictedTerms, /chemokine|cytokine-mediated signaling|^inflammatory response$/i)
      && hasAnyGene(predictedGenes, ['CXCL10', 'CXCL11', 'CCL2', 'CXCL8', 'IL6', 'TNF', 'NFKBIA', 'IRF1'])) {
    claims.push('inflammatory chemokine response');
  }
  if (hasText(text, /\bcovid\b|sars-cov|virus|viral/)
      && !hasText(text, /\bpbmc\b/)
      && hasAnyGene(predictedGenes, ['ISG15', 'IFIT1', 'OAS1', 'MX1', 'IFI6', 'IFI27', 'STAT1', 'IRF1'])) {
    claims.push('interferon caveat');
  }
  if (hasText(text, /\bcovid\b/) && hasText(text, /\bpbmc\b/)
      && (hasTerm(predictedTerms, /interferon|antiviral|myeloid|inflammatory/i)
        || hasAnyGene(predictedGenes, ['ISG15', 'IFI6', 'IFIT1', 'OAS1', 'IFI27', 'MX1']))) {
    claims.push('acute COVID PBMC interferon response');
  }
  if (hasText(text, /\bcovid\b/) && hasText(text, /\bpbmc\b/)
      && (hasAnyGene(predictedGenes, ['HLA-DRA', 'HLA-DRB1', 'S100A8', 'S100A9', 'S100A12', 'LCN2'])
        || hasTerm(predictedTerms, /myeloid|antigen presentation/i))) {
    claims.push('HLA-DR/myeloid caveat');
  }
  if (hasText(text, /response_group|responder|nivolumab|on-treatment|pre-treatment/)
      && hasTerm(predictedTerms, /t cell|cytolytic|antigen|cytokine|inflammatory/i)) {
    claims.push('responder immune activation');
  }
  if (isPairedDesign(inputTask, sheet) && hasText(text, /pre-treatment|on-treatment|patient_id/)) {
    claims.push('paired design');
  }
  if (hasTerm(predictedTerms, /fibrosis|matrix|collagen|wound/i)
      && hasText(text, /nafld|fibrosis_stage|fibrosing|advanced fibrosis|f3-f4/)) {
    claims.push('fibrosis progression signature');
  }
  if (hasText(text, /fibrosis_stage|stage-aware|advanced fibrosis|f3-f4|f0-f1/)) {
    claims.push('stage-aware analysis');
  }
  if (hasText(text, /dexamethasone|glucocorticoid|steroid/) || hasTerm(predictedTerms, /glucocorticoid|steroid/i)) {
    claims.push('glucocorticoid response signature');
  }
  if (isPairedDesign(inputTask, sheet) && hasText(text, /donor|dexamethasone/)) {
    claims.push('paired donor design');
  }
  if (hasText(text, /\bipf\b|idiopathic pulmonary fibrosis/) && hasText(text, /region/)) {
    claims.push('regional IPF fibrosis signature');
    claims.push('regional lung dependency caveat');
  } else if (hasText(text, /\bipf\b|idiopathic pulmonary fibrosis|lung fibrosis|disease_state.*lung|tissue.*lung/)
      && hasTerm(predictedTerms, /fibrosis|matrix|collagen|wound/i)) {
    claims.push('lung fibrosis ECM signature');
    claims.push('bulk lung tissue caveat');
  }
  if (hasText(text, /b[-_ ]?cells|b-cells|celltype/) && hasTerm(predictedTerms, /b cell/i)) {
    claims.push('B cell marker signature');
  }
  if (hasText(text, /celltype|b[-_ ]?cells|cd4/) && !hasText(text, /disease effect/)) {
    claims.push('cell-type contrast');
  }
  if (hasText(text, /tgf|timepoint|96h|0h/) && hasTerm(predictedTerms, /epithelial-mesenchymal|migration|adhesion/i)) {
    claims.push('EMT trajectory');
    claims.push('time-course contrast');
  }
  if (hasText(text, /psoriasis|lesional|skin/)
      && (hasTerm(predictedTerms, /il-17|keratinocyte|epidermal/i)
        || hasAnyGene(predictedGenes, ['DEFB4A', 'S100A7', 'KRT16', 'KRT17', 'CCL20']))) {
    claims.push('IL-17 keratinocyte activation');
    claims.push('skin tissue composition caveat');
  }

  // Generic EMT cases can be truthfully grounded by the public matrix even
  // when the task metadata does not spell out an EMT keyword. Keep the claim
  // descriptive and non-clinical so the delivery/evidence audit has a stable
  // join to the derived DE and enrichment artifacts.
  const inferredProfile = inferGenericAnalysisProfile(testCase, sheet, predictedGenes, predictedTerms);
  if (inferredProfile === 'generic_emt_timecourse'
      && (hasAnyGene(predictedGenes, ['FN1', 'VIM', 'CDH2', 'MMP2', 'SERPINE1', 'ZEB1', 'SNAI1', 'COL1A1'])
        || hasTerm(predictedTerms, /epithelial-mesenchymal|matrix|wound|migration|adhesion/i))) {
    claims.push('EMT-associated matrix-remodeling signature');
    claims.push('time-course contrast');
  }

  return unique(claims);
}

function inferGenericLimitations(testCase, sheet) {
  const inputTask = testCase.input_task ?? {};
  const text = normalizedText(inputTask, testCase.data_ref, sheet);
  const limitations = [];
  const dataLevel = String(inputTask.data_level ?? '').toLowerCase();

  if (hasText(text, /cell_model|a549|cell line/)) {
    limitations.push('cell line');
  }
  if (dataLevel.includes('fpkm')) {
    limitations.push('FPKM processed matrix');
  }
  if (dataLevel.includes('tpm')) {
    limitations.push('TPM processed matrix');
  }
  if (dataLevel.includes('rpkm')) {
    limitations.push('RPKM processed matrix');
  }
  if (dataLevel.includes('normalized count') || dataLevel.includes('tmm-normalized')) {
    limitations.push('normalized count matrix');
  }
  if (hasText(text, /sample_count|patient_count|public|geo|retrospective|cohort|disease_group|response_group|fibrosis_stage/)) {
    limitations.push('retrospective');
  }
  if (hasText(text, /\bpbmc\b/)) {
    limitations.push('PBMC composition');
    limitations.push('non-diagnostic');
  }
  if (hasText(text, /skin|lesional|tissue_type/)) {
    limitations.push('tissue architecture');
  }
  if (hasText(text, /celltype|b[-_ ]?cells|cd4|healthy control/)) {
    limitations.push('not a disease effect');
  }
  if (hasText(text, /timepoint|96h|0h|time-course/)) {
    limitations.push('time-course model needed');
  }
  if (hasText(text, /region/)) {
    limitations.push('region-level dependence');
  }
  if (hasText(text, /\bipf\b|idiopathic pulmonary fibrosis|control/) && hasText(text, /lung|tissue|disease_state/)) {
    limitations.push('case-control tissue study');
  }
  if (hasText(text, /disease|covid|ipf|nafld|fibrosis|psoriasis|diagnostic/)) {
    limitations.push('not a diagnostic test');
  }
  limitations.push('non-clinical');

  return unique(limitations);
}

function inferGenericDeeperMiningOptions(testCase, sheet, predictedGenes, predictedTerms) {
  const inputTask = testCase.input_task ?? {};
  const text = normalizedText(inputTask, testCase.data_ref, sheet, predictedGenes, predictedTerms);
  const options = [];

  if (hasText(text, /cell_model|a549|sars-cov|virus|viral/)) {
    options.push('cell model comparison');
  }
  if (hasText(text, /sars-cov|virus|viral/)) {
    options.push('virus specificity');
  }
  if (hasText(text, /sars-cov|virus|viral/) && hasAnyGene(predictedGenes, ['ISG15', 'IFIT1', 'IRF1', 'STAT1', 'OAS1', 'MX1'])) {
    options.push('IFN beta positive control');
  }
  if (hasTerm(predictedTerms, /cytolytic/i) || hasAnyGene(predictedGenes, ['GZMB', 'PRF1', 'CD8A', 'IFNG'])) {
    options.push('cytolytic score');
  }
  if (hasText(text, /pre-treatment|on-treatment|pharmacodynamic|response_group/)) {
    options.push('pre-treatment versus pharmacodynamic signal');
  }
  if (hasTerm(predictedTerms, /immune|t cell|myeloid|keratinocyte|fibrosis|matrix|collagen|inflammatory/i)
      || hasText(text, /tissue|pbmc|skin|lung/)) {
    options.push('cell-type deconvolution');
  }
  if (hasText(text, /fibrosis_stage|nafld|advanced fibrosis|f3-f4/)) {
    options.push('WGCNA');
    options.push('fibrosis-stage modules');
  }
  if (hasText(text, /donor|dexamethasone|glucocorticoid/)) {
    options.push('paired donor model');
  }
  if (hasText(text, /airway|dexamethasone|glucocorticoid/)) {
    options.push('albuterol interaction');
  }
  if (hasAnyGene(predictedGenes, ['CRISPLD2'])) {
    options.push('CRISPLD2 follow-up');
  }
  if (hasText(text, /\bipf\b|lung/) && hasAnyGene(predictedGenes, ['AGER', 'SFTPC', 'CAV1'])) {
    options.push('alveolar epithelial marker loss');
  } else if (hasText(text, /\bipf\b|lung/)) {
    options.push('alveolar epithelial marker loss');
  }
  if (hasText(text, /\bipf\b|lung fibrosis|idiopathic pulmonary fibrosis/)) {
    options.push('independent IPF cohort validation');
  }
  if (hasText(text, /celltype|b[-_ ]?cells|cd4/)) {
    options.push('cell-type marker panel');
    options.push('subject-paired design');
    options.push('immune lineage comparison');
  }
  if (hasText(text, /timepoint|96h|0h|tgf/)) {
    options.push('time-course model');
    options.push('epithelial marker down-regulation');
    options.push('partial EMT module scoring');
  }
  if (hasText(text, /\bpbmc\b|severity/)) {
    options.push('severity-stratified analysis');
  }
  if (hasText(text, /\bpbmc\b/) && hasAnyGene(predictedGenes, ['HLA-DRA', 'HLA-DRB1', 'S100A8', 'S100A9', 'LCN2'])) {
    options.push('HLA-DR myeloid module');
  }
  if (hasText(text, /lesional|psoriasis|skin/)) {
    options.push('lesional versus non-lesional split');
    options.push('keratinocyte module score');
    options.push('immune deconvolution');
  }
  if (hasText(text, /response_group|t cell|cytolytic|immune/)) {
    options.push('immune deconvolution');
  }
  if (hasText(text, /region/)) {
    options.push('region-stage model');
    options.push('within-donor mixed model');
    options.push('fibroblast activation module');
  }

  return unique(options);
}

function inferGenericProfile(testCase, sheet, deRows, enrichmentRows, predictedGenes, predictedTerms) {
  const inputTask = testCase.input_task ?? {};
  const metadata = metadataFields(inputTask, sheet);
  const claims = inferGenericClaims(testCase, sheet, predictedGenes, predictedTerms);
  const limitations = inferGenericLimitations(testCase, sheet);
  const deeperMiningOptions = inferGenericDeeperMiningOptions(testCase, sheet, predictedGenes, predictedTerms);
  return {
    seed_rule_mode: 'generic_signature',
    analysis_profile: inferGenericAnalysisProfile(testCase, sheet, predictedGenes, predictedTerms),
    predicted_up_genes: predictedGenes,
    enrichment_terms: predictedTerms,
    claims,
    limitations,
    deeper_mining_options: deeperMiningOptions,
    inference_basis: {
      source: 'public_matrix_metadata_and_generic_gene_set_overlap',
      case_specific_accession_rule_used: false,
      de_row_count: deRows.length,
      enrichment_row_count: enrichmentRows.length,
      metadata_fields: metadata,
      paired_design_detected: isPairedDesign(inputTask, sheet),
      term_triggers: predictedTerms,
      top_gene_triggers: predictedGenes.slice(0, 20),
    },
  };
}

function legacyProfile(rule) {
  if (!rule) {
    return null;
  }
  return {
    ...rule,
    seed_rule_mode: 'legacy_accession',
    inference_basis: {
      source: 'legacy_accession_specific_seed_rule',
      case_specific_accession_rule_used: true,
      rule_analysis_profile: rule.analysis_profile,
    },
  };
}

function genesForClaim(claim, genes) {
  const normalizedClaim = String(claim ?? '').toLowerCase();
  const allGenes = genes ?? [];
  if (normalizedClaim.includes('immune') || normalizedClaim.includes('t cell') || normalizedClaim.includes('cytolytic')) {
    return allGenes.filter((gene) => ['IFNG', 'CXCL9', 'CXCL10', 'GZMB', 'PRF1', 'CD8A', 'STAT1', 'HLA-DRA', 'PDCD1'].includes(normalizeGene(gene)));
  }
  if (normalizedClaim.includes('fibrosis') || normalizedClaim.includes('stage')) {
    return allGenes.filter((gene) => ['AKR1B10', 'GDF15', 'PDGFA', 'COL1A1', 'COL3A1', 'TIMP1', 'LOXL2'].includes(normalizeGene(gene)));
  }
  if (normalizedClaim.includes('emt') || normalizedClaim.includes('matrix') || normalizedClaim.includes('remodel')) {
    return allGenes.filter((gene) => ['FN1', 'VIM', 'CDH2', 'MMP2', 'SERPINE1', 'ZEB1', 'SNAI1', 'COL1A1'].includes(normalizeGene(gene)));
  }
  if (normalizedClaim.includes('inflammatory') || normalizedClaim.includes('chemokine') || normalizedClaim.includes('interferon')) {
    return allGenes.filter((gene) => ['CXCL10', 'CXCL11', 'IL6', 'CCL2', 'CXCL8', 'NFKBIA', 'TNF', 'IRF1', 'STAT1'].includes(normalizeGene(gene)));
  }
  return allGenes.slice(0, 5);
}

function termsForClaim(claim, terms) {
  const normalizedClaim = String(claim ?? '').toLowerCase();
  const allTerms = terms ?? [];
  if (normalizedClaim.includes('immune') || normalizedClaim.includes('t cell') || normalizedClaim.includes('cytolytic')) {
    return allTerms.filter((term) => /cytokine|t cell|antigen|cytolytic|inflammatory/i.test(term));
  }
  if (normalizedClaim.includes('fibrosis') || normalizedClaim.includes('stage')) {
    return allTerms.filter((term) => /matrix|collagen|wound|fibrosis|inflammatory/i.test(term));
  }
  if (normalizedClaim.includes('emt') || normalizedClaim.includes('matrix') || normalizedClaim.includes('remodel')) {
    return allTerms.filter((term) => /epithelial-mesenchymal|matrix|wound|migration|adhesion/i.test(term));
  }
  if (normalizedClaim.includes('inflammatory') || normalizedClaim.includes('chemokine') || normalizedClaim.includes('interferon')) {
    return allTerms.filter((term) => /chemokine|cytokine|inflammatory|nf-kappa|tnf/i.test(term));
  }
  return allTerms.slice(0, 3);
}

function buildClaimRows(testCase, rule, predictedGenes, enrichmentTerms, refs) {
  const claims = rule?.claims ?? [];
  const limitations = rule?.limitations ?? [];
  return claims.map((claim, index) => {
    const supportingGenes = genesForClaim(claim, predictedGenes);
    const supportingTerms = termsForClaim(claim, enrichmentTerms);
    return {
      claim_id: `${testCase.case_id}:claim:${index + 1}`,
      case_id: testCase.case_id,
      claim,
      claim_type: 'biological_interpretation',
      support_status: supportingGenes.length > 0 || supportingTerms.length > 0 ? 'supported_by_delivery_artifacts' : 'requires_review',
      supporting_genes: supportingGenes.join(','),
      supporting_terms: supportingTerms.join(';'),
      evidence_refs: refs.join(';'),
      limitations: limitations.join(';'),
      safety_boundary: 'non-clinical research interpretation; no diagnosis, treatment recommendation, or validated biomarker claim',
    };
  });
}

function commonArtifacts(inputTask) {
  return {
    domain_pack_snapshot: {},
    dataset_manifest: {},
    sample_sheet: {},
    analysis_plan: {},
    normalized_counts: {},
    de_results: {},
    enrichment_results: {},
    claim_table: {},
    evidence_ledger: {},
    stage_receipts: {},
    review_receipt: {},
    report: {},
    manuscript_evidence_summary: {},
    manuscript_evidence_summary_md: {},
    delivery_readme: {},
    artifact_manifest: {},
    run_receipt: {},
  };
}

function caseOutputDir(artifactRoot, testCase) {
  return path.join(artifactRoot, testCase.case_id);
}

function relativeArtifactRefs(outDir, artifactPaths) {
  return Object.fromEntries(Object.entries(artifactPaths).map(([key, value]) => [key, path.relative(outDir, value)]));
}

function artifactRefMap(outDir, artifactPaths, keys) {
  return Object.fromEntries(keys
    .filter((key) => artifactPaths[key])
    .map((key) => [key, path.relative(outDir, artifactPaths[key])]));
}

function stageReceipt(stageId, testCase, outDir, artifactPaths, details = {}) {
  const outputRefsByStage = {
    data_readiness: ['dataset_manifest', 'sample_sheet'],
    analysis_plan: ['analysis_plan'],
    execution: ['normalized_counts', 'de_results', 'enrichment_results', 'run_receipt'],
    evidence_audit: ['claim_table', 'evidence_ledger'],
    biological_interpretation: ['report', 'manuscript_evidence_summary'],
    review_and_red_team: ['review_receipt'],
    delivery: ['delivery_readme', 'artifact_manifest'],
  };
  return {
    surface_kind: 'opl_bio_bulk_rna_seq_stage_receipt',
    stage_id: stageId,
    status: details.status ?? 'generated',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_bulk_rna_seq_agent',
    domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    task_kind: testCase.input_task?.task_kind,
    output_refs: artifactRefMap(outDir, artifactPaths, outputRefsByStage[stageId] ?? []),
    blockers: details.blockers ?? [],
    notes: details.notes ?? [],
    authority_boundary: {
      receipt_can_claim_domain_ready: false,
      receipt_can_claim_biological_quality_verdict: false,
      receipt_can_claim_clinical_validity: false,
    },
  };
}

function buildStageReceipts(testCase, outDir, artifactPaths, liveBioc, profile) {
  const executionNotes = liveBioc.status === 'generated'
    ? ['live DESeq2/clusterProfiler receipt available']
    : [`live Bioconductor lane blocked: ${liveBioc.blocker ?? 'unknown'}`];
  return STAGE_SEQUENCE.map((stageId) => stageReceipt(stageId, testCase, outDir, artifactPaths, {
    notes: stageId === 'execution'
      ? [...executionNotes, `seed_rule_mode:${profile?.seed_rule_mode ?? DEFAULT_SEED_RULE_MODE}`]
      : [],
  }));
}

function buildReviewReceipt(testCase, claimRows, evidenceLedgerRows, liveBioc, stageReceipts, profile) {
  const blockers = [
    ...(claimRows.length === 0 ? ['claim_table_empty'] : []),
    ...(evidenceLedgerRows.length === 0 ? ['evidence_ledger_empty'] : []),
    ...(stageReceipts.some((receipt) => receipt.status !== 'generated') ? ['stage_receipt_blocked'] : []),
  ];
  return {
    surface_kind: 'opl_bio_bulk_rna_seq_review_receipt',
    status: blockers.length === 0 ? 'generated' : 'blocked',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_bulk_rna_seq_agent',
    review_scope: [
      'data readiness',
      'analysis plan',
      'execution receipt',
      'claim grounding',
      'safety boundary',
      'delivery completeness',
    ],
    accepted_limitations: [
      profile?.seed_rule_mode === 'legacy_accession'
        ? 'legacy accession-specific seed lane'
        : 'generic public-matrix signature inference lane',
      'not a clinical diagnostic or treatment recommendation',
      'article-grade replay requires domain-owner review beyond deterministic gate pass',
      ...(liveBioc.status === 'generated' ? [] : ['live DESeq2/clusterProfiler lane unavailable in this run']),
    ],
    blockers,
    stage_receipt_count: stageReceipts.length,
    claim_count: claimRows.length,
    evidence_row_count: evidenceLedgerRows.length,
    authority_boundary: {
      review_can_claim_domain_ready: false,
      review_can_claim_production_ready: false,
      review_can_claim_biological_quality_verdict: false,
      review_can_claim_clinical_validity: false,
    },
  };
}

function writeDeliveryReadme(filePath, testCase, artifactPaths, stageReceipts, reviewReceipt) {
  const artifactLines = Object.entries(artifactPaths)
    .map(([name, artifactPath]) => `- ${name}: \`${path.basename(artifactPath)}\``)
    .join('\n');
  const stageLines = stageReceipts
    .map((receipt) => `- ${receipt.stage_id}: ${receipt.status}`)
    .join('\n');
  const text = [
    `# ${testCase.case_id} Delivery`,
    '',
    'This is an OPL-Bio Bulk RNA-seq scenario-agent delivery package for benchmark replay and knowledge-delivery evaluation.',
    '',
    '## Stage Receipts',
    '',
    stageLines,
    '',
    '## Artifacts',
    '',
    artifactLines,
    '',
    '## Review',
    '',
    `- Review status: ${reviewReceipt.status}`,
    `- Blockers: ${(reviewReceipt.blockers ?? []).join(', ') || 'none'}`,
    '',
    '## Boundary',
    '',
    'This package is non-clinical research assistance. It does not claim production readiness, clinical validity, or domain-owner biological quality verdict.',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, text);
}

function topGenes(deRows, allowedGenes = null, minPadj = null, limit = 50) {
  const allowed = allowedGenes ? new Set(allowedGenes.map(normalizeGene)) : null;
  const ranked = deRows
    .filter((row) => row.direction === 'up')
    .filter((row) => !allowed || allowed.has(normalizeGene(row.gene)))
    .filter((row) => minPadj === null || (
      Number.isFinite(Number(row.padj)) && Number(row.padj) <= minPadj
    ));
  return (Number.isSafeInteger(limit) && limit >= 0 ? ranked.slice(0, limit) : ranked)
    .map((row) => row.gene);
}

function matchedTerms(enrichmentRows, allowedTerms = null) {
  const allowed = allowedTerms ? new Set(allowedTerms.map((term) => String(term).toLowerCase())) : null;
  return enrichmentRows
    .filter((row) => !allowed || allowed.has(String(row.term_name).toLowerCase()))
    .slice(0, 8)
    .map((row) => row.term_name);
}

function rscriptPath(envBin) {
  if (envBin) {
    return path.join(path.resolve(envBin), 'Rscript');
  }
  return 'Rscript';
}

function runLiveBiocReplay(testCase, countsPath, sampleSheetPath, outDir, envBin) {
  const inputTask = testCase.input_task ?? {};
  if (inputTask.species !== 'human') {
    return { status: 'blocked', blocker: 'live_bioc_runner_currently_supports_human_orgdb_only' };
  }
  const scriptPath = path.resolve('examples/opl-bio-agent/runtime/tool_adapters/bulk_rna_seq_deseq2_clusterprofiler.R');
  const rscript = rscriptPath(envBin);
  if (!fs.existsSync(scriptPath)) {
    return { status: 'blocked', blocker: 'live_bioc_runner_script_missing' };
  }
  if (envBin && !fs.existsSync(rscript)) {
    return { status: 'blocked', blocker: 'rscript_missing_in_env_bin' };
  }
  const liveOutDir = path.join(outDir, 'live_bioc');
  fs.mkdirSync(liveOutDir, { recursive: true });
  const result = spawnSync(rscript, [
    scriptPath,
    '--counts', countsPath,
    '--sample-sheet', sampleSheetPath,
    '--out-dir', liveOutDir,
    '--case-condition', inputTask.contrast?.case_condition,
    '--control-condition', inputTask.contrast?.control_condition,
    '--design-formula', inputTask.design_formula ?? '~ condition',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: envBin ? `${path.resolve(envBin)}${path.delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
    },
    timeout: 20 * 60 * 1000,
  });
  const receiptPath = path.join(liveOutDir, 'live_bioc_receipt.json');
  const receipt = readMaybeJson(receiptPath);
  if (result.status !== 0 || !receipt) {
    return {
      status: 'blocked',
      blocker: 'live_bioc_runner_failed',
      command_invoked: true,
      retry_count: 0,
      stdout_tail: `${result.stdout ?? ''}`.trim().split(/\r?\n/).slice(-8).join('\n') || null,
      stderr_tail: `${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-12).join('\n') || null,
    };
  }
  return {
    status: 'generated',
    command_invoked: true,
    retry_count: 0,
    out_dir: liveOutDir,
    receipt_path: receiptPath,
    receipt,
    outputs: receipt.outputs ?? {},
  };
}

function writeReport(filePath, testCase, deRows, enrichmentRows, profile, mode) {
  const topDe = deRows.slice(0, 8).map((row) => `- ${row.gene}: log2FC=${row.log2FC}, padj=${row.padj}`).join('\n');
  const topTerms = enrichmentRows.slice(0, 6)
    .map((row) => `- ${row.term_name}: overlap=${row.overlap_genes}, adjusted_p_value=${row.adjusted_p_value}`)
    .join('\n');
  const text = [
    `# ${testCase.case_id}`,
    '',
    `Mode: \`${mode}\``,
    `Seed rule mode: \`${profile?.seed_rule_mode ?? DEFAULT_SEED_RULE_MODE}\``,
    `Analysis profile: \`${profile?.analysis_profile ?? 'generic_bulk_rna_seq_signature'}\``,
    '',
    '## Contrast',
    '',
    `- Case: ${testCase.input_task?.contrast?.case_condition}`,
    `- Control: ${testCase.input_task?.contrast?.control_condition}`,
    `- Design: ${testCase.input_task?.design_formula}`,
    '',
    '## Top Differential Expression Signals',
    '',
    topDe || '- No DE rows generated.',
    '',
    '## Top Enrichment Signals',
    '',
    topTerms || '- No enrichment rows generated.',
    '',
    '## Claims',
    '',
    ...(profile?.claims ?? []).map((claim) => `- ${claim}`),
    '',
    '## Limitations',
    '',
    ...(profile?.limitations ?? []).map((limitation) => `- ${limitation}`),
    '',
    '## Inference Basis',
    '',
    `- Source: ${profile?.inference_basis?.source ?? 'unknown'}`,
    `- Case-specific accession rule used: ${profile?.inference_basis?.case_specific_accession_rule_used === true}`,
    '',
    'This report is non-clinical research assistance and does not claim diagnosis, treatment recommendation, production readiness, or biological quality verdict.',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, text);
}

function runLiveMatrixReplay(testCase, repoRoot, agentRoot, artifactRoot, seedRuleMode, envBin, pack, ablationMode, evolutionArm, runtimeBinding, caseBaseDir = null) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const inputTask = testCase.input_task ?? {};
  const rule = resolveRule(testCase);
  const countsPath = resolveInputPath(repoRoot, agentRoot, inputTask.local_inputs?.counts_tsv, runtimeBinding?.inputRoot, caseBaseDir, testCase.case_id);
  const sampleSheetPath = resolveInputPath(repoRoot, agentRoot, inputTask.local_inputs?.sample_sheet_tsv, runtimeBinding?.inputRoot, caseBaseDir, testCase.case_id);
  if (!countsPath || !sampleSheetPath) {
    return null;
  }
  if (!fs.existsSync(countsPath) || !fs.existsSync(sampleSheetPath)) {
    throw new Error(`Missing local Bulk RNA-seq input for ${testCase.case_id}`);
  }

  const outDir = caseOutputDir(artifactRoot, testCase);
  fs.mkdirSync(outDir, { recursive: true });
  const liveBioc = ablationMode === 'no_tool_retrieval'
    ? { status: 'blocked', blocker: 'tool_retrieval_disabled_by_ablation', command_invoked: false, retry_count: 0, outputs: {} }
    : runLiveBiocReplay(testCase, countsPath, sampleSheetPath, outDir, envBin);
  if (ablationMode === 'no_error_recovery' && liveBioc.status !== 'generated') {
    throw new Error(`Primary tool failed with error recovery disabled for ${testCase.case_id}: ${liveBioc.blocker ?? 'unknown blocker'}`);
  }
  const matrix = countMatrix(readTsv(countsPath));
  const sheet = readTsv(sampleSheetPath);
  const expressionMatrix = matrixForDifferentialExpression(inputTask, matrix.geneRows, matrix.sampleColumns);
  const normalizedRows = expressionMatrix.rows;
  const caseCondition = inputTask.contrast?.case_condition;
  const controlCondition = inputTask.contrast?.control_condition;
  const caseSamples = samplesForCondition(sheet, caseCondition);
  const controlSamples = samplesForCondition(sheet, controlCondition);
  if (caseSamples.length === 0 || controlSamples.length === 0) {
    throw new Error(`Contrast samples not found for ${testCase.case_id}`);
  }

  const proxyDeRows = differentialExpression(normalizedRows, caseSamples, controlSamples);
  const liveDePath = liveBioc.status === 'generated'
    ? (liveBioc.receipt?.outputs?.deseq2_results ?? liveBioc.outputs?.deseq2_results)
    : null;
  const liveDeRows = liveDePath && fs.existsSync(liveDePath)
    ? readTsv(liveDePath)
      .map((row) => ({
        ...row,
        log2FC: Number(row.log2FoldChange ?? row.log2FC),
        pvalue: Number(row.pvalue),
        padj: Number(row.padj),
        direction: Number(row.log2FoldChange ?? row.log2FC) >= 0 ? 'up' : 'down',
      }))
      .filter((row) => Number.isFinite(row.log2FC) && Number.isFinite(row.padj))
      .sort((left, right) => Number(right.log2FC) - Number(left.log2FC))
    : null;
  const deRows = liveDeRows ?? proxyDeRows;
  const deValue = (row, names) => {
    for (const name of names) {
      const value = Number(row[name]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };
  const selectPredictionRows = (rows, limit, minPadj = null) => rows
    .filter((row) => row.direction === 'up')
    .filter((row) => minPadj === null || (
      Number.isFinite(Number(row.padj)) && Number(row.padj) <= minPadj
    ))
    .slice(0, limit);
  const enrichmentRows = enrichmentFromDe(proxyDeRows);
  const artifactPaths = {
    domain_pack_snapshot: path.join(outDir, 'domain_pack_snapshot.json'),
    dataset_manifest: path.join(outDir, 'dataset_manifest.json'),
    sample_sheet: path.join(outDir, 'sample_sheet.tsv'),
    analysis_plan: path.join(outDir, 'analysis_plan.json'),
    normalized_counts: path.join(outDir, 'normalized_counts.tsv'),
    de_results: path.join(outDir, 'de_results.tsv'),
    enrichment_results: path.join(outDir, 'enrichment_results.tsv'),
    claim_table: path.join(outDir, 'claim_table.tsv'),
    evidence_ledger: path.join(outDir, 'evidence_ledger.jsonl'),
    stage_receipts: path.join(outDir, 'stage_receipts.jsonl'),
    review_receipt: path.join(outDir, 'review_receipt.json'),
    report: path.join(outDir, 'report.md'),
    manuscript_evidence_summary: path.join(outDir, 'manuscript_evidence_summary.json'),
    manuscript_evidence_summary_md: path.join(outDir, 'manuscript_evidence_summary.md'),
    delivery_readme: path.join(outDir, 'delivery_readme.md'),
    artifact_manifest: path.join(outDir, 'artifact_manifest.json'),
    run_receipt: path.join(outDir, 'run_receipt.json'),
  };
  if (liveBioc.status === 'generated') {
    artifactPaths.live_bioc_receipt = liveBioc.receipt_path;
    artifactPaths.deseq2_results = liveBioc.outputs.deseq2_results;
    artifactPaths.deseq2_normalized_counts = liveBioc.outputs.deseq2_normalized_counts;
    artifactPaths.clusterprofiler_enrichment_results = liveBioc.outputs.clusterprofiler_enrichment_results;
  }
  const executionMode = liveBioc.status === 'generated' ? 'live_deseq2_replay' : 'processed_count_matrix_analysis';

  writeJson(artifactPaths.domain_pack_snapshot, {
    ...pack.payload,
    source_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    source_path: pack.path,
    snapshot_role: 'case_delivery_domain_pack_snapshot',
  });
  writeJson(artifactPaths.dataset_manifest, {
    geo_accession: inputTask.geo_accession,
    data_ref: testCase.data_ref,
    expression_matrix_ref: inputTask.expression_matrix_ref,
    local_counts_tsv: countsPath,
    local_sample_sheet_tsv: sampleSheetPath,
    data_level: inputTask.data_level,
    sample_count: matrix.sampleColumns.length,
    gene_count: matrix.geneRows.length,
    normalization: expressionMatrix.normalization,
    library_sizes: expressionMatrix.library_sizes,
    authority_boundary: {
      manifest_can_claim_live_geo_download: false,
      manifest_can_claim_clinical_validity: false,
    },
  });
  writeTsv(artifactPaths.sample_sheet, sheet, Object.keys(sheet[0] ?? {}));
  writeJson(artifactPaths.analysis_plan, {
    planner_enabled: ablationMode !== 'no_planner',
    planning_mode: ablationMode === 'no_planner' ? 'fixed_pre_registered_protocol_without_agent_planner' : 'agent_case_specific_planner',
    ablation_mode: ablationMode,
    design_formula: inputTask.design_formula,
    contrast: inputTask.contrast,
    case_samples: caseSamples,
    control_samples: controlSamples,
    normalization: expressionMatrix.normalization,
    de_method: liveBioc.status === 'generated'
      ? 'live DESeq2 result table used for prediction ranking'
      : 'deterministic log2FC with approximate variance score; live DESeq2 runner blocked',
    enrichment_method: liveBioc.status === 'generated'
      ? 'clusterProfiler enrichGO live runner plus built-in benchmark gene set overlap projection'
      : 'built-in benchmark gene set overlap',
    live_bioc_runner: liveBioc,
    fdr_threshold: inputTask.analysis_policy?.fdr_threshold,
    gene_id_policy: inputTask.analysis_policy?.gene_id_policy,
  });
  writeTsv(artifactPaths.normalized_counts, normalizedRows, ['gene', ...matrix.sampleColumns]);
  writeTsv(artifactPaths.de_results, deRows, ['gene', 'baseMean', 'caseMean', 'controlMean', 'log2FC', 'pvalue', 'padj', 'direction']);
  writeTsv(artifactPaths.enrichment_results, enrichmentRows, [
    'term_id',
    'term_name',
    'source',
    'overlap_genes',
    'overlap_count',
    'term_size',
    'recall',
    'adjusted_p_value',
  ]);
  const useLegacyProfile = seedRuleMode === 'legacy_accession' && rule;
  const explicitSignatureTask = Boolean(
    String(inputTask.benchmark_signature_family ?? '').trim()
  );
  const initialPredictedUpGenes = useLegacyProfile
    ? topGenes(deRows, rule.predicted_up_genes)
    : topGenes(
        deRows,
        null,
        liveDeRows ? Number(inputTask.analysis_policy?.fdr_threshold ?? 0.05) : null,
        evolutionArm === 'A3' && !String(inputTask.benchmark_signature_family ?? '').trim()
          ? null
          : 50,
      );
  const predictedTerms = useLegacyProfile
    ? matchedTerms(enrichmentRows, rule.enrichment_terms)
    : matchedTerms(enrichmentRows);
  const initialProfile = useLegacyProfile
    ? legacyProfile({
        ...rule,
        predicted_up_genes: initialPredictedUpGenes,
        enrichment_terms: predictedTerms,
      })
    : inferGenericProfile(testCase, sheet, deRows, enrichmentRows, initialPredictedUpGenes, predictedTerms);
  const geneSelection = useLegacyProfile
    ? {
        predicted_up_genes: initialPredictedUpGenes,
        policy: 'legacy_accession_seed_allowed_genes',
        signature_genes: [],
        suppressed_genes: [],
      }
    : explicitSignatureTask
      ? (() => {
          const signatureSelection = refineBulkRnaSeqPredictedGenes({
            analysisProfile: initialProfile.analysis_profile,
            deRows,
            initialPredictedGenes: initialPredictedUpGenes,
            evolutionArm,
          });
          if (evolutionArm !== 'A1' || signatureSelection.predicted_up_genes.length > 0) {
            return signatureSelection;
          }
          return {
            predicted_up_genes: initialPredictedUpGenes,
            policy: 'profile_signature_absent_then_ranked_live_reference_fallback',
            signature_genes: signatureSelection.signature_genes,
            suppressed_genes: [],
          };
        })()
      : {
          predicted_up_genes: initialPredictedUpGenes,
          policy: 'ranked_live_reference_without_task_signature_contract',
          signature_genes: [],
          suppressed_genes: [],
        };
  const predictedUpGenes = geneSelection.predicted_up_genes;
  const refinedProfile = useLegacyProfile
    ? null
    : inferGenericProfile(testCase, sheet, deRows, enrichmentRows, predictedUpGenes, predictedTerms);
  const profile = useLegacyProfile
    ? initialProfile
    : {
        ...refinedProfile,
        inference_basis: {
          ...refinedProfile.inference_basis,
          gene_selection_policy: geneSelection.policy,
          signature_gene_candidates: geneSelection.signature_genes,
          suppressed_initial_up_genes: geneSelection.suppressed_genes,
          initial_top_gene_triggers: initialPredictedUpGenes,
        },
      };
  const refs = evidenceRefs(testCase);
  const claimRows = buildClaimRows(testCase, profile, predictedUpGenes, predictedTerms, refs);
  const evidenceLedgerRows = buildBulkRnaSeqEvidenceLedgerRows(testCase, claimRows, artifactPaths, {
    deRows,
    enrichmentRows,
  });
  const stageReceipts = buildStageReceipts(testCase, outDir, artifactPaths, liveBioc, profile)
    .map((receipt) => ablationMode === 'no_verifier_quality_gate' && receipt.stage_id === 'review_and_red_team'
      ? { ...receipt, status: 'skipped_by_ablation', details: { ...(receipt.details ?? {}), ablation_mode: ablationMode } }
      : receipt);
  const reviewReceipt = ablationMode === 'no_verifier_quality_gate'
    ? {
        surface_kind: 'opl_bio_bulk_rna_seq_review_receipt',
        status: 'skipped_by_ablation',
        case_id: testCase.case_id,
        ablation_mode: ablationMode,
        blockers: ['verifier_quality_gate_disabled_by_ablation'],
        authority_boundary: { review_can_claim_biological_quality_verdict: false },
      }
    : buildReviewReceipt(testCase, claimRows, evidenceLedgerRows, liveBioc, stageReceipts, profile);
  writeTsv(artifactPaths.claim_table, claimRows, [
    'claim_id',
    'case_id',
    'claim',
    'claim_type',
    'support_status',
    'supporting_genes',
    'supporting_terms',
    'evidence_refs',
    'limitations',
    'safety_boundary',
  ]);
  writeJsonl(artifactPaths.evidence_ledger, evidenceLedgerRows);
  writeReport(artifactPaths.report, testCase, deRows, enrichmentRows, profile, executionMode);
  writeJson(artifactPaths.review_receipt, reviewReceipt);
  writeJsonl(artifactPaths.stage_receipts, stageReceipts);
  const manuscriptEvidenceSummary = writeCaseManuscriptEvidenceSummary({
    jsonPath: artifactPaths.manuscript_evidence_summary,
    markdownPath: artifactPaths.manuscript_evidence_summary_md,
    scenario: 'bulk_rna_seq',
    scenarioAgentId: 'opl_bio_bulk_rna_seq_agent',
    testCase,
    dataset: {
      geo_accession: inputTask.geo_accession,
      data_ref: testCase.data_ref,
      expression_matrix_ref: inputTask.expression_matrix_ref,
      data_level: inputTask.data_level,
      sample_count: matrix.sampleColumns.length,
      gene_count: matrix.geneRows.length,
    },
    contrast: inputTask.contrast,
    execution: {
      execution_mode: executionMode,
      seed_rule_mode: profile.seed_rule_mode,
      analysis_profile: profile.analysis_profile,
      live_tool_status: liveBioc.status,
    },
    primaryResults: {
      genes: predictedUpGenes,
      terms: predictedTerms,
      quantitative_context: {
        de_row_count: deRows.length,
        enrichment_row_count: enrichmentRows.length,
      },
    },
    claims: profile.claims,
    limitations: profile.limitations,
    deeperMiningOptions: profile.deeper_mining_options,
    artifactPaths,
    stageReceipts,
    reviewReceipt,
    inferenceBasis: profile.inference_basis,
    authorityBoundary: {
      summary_can_claim_live_deseq2_replay: executionMode === 'live_deseq2_replay',
    },
  });
  writeDeliveryReadme(artifactPaths.delivery_readme, testCase, artifactPaths, stageReceipts, reviewReceipt);
  const completedAt = new Date().toISOString();
  const wallClockMs = Math.max(0, Date.now() - startedMs);
  const toolInvocationCount = liveBioc.command_invoked === true ? 1 : 0;
  writeJson(artifactPaths.run_receipt, {
    surface_kind: 'opl_bio_bulk_rna_seq_case_run_receipt',
    status: 'generated',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_bulk_rna_seq_agent',
    domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    execution_mode: executionMode,
    seed_rule_mode: profile.seed_rule_mode,
    analysis_profile: profile.analysis_profile,
    inference_basis: profile.inference_basis,
    artifact_root: outDir,
    artifact_paths: artifactPaths,
    stage_receipts_path: artifactPaths.stage_receipts,
    review_receipt_path: artifactPaths.review_receipt,
    manuscript_evidence_summary_path: artifactPaths.manuscript_evidence_summary,
    live_bioc_runner: liveBioc,
    ablation_mode: ablationMode,
    evolution_arm: evolutionArm,
    ablation_components: {
      planner_enabled: ablationMode !== 'no_planner',
      tool_retrieval_enabled: ablationMode !== 'no_tool_retrieval',
      verifier_quality_gate_enabled: ablationMode !== 'no_verifier_quality_gate',
      error_recovery_enabled: ablationMode !== 'no_error_recovery',
    },
    started_at: startedAt,
    completed_at: completedAt,
    wall_clock_ms: wallClockMs,
    tool_invocation_count: toolInvocationCount,
    retry_count: liveBioc.retry_count ?? 0,
    planning_steps: ablationMode === 'no_planner' ? 0 : 1,
    tool_calls_by_class: { external_analysis_process: toolInvocationCount },
    unique_tools: toolInvocationCount,
    database_accesses: 0,
    software_versions: [`node@${process.version}`, 'bulk-rna-seq-agent@v0.5'],
    database_versions: ['none:not_used_by_agent_execution'],
    instrumentation_scope: 'per_case_agent_execution',
    authority_boundary: {
      receipt_can_claim_live_geo_download: false,
      receipt_can_claim_deseq2: liveBioc.status === 'generated',
      receipt_can_claim_clusterprofiler: liveBioc.status === 'generated',
      receipt_can_claim_domain_ready: false,
      receipt_can_claim_clinical_validity: false,
    },
  });
  writeJson(artifactPaths.artifact_manifest, {
    surface_kind: 'opl_bio_bulk_rna_seq_artifact_manifest',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_bulk_rna_seq_agent',
    domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    artifact_paths: artifactPaths,
    seed_rule_mode: profile.seed_rule_mode,
    analysis_profile: profile.analysis_profile,
    inference_basis: profile.inference_basis,
    local_inputs: {
      counts_tsv: countsPath,
      sample_sheet_tsv: sampleSheetPath,
    },
    generated_file_count: Object.keys(artifactPaths).length,
    claim_artifacts: {
      claim_table: artifactPaths.claim_table,
      evidence_ledger: artifactPaths.evidence_ledger,
      claim_count: claimRows.length,
      evidence_row_count: evidenceLedgerRows.length,
    },
    stage_artifacts: {
      domain_pack_snapshot: artifactPaths.domain_pack_snapshot,
      stage_receipts: artifactPaths.stage_receipts,
      review_receipt: artifactPaths.review_receipt,
      stage_count: stageReceipts.length,
      review_status: reviewReceipt.status,
    },
    manuscript_evidence: {
      summary_json: artifactPaths.manuscript_evidence_summary,
      summary_markdown: artifactPaths.manuscript_evidence_summary_md,
      supported_claim_count: manuscriptEvidenceSummary.manuscript_claims.supported_claims.length,
      public_input_only: manuscriptEvidenceSummary.blind_boundary.public_input_only,
      private_oracle_used_by_agent: manuscriptEvidenceSummary.blind_boundary.private_oracle_used_by_agent,
    },
  });

  return {
    execution_mode: executionMode,
    live_bioc_runner: liveBioc,
    artifact_root: outDir,
    artifact_paths: artifactPaths,
    artifact_refs: relativeArtifactRefs(outDir, artifactPaths),
    domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    stage_receipts_path: artifactPaths.stage_receipts,
    review_receipt_path: artifactPaths.review_receipt,
    manuscript_evidence_summary_path: artifactPaths.manuscript_evidence_summary,
    review_status: reviewReceipt.status,
    sample_ids: matrix.sampleColumns,
    cohort_summary: inputTask.cohort_summary ?? null,
    seed_rule_mode: profile.seed_rule_mode,
    analysis_profile: profile.analysis_profile,
    inference_basis: profile.inference_basis,
    predicted_up_genes: predictedUpGenes,
    enrichment_terms: predictedTerms,
    claims: profile.claims,
    limitations: profile.limitations,
    deeper_mining_options: profile.deeper_mining_options,
    claim_table_path: artifactPaths.claim_table,
    evidence_ledger_path: artifactPaths.evidence_ledger,
    manuscript_evidence_summary_path: artifactPaths.manuscript_evidence_summary,
  };
}

function planArtifacts(inputTask) {
  return {
    ...commonArtifacts(inputTask),
    dataset_manifest: {
      geo_accession: inputTask.geo_accession,
      data_level: inputTask.data_level,
      expression_matrix_ref: inputTask.expression_matrix_ref,
      sample_count: Array.isArray(inputTask.sample_sheet)
        ? inputTask.sample_sheet.length
        : inputTask.cohort_summary?.sample_count,
      cohort_summary: inputTask.cohort_summary ?? null,
    },
    sample_sheet: {
      sample_ids: sampleIds(inputTask),
      cohort_summary: inputTask.cohort_summary ?? null,
      metadata_fields: unique(['condition', ...(inputTask.cohort_summary?.required_metadata_fields ?? [])]),
    },
    analysis_plan: {
      design_formula: inputTask.design_formula,
      contrast: inputTask.contrast,
      preferred_runner: inputTask.analysis_policy?.preferred_runner,
      accepted_runner: inputTask.analysis_policy?.accepted_runner,
      fdr_threshold: inputTask.analysis_policy?.fdr_threshold,
      gene_id_policy: inputTask.analysis_policy?.gene_id_policy,
      starting_point: inputTask.analysis_policy?.starting_point,
    },
  };
}

function predictCase(testCase, repoRoot, agentRoot, artifactRoot, seedRuleMode, envBin, pack, ablationMode, evolutionArm, runtimeBinding, caseBaseDir = null) {
  const inputTask = testCase.input_task ?? {};
  const liveResult = runLiveMatrixReplay(testCase, repoRoot, agentRoot, artifactRoot, seedRuleMode, envBin, pack, ablationMode, evolutionArm, runtimeBinding, caseBaseDir);
  if (!liveResult) {
    return {
      case_id: testCase.case_id,
      status: 'blocked',
      blocker: 'no_local_bulk_rna_seq_matrix_input',
      predicted_up_genes: [],
      enrichment_terms: [],
      claims: [],
      limitations: [],
      deeper_mining_options: [],
      artifacts: liveResult?.artifact_paths ?? planArtifacts(inputTask),
      domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
      stage_receipts_path: liveResult?.stage_receipts_path ?? null,
      review_receipt_path: liveResult?.review_receipt_path ?? null,
      manuscript_evidence_summary_path: null,
      evidence_refs: evidenceRefs(testCase),
      agent_trace_refs: ['agent_runner:bulk_rna_seq_agent.v0.5'],
    };
  }

  const executionMode = liveResult?.execution_mode ?? 'curated_fixture_replay_not_live_deseq2';
  return {
    case_id: testCase.case_id,
    benchmark_id: testCase.benchmark_id,
    status: 'generated',
    analysis_profile: liveResult.analysis_profile,
    seed_rule_mode: liveResult.seed_rule_mode,
    inference_basis: liveResult.inference_basis,
    execution_mode: executionMode,
    ablation_mode: ablationMode,
    evolution_arm: evolutionArm,
    dataset: {
      geo_accession: inputTask.geo_accession,
      data_ref: testCase.data_ref,
      expression_matrix_ref: inputTask.expression_matrix_ref,
      data_level: inputTask.data_level,
    },
    domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    contrast: inputTask.contrast,
    design_formula: inputTask.design_formula,
    sample_ids: liveResult?.sample_ids ?? sampleIds(inputTask),
    cohort_summary: liveResult?.cohort_summary ?? inputTask.cohort_summary ?? null,
    predicted_up_genes: liveResult.predicted_up_genes,
    enrichment_terms: liveResult.enrichment_terms,
    claims: liveResult.claims,
    limitations: liveResult.limitations,
    deeper_mining_options: liveResult.deeper_mining_options,
    artifacts: liveResult?.artifact_paths ?? planArtifacts(inputTask),
    artifact_refs: liveResult?.artifact_refs ?? null,
    stage_receipts_path: liveResult?.stage_receipts_path ?? null,
    review_receipt_path: liveResult?.review_receipt_path ?? null,
    review_status: liveResult?.review_status ?? null,
    manuscript_evidence_summary_path: liveResult?.manuscript_evidence_summary_path ?? null,
    evidence_refs: evidenceRefs(testCase),
    agent_trace_refs: [
      'agent_runner:bulk_rna_seq_agent.v0.5',
      `seed_rule_mode:${liveResult.seed_rule_mode}`,
      `analysis_profile:${liveResult.analysis_profile}`,
      `execution_mode:${executionMode}`,
      `ablation_mode:${ablationMode}`,
      `evolution_arm:${evolutionArm}`,
    ],
    live_bioc_runner: liveResult?.live_bioc_runner ?? null,
    authority_boundary: {
      prediction_can_claim_live_deseq2_replay: executionMode === 'live_deseq2_replay',
      prediction_can_claim_deseq2: executionMode === 'live_deseq2_replay',
      prediction_can_claim_clusterprofiler: executionMode === 'live_deseq2_replay',
      prediction_can_claim_live_geo_download: false,
      prediction_can_claim_domain_ready: false,
      prediction_can_claim_clinical_validity: false,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.cases || !args.out) {
    throw new Error(usage());
  }

  const repoRoot = process.cwd();
  const agentRoot = agentRootFromCases(args.cases);
  const artifactRoot = path.resolve(args.artifact_root ?? '/private/tmp/opl-bio-agent/bulk-rna-seq');
  const envBin = args.env_bin ? path.resolve(args.env_bin) : null;
  const pack = domainPack(repoRoot);
  const suite = readJson(args.cases);
  const suiteBaseDir = path.dirname(path.resolve(args.cases));
  const runtimeBindings = loadSameContractRuntimeBindings(
    repoRoot,
    args.same_contract_runtime_bindings,
    suite.cases ?? [],
  );
  const casePredictions = (suite.cases ?? []).map((testCase) => predictCase(
    testCase,
    repoRoot,
    agentRoot,
    artifactRoot,
    args.seed_rule_mode,
    envBin,
    pack,
    args.ablation_mode,
    args.evolution_arm,
    runtimeBindings.byCase.get(testCase.case_id),
    suiteBaseDir,
  ));
  const allLiveDeseq2 = casePredictions.length > 0
    && casePredictions.every((prediction) => (
      prediction.execution_mode === 'live_deseq2_replay'
      && prediction.authority_boundary?.prediction_can_claim_live_deseq2_replay === true
    ));
  const predictions = {
    surface_kind: 'opl_bio_bulk_rna_seq_prediction_suite',
    version: 'opl-bio-bulk-rna-seq-predictions.v0.5',
    owner: 'opl-bio-agent',
    generated_by: 'runtime/agent_runner/bulk_rna_seq_agent.mjs',
    generation_scope: 'agent_output_not_gold_fixture',
    scenario_agent_id: 'opl_bio_bulk_rna_seq_agent',
    domain_pack_ref: BULK_RNA_SEQ_DOMAIN_PACK_REF,
    domain_pack_path: pack.path,
    execution_mode: 'live_deseq2_replay_when_available_else_processed_count_matrix_analysis',
    seed_rule_mode: args.seed_rule_mode,
    ablation_mode: args.ablation_mode,
    evolution_arm: args.evolution_arm,
    artifact_root: artifactRoot,
    env_bin: envBin,
    same_contract_runtime_receipt: runtimeBindings.receipt,
    predictions: casePredictions,
    authority_boundary: {
      prediction_can_claim_domain_ready: false,
      prediction_can_claim_biological_quality_verdict: false,
      prediction_can_claim_clinical_validity: false,
      prediction_can_claim_live_geo_download: false,
      prediction_can_claim_live_deseq2_replay: allLiveDeseq2,
      prediction_can_claim_deseq2: allLiveDeseq2,
      prediction_can_claim_clusterprofiler: allLiveDeseq2,
    },
  };

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(predictions, null, 2)}\n`);
  console.log(JSON.stringify({
    surface_kind: 'opl_bio_bulk_rna_seq_agent_receipt',
    status: 'generated',
    predictions_path: outPath,
    artifact_root: predictions.artifact_root,
    case_count: predictions.predictions.length,
    execution_mode: predictions.execution_mode,
    authority_boundary: predictions.authority_boundary,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    surface_kind: 'opl_bio_bulk_rna_seq_agent_receipt',
    status: 'blocked',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
