#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  describeScRnaSeqInputLanes,
  materializeScRnaSeqInput,
} from './parts/sc_rna_seq_input_materializer.mjs';
import { writeCaseManuscriptEvidenceSummary } from './parts/manuscript_evidence_summary.mjs';

const SC_RNA_SEQ_DOMAIN_PACK_REF = 'examples/opl-bio-agent/contracts/sc_rna_seq_scenario_domain_pack.json';
const DEFAULT_SEED_RULE_MODE = 'generic_signature';
const SEED_RULE_MODES = new Set(['generic_signature', 'legacy_kang_seed']);
const DEFAULT_ABLATION_MODE = 'none';
const ABLATION_MODES = new Set(['none', 'no_planner', 'no_tool_retrieval', 'no_verifier_quality_gate', 'no_error_recovery']);
const STAGE_SEQUENCE = [
  'data_readiness',
  'analysis_plan',
  'qc_and_normalization',
  'celltype_annotation',
  'condition_response',
  'evidence_audit',
  'biological_interpretation',
  'review_and_red_team',
  'delivery',
];

const CELL_TYPE_MARKERS = {
  T_cell: ['CD3D', 'CD3E', 'IL7R', 'TRAC'],
  B_cell: ['MS4A1', 'CD79A', 'CD79B', 'CD74'],
  monocyte: ['LST1', 'S100A8', 'S100A9', 'LYZ', 'FCGR3A'],
};

const CONDITION_RESPONSE_GENE_SETS = [
  {
    term: 'interferon response',
    genes: ['ISG15', 'IFIT1', 'IFI6', 'MX1', 'OAS1', 'IFI27', 'STAT1'],
  },
  {
    term: 'antiviral defense response',
    genes: ['ISG15', 'IFIT1', 'MX1', 'OAS1', 'IFI27'],
  },
  {
    term: 'PBMC cell-type structure',
    genes: ['CD3D', 'CD3E', 'MS4A1', 'CD79A', 'LST1', 'S100A8', 'LYZ'],
  },
  {
    term: 'monocyte interferon response',
    genes: ['ISG15', 'IFIT1', 'IFI6', 'MX1', 'OAS1', 'IFI27', 'STAT1', 'S100A8', 'S100A9'],
  },
];

const SCRNA_ROUTINE_CAPABILITIES = [
  { capability_id: 'input_materialization', class: 'core', default_status: 'verified', claim_boundary: 'canonical counts and metadata materialization only' },
  { capability_id: 'qc_metrics_and_filtering', class: 'core', default_status: 'verified', claim_boundary: 'QC metrics and flags; thresholds remain task-configured' },
  { capability_id: 'normalization', class: 'core', default_status: 'verified', claim_boundary: 'library-size normalization plus log1p for nonnegative input' },
  { capability_id: 'highly_variable_genes', class: 'core', default_status: 'verified', claim_boundary: 'Scanpy HVG table when live lane is available' },
  { capability_id: 'scaling_and_regression_preparation', class: 'core', default_status: 'verified', claim_boundary: 'deterministic gene-wise z-score preparation; regression covariates are not fitted' },
  { capability_id: 'dimensionality_reduction', class: 'core', default_status: 'verified', claim_boundary: 'Scanpy PCA coordinates when live lane is available' },
  { capability_id: 'umap_embedding_and_visualization', class: 'core', default_status: 'partial', claim_boundary: 'UMAP coordinates when live Scanpy succeeds; plots are optional and descriptive' },
  { capability_id: 'neighbor_graph_and_clustering', class: 'core', default_status: 'verified', claim_boundary: 'neighbors plus Leiden when live lane is available' },
  { capability_id: 'marker_and_celltype_annotation', class: 'core', default_status: 'verified', claim_boundary: 'marker table and candidate annotation; no clinical label validity' },
  { capability_id: 'sample_aware_pseudobulk_de', class: 'core', default_status: 'verified', claim_boundary: 'sample x cell-type pseudobulk CPM/log1p effects with Welch test and BH FDR; candidate inference only' },
  { capability_id: 'condition_response', class: 'core', default_status: 'verified', claim_boundary: 'descriptive cell-level contrast and cell-type projection' },
  { capability_id: 'cell_composition_and_differential_abundance', class: 'core', default_status: 'verified', claim_boundary: 'sample-level cell-type counts and proportions; no inferential DA model' },
  { capability_id: 'cell_cycle_scoring', class: 'core', default_status: 'verified', claim_boundary: 'marker-set module scores and phase candidates' },
  { capability_id: 'gene_set_module_scoring', class: 'core', default_status: 'verified', claim_boundary: 'transparent marker/response gene-set scores; no pathway causal inference' },
  { capability_id: 'batch_effect_diagnostic', class: 'core', default_status: 'partial', claim_boundary: 'balance diagnostics and integration routing; no corrected embedding' },
  { capability_id: 'doublet_screening', class: 'core', default_status: 'partial', claim_boundary: 'library-size/detected-gene heuristic candidates only' },
  { capability_id: 'trajectory_readiness', class: 'core', default_status: 'partial', claim_boundary: 'PC1 ordering proxy; no lineage inference' },
  { capability_id: 'raw_fastq_to_feature_barcode_matrix', class: 'upstream', default_status: 'unsupported', claim_boundary: 'requires a platform-specific aligner/counting pipeline and reference bundle before this Agent starts' },
  { capability_id: 'ambient_rna_correction', class: 'specialized', default_status: 'unsupported', claim_boundary: 'requires an ambient-RNA model and raw droplet information' },
  { capability_id: 'rna_velocity', class: 'specialized', default_status: 'unsupported', claim_boundary: 'requires spliced/unspliced layers' },
  { capability_id: 'cnv_inference', class: 'specialized', default_status: 'unsupported', claim_boundary: 'requires genomic location/reference and dedicated model' },
  { capability_id: 'cell_cell_communication', class: 'specialized', default_status: 'unsupported', claim_boundary: 'requires ligand-receptor database and interaction model' },
  { capability_id: 'tcr_bcr_clonotype', class: 'specialized', default_status: 'unsupported', claim_boundary: 'requires V(D)J contig/clone inputs' },
  { capability_id: 'spatial_or_multiome', class: 'specialized', default_status: 'unsupported', claim_boundary: 'requires spatial coordinates or additional modality' },
];

function routineCoverageReceipt(testCase, materializedInput, liveScanpy, artifactPaths) {
  const liveRoutine = liveScanpy?.receipt?.routine_analysis ?? {};
  const statuses = new Map(SCRNA_ROUTINE_CAPABILITIES.map((entry) => [entry.capability_id, entry.default_status]));
  statuses.set('input_materialization', materializedInput?.status === 'generated' ? 'verified' : 'blocked');
  statuses.set('highly_variable_genes', liveScanpy?.status === 'generated' ? 'verified' : 'partial');
  statuses.set('scaling_and_regression_preparation', artifactPaths.scaled_expression ? 'verified' : 'blocked');
  statuses.set('dimensionality_reduction', liveScanpy?.status === 'generated' ? 'verified' : 'partial');
  statuses.set('umap_embedding_and_visualization', liveRoutine.umap_status === 'generated' ? 'verified' : 'partial');
  statuses.set('neighbor_graph_and_clustering', liveRoutine.clustering_status === 'scanpy_neighbors_leiden' ? 'verified' : 'partial');
  statuses.set('sample_aware_pseudobulk_de', liveRoutine.sample_aware_pseudobulk_status === 'generated' ? 'verified' : 'partial');
  statuses.set('cell_composition_and_differential_abundance', artifactPaths.cell_composition ? 'verified' : 'blocked');
  statuses.set('cell_cycle_scoring', artifactPaths.cell_cycle_scores ? 'verified' : 'blocked');
  statuses.set('gene_set_module_scoring', artifactPaths.module_scores ? 'verified' : 'blocked');
  statuses.set('batch_effect_diagnostic', liveRoutine.batch_diagnostic_status === 'generated' ? 'partial' : 'partial');
  const rows = SCRNA_ROUTINE_CAPABILITIES.map((entry) => ({
    ...entry,
    status: statuses.get(entry.capability_id),
    evidence_refs: {
      runner: 'examples/opl-bio-agent/runtime/agent_runner/sc_rna_seq_agent.mjs',
      live_scanpy_receipt: artifactPaths.scanpy_receipt,
      artifact: artifactPaths[entry.capability_id === 'highly_variable_genes' ? 'scanpy_highly_variable_genes'
        : entry.capability_id === 'scaling_and_regression_preparation' ? 'scaled_expression'
          : entry.capability_id === 'neighbor_graph_and_clustering' ? 'scanpy_cluster_assignments'
            : entry.capability_id === 'umap_embedding_and_visualization' ? 'scanpy_umap_coordinates'
              : entry.capability_id === 'sample_aware_pseudobulk_de' ? 'scanpy_pseudobulk_de'
                : entry.capability_id === 'cell_composition_and_differential_abundance' ? 'cell_composition'
                  : entry.capability_id === 'cell_cycle_scoring' ? 'cell_cycle_scores'
                    : entry.capability_id === 'gene_set_module_scoring' ? 'module_scores'
                      : entry.capability_id === 'batch_effect_diagnostic' ? 'batch_diagnostic'
                        : entry.capability_id === 'doublet_screening' ? 'doublet_screen'
                          : entry.capability_id === 'trajectory_readiness' ? 'trajectory_readiness'
                            : entry.capability_id === 'dimensionality_reduction' ? 'scanpy_pca_coordinates'
                              : entry.capability_id === 'marker_and_celltype_annotation' ? 'marker_table'
                                : entry.capability_id === 'condition_response' ? 'condition_response'
                                  : entry.capability_id === 'qc_metrics_and_filtering' ? 'qc_metrics'
                                    : entry.capability_id === 'normalization' ? 'normalized_expression'
                                      : entry.capability_id === 'input_materialization' ? 'input_materialization_receipt' : 'report'],
    },
  }));
  const coreRows = rows.filter((row) => row.class === 'core');
  const coveredCoreCount = coreRows.filter((row) => row.status === 'verified' || row.status === 'partial').length;
  return {
    surface_kind: 'opl_bio_sc_rna_seq_routine_analysis_coverage',
    version: 'opl-bio-sc-rna-seq-routine-analysis-coverage.v2',
    case_id: testCase.case_id,
    scope: 'core single-cell RNA-seq workflow plus explicit specialized modality boundaries',
    routine_capabilities: rows,
    core_capability_count: coreRows.length,
    core_capability_covered_count: coveredCoreCount,
    core_capability_coverage_fraction: Number((coveredCoreCount / Math.max(coreRows.length, 1)).toFixed(3)),
    verified_core_capability_count: coreRows.filter((row) => row.status === 'verified').length,
    partial_core_capability_count: coreRows.filter((row) => row.status === 'partial').length,
    unsupported_specialized_capability_count: rows.filter((row) => row.class === 'specialized' && row.status === 'unsupported').length,
    unsupported_upstream_capability_count: rows.filter((row) => row.class === 'upstream' && row.status === 'unsupported').length,
    authority_boundary: {
      coverage_can_claim_core_workflow_support: coveredCoreCount >= coreRows.length,
      coverage_can_claim_article_grade_replay: false,
      coverage_can_claim_clinical_validity: false,
      coverage_can_claim_raw_read_processing: false,
      coverage_can_claim_specialized_modality_support: false,
    },
  };
}

function usage() {
  return [
    'Usage: node runtime/agent_runner/sc_rna_seq_agent.mjs --cases <cases.json> --out <predictions.json> [--artifact-root <dir>] [--seed-rule-mode generic_signature|legacy_kang_seed] [--python-bin <python>] [--enable-scanpy-umap] [--ablation-mode none|no_planner|no_tool_retrieval|no_verifier_quality_gate|no_error_recovery]',
    `Input modes: each case may provide one of ${describeScRnaSeqInputLanes().join(', ')} through input_task.local_inputs.`,
    'Default seed-rule mode is generic_signature: claims are inferred from public cell metadata, marker tables, condition-response tables, and generic marker/response gene sets.',
    'If Scanpy is available in --python-bin, a live Scanpy receipt, h5ad, marker table, condition-response table, and PCA table are added. Optional Scanpy UMAP figures require --enable-scanpy-umap.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {
    seed_rule_mode: DEFAULT_SEED_RULE_MODE,
    ablation_mode: DEFAULT_ABLATION_MODE,
    python_bin: process.env.SCRNA_PYTHON_BIN ?? 'python3',
    enable_scanpy_umap: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cases' || token === '--out' || token === '--artifact-root' || token === '--seed-rule-mode' || token === '--python-bin' || token === '--ablation-mode') {
      out[token.slice(2).replaceAll('-', '_')] = argv[index + 1];
      index += 1;
    } else if (token === '--enable-scanpy-umap') {
      out.enable_scanpy_umap = true;
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
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
  const batchSize = 2000;
  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize).map((row) => JSON.stringify(row)).join('\n');
    fs.appendFileSync(filePath, `${chunk}\n`);
  }
}

function readTsv(filePath) {
  // Full tumour-microenvironment count matrices exceed the V8 single-string
  // limit when read in one call, so parse the file line by line.
  const fd = fs.openSync(filePath, 'r');
  const chunkSize = 4 * 1024 * 1024;
  const buffer = Buffer.allocUnsafe(chunkSize);
  let headers = null;
  let remainder = '';
  const rows = [];
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytes === 0) break;
      const text = remainder + buffer.toString('utf8', 0, bytes);
      const lines = text.split('\n');
      remainder = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (!line) continue;
        if (!headers) {
          headers = line.split('\t');
          continue;
        }
        const values = line.split('\t');
        rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
      }
    }
    if (remainder.trim()) {
      if (!headers) {
        headers = remainder.split('\t');
      } else {
        const values = remainder.replace(/\r$/, '').split('\t');
        rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return rows;
}

function writeTsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Full tumour-microenvironment runs exceed the V8 single-string limit when
  // all rows are joined at once, so write incrementally.
  fs.writeFileSync(filePath, `${headers.join('\t')}\n`);
  const batchSize = 2000;
  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows
      .slice(start, start + batchSize)
      .map((row) => headers.map((header) => row[header] ?? '').join('\t'))
      .join('\n');
    fs.appendFileSync(filePath, `${chunk}\n`);
  }
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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

function resolveInputPath(repoRoot, agentRoot, maybeRelativePath) {
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

function domainPack(repoRoot) {
  const candidates = [
    path.resolve(repoRoot, SC_RNA_SEQ_DOMAIN_PACK_REF),
    path.resolve(repoRoot, SC_RNA_SEQ_DOMAIN_PACK_REF.replace(/^examples\/opl-bio-agent\//, '')),
  ];
  const packPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!packPath) {
    throw new Error(`scRNA-seq domain pack not found. Tried: ${candidates.join(', ')}`);
  }
  return {
    path: packPath,
    payload: readJson(packPath),
  };
}

function runLiveScanpyReplay(testCase, countsPath, metadataPath, outDir, pythonBin, enableScanpyUmap, agentRoot) {
  const inputTask = testCase.input_task ?? {};
  const scriptPath = [
    path.join(agentRoot, 'runtime/tool_adapters/sc_rna_seq_scanpy_replay.py'),
    path.resolve('examples/opl-bio-agent/runtime/tool_adapters/sc_rna_seq_scanpy_replay.py'),
    path.resolve('runtime/tool_adapters/sc_rna_seq_scanpy_replay.py'),
  ].find((candidate) => fs.existsSync(candidate));
  const liveOutDir = path.join(outDir, 'live_scanpy');
  const receiptPath = path.join(liveOutDir, 'live_scanpy_receipt.json');
  fs.mkdirSync(liveOutDir, { recursive: true });
  if (!scriptPath) {
    const receipt = {
      surface_kind: 'opl_bio_sc_rna_seq_scanpy_receipt',
      status: 'blocked',
      blocker: 'scanpy_adapter_script_missing',
      case_id: testCase.case_id,
      outputs: {},
    };
    writeJson(receiptPath, receipt);
    return { status: 'blocked', blocker: receipt.blocker, command_invoked: false, retry_count: 0, out_dir: liveOutDir, receipt_path: receiptPath, receipt, outputs: {} };
  }
  const commandArgs = [
    scriptPath,
    '--counts', countsPath,
    '--metadata', metadataPath,
    '--out-dir', liveOutDir,
    '--case-id', testCase.case_id,
    '--condition-field', inputTask.condition_field,
    '--cell-type-field', inputTask.cell_type_field,
    '--case-condition', inputTask.contrast?.case_condition,
    '--control-condition', inputTask.contrast?.control_condition,
    '--sample-field', inputTask.sample_field ?? 'donor',
    '--batch-field', inputTask.batch_field ?? 'batch',
  ];
  if (enableScanpyUmap === true) {
    commandArgs.push('--enable-umap-plots');
  }
  const result = spawnSync(pythonBin ?? 'python3', commandArgs, {
    encoding: 'utf8',
    // Full CRC tumour-microenvironment runs can emit large marker and
    // condition-response tables on stdout; the Node default (~1 MB) aborts.
    maxBuffer: 512 * 1024 * 1024,
    env: {
      ...process.env,
      MPLCONFIGDIR: path.join(liveOutDir, 'matplotlib_config'),
      NUMBA_DISABLE_JIT: process.env.NUMBA_DISABLE_JIT ?? '1',
      NUMBA_CACHE_DIR: path.join(liveOutDir, 'numba_cache'),
    },
    timeout: 20 * 60 * 1000,
  });
  const receipt = fs.existsSync(receiptPath)
    ? readJson(receiptPath)
    : {
        surface_kind: 'opl_bio_sc_rna_seq_scanpy_receipt',
        status: 'blocked',
        blocker: result.error ? result.error.message : 'scanpy_adapter_failed_without_receipt',
        stdout_tail: `${result.stdout ?? ''}`.trim().split(/\r?\n/).slice(-8).join('\n') || null,
        stderr_tail: `${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-12).join('\n') || null,
        case_id: testCase.case_id,
        outputs: {},
      };
  if (!fs.existsSync(receiptPath)) {
    writeJson(receiptPath, receipt);
  }
  return {
    status: receipt.status === 'generated' ? 'generated' : 'blocked',
    blocker: receipt.blocker ?? null,
    command_invoked: true,
    retry_count: 0,
    out_dir: liveOutDir,
    receipt_path: receiptPath,
    receipt,
    outputs: receipt.outputs ?? {},
  };
}

function matrixFromRows(rows) {
  const headers = Object.keys(rows[0] ?? {});
  const cellIds = headers.filter((header) => header !== 'gene');
  return {
    cellIds,
    genes: rows.map((row) => ({
      gene: row.gene,
      counts: Object.fromEntries(cellIds.map((cellId) => [cellId, Number(row[cellId] ?? 0)])),
    })),
  };
}

function cellMetadataById(rows) {
  return new Map(rows.map((row) => [row.cell_id, row]));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function librarySizes(genes, cellIds) {
  return Object.fromEntries(cellIds.map((cellId) => [
    cellId,
    genes.reduce((sum, row) => sum + Number(row.counts[cellId] ?? 0), 0),
  ]));
}

function inferExpressionScale(genes, cellIds) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let nonFiniteValueCount = 0;
  for (const row of genes) {
    for (const cellId of cellIds) {
      const value = Number(row.counts[cellId] ?? 0);
      if (!Number.isFinite(value)) {
        nonFiniteValueCount += 1;
        continue;
      }
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return {
    kind: minimum < 0 ? 'preprocessed_centered_or_scaled_expression' : 'nonnegative_counts_or_expression',
    minimum: Number.isFinite(minimum) ? minimum : null,
    maximum: Number.isFinite(maximum) ? maximum : null,
    non_finite_value_count: nonFiniteValueCount,
  };
}

function normalizedExpression(genes, cellIds, sizes, expressionScale) {
  return genes.map((row) => {
    const normalized = { gene: row.gene };
    for (const cellId of cellIds) {
      const value = Number(row.counts[cellId] ?? 0);
      if (expressionScale.kind === 'preprocessed_centered_or_scaled_expression') {
        normalized[cellId] = Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
      } else {
        const cpm = (value / Math.max(sizes[cellId], 1)) * 1000000;
        normalized[cellId] = Number.isFinite(cpm) ? Number(Math.log1p(cpm).toFixed(4)) : 0;
      }
    }
    return normalized;
  });
}

function scaledExpression(normalizedRows, cellIds) {
  return normalizedRows.map((row) => {
    const values = cellIds.map((cellId) => Number(row[cellId] ?? 0));
    const center = mean(values);
    const variance = mean(values.map((value) => (value - center) ** 2));
    const scale = Math.sqrt(variance) || 1;
    return {
      gene: row.gene,
      ...Object.fromEntries(cellIds.map((cellId, index) => [
        cellId,
        Number(((Number(values[index]) - center) / scale).toFixed(5)),
      ])),
    };
  });
}

const CELL_CYCLE_MODULES = {
  S_phase: ['MCM5', 'MCM6', 'PCNA', 'TYMS', 'STMN1', 'UHRF1', 'RRM2'],
  G2M_phase: ['HMGB2', 'TOP2A', 'MKI67', 'UBE2C', 'CCNB1', 'CCNB2', 'CDK1'],
};

function moduleScoreRows(normalizedRows, cellIds, modules) {
  const expressionByGene = geneRowByName(normalizedRows);
  return cellIds.flatMap((cellId) => Object.entries(modules).map(([module, genes]) => {
    const availableGenes = genes.map(normalizeGene).filter((gene) => expressionByGene.has(gene));
    const score = availableGenes.length > 0
      ? mean(availableGenes.map((gene) => Number(expressionByGene.get(gene)[cellId] ?? 0)))
      : 0;
    return {
      cell_id: cellId,
      module,
      score: Number(score.toFixed(5)),
      available_gene_count: availableGenes.length,
      module_gene_count: genes.length,
    };
  }));
}

function cellCycleScoreRows(normalizedRows, cellIds) {
  const rows = moduleScoreRows(normalizedRows, cellIds, CELL_CYCLE_MODULES);
  const byCell = new Map();
  for (const row of rows) {
    const entry = byCell.get(row.cell_id) ?? {};
    entry[row.module] = row;
    byCell.set(row.cell_id, entry);
  }
  return cellIds.map((cellId) => {
    const entry = byCell.get(cellId) ?? {};
    const s = Number(entry.S_phase?.score ?? 0);
    const g2m = Number(entry.G2M_phase?.score ?? 0);
    const phase = Math.max(s, g2m) <= 0 ? 'G1_or_unscored' : s >= g2m ? 'S' : 'G2M';
    return {
      cell_id: cellId,
      S_score: Number(s.toFixed(5)),
      G2M_score: Number(g2m.toFixed(5)),
      phase,
      S_available_gene_count: entry.S_phase?.available_gene_count ?? 0,
      G2M_available_gene_count: entry.G2M_phase?.available_gene_count ?? 0,
      method: 'transparent_marker_module_mean_on_normalized_expression',
    };
  });
}

function cellCompositionRows(metadataRows, sampleField, cellTypeField, conditionField) {
  const effectiveSampleField = metadataRows.some((row) => row[sampleField]) ? sampleField : null;
  const groups = new Map();
  for (const row of metadataRows) {
    const sampleId = effectiveSampleField ? row[effectiveSampleField] : 'all_cells';
    const cellType = row[cellTypeField] ?? 'unassigned';
    const condition = row[conditionField] ?? '';
    const key = `${sampleId}\t${cellType}\t${condition}`;
    const entry = groups.get(key) ?? { sample_id: sampleId, cell_type: cellType, condition, cell_count: 0 };
    entry.cell_count += 1;
    groups.set(key, entry);
  }
  const totals = new Map();
  for (const row of groups.values()) totals.set(row.sample_id, (totals.get(row.sample_id) ?? 0) + row.cell_count);
  return [...groups.values()]
    .map((row) => ({ ...row, total_sample_cells: totals.get(row.sample_id), fraction: Number((row.cell_count / Math.max(totals.get(row.sample_id), 1)).toFixed(6)) }))
    .sort((left, right) => left.sample_id.localeCompare(right.sample_id) || left.cell_type.localeCompare(right.cell_type));
}

function genericMarkerCellPredictions(normalizedRows, cellIds, policy) {
  const markerPanel = policy?.marker_panel ?? {};
  const expressionByGene = geneRowByName(normalizedRows);
  const markerStats = new Map();
  for (const marker of unique(Object.values(markerPanel).flat().map(normalizeGene))) {
    const row = expressionByGene.get(marker);
    if (!row) continue;
    const values = cellIds.map((cellId) => Number(row[cellId] ?? 0));
    const average = mean(values);
    const variance = mean(values.map((value) => (value - average) ** 2));
    markerStats.set(marker, { row, average, standardDeviation: Math.sqrt(variance) || 1 });
  }

  return cellIds.map((cellId) => {
    const scores = Object.entries(markerPanel).map(([cellType, markers]) => {
      const availableMarkers = markers
        .map(normalizeGene)
        .filter((marker) => markerStats.has(marker));
      const score = availableMarkers.length > 0
        ? mean(availableMarkers.map((marker) => {
            const stats = markerStats.get(marker);
            return (Number(stats.row[cellId] ?? 0) - stats.average) / stats.standardDeviation;
          }))
        : Number.NEGATIVE_INFINITY;
      const detectedMarkerCount = availableMarkers.filter((marker) => Number(markerStats.get(marker).row[cellId] ?? 0) > 0).length;
      return { cellType, score, availableMarkers, detectedMarkerCount };
    }).sort((left, right) => right.score - left.score || left.cellType.localeCompare(right.cellType));
    const prediction = scores[0];
    const runnerUp = scores[1];
    return {
      public_cell_id: cellId,
      predicted_celltype: prediction?.cellType ?? 'unassigned',
      marker_score: Number.isFinite(prediction?.score) ? Number(prediction.score.toFixed(6)) : null,
      score_margin: Number.isFinite(prediction?.score) && Number.isFinite(runnerUp?.score)
        ? Number((prediction.score - runnerUp.score).toFixed(6))
        : null,
      detected_signature_gene_count: prediction?.detectedMarkerCount ?? 0,
      available_signature_gene_count: prediction?.availableMarkers.length ?? 0,
      runner_up_celltype: runnerUp?.cellType ?? null,
      annotation_policy_id: policy?.policy_id ?? 'unknown',
    };
  });
}

function evolvedLinearCellPredictions(normalizedRows, cellIds, policy, genericPolicy) {
  const expressionByGene = geneRowByName(normalizedRows);
  const featureGenes = policy?.feature_selection?.selected_genes ?? [];
  const scalerMean = policy?.scaler?.mean ?? [];
  const scalerScale = policy?.scaler?.scale ?? [];
  const classes = policy?.classifier?.classes ?? [];
  const coefficients = policy?.classifier?.coefficients ?? [];
  const intercepts = policy?.classifier?.intercepts ?? [];
  if (
    featureGenes.length === 0
    || featureGenes.length !== scalerMean.length
    || featureGenes.length !== scalerScale.length
    || classes.length !== coefficients.length
    || classes.length !== intercepts.length
  ) {
    throw new Error(`Invalid evolved scRNA-seq cell annotation policy: ${policy?.policy_id ?? 'unknown'}`);
  }
  const genericPredictions = genericPolicy
    ? new Map(genericMarkerCellPredictions(normalizedRows, cellIds, genericPolicy).map((row) => [row.public_cell_id, row]))
    : new Map();
  const fallback = policy?.generic_marker_fallback ?? {};
  const fallbackTypes = new Set(fallback.eligible_cell_types ?? []);
  const trainingSupport = fallback.training_class_support ?? {};

  return cellIds.map((cellId) => {
    const standardized = featureGenes.map((gene, index) => {
      const value = Number(expressionByGene.get(normalizeGene(gene))?.[cellId] ?? 0);
      return (value - Number(scalerMean[index] ?? 0)) / Math.max(Number(scalerScale[index] ?? 1), Number.EPSILON);
    });
    const ranked = classes.map((cellType, classIndex) => ({
      cellType,
      score: Number(intercepts[classIndex] ?? 0) + standardized.reduce(
        (sum, value, featureIndex) => sum + value * Number(coefficients[classIndex]?.[featureIndex] ?? 0),
        0,
      ),
    })).sort((left, right) => right.score - left.score || left.cellType.localeCompare(right.cellType));
    const linearPrediction = ranked[0];
    const linearRunnerUp = ranked[1];
    const genericPrediction = genericPredictions.get(cellId);
    const fallbackApplied = fallback.enabled === true
      && fallbackTypes.has(genericPrediction?.predicted_celltype)
      && Number(trainingSupport[genericPrediction?.predicted_celltype] ?? 0) <= Number(fallback.maximum_training_support_for_fallback ?? -1)
      && Number(genericPrediction?.score_margin ?? Number.NEGATIVE_INFINITY) >= Number(fallback.minimum_generic_marker_score_margin ?? Number.POSITIVE_INFINITY);
    return {
      public_cell_id: cellId,
      predicted_celltype: fallbackApplied ? genericPrediction.predicted_celltype : linearPrediction?.cellType ?? 'unassigned',
      marker_score: fallbackApplied
        ? genericPrediction.marker_score
        : Number.isFinite(linearPrediction?.score) ? Number(linearPrediction.score.toFixed(6)) : null,
      score_margin: fallbackApplied
        ? genericPrediction.score_margin
        : Number.isFinite(linearPrediction?.score) && Number.isFinite(linearRunnerUp?.score)
          ? Number((linearPrediction.score - linearRunnerUp.score).toFixed(6))
          : null,
      detected_signature_gene_count: featureGenes.filter((gene) => Number(expressionByGene.get(normalizeGene(gene))?.[cellId] ?? 0) > 0).length,
      available_signature_gene_count: featureGenes.filter((gene) => expressionByGene.has(normalizeGene(gene))).length,
      runner_up_celltype: fallbackApplied ? genericPrediction.runner_up_celltype : linearRunnerUp?.cellType ?? null,
      annotation_policy_id: policy?.policy_id ?? 'unknown',
      annotation_model_kind: policy?.model_kind ?? 'unknown',
      linear_predicted_celltype: linearPrediction?.cellType ?? null,
      fallback_applied: fallbackApplied,
    };
  });
}

function cellPredictionsForPolicy(normalizedRows, cellIds, policy, genericPolicy) {
  if (policy?.model_kind === 'standardized_multinomial_logistic_regression') {
    return evolvedLinearCellPredictions(normalizedRows, cellIds, policy, genericPolicy);
  }
  return genericMarkerCellPredictions(normalizedRows, cellIds, policy);
}

function externalBlindRunnerCellPredictions({
  policy,
  policyPath,
  materializedInput,
  matrix,
  inputTask,
  testCase,
  repoRoot,
  outDir,
  pythonBin,
}) {
  const sourceH5ad = materializedInput.source_paths?.h5ad;
  if (!sourceH5ad) {
    throw new Error(`External scRNA-seq annotation policy requires an H5AD input for ${testCase.case_id}`);
  }
  if (!policyPath) {
    throw new Error(`External scRNA-seq annotation policy requires cell_annotation_policy_ref for ${testCase.case_id}`);
  }
  const runnerRef = policy?.execution_gates?.blind_runner;
  const runnerPath = repoRelativePath(repoRoot, runnerRef);
  if (!runnerPath || !fs.existsSync(runnerPath)) {
    throw new Error(`External scRNA-seq annotation runner is missing: ${runnerRef ?? 'undefined'}`);
  }

  const executionRoot = path.join(outDir, 'cell_annotation_execution');
  const args = [
    runnerPath,
    '--h5ad', sourceH5ad,
    '--policy', policyPath,
    '--out-root', executionRoot,
    '--cell-count', String(matrix.cellIds.length),
    '--selection-seed', `opl-bio-agent:${testCase.case_id}`,
  ];
  const modelRef = inputTask.celltypist_model_ref ?? process.env.SCRNA_CELLTYPIST_MODEL;
  if (modelRef) {
    args.push('--celltypist-model', repoRelativePath(repoRoot, modelRef));
  }
  if (inputTask.tissue) {
    args.push('--tissue', String(inputTask.tissue));
  }
  const result = spawnSync(pythonBin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      MPLBACKEND: process.env.MPLBACKEND ?? 'Agg',
      MPLCONFIGDIR: process.env.MPLCONFIGDIR ?? path.join(outDir, '.matplotlib'),
    },
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || 'unknown failure').trim();
    throw new Error(`External scRNA-seq annotation runner failed for ${testCase.case_id}: ${detail.slice(-4000)}`);
  }

  const receiptPath = path.join(executionRoot, 'receipt.json');
  const predictionsPath = path.join(executionRoot, 'predictions.tsv');
  if (!fs.existsSync(receiptPath) || !fs.existsSync(predictionsPath)) {
    throw new Error(`External scRNA-seq annotation runner did not emit required artifacts for ${testCase.case_id}`);
  }
  const receipt = readJson(receiptPath);
  if (receipt.status !== 'predictions_frozen_before_truth_inspection') {
    throw new Error(`External scRNA-seq annotation failed closed for ${testCase.case_id}: ${receipt.status}`);
  }
  const predictionRows = readTsv(predictionsPath);
  const predictionsByCell = new Map(predictionRows.map((row) => [row.public_cell_id, row]));
  const missingCellIds = matrix.cellIds.filter((cellId) => !predictionsByCell.has(cellId));
  if (missingCellIds.length > 0) {
    throw new Error(`External scRNA-seq annotation omitted ${missingCellIds.length} cells for ${testCase.case_id}`);
  }

  const matchedFeatureCount = Number(receipt.matched_feature_count ?? 0);
  return {
    receipt,
    receiptPath,
    predictions: matrix.cellIds.map((cellId) => {
      const row = predictionsByCell.get(cellId);
      const usedDomainTool = row.prediction_source === 'celltypist';
      const selectedConfidence = Number(usedDomainTool ? row.celltypist_max_probability : row.v0_3_max_probability);
      return {
        public_cell_id: cellId,
        predicted_celltype: row.predicted_celltype,
        marker_score: Number.isFinite(selectedConfidence) ? Number(selectedConfidence.toFixed(6)) : null,
        score_margin: null,
        detected_signature_gene_count: matchedFeatureCount,
        available_signature_gene_count: matchedFeatureCount,
        runner_up_celltype: null,
        annotation_policy_id: policy.policy_id,
        annotation_model_kind: policy.model_kind,
        linear_predicted_celltype: row.v0_3_prediction,
        fallback_applied: false,
        prediction_source: row.prediction_source,
        inference_status: row.inference_status,
        domain_tool_prediction: row.celltypist_prediction,
        domain_tool_max_probability: row.celltypist_max_probability,
        linear_max_probability: row.v0_3_max_probability,
        arbitration_applied: usedDomainTool,
      };
    }),
  };
}

function cellIdsBy(rows, field, value) {
  return rows.filter((row) => row[field] === value).map((row) => row.cell_id);
}

function geneRowByName(rows) {
  return new Map(rows.map((row) => [normalizeGene(row.gene), row]));
}

function averageForCells(row, cellIds) {
  return mean(cellIds.map((cellId) => Number(row[cellId] ?? 0)));
}

function markerTable(normalizedRows, metadataRows, cellTypeField) {
  const cellTypes = unique(metadataRows.map((row) => row[cellTypeField]));
  const rows = [];
  for (const cellType of cellTypes) {
    const inType = cellIdsBy(metadataRows, cellTypeField, cellType);
    const outType = metadataRows.filter((row) => row[cellTypeField] !== cellType).map((row) => row.cell_id);
    for (const row of normalizedRows) {
      const inMean = averageForCells(row, inType);
      const outMean = averageForCells(row, outType);
      const score = inMean - outMean;
      rows.push({
        cell_type: cellType,
        gene: row.gene,
        mean_in_cell_type: Number(inMean.toFixed(4)),
        mean_other_cells: Number(outMean.toFixed(4)),
        marker_score: Number(score.toFixed(4)),
        direction: score >= 0 ? 'enriched' : 'depleted',
      });
    }
  }
  return rows.sort((left, right) => (
    left.cell_type.localeCompare(right.cell_type) || right.marker_score - left.marker_score
  ));
}

function topMarkersByType(markerRows) {
  const result = {};
  for (const cellType of unique(markerRows.map((row) => row.cell_type))) {
    const known = new Set((CELL_TYPE_MARKERS[cellType] ?? []).map(normalizeGene));
    const rows = markerRows
      .filter((row) => row.cell_type === cellType && row.direction === 'enriched')
      .sort((left, right) => {
        const knownDelta = Number(known.has(normalizeGene(right.gene))) - Number(known.has(normalizeGene(left.gene)));
        return knownDelta || right.marker_score - left.marker_score;
      });
    const knownRows = rows.filter((row) => known.has(normalizeGene(row.gene)));
    result[cellType] = (knownRows.length > 0 ? knownRows : rows).slice(0, 6).map((row) => row.gene);
  }
  return result;
}

function conditionResponseRows(normalizedRows, metadataRows, conditionField, caseCondition, controlCondition) {
  const caseCells = cellIdsBy(metadataRows, conditionField, caseCondition);
  const controlCells = cellIdsBy(metadataRows, conditionField, controlCondition);
  return normalizedRows.map((row) => {
    const caseMean = averageForCells(row, caseCells);
    const controlMean = averageForCells(row, controlCells);
    return {
      gene: row.gene,
      case_mean_log1p_cpm: Number(caseMean.toFixed(4)),
      control_mean_log1p_cpm: Number(controlMean.toFixed(4)),
      delta_log1p_cpm: Number((caseMean - controlMean).toFixed(4)),
      direction: caseMean >= controlMean ? 'up' : 'down',
    };
  }).sort((left, right) => Math.abs(right.delta_log1p_cpm) - Math.abs(left.delta_log1p_cpm));
}

function celltypeConditionResponseRows(normalizedRows, metadataRows, conditionField, cellTypeField, caseCondition, controlCondition) {
  const rows = [];
  const cellTypes = unique(metadataRows.map((row) => row[cellTypeField]));
  for (const cellType of cellTypes) {
    const scoped = metadataRows.filter((row) => row[cellTypeField] === cellType);
    const caseCells = cellIdsBy(scoped, conditionField, caseCondition);
    const controlCells = cellIdsBy(scoped, conditionField, controlCondition);
    for (const row of normalizedRows) {
      const caseMean = averageForCells(row, caseCells);
      const controlMean = averageForCells(row, controlCells);
      rows.push({
        cell_type: cellType,
        gene: row.gene,
        case_mean_log1p_cpm: Number(caseMean.toFixed(4)),
        control_mean_log1p_cpm: Number(controlMean.toFixed(4)),
        delta_log1p_cpm: Number((caseMean - controlMean).toFixed(4)),
        direction: caseMean >= controlMean ? 'up' : 'down',
      });
    }
  }
  return rows.sort((left, right) => (
    left.cell_type.localeCompare(right.cell_type) || Math.abs(right.delta_log1p_cpm) - Math.abs(left.delta_log1p_cpm)
  ));
}

function qcMetrics(genes, cellIds, sizes) {
  return cellIds.map((cellId) => {
    const detectedGenes = genes.filter((row) => Number(row.counts[cellId] ?? 0) > 0).length;
    const mitochondrialCounts = genes
      .filter((row) => normalizeGene(row.gene).startsWith('MT-'))
      .reduce((sum, row) => sum + Number(row.counts[cellId] ?? 0), 0);
    return {
      cell_id: cellId,
      total_counts: sizes[cellId],
      detected_genes: detectedGenes,
      pct_mito: Number(((mitochondrialCounts / Math.max(sizes[cellId], 1)) * 100).toFixed(3)),
      qc_status: 'kept',
    };
  });
}

function qcSummaryRows(qcRows) {
  const totalCounts = qcRows.map((row) => Number(row.total_counts ?? 0));
  const detectedGenes = qcRows.map((row) => Number(row.detected_genes ?? 0));
  const pctMito = qcRows.map((row) => Number(row.pct_mito ?? 0));
  const keptCount = qcRows.filter((row) => row.qc_status === 'kept').length;
  return [
    {
      metric: 'cell_count',
      value: qcRows.length,
      note: 'cells present in the provided matrix and metadata',
    },
    {
      metric: 'kept_cell_count',
      value: keptCount,
      note: 'current deterministic seed keeps all cells after QC metric calculation',
    },
    {
      metric: 'mean_total_counts',
      value: Number(mean(totalCounts).toFixed(3)),
      note: 'mean library size across cells',
    },
    {
      metric: 'mean_detected_genes',
      value: Number(mean(detectedGenes).toFixed(3)),
      note: 'mean genes with non-zero counts per cell',
    },
    {
      metric: 'mean_pct_mito',
      value: Number(mean(pctMito).toFixed(3)),
      note: 'mean mitochondrial count percentage',
    },
  ];
}

function colorForIndex(index) {
  const palette = ['#2f6f73', '#b8573f', '#6f5aa8', '#c99a2e', '#4d7fb8', '#8b5e3c'];
  return palette[index % palette.length];
}

function stableJitter(value, scale) {
  const text = String(value ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) % 997;
  }
  return ((hash / 997) - 0.5) * scale;
}

function writeCelltypeConditionProjectionSvg(filePath, metadataRows, cellTypeField, conditionField) {
  const width = 920;
  const height = 560;
  const margin = 84;
  const cellTypes = unique(metadataRows.map((row) => row[cellTypeField]));
  const conditions = unique(metadataRows.map((row) => row[conditionField]));
  const xFor = (cellType) => {
    const index = Math.max(cellTypes.indexOf(cellType), 0);
    return margin + (index / Math.max(cellTypes.length - 1, 1)) * (width - (2 * margin));
  };
  const yFor = (condition) => {
    const index = Math.max(conditions.indexOf(condition), 0);
    return margin + (index / Math.max(conditions.length - 1, 1)) * (height - (2 * margin));
  };
  const points = metadataRows.map((row) => {
    const cellTypeIndex = Math.max(cellTypes.indexOf(row[cellTypeField]), 0);
    const conditionIndex = Math.max(conditions.indexOf(row[conditionField]), 0);
    return `<circle cx="${(xFor(row[cellTypeField]) + stableJitter(row.cell_id, 44)).toFixed(1)}" cy="${(yFor(row[conditionField]) + stableJitter(`${row.cell_id}:y`, 36)).toFixed(1)}" r="8" fill="${colorForIndex(cellTypeIndex)}" stroke="${conditionIndex === 0 ? '#253238' : '#ffffff'}" stroke-width="${conditionIndex === 0 ? 2 : 1.5}"><title>${escapeXml(row.cell_id)} ${escapeXml(row[cellTypeField])} ${escapeXml(row[conditionField])}</title></circle>`;
  }).join('\n');
  const xLabels = cellTypes.map((cellType) => `<text x="${xFor(cellType).toFixed(1)}" y="${height - 28}" text-anchor="middle" font-size="16" fill="#263238">${escapeXml(cellType)}</text>`).join('\n');
  const yLabels = conditions.map((condition) => `<text x="24" y="${(yFor(condition) + 5).toFixed(1)}" font-size="16" fill="#263238">${escapeXml(condition)}</text>`).join('\n');
  const legend = cellTypes.map((cellType, index) => `<circle cx="${width - 210}" cy="${88 + (index * 28)}" r="7" fill="${colorForIndex(index)}"/><text x="${width - 194}" y="${93 + (index * 28)}" font-size="14" fill="#263238">${escapeXml(cellType)}</text>`).join('\n');
  fs.writeFileSync(filePath, [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fbfbf8"/>',
    '<text x="34" y="40" font-size="22" font-weight="700" fill="#1d2b2f">Cell-type / condition projection</text>',
    '<text x="34" y="64" font-size="13" fill="#5b666a">Deterministic metadata-guided projection for fallback delivery; not a UMAP claim.</text>',
    `<line x1="${margin}" x2="${width - margin}" y1="${height - margin}" y2="${height - margin}" stroke="#ccd3d6"/>`,
    `<line x1="${margin}" x2="${margin}" y1="${margin}" y2="${height - margin}" stroke="#ccd3d6"/>`,
    xLabels,
    yLabels,
    points,
    legend,
    '</svg>',
    '',
  ].join('\n'));
}

function markerScoreMap(markerRows) {
  const map = new Map();
  for (const row of markerRows) {
    map.set(`${row.cell_type}:${normalizeGene(row.gene)}`, Number(row.marker_score ?? 0));
  }
  return map;
}

function writeMarkerDotplotSvg(filePath, markerRows, markerGenesByCellType) {
  const genes = unique(Object.values(markerGenesByCellType).flat()).slice(0, 18);
  const cellTypes = unique(markerRows.map((row) => row.cell_type));
  const scoreMap = markerScoreMap(markerRows);
  const width = Math.max(760, 150 + (genes.length * 38));
  const height = Math.max(360, 140 + (cellTypes.length * 58));
  const maxScore = Math.max(...cellTypes.flatMap((cellType) => genes.map((gene) => Math.max(scoreMap.get(`${cellType}:${normalizeGene(gene)}`) ?? 0, 0))), 1);
  const circles = cellTypes.flatMap((cellType, rowIndex) => genes.map((gene, colIndex) => {
    const score = Math.max(scoreMap.get(`${cellType}:${normalizeGene(gene)}`) ?? 0, 0);
    const radius = 4 + ((score / maxScore) * 13);
    const opacity = 0.25 + ((score / maxScore) * 0.65);
    return `<circle cx="${150 + (colIndex * 38)}" cy="${94 + (rowIndex * 58)}" r="${radius.toFixed(1)}" fill="#2f6f73" opacity="${opacity.toFixed(2)}"><title>${escapeXml(cellType)} ${escapeXml(gene)} marker_score=${score.toFixed(3)}</title></circle>`;
  })).join('\n');
  const geneLabels = genes.map((gene, index) => `<text x="${150 + (index * 38)}" y="${height - 42}" transform="rotate(-55 ${150 + (index * 38)} ${height - 42})" text-anchor="end" font-size="13" fill="#263238">${escapeXml(gene)}</text>`).join('\n');
  const cellTypeLabels = cellTypes.map((cellType, index) => `<text x="132" y="${99 + (index * 58)}" text-anchor="end" font-size="15" fill="#263238">${escapeXml(cellType)}</text>`).join('\n');
  fs.writeFileSync(filePath, [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fbfbf8"/>',
    '<text x="34" y="40" font-size="22" font-weight="700" fill="#1d2b2f">Marker dotplot</text>',
    '<text x="34" y="64" font-size="13" fill="#5b666a">Circle size reflects deterministic marker score from normalized expression.</text>',
    cellTypeLabels,
    geneLabels,
    circles,
    '</svg>',
    '',
  ].join('\n'));
}

function responseDeltaMap(celltypeResponseRows) {
  const map = new Map();
  for (const row of celltypeResponseRows) {
    map.set(`${row.cell_type}:${normalizeGene(row.gene)}`, Number(row.delta_log1p_cpm ?? 0));
  }
  return map;
}

function heatColor(value, maxAbs) {
  const ratio = Math.max(-1, Math.min(1, value / Math.max(maxAbs, 1e-6)));
  if (ratio >= 0) {
    const lightness = 88 - (Math.abs(ratio) * 40);
    return `hsl(8 62% ${lightness.toFixed(1)}%)`;
  }
  const lightness = 88 - (Math.abs(ratio) * 40);
  return `hsl(205 52% ${lightness.toFixed(1)}%)`;
}

function writeConditionResponseHeatmapSvg(filePath, celltypeResponseRows, responseGenes) {
  const cellTypes = unique(celltypeResponseRows.map((row) => row.cell_type));
  const genes = responseGenes.slice(0, 14);
  const deltaMap = responseDeltaMap(celltypeResponseRows);
  const values = cellTypes.flatMap((cellType) => genes.map((gene) => Math.abs(deltaMap.get(`${cellType}:${normalizeGene(gene)}`) ?? 0)));
  const maxAbs = Math.max(...values, 1);
  const width = Math.max(760, 150 + (genes.length * 42));
  const height = Math.max(340, 130 + (cellTypes.length * 44));
  const cells = cellTypes.flatMap((cellType, rowIndex) => genes.map((gene, colIndex) => {
    const value = deltaMap.get(`${cellType}:${normalizeGene(gene)}`) ?? 0;
    return `<rect x="${150 + (colIndex * 42)}" y="${82 + (rowIndex * 44)}" width="38" height="38" rx="3" fill="${heatColor(value, maxAbs)}"><title>${escapeXml(cellType)} ${escapeXml(gene)} delta=${value.toFixed(3)}</title></rect>`;
  })).join('\n');
  const geneLabels = genes.map((gene, index) => `<text x="${169 + (index * 42)}" y="${height - 38}" transform="rotate(-55 ${169 + (index * 42)} ${height - 38})" text-anchor="end" font-size="13" fill="#263238">${escapeXml(gene)}</text>`).join('\n');
  const rowLabels = cellTypes.map((cellType, index) => `<text x="132" y="${106 + (index * 44)}" text-anchor="end" font-size="15" fill="#263238">${escapeXml(cellType)}</text>`).join('\n');
  fs.writeFileSync(filePath, [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fbfbf8"/>',
    '<text x="34" y="40" font-size="22" font-weight="700" fill="#1d2b2f">Cell-type condition-response heatmap</text>',
    '<text x="34" y="64" font-size="13" fill="#5b666a">Red indicates higher case-condition expression; blue indicates higher control-condition expression.</text>',
    rowLabels,
    geneLabels,
    cells,
    '</svg>',
    '',
  ].join('\n'));
}

function writeQcSummaryPlotSvg(filePath, qcSummary) {
  const rows = qcSummary.filter((row) => ['cell_count', 'kept_cell_count', 'mean_detected_genes', 'mean_pct_mito'].includes(row.metric));
  const width = 820;
  const height = 380;
  const maxValue = Math.max(...rows.map((row) => Number(row.value ?? 0)), 1);
  const bars = rows.map((row, index) => {
    const value = Number(row.value ?? 0);
    const barWidth = (value / maxValue) * 520;
    const y = 94 + (index * 58);
    return [
      `<text x="40" y="${y + 23}" font-size="15" fill="#263238">${escapeXml(row.metric)}</text>`,
      `<rect x="230" y="${y}" width="${barWidth.toFixed(1)}" height="30" rx="4" fill="${colorForIndex(index)}"/>`,
      `<text x="${240 + barWidth}" y="${y + 21}" font-size="14" fill="#263238">${escapeXml(row.value)}</text>`,
    ].join('\n');
  }).join('\n');
  fs.writeFileSync(filePath, [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fbfbf8"/>',
    '<text x="34" y="40" font-size="22" font-weight="700" fill="#1d2b2f">QC summary</text>',
    '<text x="34" y="64" font-size="13" fill="#5b666a">Fallback QC metrics from the provided processed count matrix.</text>',
    bars,
    '</svg>',
    '',
  ].join('\n'));
}

function celltypeSummary(metadataRows, cellTypeField, conditionField) {
  const rows = [];
  for (const cellType of unique(metadataRows.map((row) => row[cellTypeField]))) {
    const scoped = metadataRows.filter((row) => row[cellTypeField] === cellType);
    const conditions = Object.fromEntries(unique(scoped.map((row) => row[conditionField])).map((condition) => [
      condition,
      scoped.filter((row) => row[conditionField] === condition).length,
    ]));
    rows.push({
      cell_type: cellType,
      cell_count: scoped.length,
      condition_counts: JSON.stringify(conditions),
    });
  }
  return rows;
}

function conditionResponseSummaryRows(responseRows, celltypeResponseRows, responseGenes, terms) {
  const upRows = responseRows.filter((row) => row.direction === 'up');
  const downRows = responseRows.filter((row) => row.direction === 'down');
  const strongestOverall = responseRows[0] ?? {};
  const rows = [
    {
      summary_id: 'overall_condition_response',
      scope: 'all_cells',
      gene_count: responseRows.length,
      up_gene_count: upRows.length,
      down_gene_count: downRows.length,
      top_genes: responseGenes.join(','),
      top_terms: terms.join(';'),
      strongest_signal: strongestOverall.gene
        ? `${strongestOverall.gene}:${strongestOverall.delta_log1p_cpm}`
        : '',
    },
  ];
  for (const cellType of unique(celltypeResponseRows.map((row) => row.cell_type))) {
    const scoped = celltypeResponseRows.filter((row) => row.cell_type === cellType);
    const scopedUp = scoped.filter((row) => row.direction === 'up');
    const scopedDown = scoped.filter((row) => row.direction === 'down');
    rows.push({
      summary_id: `celltype_condition_response:${cellType}`,
      scope: cellType,
      gene_count: scoped.length,
      up_gene_count: scopedUp.length,
      down_gene_count: scopedDown.length,
      top_genes: scopedUp.slice(0, 8).map((row) => row.gene).join(','),
      top_terms: terms.join(';'),
      strongest_signal: scoped[0]?.gene ? `${scoped[0].gene}:${scoped[0].delta_log1p_cpm}` : '',
    });
  }
  return rows;
}

function topConditionGenes(responseRows) {
  const priority = new Set(CONDITION_RESPONSE_GENE_SETS.flatMap((set) => set.genes).map(normalizeGene));
  return responseRows
    .filter((row) => row.direction === 'up')
    .sort((left, right) => {
      const priorityDelta = Number(priority.has(normalizeGene(right.gene))) - Number(priority.has(normalizeGene(left.gene)));
      return priorityDelta || right.delta_log1p_cpm - left.delta_log1p_cpm;
    })
    .slice(0, 10)
    .map((row) => row.gene);
}

function enrichedTerms(conditionGenes, markerGenesByCellType) {
  const observed = new Set([
    ...conditionGenes,
    ...Object.values(markerGenesByCellType).flat(),
  ].map(normalizeGene));
  return CONDITION_RESPONSE_GENE_SETS
    .map((set) => {
      const overlapGenes = set.genes.filter((gene) => observed.has(normalizeGene(gene)));
      return {
        term_name: set.term,
        overlap_genes: overlapGenes.join(','),
        overlap_count: overlapGenes.length,
        term_size: set.genes.length,
        recall: Number((overlapGenes.length / set.genes.length).toFixed(3)),
      };
    })
    .filter((row) => row.overlap_count > 0)
    .sort((left, right) => right.recall - left.recall || right.overlap_count - left.overlap_count);
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

function normalizedText(...values) {
  return values.flatMap((value) => flattenTextFragments(value)).join(' ').toLowerCase();
}

function hasText(text, pattern) {
  return pattern.test(text);
}

function hasAnyGene(genes, candidates) {
  const observed = new Set((genes ?? []).map(normalizeGene));
  return candidates.some((gene) => observed.has(normalizeGene(gene)));
}

function hasTerm(terms, pattern) {
  return (terms ?? []).some((term) => pattern.test(String(term)));
}

function metadataFields(inputTask, metadataRows) {
  return unique([
    ...Object.keys(metadataRows[0] ?? {}),
    inputTask.condition_field,
    inputTask.cell_type_field,
  ]);
}

function inferGenericAnalysisProfile(testCase, metadataRows, markerGenesByCellType, responseGenes, terms) {
  const inputTask = testCase.input_task ?? {};
  if (String(inputTask.task_kind ?? '').includes('myeloid_pseudobulk')) {
    return 'generic_myeloid_pseudobulk_condition_response';
  }
  const text = normalizedText(inputTask, testCase.data_ref, metadataRows, markerGenesByCellType, responseGenes, terms);
  if (hasText(text, /\bpbmc\b/) && hasTerm(terms, /interferon|antiviral/i)) {
    return 'generic_pbmc_interferon_condition_response';
  }
  if (hasTerm(terms, /interferon|antiviral/i)) {
    return 'generic_single_cell_interferon_condition_response';
  }
  if (hasText(text, /cell_type|celltype|marker/) || hasTerm(terms, /cell-type structure/i)) {
    return 'generic_single_cell_marker_response';
  }
  return 'generic_single_cell_condition_response';
}

function inferGenericClaims(markerGenesByCellType, responseGenes, terms) {
  const claims = [];
  if (Object.keys(markerGenesByCellType ?? {}).length > 0 && hasTerm(terms, /cell-type structure/i)) {
    claims.push('PBMC cell-type marker recovery');
  }
  if (hasTerm(terms, /interferon|antiviral/i)
      || hasAnyGene(responseGenes, ['ISG15', 'IFIT1', 'IFI6', 'MX1', 'OAS1', 'IFI27', 'STAT1'])) {
    claims.push('interferon-stimulated gene response');
  }
  if (Object.keys(markerGenesByCellType ?? {}).length > 1 && responseGenes.length > 0) {
    claims.push('cell-type-resolved response caveat');
  }
  return unique(claims);
}

function inferGenericLimitations(testCase, metadataRows) {
  const inputTask = testCase.input_task ?? {};
  const text = normalizedText(inputTask, metadataRows);
  const limitations = [];
  if (hasText(text, /processed|seed|count matrix|gene-by-cell/)) {
    limitations.push('processed matrix seed');
  }
  if (hasText(text, /cell_type|celltype|metadata/)) {
    limitations.push('metadata-guided cell-type labels');
  }
  limitations.push('not article-grade single-cell replay');
  if (hasText(text, /donor|batch/)) {
    limitations.push('donor/batch effects not fully modeled');
  }
  limitations.push('non-clinical');
  return unique(limitations);
}

function inferGenericDeeperMiningOptions(testCase, metadataRows, responseGenes) {
  const inputTask = testCase.input_task ?? {};
  const text = normalizedText(inputTask, metadataRows, responseGenes);
  const options = [];
  if (hasText(text, /donor/)) {
    options.push('donor-aware pseudobulk');
  }
  if (hasText(text, /cell_type|celltype|t_cell|b_cell|monocyte/) || responseGenes.length > 0) {
    options.push('cell-type-specific differential expression');
  }
  options.push('Seurat or Scanpy full-object replay');
  if (hasText(text, /batch/)) {
    options.push('batch-aware integration check');
  }
  if (hasAnyGene(responseGenes, ['ISG15', 'IFIT1', 'IFI6', 'MX1', 'OAS1', 'IFI27', 'STAT1'])) {
    options.push('cell-type interferon module scoring');
  }
  return unique(options);
}

function inferGenericProfile(testCase, metadataRows, markerGenesByCellType, responseGenes, termRows) {
  const terms = termRows.map((row) => row.term_name);
  const inputTask = testCase.input_task ?? {};
  const isMyeloidPseudobulk = String(inputTask.task_kind ?? '').includes('myeloid_pseudobulk');
  return {
    seed_rule_mode: 'generic_signature',
    analysis_profile: inferGenericAnalysisProfile(testCase, metadataRows, markerGenesByCellType, responseGenes, terms),
    claims: isMyeloidPseudobulk
      ? ['patient-level myeloid pseudobulk condition response']
      : inferGenericClaims(markerGenesByCellType, responseGenes, terms),
    limitations: isMyeloidPseudobulk
      ? [
          'processed myeloid pseudobulk matrix',
          'no cell-level inference',
          'not article-grade single-cell replay',
          'non-clinical',
        ]
      : inferGenericLimitations(testCase, metadataRows),
    deeper_mining_options: isMyeloidPseudobulk
      ? [
          'independent-cohort signature validation',
          'cell-composition sensitivity analysis',
          'full single-cell object replay',
        ]
      : inferGenericDeeperMiningOptions(testCase, metadataRows, responseGenes),
    inference_basis: {
      source: isMyeloidPseudobulk
        ? 'public_scrna_patient_level_myeloid_pseudobulk_and_condition_response'
        : 'public_cell_metadata_marker_tables_condition_response_and_generic_gene_sets',
      case_specific_literature_rule_used: false,
      metadata_fields: metadataFields(inputTask, metadataRows),
      observed_cell_types: Object.keys(markerGenesByCellType),
      response_gene_triggers: responseGenes,
      term_triggers: terms,
    },
  };
}

function legacyKangProfile() {
  return {
    seed_rule_mode: 'legacy_kang_seed',
    analysis_profile: 'kang_ifnb_pbmc_marker_response_seed',
    claims: [
      'PBMC cell-type marker recovery',
      'interferon-stimulated gene response',
      'cell-type-resolved response caveat',
    ],
    limitations: [
      'processed matrix seed',
      'not article-grade single-cell replay',
      'non-clinical',
    ],
    deeper_mining_options: [
      'donor-aware pseudobulk',
      'cell-type-specific differential expression',
      'Seurat or Scanpy full-object replay',
    ],
    inference_basis: {
      source: 'legacy_kang_ifnb_seed_profile',
      case_specific_literature_rule_used: true,
    },
  };
}

function evidenceRefs(testCase) {
  return unique([
    testCase.data_ref ? `data:${testCase.data_ref}` : null,
    testCase.input_task?.counts_matrix_ref ? `matrix:${testCase.input_task.counts_matrix_ref}` : null,
    testCase.input_task?.cell_metadata_ref ? `metadata:${testCase.input_task.cell_metadata_ref}` : null,
  ]);
}

function buildClaimRows(testCase, profile, markerGenesByCellType, responseGenes, terms, refs) {
  return (profile.claims ?? []).map((claim, index) => ({
    claim_id: `${testCase.case_id}:claim:${index + 1}`,
    case_id: testCase.case_id,
    claim,
    claim_type: 'single_cell_interpretation',
    support_status: 'supported_by_delivery_artifacts',
    supporting_cell_types: Object.keys(markerGenesByCellType).join(','),
    supporting_genes: claim.includes('interferon') ? responseGenes.join(',') : Object.values(markerGenesByCellType).flat().join(','),
    supporting_terms: terms.join(';'),
    evidence_refs: refs.join(';'),
    limitations: (profile.limitations ?? []).join(';'),
    safety_boundary: 'non-clinical research interpretation; no diagnosis, treatment recommendation, or validated biomarker claim',
  }));
}

function buildEvidenceLedgerRows(testCase, claimRows, artifactPaths) {
  return claimRows.flatMap((claimRow) => String(claimRow.evidence_refs ?? '').split(';').filter(Boolean).map((ref) => ({
    evidence_id: `${claimRow.claim_id}:${ref.replace(/[^a-z0-9]+/gi, '_')}`,
    case_id: testCase.case_id,
    claim_id: claimRow.claim_id,
    evidence_ref: ref,
    evidence_kind: ref.split(':')[0] ?? 'unknown',
    support_status: claimRow.support_status,
    supporting_genes: claimRow.supporting_genes,
    supporting_terms: claimRow.supporting_terms,
    artifact_refs: {
      marker_table: artifactPaths.marker_table,
      condition_response: artifactPaths.condition_response,
      marker_dotplot: artifactPaths.marker_dotplot,
      condition_response_heatmap: artifactPaths.condition_response_heatmap,
      report: artifactPaths.report,
    },
    authority_boundary: {
      evidence_can_claim_clinical_validity: false,
      evidence_can_claim_biological_quality_verdict: false,
    },
  })));
}

function stageReceipt(stageId, testCase, outDir, artifactPaths, profile, liveScanpy) {
  const outputRefsByStage = {
    data_readiness: ['dataset_manifest', 'input_materialization_receipt', 'cell_metadata'],
    analysis_plan: ['analysis_plan', 'scanpy_receipt', 'batch_diagnostic'],
    qc_and_normalization: ['qc_metrics', 'normalized_expression', 'scaled_expression', 'cell_cycle_scores', 'qc_summary', 'qc_summary_plot', 'scanpy_highly_variable_genes', 'doublet_screen'],
    celltype_annotation: ['celltype_summary', 'marker_table', 'cluster_annotation', 'celltype_condition_projection', 'marker_dotplot', 'scanpy_cluster_assignments'],
    condition_response: ['condition_response', 'celltype_condition_response', 'condition_response_summary', 'condition_response_heatmap', 'cell_composition', 'module_scores', 'pathway_enrichment', 'scanpy_pseudobulk_de', 'scanpy_umap_coordinates', 'trajectory_readiness'],
    evidence_audit: ['claim_table', 'evidence_ledger'],
    biological_interpretation: ['report', 'manuscript_evidence_summary'],
    review_and_red_team: ['review_receipt'],
    delivery: ['delivery_readme', 'artifact_manifest'],
  };
  return {
    surface_kind: 'opl_bio_sc_rna_seq_stage_receipt',
    stage_id: stageId,
    status: 'generated',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_sc_rna_seq_agent',
    domain_pack_ref: SC_RNA_SEQ_DOMAIN_PACK_REF,
    task_kind: testCase.input_task?.task_kind,
    output_refs: Object.fromEntries((outputRefsByStage[stageId] ?? [])
      .filter((key) => artifactPaths[key])
      .map((key) => [key, path.relative(outDir, artifactPaths[key])])),
    blockers: [],
    notes: [
      ...(stageId === 'analysis_plan' ? [`scanpy_status:${liveScanpy?.status ?? 'unknown'}`] : []),
      ...(stageId === 'condition_response' ? [`seed_rule_mode:${profile?.seed_rule_mode ?? DEFAULT_SEED_RULE_MODE}`] : []),
    ],
    authority_boundary: {
      receipt_can_claim_domain_ready: false,
      receipt_can_claim_biological_quality_verdict: false,
      receipt_can_claim_clinical_validity: false,
    },
  };
}

function buildReviewReceipt(testCase, claimRows, evidenceRows, stageReceipts, profile, liveScanpy) {
  const blockers = [
    ...(claimRows.length === 0 ? ['claim_table_empty'] : []),
    ...(evidenceRows.length === 0 ? ['evidence_ledger_empty'] : []),
    ...(stageReceipts.some((receipt) => receipt.status !== 'generated') ? ['stage_receipt_blocked'] : []),
  ];
  return {
    surface_kind: 'opl_bio_sc_rna_seq_review_receipt',
    status: blockers.length === 0 ? 'generated' : 'blocked',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_sc_rna_seq_agent',
    review_scope: [
      'data readiness',
      'QC and normalization',
      'cell-type marker recovery',
      'condition response',
      'claim grounding',
      'safety boundary',
      'delivery completeness',
    ],
    accepted_limitations: [
      profile?.seed_rule_mode === 'legacy_kang_seed'
        ? 'legacy Kang IFN-beta seed profile'
        : 'generic public-matrix single-cell signature inference lane',
      liveScanpy?.status === 'generated'
        ? 'live Scanpy processed-matrix replay receipt available'
        : `live Scanpy lane unavailable: ${liveScanpy?.blocker ?? 'unknown'}`,
      'not a clinical diagnostic or treatment recommendation',
      'article-grade Seurat/Scanpy replay requires domain-owner review beyond deterministic gate pass',
      liveScanpy?.receipt?.figure_generation?.status === 'skipped'
        ? 'Scanpy UMAP figures skipped by default; fallback SVG figures remain required delivery'
        : null,
    ].filter(Boolean),
    blockers,
    stage_receipt_count: stageReceipts.length,
    claim_count: claimRows.length,
    evidence_row_count: evidenceRows.length,
    authority_boundary: {
      review_can_claim_domain_ready: false,
      review_can_claim_production_ready: false,
      review_can_claim_biological_quality_verdict: false,
      review_can_claim_clinical_validity: false,
    },
  };
}

function writeReport(filePath, testCase, markerGenesByCellType, responseGenes, terms, profile, liveScanpy) {
  const markerLines = Object.entries(markerGenesByCellType)
    .map(([cellType, genes]) => `- ${cellType}: ${genes.join(', ')}`)
    .join('\n');
  const text = [
    `# ${testCase.case_id}`,
    '',
    'Mode: `processed_single_cell_matrix_marker_response_smoke`',
    `Seed rule mode: \`${profile.seed_rule_mode}\``,
    `Analysis profile: \`${profile.analysis_profile}\``,
    `Scanpy live lane: \`${liveScanpy?.status ?? 'unknown'}\``,
    '',
    '## Cell-Type Marker Recovery',
    '',
    markerLines || '- No marker rows generated.',
    '',
    '## Condition Response',
    '',
    `- Top stimulated-up genes: ${responseGenes.join(', ')}`,
    `- Terms: ${terms.join('; ')}`,
    '',
    '## Standard Delivery Figures',
    '',
    '- `qc_summary_plot.svg`',
    '- `celltype_condition_projection.svg`',
    '- `marker_dotplot.svg`',
    '- `condition_response_heatmap.svg`',
    ...(liveScanpy?.status === 'generated'
      ? [
          '- `live_scanpy/scanpy_processed.h5ad`',
          '- `live_scanpy/tables/scanpy_rank_genes_groups.tsv`',
          '- `live_scanpy/tables/scanpy_condition_response.tsv`',
          '- `live_scanpy/tables/scanpy_pca_coordinates.tsv`',
          '- `live_scanpy/tables/scanpy_umap_coordinates.tsv` when UMAP coordinates are estimable',
          '- `live_scanpy/tables/scanpy_highly_variable_genes.tsv`',
          '- `live_scanpy/tables/scanpy_cluster_assignments.tsv`',
          '- `live_scanpy/tables/scanpy_pseudobulk_de.tsv` when sample metadata is available',
          '- `live_scanpy/batch_diagnostic.json`',
          '- `live_scanpy/tables/doublet_screen.tsv`',
          '- `live_scanpy/tables/trajectory_readiness.tsv`',
          ...(liveScanpy?.outputs?.umap_cell_type ? ['- `live_scanpy/figures/umap_cell_type.png`'] : []),
          ...(liveScanpy?.outputs?.umap_condition ? ['- `live_scanpy/figures/umap_condition.png`'] : []),
        ]
      : ['- Scanpy live outputs unavailable in this run; see `live_scanpy_receipt.json`.']),
    '',
    '## Claims',
    '',
    ...(profile.claims ?? []).map((claim) => `- ${claim}`),
    '',
    '## Limitations',
    '',
    ...(profile.limitations ?? []).map((limitation) => `- ${limitation}`),
    '',
    '## Inference Basis',
    '',
    `- Source: ${profile.inference_basis?.source ?? 'unknown'}`,
    `- Case-specific literature rule used: ${profile.inference_basis?.case_specific_literature_rule_used === true}`,
    '',
    'This report is non-clinical research assistance and does not claim diagnosis, treatment recommendation, production readiness, or biological quality verdict.',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, text);
}

function writeDeliveryReadme(filePath, testCase, artifactPaths, stageReceipts, reviewReceipt) {
  const artifactLines = Object.entries(artifactPaths)
    .map(([name, artifactPath]) => `- ${name}: \`${path.basename(artifactPath)}\``)
    .join('\n');
  const stageLines = stageReceipts
    .map((receipt) => `- ${receipt.stage_id}: ${receipt.status}`)
    .join('\n');
  fs.writeFileSync(filePath, [
    `# ${testCase.case_id} Delivery`,
    '',
    'This is an OPL-Bio scRNA-seq scenario-agent delivery package for benchmark replay and knowledge-delivery evaluation.',
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
  ].join('\n'));
}

function runCase(testCase, repoRoot, agentRoot, artifactRoot, seedRuleMode, pythonBin, pack, enableScanpyUmap, ablationMode) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const inputTask = testCase.input_task ?? {};
  const outDir = path.join(artifactRoot, testCase.case_id);
  fs.mkdirSync(outDir, { recursive: true });
  const artifactPaths = {
    domain_pack_snapshot: path.join(outDir, 'domain_pack_snapshot.json'),
    dataset_manifest: path.join(outDir, 'dataset_manifest.json'),
    input_materialization_receipt: path.join(outDir, 'input_materialization_receipt.json'),
    analysis_plan: path.join(outDir, 'analysis_plan.json'),
    cell_metadata: path.join(outDir, 'cell_metadata.tsv'),
    qc_metrics: path.join(outDir, 'qc_metrics.tsv'),
    qc_summary: path.join(outDir, 'qc_summary.tsv'),
    qc_summary_plot: path.join(outDir, 'qc_summary_plot.svg'),
    normalized_expression: path.join(outDir, 'normalized_expression.tsv'),
    scaled_expression: path.join(outDir, 'scaled_expression.tsv'),
    cell_cycle_scores: path.join(outDir, 'cell_cycle_scores.tsv'),
    module_scores: path.join(outDir, 'module_scores.tsv'),
    pathway_enrichment: path.join(outDir, 'pathway_enrichment.tsv'),
    cell_composition: path.join(outDir, 'cell_composition.tsv'),
    celltype_summary: path.join(outDir, 'celltype_summary.tsv'),
    marker_table: path.join(outDir, 'marker_table.tsv'),
    marker_dotplot: path.join(outDir, 'marker_dotplot.svg'),
    celltype_condition_projection: path.join(outDir, 'celltype_condition_projection.svg'),
    cluster_annotation: path.join(outDir, 'cluster_annotation.json'),
    cell_predictions: path.join(outDir, 'cell_predictions.tsv'),
    cell_annotation_execution_receipt: path.join(outDir, 'cell_annotation_execution/receipt.json'),
    condition_response: path.join(outDir, 'condition_response.tsv'),
    celltype_condition_response: path.join(outDir, 'celltype_condition_response.tsv'),
    condition_response_summary: path.join(outDir, 'condition_response_summary.tsv'),
    condition_response_heatmap: path.join(outDir, 'condition_response_heatmap.svg'),
    scanpy_receipt: path.join(outDir, 'live_scanpy/live_scanpy_receipt.json'),
    scanpy_processed_h5ad: path.join(outDir, 'live_scanpy/scanpy_processed.h5ad'),
    scanpy_rank_genes_groups: path.join(outDir, 'live_scanpy/tables/scanpy_rank_genes_groups.tsv'),
    scanpy_condition_response: path.join(outDir, 'live_scanpy/tables/scanpy_condition_response.tsv'),
    scanpy_pca_coordinates: path.join(outDir, 'live_scanpy/tables/scanpy_pca_coordinates.tsv'),
    scanpy_highly_variable_genes: path.join(outDir, 'live_scanpy/tables/scanpy_highly_variable_genes.tsv'),
    scanpy_cluster_assignments: path.join(outDir, 'live_scanpy/tables/scanpy_cluster_assignments.tsv'),
    scanpy_umap_coordinates: path.join(outDir, 'live_scanpy/tables/scanpy_umap_coordinates.tsv'),
    scanpy_pseudobulk_de: path.join(outDir, 'live_scanpy/tables/scanpy_pseudobulk_de.tsv'),
    batch_diagnostic: path.join(outDir, 'live_scanpy/batch_diagnostic.json'),
    doublet_screen: path.join(outDir, 'live_scanpy/tables/doublet_screen.tsv'),
    trajectory_readiness: path.join(outDir, 'live_scanpy/tables/trajectory_readiness.tsv'),
    routine_analysis_coverage: path.join(outDir, 'routine_analysis_coverage.json'),
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

  const materializedInput = materializeScRnaSeqInput({
    testCase,
    repoRoot,
    agentRoot,
    outDir,
    receiptPath: artifactPaths.input_materialization_receipt,
    pythonBin,
  });
  if (materializedInput.status !== 'generated') {
    throw new Error(`Unable to materialize scRNA-seq input for ${testCase.case_id}: ${materializedInput.blocker ?? 'unknown blocker'}`);
  }
  const matrix = matrixFromRows(readTsv(materializedInput.counts_path));
  const metadataRows = readTsv(materializedInput.metadata_path);
  const liveScanpy = ablationMode === 'no_tool_retrieval'
    ? { status: 'blocked', blocker: 'tool_retrieval_disabled_by_ablation', command_invoked: false, retry_count: 0, outputs: {} }
    : runLiveScanpyReplay(
        testCase,
        materializedInput.counts_path,
        materializedInput.metadata_path,
        outDir,
        pythonBin,
        enableScanpyUmap,
        agentRoot,
      );
  const routineCoverage = routineCoverageReceipt(testCase, materializedInput.receipt, liveScanpy, artifactPaths);
  writeJson(artifactPaths.routine_analysis_coverage, routineCoverage);
  if (ablationMode === 'no_error_recovery' && liveScanpy.status !== 'generated') {
    throw new Error(`Primary tool failed with error recovery disabled for ${testCase.case_id}: ${liveScanpy.blocker ?? 'unknown blocker'}`);
  }
  const metadataById = cellMetadataById(metadataRows);
  const missingMetadata = matrix.cellIds.filter((cellId) => !metadataById.has(cellId));
  if (missingMetadata.length > 0) {
    throw new Error(`Missing metadata rows for cells: ${missingMetadata.join(', ')}`);
  }

  const sizes = librarySizes(matrix.genes, matrix.cellIds);
  const expressionScale = inferExpressionScale(matrix.genes, matrix.cellIds);
  if (expressionScale.non_finite_value_count > 0) {
    throw new Error(`Non-finite expression values found for ${testCase.case_id}: ${expressionScale.non_finite_value_count}`);
  }
  const normalizedRows = normalizedExpression(matrix.genes, matrix.cellIds, sizes, expressionScale);
  const scaledRows = scaledExpression(normalizedRows, matrix.cellIds);
  const cellCycleRows = cellCycleScoreRows(normalizedRows, matrix.cellIds);
  const genericCellAnnotationPolicy = pack.payload?.tool_policy?.generic_cell_annotation_policy;
  const defaultCellAnnotationPolicyRef = inputTask.enable_generic_cell_annotation === true
    ? pack.payload?.tool_policy?.default_cell_annotation_policy_ref
    : null;
  const selectedCellAnnotationPolicyRef = inputTask.cell_annotation_policy_ref ?? defaultCellAnnotationPolicyRef;
  const cellAnnotationPolicyPath = selectedCellAnnotationPolicyRef
    ? (path.isAbsolute(selectedCellAnnotationPolicyRef)
        ? selectedCellAnnotationPolicyRef
        : path.resolve(repoRoot, selectedCellAnnotationPolicyRef))
    : null;
  const cellAnnotationPolicy = cellAnnotationPolicyPath
    ? readJson(cellAnnotationPolicyPath)
    : inputTask.enable_generic_cell_annotation === true
      ? genericCellAnnotationPolicy
      : null;
  const externalAnnotationPolicy = cellAnnotationPolicy?.model_kind === 'external_blind_runner';
  const cellAnnotationExecution = externalAnnotationPolicy
    ? externalBlindRunnerCellPredictions({
        policy: cellAnnotationPolicy,
        policyPath: cellAnnotationPolicyPath,
        materializedInput,
        matrix,
        inputTask,
        testCase,
        repoRoot,
        outDir,
        pythonBin,
      })
    : {
        predictions: cellAnnotationPolicy
          ? cellPredictionsForPolicy(normalizedRows, matrix.cellIds, cellAnnotationPolicy, genericCellAnnotationPolicy)
          : [],
        receipt: {
          surface_kind: 'opl_bio_scrna_cell_annotation_execution_receipt',
          status: cellAnnotationPolicy ? 'generated_in_process' : 'not_requested',
          case_id: testCase.case_id,
          policy_id: cellAnnotationPolicy?.policy_id ?? null,
          model_kind: cellAnnotationPolicy?.model_kind ?? null,
          prediction_count: cellAnnotationPolicy ? matrix.cellIds.length : 0,
          authority_boundary: {
            truth_inspected_during_prediction: false,
            external_domain_tool_invoked: false,
          },
        },
        receiptPath: artifactPaths.cell_annotation_execution_receipt,
      };
  if (!externalAnnotationPolicy) {
    writeJson(artifactPaths.cell_annotation_execution_receipt, cellAnnotationExecution.receipt);
  }
  const cellPredictions = cellAnnotationExecution.predictions;
  const qcRows = qcMetrics(matrix.genes, matrix.cellIds, sizes);
  const markerRows = markerTable(normalizedRows, metadataRows, inputTask.cell_type_field);
  const markerGenesByCellType = topMarkersByType(markerRows);
  const caseCells = cellIdsBy(metadataRows, inputTask.condition_field, inputTask.contrast?.case_condition);
  const controlCells = cellIdsBy(metadataRows, inputTask.condition_field, inputTask.contrast?.control_condition);
  if (caseCells.length === 0 || controlCells.length === 0) {
    throw new Error(`Contrast cells not found for ${testCase.case_id}`);
  }
  const responseRows = conditionResponseRows(
    normalizedRows,
    metadataRows,
    inputTask.condition_field,
    inputTask.contrast?.case_condition,
    inputTask.contrast?.control_condition,
  );
  const celltypeResponseRows = celltypeConditionResponseRows(
    normalizedRows,
    metadataRows,
    inputTask.condition_field,
    inputTask.cell_type_field,
    inputTask.contrast?.case_condition,
    inputTask.contrast?.control_condition,
  );
  const responseGenes = topConditionGenes(responseRows);
  const termRows = enrichedTerms(responseGenes, markerGenesByCellType);
  const terms = termRows.map((row) => row.term_name);
  const moduleRows = moduleScoreRows(
    normalizedRows,
    matrix.cellIds,
    Object.fromEntries(CONDITION_RESPONSE_GENE_SETS.map((set) => [set.term, set.genes])),
  );
  const compositionRows = cellCompositionRows(
    metadataRows,
    inputTask.sample_field ?? 'donor',
    inputTask.cell_type_field,
    inputTask.condition_field,
  );
  const profile = seedRuleMode === 'legacy_kang_seed'
    ? legacyKangProfile()
    : inferGenericProfile(testCase, metadataRows, markerGenesByCellType, responseGenes, termRows);
  const qcSummary = qcSummaryRows(qcRows);
  const conditionResponseSummary = conditionResponseSummaryRows(responseRows, celltypeResponseRows, responseGenes, terms);
  const refs = evidenceRefs(testCase);
  const claimRows = buildClaimRows(testCase, profile, markerGenesByCellType, responseGenes, terms, refs);
  const evidenceRows = buildEvidenceLedgerRows(testCase, claimRows, artifactPaths);
  const stageReceipts = STAGE_SEQUENCE.map((stageId) => stageReceipt(stageId, testCase, outDir, artifactPaths, profile, liveScanpy))
    .map((receipt) => ablationMode === 'no_verifier_quality_gate' && receipt.stage_id === 'review_and_red_team'
      ? { ...receipt, status: 'skipped_by_ablation', details: { ...(receipt.details ?? {}), ablation_mode: ablationMode } }
      : receipt);
  const reviewReceipt = ablationMode === 'no_verifier_quality_gate'
    ? {
        surface_kind: 'opl_bio_sc_rna_seq_review_receipt',
        status: 'skipped_by_ablation',
        case_id: testCase.case_id,
        ablation_mode: ablationMode,
        blockers: ['verifier_quality_gate_disabled_by_ablation'],
        authority_boundary: { review_can_claim_biological_quality_verdict: false },
      }
    : buildReviewReceipt(testCase, claimRows, evidenceRows, stageReceipts, profile, liveScanpy);
  const executionMode = externalAnnotationPolicy
    ? 'candidate_external_cell_annotation_policy'
    : liveScanpy.status === 'generated'
      ? 'live_scanpy_processed_matrix_replay'
      : 'processed_single_cell_matrix_analysis';

  writeJson(artifactPaths.domain_pack_snapshot, {
    ...pack.payload,
    source_ref: SC_RNA_SEQ_DOMAIN_PACK_REF,
    source_path: pack.path,
    snapshot_role: 'case_delivery_domain_pack_snapshot',
  });
  writeJson(artifactPaths.dataset_manifest, {
    geo_accession: inputTask.geo_accession,
    data_ref: testCase.data_ref,
    counts_matrix_ref: inputTask.counts_matrix_ref,
    cell_metadata_ref: inputTask.cell_metadata_ref,
    requested_input_lane: materializedInput.receipt?.requested_lane,
    materialized_input_lane: materializedInput.receipt?.materialized_lane,
    local_counts_tsv: materializedInput.counts_path,
    local_cell_metadata_tsv: materializedInput.metadata_path,
    input_source_paths: materializedInput.receipt?.source_paths ?? {},
    input_materialization_receipt: artifactPaths.input_materialization_receipt,
    data_level: inputTask.data_level,
    cell_count: matrix.cellIds.length,
    gene_count: matrix.genes.length,
    condition_field: inputTask.condition_field,
    cell_type_field: inputTask.cell_type_field,
    seed_rule_mode: profile.seed_rule_mode,
    analysis_profile: profile.analysis_profile,
    inference_basis: profile.inference_basis,
    expression_scale: expressionScale,
    cell_annotation_policy: cellAnnotationPolicy
      ? {
          policy_id: cellAnnotationPolicy.policy_id,
          model_kind: cellAnnotationPolicy.model_kind ?? 'generic_marker_signature',
          policy_ref: inputTask.cell_annotation_policy_ref ?? SC_RNA_SEQ_DOMAIN_PACK_REF,
        }
      : null,
    authority_boundary: {
      manifest_can_claim_live_geo_download: false,
      manifest_can_claim_clinical_validity: false,
    },
  });
  writeJson(artifactPaths.analysis_plan, {
    surface_kind: 'opl_bio_sc_rna_seq_analysis_plan',
    case_id: testCase.case_id,
    planner_enabled: ablationMode !== 'no_planner',
    planning_mode: ablationMode === 'no_planner' ? 'fixed_pre_registered_protocol_without_agent_planner' : 'agent_case_specific_planner',
    ablation_mode: ablationMode,
    contrast: inputTask.contrast,
    condition_field: inputTask.condition_field,
    cell_type_field: inputTask.cell_type_field,
    generic_cell_annotation_enabled: cellAnnotationPolicy !== null,
    generic_cell_annotation_policy_id: cellAnnotationPolicy?.policy_id ?? null,
    cell_annotation_policy_ref: inputTask.cell_annotation_policy_ref ?? null,
    cell_annotation_model_kind: cellAnnotationPolicy?.model_kind ?? 'generic_marker_signature',
    preferred_framework: inputTask.analysis_policy?.preferred_framework,
    accepted_runner: inputTask.analysis_policy?.accepted_runner,
    accepted_input_lanes: describeScRnaSeqInputLanes(),
    input_materialization: materializedInput.receipt,
    live_scanpy_runner: liveScanpy,
    routine_analysis_coverage_ref: artifactPaths.routine_analysis_coverage,
    routine_analysis_coverage: routineCoverage,
    ablation_components: {
      planner_enabled: ablationMode !== 'no_planner',
      tool_retrieval_enabled: ablationMode !== 'no_tool_retrieval',
      verifier_quality_gate_enabled: ablationMode !== 'no_verifier_quality_gate',
      error_recovery_enabled: ablationMode !== 'no_error_recovery',
    },
    deterministic_fallback: {
      normalization: expressionScale.kind === 'preprocessed_centered_or_scaled_expression'
        ? 'preserve finite preprocessed centered/scaled expression values'
        : 'library-size CPM plus log1p',
      expression_scale: expressionScale,
      marker_method: 'metadata-guided one-vs-rest marker score',
      condition_response_method: 'case minus control log1p CPM delta',
      can_claim_umap: false,
      can_claim_article_grade_replay: false,
    },
  });
  writeTsv(artifactPaths.cell_metadata, metadataRows, Object.keys(metadataRows[0] ?? {}));
  writeTsv(artifactPaths.qc_metrics, qcRows, ['cell_id', 'total_counts', 'detected_genes', 'pct_mito', 'qc_status']);
  writeTsv(artifactPaths.qc_summary, qcSummary, ['metric', 'value', 'note']);
  writeQcSummaryPlotSvg(artifactPaths.qc_summary_plot, qcSummary);
  writeTsv(artifactPaths.normalized_expression, normalizedRows, ['gene', ...matrix.cellIds]);
  writeTsv(artifactPaths.scaled_expression, scaledRows, ['gene', ...matrix.cellIds]);
  writeTsv(artifactPaths.cell_cycle_scores, cellCycleRows, [
    'cell_id', 'S_score', 'G2M_score', 'phase', 'S_available_gene_count', 'G2M_available_gene_count', 'method',
  ]);
  writeTsv(artifactPaths.module_scores, moduleRows, [
    'cell_id', 'module', 'score', 'available_gene_count', 'module_gene_count',
  ]);
  writeTsv(artifactPaths.pathway_enrichment, termRows, [
    'term_name', 'overlap_genes', 'overlap_count', 'term_size', 'recall',
  ]);
  writeTsv(artifactPaths.cell_composition, compositionRows, [
    'sample_id', 'cell_type', 'condition', 'cell_count', 'total_sample_cells', 'fraction',
  ]);
  writeTsv(artifactPaths.celltype_summary, celltypeSummary(metadataRows, inputTask.cell_type_field, inputTask.condition_field), [
    'cell_type',
    'cell_count',
    'condition_counts',
  ]);
  writeTsv(artifactPaths.marker_table, markerRows, [
    'cell_type',
    'gene',
    'mean_in_cell_type',
    'mean_other_cells',
    'marker_score',
    'direction',
  ]);
  writeMarkerDotplotSvg(artifactPaths.marker_dotplot, markerRows, markerGenesByCellType);
  writeCelltypeConditionProjectionSvg(
    artifactPaths.celltype_condition_projection,
    metadataRows,
    inputTask.cell_type_field,
    inputTask.condition_field,
  );
  writeJson(artifactPaths.cluster_annotation, {
    surface_kind: 'opl_bio_sc_rna_seq_cluster_annotation',
    case_id: testCase.case_id,
    annotation_mode: 'metadata-guided marker replay seed',
    cell_type_markers: markerGenesByCellType,
    generic_cell_annotation: cellAnnotationPolicy
      ? {
          status: 'generated_candidate_cell_annotations',
          policy_id: cellAnnotationPolicy.policy_id,
          model_kind: cellAnnotationPolicy.model_kind ?? 'generic_marker_signature',
          policy_ref: inputTask.cell_annotation_policy_ref ?? SC_RNA_SEQ_DOMAIN_PACK_REF,
          prediction_count: cellPredictions.length,
          predictions_path: artifactPaths.cell_predictions,
          execution_receipt_path: artifactPaths.cell_annotation_execution_receipt,
        }
      : { status: 'not_requested' },
    authority_boundary: {
      annotation_can_claim_novel_cell_type_discovery: false,
      annotation_can_claim_article_grade_cell_labels: false,
    },
  });
  writeTsv(artifactPaths.cell_predictions, cellPredictions, [
    'public_cell_id',
    'predicted_celltype',
    'marker_score',
    'score_margin',
    'detected_signature_gene_count',
    'available_signature_gene_count',
      'runner_up_celltype',
      'annotation_policy_id',
      'annotation_model_kind',
      'linear_predicted_celltype',
      'fallback_applied',
      'prediction_source',
      'inference_status',
      'domain_tool_prediction',
      'domain_tool_max_probability',
      'linear_max_probability',
      'arbitration_applied',
  ]);
  writeTsv(artifactPaths.condition_response, responseRows, [
    'gene',
    'case_mean_log1p_cpm',
    'control_mean_log1p_cpm',
    'delta_log1p_cpm',
    'direction',
  ]);
  writeTsv(artifactPaths.celltype_condition_response, celltypeResponseRows, [
    'cell_type',
    'gene',
    'case_mean_log1p_cpm',
    'control_mean_log1p_cpm',
    'delta_log1p_cpm',
    'direction',
  ]);
  writeTsv(artifactPaths.condition_response_summary, conditionResponseSummary, [
    'summary_id',
    'scope',
    'gene_count',
    'up_gene_count',
    'down_gene_count',
    'top_genes',
    'top_terms',
    'strongest_signal',
  ]);
  writeConditionResponseHeatmapSvg(artifactPaths.condition_response_heatmap, celltypeResponseRows, responseGenes);
  writeTsv(artifactPaths.claim_table, claimRows, [
    'claim_id',
    'case_id',
    'claim',
    'claim_type',
    'support_status',
    'supporting_cell_types',
    'supporting_genes',
    'supporting_terms',
    'evidence_refs',
    'limitations',
    'safety_boundary',
  ]);
  writeJsonl(artifactPaths.evidence_ledger, evidenceRows);
  writeReport(artifactPaths.report, testCase, markerGenesByCellType, responseGenes, terms, profile, liveScanpy);
  writeJsonl(artifactPaths.stage_receipts, stageReceipts);
  writeJson(artifactPaths.review_receipt, reviewReceipt);
  const manuscriptEvidenceSummary = writeCaseManuscriptEvidenceSummary({
    jsonPath: artifactPaths.manuscript_evidence_summary,
    markdownPath: artifactPaths.manuscript_evidence_summary_md,
    scenario: 'sc_rna_seq',
    scenarioAgentId: 'opl_bio_sc_rna_seq_agent',
    testCase,
    dataset: {
      geo_accession: inputTask.geo_accession,
      data_ref: testCase.data_ref,
      counts_matrix_ref: inputTask.counts_matrix_ref,
      cell_metadata_ref: inputTask.cell_metadata_ref,
      data_level: inputTask.data_level,
      cell_count: matrix.cellIds.length,
      gene_count: matrix.genes.length,
      materialized_input_lane: materializedInput.receipt?.materialized_lane,
    },
    contrast: inputTask.contrast,
    execution: {
      execution_mode: executionMode,
      seed_rule_mode: profile.seed_rule_mode,
      analysis_profile: profile.analysis_profile,
      live_tool_status: liveScanpy.status,
    },
    primaryResults: {
      genes: responseGenes,
      terms,
      cell_types: Object.keys(markerGenesByCellType),
      marker_genes_by_cell_type: markerGenesByCellType,
      quantitative_context: {
        marker_row_count: markerRows.length,
        condition_response_row_count: responseRows.length,
        celltype_condition_response_row_count: celltypeResponseRows.length,
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
      summary_can_claim_scanpy_processed_matrix_replay: liveScanpy.status === 'generated',
      summary_can_claim_article_grade_replay: false,
    },
  });
  writeDeliveryReadme(artifactPaths.delivery_readme, testCase, artifactPaths, stageReceipts, reviewReceipt);
  const completedAt = new Date().toISOString();
  const wallClockMs = Math.max(0, Date.now() - startedMs);
  const toolInvocationCount = (liveScanpy.command_invoked === true ? 1 : 0) + (externalAnnotationPolicy ? 1 : 0);
  writeJson(artifactPaths.run_receipt, {
    surface_kind: 'opl_bio_sc_rna_seq_case_run_receipt',
    status: 'generated',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_sc_rna_seq_agent',
    domain_pack_ref: SC_RNA_SEQ_DOMAIN_PACK_REF,
    execution_mode: executionMode,
    seed_rule_mode: profile.seed_rule_mode,
    analysis_profile: profile.analysis_profile,
    inference_basis: profile.inference_basis,
    artifact_root: outDir,
    artifact_paths: artifactPaths,
    input_materialization: materializedInput.receipt,
    stage_receipts_path: artifactPaths.stage_receipts,
    review_receipt_path: artifactPaths.review_receipt,
    manuscript_evidence_summary_path: artifactPaths.manuscript_evidence_summary,
    routine_analysis_coverage_path: artifactPaths.routine_analysis_coverage,
    live_scanpy_runner: liveScanpy,
    cell_annotation_execution: {
      status: cellAnnotationExecution.receipt?.status ?? null,
      receipt_path: artifactPaths.cell_annotation_execution_receipt,
      policy_id: cellAnnotationPolicy?.policy_id ?? null,
      model_kind: cellAnnotationPolicy?.model_kind ?? null,
    },
    ablation_mode: ablationMode,
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
    retry_count: liveScanpy.retry_count ?? 0,
    planning_steps: ablationMode === 'no_planner' ? 0 : 1,
    tool_calls_by_class: { external_analysis_process: toolInvocationCount },
    unique_tools: toolInvocationCount,
    database_accesses: 0,
    software_versions: [`node@${process.version}`, 'sc-rna-seq-agent@v0.8'],
    database_versions: ['none:not_used_by_agent_execution'],
    instrumentation_scope: 'per_case_agent_execution',
    authority_boundary: {
      receipt_can_claim_live_geo_download: false,
      receipt_can_claim_scanpy_processed_matrix_replay: liveScanpy.status === 'generated',
      receipt_can_claim_seurat_or_scanpy: liveScanpy.status === 'generated',
      receipt_can_claim_domain_ready: false,
      receipt_can_claim_clinical_validity: false,
    },
  });
  writeJson(artifactPaths.artifact_manifest, {
    surface_kind: 'opl_bio_sc_rna_seq_artifact_manifest',
    case_id: testCase.case_id,
    scenario_agent_id: 'opl_bio_sc_rna_seq_agent',
    domain_pack_ref: SC_RNA_SEQ_DOMAIN_PACK_REF,
    artifact_paths: artifactPaths,
    routine_analysis_coverage: routineCoverage,
    seed_rule_mode: profile.seed_rule_mode,
    analysis_profile: profile.analysis_profile,
    inference_basis: profile.inference_basis,
    local_inputs: {
      counts_tsv: materializedInput.counts_path,
      cell_metadata_tsv: materializedInput.metadata_path,
      input_materialization_receipt: artifactPaths.input_materialization_receipt,
    },
    generated_file_count: Object.keys(artifactPaths).length,
    live_scanpy_runner: {
      status: liveScanpy.status,
      receipt_path: liveScanpy.receipt_path,
      blocker: liveScanpy.blocker,
      figure_generation: liveScanpy.receipt?.figure_generation ?? null,
    },
    cell_annotation_execution: {
      status: cellAnnotationExecution.receipt?.status ?? null,
      receipt_path: artifactPaths.cell_annotation_execution_receipt,
      policy_id: cellAnnotationPolicy?.policy_id ?? null,
      model_kind: cellAnnotationPolicy?.model_kind ?? null,
    },
    claim_artifacts: {
      claim_table: artifactPaths.claim_table,
      evidence_ledger: artifactPaths.evidence_ledger,
      claim_count: claimRows.length,
      evidence_row_count: evidenceRows.length,
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
    case_id: testCase.case_id,
    benchmark_id: testCase.benchmark_id,
    status: 'generated',
    analysis_profile: profile.analysis_profile,
    seed_rule_mode: profile.seed_rule_mode,
    inference_basis: profile.inference_basis,
    execution_mode: executionMode,
    ablation_mode: ablationMode,
    input_materialization: {
      requested_lane: materializedInput.receipt?.requested_lane,
      materialized_lane: materializedInput.receipt?.materialized_lane,
      receipt_path: artifactPaths.input_materialization_receipt,
    },
    dataset: {
      geo_accession: inputTask.geo_accession,
      data_ref: testCase.data_ref,
      counts_matrix_ref: inputTask.counts_matrix_ref,
      cell_metadata_ref: inputTask.cell_metadata_ref,
      data_level: inputTask.data_level,
    },
    domain_pack_ref: SC_RNA_SEQ_DOMAIN_PACK_REF,
    contrast: inputTask.contrast,
    cell_ids: matrix.cellIds,
    predicted_cell_types: Object.keys(markerGenesByCellType),
    cell_predictions: cellPredictions,
    cell_annotation_policy: cellAnnotationPolicy
      ? {
          policy_id: cellAnnotationPolicy.policy_id,
          model_kind: cellAnnotationPolicy.model_kind ?? 'generic_marker_signature',
          policy_ref: inputTask.cell_annotation_policy_ref ?? SC_RNA_SEQ_DOMAIN_PACK_REF,
          feedback_adapted: cellAnnotationPolicy.authority_boundary?.policy_is_feedback_adapted === true,
          may_be_used_for_primary_same_case_benchmark: cellAnnotationPolicy.authority_boundary?.policy_may_be_used_for_primary_same_case_benchmark !== false,
        }
      : null,
    expression_scale: expressionScale,
    marker_genes_by_cell_type: markerGenesByCellType,
    predicted_condition_response_genes: responseGenes,
    enrichment_terms: terms,
    claims: profile.claims,
    limitations: profile.limitations,
    deeper_mining_options: profile.deeper_mining_options,
    artifacts: artifactPaths,
    artifact_root: outDir,
    stage_receipts_path: artifactPaths.stage_receipts,
    review_receipt_path: artifactPaths.review_receipt,
    review_status: reviewReceipt.status,
    manuscript_evidence_summary_path: artifactPaths.manuscript_evidence_summary,
    evidence_refs: refs,
    live_scanpy_runner: liveScanpy,
    routine_analysis_coverage: routineCoverage,
    agent_trace_refs: [
      'agent_runner:sc_rna_seq_agent.v0.8',
      `seed_rule_mode:${profile.seed_rule_mode}`,
      `analysis_profile:${profile.analysis_profile}`,
      `execution_mode:${executionMode}`,
      `ablation_mode:${ablationMode}`,
    ],
    authority_boundary: {
      prediction_can_claim_live_geo_download: false,
      prediction_can_claim_scanpy_processed_matrix_replay: liveScanpy.status === 'generated',
      prediction_can_claim_seurat_or_scanpy: liveScanpy.status === 'generated',
      prediction_can_claim_article_grade_replay: false,
      prediction_can_claim_candidate_marker_signature_cell_annotations: cellPredictions.length === matrix.cellIds.length,
      prediction_can_claim_core_scrna_workflow_support: routineCoverage.authority_boundary.coverage_can_claim_core_workflow_support,
      prediction_uses_feedback_adapted_cell_annotation_policy: cellAnnotationPolicy?.authority_boundary?.policy_is_feedback_adapted === true,
      prediction_uses_external_cell_annotation_candidate: externalAnnotationPolicy,
      prediction_uses_postfreeze_promoted_cell_annotation_policy: cellAnnotationPolicy?.authority_boundary?.policy_is_postfreeze_promoted === true,
      prediction_can_claim_article_grade_cell_annotation_accuracy: false,
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
  const artifactRoot = path.resolve(args.artifact_root ?? '/private/tmp/opl-bio-agent/sc-rna-seq');
  const pythonBin = args.python_bin ?? 'python3';
  const pack = domainPack(repoRoot);
  const suite = readJson(args.cases);
  const casePredictions = (suite.cases ?? []).map((testCase) => {
    const caseStartedAt = new Date().toISOString();
    const caseStartedMs = Date.now();
    try {
      return runCase(
        testCase,
        repoRoot,
        agentRoot,
        artifactRoot,
        args.seed_rule_mode,
        pythonBin,
        pack,
        args.enable_scanpy_umap,
        args.ablation_mode,
      );
    } catch (error) {
      if (args.ablation_mode !== 'no_error_recovery') throw error;
      const outDir = path.join(artifactRoot, testCase.case_id);
      const runReceiptPath = path.join(outDir, 'run_receipt.json');
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();
      const wallClockMs = Math.max(1, Date.now() - caseStartedMs);
      writeJson(runReceiptPath, {
        surface_kind: 'opl_bio_sc_rna_seq_case_run_receipt',
        status: 'semantic_failure',
        case_id: testCase.case_id,
        scenario_agent_id: 'opl_bio_sc_rna_seq_agent',
        ablation_mode: args.ablation_mode,
        ablation_components: {
          planner_enabled: true,
          tool_retrieval_enabled: true,
          verifier_quality_gate_enabled: true,
          error_recovery_enabled: false,
        },
        blocker: message,
        artifact_root: outDir,
        started_at: caseStartedAt,
        completed_at: completedAt,
        wall_clock_ms: wallClockMs,
        tool_invocation_count: 1,
        retry_count: 0,
        planning_steps: 1,
        tool_calls_by_class: { external_analysis_process: 1 },
        unique_tools: 1,
        database_accesses: 0,
        software_versions: [`node@${process.version}`, 'sc-rna-seq-agent@v0.7'],
        database_versions: ['none:not_used_by_agent_execution'],
        instrumentation_scope: 'per_case_agent_execution',
      });
      return {
        case_id: testCase.case_id,
        benchmark_id: testCase.benchmark_id,
        status: 'blocked',
        blocker: message,
        ablation_mode: args.ablation_mode,
        predicted_cell_types: [],
        cell_predictions: [],
        marker_genes_by_cell_type: {},
        predicted_condition_response_genes: [],
        enrichment_terms: [],
        claims: [],
        limitations: ['primary tool failed and error recovery was disabled'],
        deeper_mining_options: [],
        artifacts: { run_receipt: runReceiptPath },
        artifact_root: outDir,
        authority_boundary: {
          prediction_can_claim_article_grade_replay: false,
          prediction_can_claim_domain_ready: false,
          prediction_can_claim_clinical_validity: false,
        },
      };
    }
  });
  const predictions = {
    surface_kind: 'opl_bio_sc_rna_seq_prediction_suite',
    version: 'opl-bio-sc-rna-seq-predictions.v0.6',
    owner: 'opl-bio-agent',
    generated_by: 'runtime/agent_runner/sc_rna_seq_agent.mjs',
    generation_scope: 'agent_output_not_gold_fixture',
    scenario_agent_id: 'opl_bio_sc_rna_seq_agent',
    domain_pack_ref: SC_RNA_SEQ_DOMAIN_PACK_REF,
    domain_pack_path: pack.path,
    execution_mode: 'live_scanpy_processed_matrix_replay_when_available_else_processed_matrix_analysis',
    seed_rule_mode: args.seed_rule_mode,
    python_bin: pythonBin,
    enable_scanpy_umap: args.enable_scanpy_umap,
    ablation_mode: args.ablation_mode,
    artifact_root: artifactRoot,
    predictions: casePredictions,
    authority_boundary: {
      prediction_can_claim_domain_ready: false,
      prediction_can_claim_biological_quality_verdict: false,
      prediction_can_claim_clinical_validity: false,
      prediction_can_claim_live_geo_download: false,
      prediction_can_claim_seurat_or_scanpy: false,
      prediction_can_claim_article_grade_replay: false,
    },
  };

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(predictions, null, 2)}\n`);
  console.log(JSON.stringify({
    surface_kind: 'opl_bio_sc_rna_seq_agent_receipt',
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
  if (process.env.OPL_SCR_DEBUG_STACK === '1' && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  console.error(JSON.stringify({
    surface_kind: 'opl_bio_sc_rna_seq_agent_receipt',
    status: 'blocked',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
