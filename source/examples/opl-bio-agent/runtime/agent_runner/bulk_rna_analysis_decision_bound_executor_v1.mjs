#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_ADAPTERS = {
  deseq2: path.join(REPO_ROOT, 'examples/opl-bio-agent/runtime/tool_adapters/bulk_rna_seq_deseq2_clusterprofiler.R'),
  limma_voom: path.join(REPO_ROOT, 'examples/opl-bio-agent/runtime/tool_adapters/bulk_rna_seq_limma_processed_expression.R'),
};
const FORBIDDEN_KEYS = new Set([
  'predicted_up_genes', 'predicted_down_genes', 'predicted_genes', 'enrichment_terms',
  'claims', 'genes', 'gene_list', 'gene_set', 'gene_sets',
]);
const DECISION_KEYS = new Set(['decision_version', 'case_id', 'system_id', 'selected_de_method', 'selected_enrichment_method', 'design_formula', 'contrast', 'parameters', 'recovery_policy', 'evidence_refs', 'rationale', 'policy_evidence', 'truth_accessed']);
const CONTRAST_KEYS = new Set(['case_condition', 'control_condition']);
const PARAMETER_KEYS = new Set(['fdr_threshold', 'log2fc_threshold', 'minimum_count', 'p_adjust_method']);
const RECOVERY_KEYS = new Set(['on_missing_input', 'on_tool_failure']);
const POLICY_EVIDENCE_KEYS = new Set(['protocol_ref', 'case_profile_ref', 'decision_basis', 'sensitivity_plan']);
const DECISION_BASIS_KEYS = new Set(['sample_size', 'paired_or_blocked_design', 'library_depth', 'integer_count_or_processed_scale', 'sparsity', 'effect_size_distribution']);
const SENSITIVITY_KEYS = new Set(['lower_log2fc_threshold', 'upper_log2fc_threshold', 'minimum_count_zero']);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const writeText = (file, value) => fs.writeFileSync(file, value);

function typedNull(failureType, message, details = {}) {
  return { status: 'typed_terminal_null', failure_type: failureType, failure_message: message, retryable: false, zero_imputed: false, details };
}

function containsForbiddenKey(value, location = '$') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = containsForbiddenKey(value[i], `${location}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return `${location}.${key}`;
    const found = containsForbiddenKey(child, `${location}.${key}`);
    if (found) return found;
  }
  return null;
}

function hasUnexpectedKeys(value, allowed, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  return unexpected ? `${location}.${unexpected}` : null;
}

export function bindBulkRnaAnalysisDecision({ decision, testCase }) {
  if (!decision || typeof decision !== 'object') return typedNull('decision_contract_invalid', 'Decision must be an object.');
  const forbidden = containsForbiddenKey(decision);
  if (forbidden) return typedNull('model_prediction_in_decision', 'Decision contains a model-predicted gene, enrichment, or claim field.', { location: forbidden });
  const unexpected = hasUnexpectedKeys(decision, DECISION_KEYS, '$')
    ?? hasUnexpectedKeys(decision.contrast, CONTRAST_KEYS, '$.contrast')
    ?? hasUnexpectedKeys(decision.parameters, PARAMETER_KEYS, '$.parameters')
    ?? hasUnexpectedKeys(decision.recovery_policy, RECOVERY_KEYS, '$.recovery_policy')
    ?? hasUnexpectedKeys(decision.policy_evidence, POLICY_EVIDENCE_KEYS, '$.policy_evidence')
    ?? hasUnexpectedKeys(decision.policy_evidence?.decision_basis, DECISION_BASIS_KEYS, '$.policy_evidence.decision_basis')
    ?? hasUnexpectedKeys(decision.policy_evidence?.sensitivity_plan, SENSITIVITY_KEYS, '$.policy_evidence.sensitivity_plan');
  if (unexpected) return typedNull('decision_contract_invalid', 'Decision contains a field outside the v1 contract.', { location: unexpected });
  if (decision.decision_version !== 'bulk_rna_analysis_decision_v1') return typedNull('decision_contract_mismatch', 'Unsupported decision_version.');
  if (decision.case_id !== testCase.case_id) return typedNull('case_id_mismatch', 'Decision case_id does not match the case.');
  if (decision.truth_accessed !== false) return typedNull('truth_boundary_violation', 'truth_accessed must be false.');
  const input = testCase.input_task ?? {};
  if (decision.system_id !== 'opl_bio_bulk_rna_seq_agent') return typedNull('system_id_mismatch', 'Decision system_id is not the Bulk RNA-seq Agent.');
  if (!decision.contrast || decision.contrast.case_condition !== input.contrast?.case_condition || decision.contrast.control_condition !== input.contrast?.control_condition) {
    return typedNull('target_mismatch', 'Decision contrast does not match the visible case target.');
  }
  if (decision.design_formula !== input.design_formula) return typedNull('target_mismatch', 'Decision design_formula does not match the visible case target.');
  const p = decision.parameters ?? {};
  if (!(p.fdr_threshold > 0 && p.fdr_threshold <= 0.25) || !(p.log2fc_threshold >= 0 && p.log2fc_threshold <= 20) || !Number.isInteger(p.minimum_count) || p.minimum_count < 0 || p.minimum_count > 1000000 || !['BH', 'bonferroni', 'holm'].includes(p.p_adjust_method)) {
    return typedNull('threshold_out_of_range', 'Decision parameters are outside the frozen allowlist.');
  }
  if (!['deseq2', 'limma_voom'].includes(decision.selected_de_method) || !['clusterProfiler_GO_BP', 'none'].includes(decision.selected_enrichment_method)) {
    return typedNull('unsupported_method', 'Decision selected method is not supported.');
  }
  if (decision.recovery_policy?.on_missing_input !== 'typed_terminal_null' || decision.recovery_policy?.on_tool_failure !== 'typed_terminal_null') {
    return typedNull('recovery_policy_invalid', 'Recovery policy must be typed_terminal_null.');
  }
  if (decision.policy_evidence) {
    const sensitivity = decision.policy_evidence.sensitivity_plan;
    if (!(sensitivity.lower_log2fc_threshold < sensitivity.upper_log2fc_threshold)) return typedNull('sensitivity_plan_invalid', 'Sensitivity bounds must be ordered.');
    if (sensitivity.lower_log2fc_threshold === p.log2fc_threshold && sensitivity.upper_log2fc_threshold === p.log2fc_threshold) return typedNull('sensitivity_plan_invalid', 'Sensitivity plan must include an alternative threshold.');
  }
  return { status: 'bound', case_id: testCase.case_id, system_id: decision.system_id, selected_de_method: decision.selected_de_method, selected_enrichment_method: decision.selected_enrichment_method, design_formula: decision.design_formula, contrast: decision.contrast, parameters: p, policy_evidence: decision.policy_evidence ?? null, truth_accessed: false };
}

function parseTsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim() ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/) : [];
  if (!lines.length) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => Object.fromEntries(line.split('\t').map((value, i) => [headers[i], value])));
}

function tsv(rows, columns) {
  return `${columns.join('\t')}\n${rows.map((row) => columns.map((column) => row[column] ?? '').join('\t')).join('\n')}${rows.length ? '\n' : ''}`;
}

function runAdapter({ decision, testCase, outDir, rscript, adapterPath, adapterRunner }) {
  const input = testCase.input_task.local_inputs;
  const countsFlag = decision.selected_de_method === 'limma_voom' ? '--expression' : '--counts';
  const args = [countsFlag, path.resolve(input.counts_tsv), '--sample-sheet', path.resolve(input.sample_sheet_tsv), '--out-dir', outDir, '--case-condition', decision.contrast.case_condition, '--control-condition', decision.contrast.control_condition, '--design-formula', decision.design_formula];
  if (adapterRunner) return adapterRunner({ decision, testCase, outDir, adapterPath, rscript, args });
  const result = spawnSync(rscript, [adapterPath, ...args], { encoding: 'utf8', timeout: 20 * 60 * 1000, env: { ...process.env } });
  if (result.status !== 0) throw new Error(`adapter_exit_${result.status}:${String(result.stderr ?? '').trim().slice(-500)}`);
}

function deRowsForMethod(method, outDir) {
  const file = method === 'deseq2' ? path.join(outDir, 'deseq2_results.tsv') : path.join(outDir, 'limma_results.tsv');
  if (!fs.existsSync(file)) throw new Error(`missing_de_results:${path.basename(file)}`);
  return { file, rows: parseTsv(file) };
}

function selectRows(rows, parameters, minimumCountSupport = 0) {
  return rows.filter(row => row.padj <= parameters.fdr_threshold
    && Math.abs(row.log2fc) >= parameters.log2fc_threshold
    && (parameters.minimum_count === 0 || row.minimum_count_support >= Math.min(minimumCountSupport || Number.MAX_SAFE_INTEGER, parameters.minimum_count)));
}

function runIdentifierMapping({ rows, outDir, rscript, identifierMapper }) {
  if (rows.length === 0) return [];
  if (identifierMapper) return identifierMapper({ rows, outDir, rscript });
  const inputFile = path.join(outDir, 'gene-identifiers.tsv');
  const outputFile = path.join(outDir, 'gene-symbol-map.tsv');
  const identifierFor = (row) => String(row.identifier ?? row.gene ?? '');
  writeText(inputFile, `identifier\tkeytype\n${rows.map(row => `${identifierFor(row)}\t${/^ENSG\d+/.test(identifierFor(row)) ? 'ENSEMBL' : 'SYMBOL'}`).join('\n')}\n`);
  const script = path.join(REPO_ROOT, 'scripts/map-opl-bio-gene-identifiers-v1.R');
  const mapped = spawnSync(rscript, [script, inputFile, outputFile], { encoding: 'utf8', timeout: 10 * 60 * 1000, env: { ...process.env } });
  if (mapped.status !== 0) throw new Error(`identifier_mapping_exit_${mapped.status}:${String(mapped.stderr ?? '').trim().slice(-500)}`);
  return parseTsv(outputFile).map(row => ({ ...row, symbol: row.symbol || row.identifier }));
}

function bindAndExecuteCase(testCase, decision, outDir, options) {
  const executionCase = {
    ...testCase,
    input_task: {
      ...(testCase.input_task ?? {}),
      design_formula: decision?.design_formula ?? testCase.input_task?.design_formula,
      contrast: decision?.contrast ?? testCase.input_task?.contrast,
    },
  };
  const binding = bindBulkRnaAnalysisDecision({ decision, testCase: executionCase });
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, 'decision-binding.json'), binding);
  const writeFailureOutputs = (failure) => {
    writeJson(path.join(outDir, 'execution_receipt.json'), { ...failure, case_id: testCase.case_id, truth_accessed: false });
    writeText(path.join(outDir, 'significant_genes.tsv'), 'gene\tlog2fc\tpadj\n');
    writeText(path.join(outDir, 'down_genes.tsv'), 'gene\tlog2fc\tpadj\n');
    writeText(path.join(outDir, 'enrichment_terms.tsv'), 'term_id\tterm_name\tp_adjusted\toverlap_genes\n');
    return { ...failure, case_id: testCase.case_id };
  };
  if (binding.status !== 'bound') return writeFailureOutputs(binding);
  const inputs = testCase.public_task?.local_inputs ?? testCase.input_task?.local_inputs ?? {};
  const inputBase = options.casesBaseDir ?? process.cwd();
  const resolveInput = (value) => {
    if (!value) return null;
    if (path.isAbsolute(value)) return value;
    const relativeToCases = path.resolve(inputBase, value);
    const relativeToRepo = path.resolve(REPO_ROOT, value);
    if (fs.existsSync(relativeToCases)) return relativeToCases;
    if (fs.existsSync(relativeToRepo)) return relativeToRepo;
    return relativeToCases;
  };
  const countsPath = resolveInput(inputs.counts_tsv);
  const sampleSheetPath = resolveInput(inputs.sample_sheet_tsv);
  if (!countsPath || !sampleSheetPath || !fs.existsSync(countsPath) || !fs.existsSync(sampleSheetPath)) {
    const failure = typedNull('missing_input', 'Required local input is missing.', { counts_tsv: countsPath, sample_sheet_tsv: sampleSheetPath });
    writeJson(path.join(outDir, 'decision-binding.json'), failure);
    return writeFailureOutputs(failure);
  }
  try {
    const adapterPath = options.adapterPaths?.[binding.selected_de_method] ?? DEFAULT_ADAPTERS[binding.selected_de_method];
    const adapterCase = { ...executionCase, input_task: { ...executionCase.input_task, local_inputs: { counts_tsv: countsPath, sample_sheet_tsv: sampleSheetPath } } };
    runAdapter({ decision, testCase: adapterCase, outDir, rscript: options.rscript ?? 'Rscript', adapterPath, adapterRunner: options.adapterRunner });
    const result = deRowsForMethod(binding.selected_de_method, outDir);
    const p = binding.parameters;
    const normalized = result.rows.map((row) => {
      const log2fcValue = row.log2FoldChange ?? row.logFC;
      const padjValue = row.padj ?? row.adj_P_Val ?? row['adj.P.Val'];
      const countValue = row.minimum_count_support ?? row.count_at_least_10 ?? row.mean_count ?? row.baseMean;
      const symbol = typeof row.symbol === 'string' && row.symbol.trim() && row.symbol.trim() !== 'NA' ? row.symbol.trim() : null;
      return {
        ...row,
        symbol,
        gene: row.gene,
        identifier: row.ensembl_id ?? row.gene,
        log2fc: log2fcValue == null || log2fcValue === '' ? Number.NaN : Number(log2fcValue),
        padj: padjValue == null || padjValue === '' ? Number.NaN : Number(padjValue),
        count: countValue == null || countValue === '' ? Number.NaN : Number(countValue),
      };
    }).filter((row) => row.gene && Number.isFinite(row.log2fc) && Number.isFinite(row.padj));
    const counts = parseTsv(countsPath);
    const sampleIds = Object.keys(counts[0] ?? {}).filter(column => column !== 'gene');
    const countByGene = new Map(counts.map(row => [row.gene, sampleIds.map(sample => Number(row[sample] ?? 0))]));
    const groups = [...new Set(parseTsv(sampleSheetPath).map(row => row.condition))].map(condition => parseTsv(sampleSheetPath).filter(row => row.condition === condition).map(row => row.sample_id));
    const smallestGroupSize = Math.min(...groups.map(group => group.length));
    for (const row of normalized) row.minimum_count_support = (countByGene.get(row.identifier) ?? countByGene.get(row.gene) ?? []).filter(value => value >= p.minimum_count).length;
    const eligible = selectRows(normalized, p, smallestGroupSize);
    const mapping = runIdentifierMapping({ rows: eligible, outDir, rscript: options.rscript ?? 'Rscript', identifierMapper: options.identifierMapper });
    const symbolByIdentifier = new Map(mapping.map(row => [row.identifier, row.symbol]));
    const projected = eligible.map(row => ({ ...row, projected_gene: row.symbol?.trim() || symbolByIdentifier.get(row.identifier) || row.gene || row.identifier }));
    const up = projected.filter((row) => row.log2fc > 0).sort((a, b) => b.log2fc - a.log2fc || a.padj - b.padj || a.projected_gene.localeCompare(b.projected_gene));
    const down = projected.filter((row) => row.log2fc < 0).map(row => ({ ...row, gene: row.projected_gene })).sort((a, b) => a.log2fc - b.log2fc || a.padj - b.padj || a.gene.localeCompare(b.gene));
    writeText(path.join(outDir, 'significant_genes.tsv'), tsv(projected.map(row => ({ ...row, gene: row.projected_gene })), ['gene', 'log2fc', 'padj']));
    writeText(path.join(outDir, 'down_genes.tsv'), tsv(down, ['gene', 'log2fc', 'padj']));
    const enrichmentPath = path.join(outDir, binding.selected_de_method === 'deseq2' ? 'clusterprofiler_enrichment_results.tsv' : 'enrichment_results.tsv');
    const enrichmentRows = binding.selected_enrichment_method === 'none' ? [] : (fs.existsSync(enrichmentPath) ? parseTsv(enrichmentPath) : []);
    writeText(path.join(outDir, 'enrichment_terms.tsv'), binding.selected_enrichment_method === 'none' ? 'term_id\tterm_name\tp_adjusted\toverlap_genes\n' : `${fs.readFileSync(enrichmentPath, 'utf8')}`);
    const prediction = { case_id: testCase.case_id, status: 'completed', significant_up_genes: up.map((row) => row.projected_gene), significant_down_genes: down.map((row) => row.gene), enrichment_terms: enrichmentRows.map((row) => row.term_id ?? row.ID ?? row.term_name ?? row.Description).filter(Boolean) };
    const sensitivity = binding.policy_evidence?.sensitivity_plan ? {
      lower_log2fc_threshold: selectRows(normalized, { ...p, log2fc_threshold: binding.policy_evidence.sensitivity_plan.lower_log2fc_threshold }).length,
      upper_log2fc_threshold: selectRows(normalized, { ...p, log2fc_threshold: binding.policy_evidence.sensitivity_plan.upper_log2fc_threshold }).length,
      minimum_count_zero: selectRows(normalized, { ...p, minimum_count: 0 }).length,
    } : null;
    writeJson(path.join(outDir, 'execution_receipt.json'), { status: 'completed', case_id: testCase.case_id, selected_de_method: binding.selected_de_method, selected_enrichment_method: binding.selected_enrichment_method, de_results_source: path.basename(result.file), policy_evidence: binding.policy_evidence, identifier_mapping: { source: 'org.Hs.eg.db', mapped_count: mapping.filter(row => row.symbol && row.symbol !== row.identifier).length, total_count: mapping.length, mapping_file: 'gene-symbol-map.tsv' }, sensitivity, truth_accessed: false, outputs: ['decision-binding.json', 'gene-symbol-map.tsv', 'significant_genes.tsv', 'down_genes.tsv', 'enrichment_terms.tsv'] });
    return prediction;
  } catch (error) {
    const failure = typedNull('tool_failure', error instanceof Error ? error.message : String(error));
    return writeFailureOutputs(failure);
  }
}

export function runBulkRnaAnalysisDecisionBoundExecutor({ casesPath, decisionsPath, out, ...options }) {
  if (fs.existsSync(out)) throw new Error(`Output already exists: ${out}`);
  const suite = readJson(casesPath);
  const decisionsDoc = readJson(decisionsPath);
  const cases = suite.cases ?? suite;
  const decisions = decisionsDoc.decisions ?? decisionsDoc;
  const decisionByCase = new Map((Array.isArray(decisions) ? decisions : [decisions]).map((decision) => [decision.case_id, decision]));
  fs.mkdirSync(out, { recursive: false });
  const predictions = cases.map((testCase) => bindAndExecuteCase(testCase, decisionByCase.get(testCase.case_id), path.join(out, testCase.case_id), { ...options, casesBaseDir: path.dirname(path.resolve(casesPath)) }));
  const receipt = { surface_kind: 'opl_bio_bulk_rna_analysis_decision_bound_execution_receipt_v1', version: 'v1', status: predictions.every((row) => row.status === 'completed') ? 'completed' : 'typed_terminal_null', truth_accessed: false, case_count: cases.length, predictions: predictions.map((row) => ({ case_id: row.case_id, status: row.status, significant_up_genes: row.status === 'completed' ? row.significant_up_genes : null, significant_down_genes: row.status === 'completed' ? row.significant_down_genes : null, enrichment_terms: row.status === 'completed' ? row.enrichment_terms : null })) };
  writeJson(path.join(out, 'predictions.json'), receipt);
  writeJson(path.join(out, 'execution_receipt.json'), receipt);
  return receipt;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (['--cases', '--decisions', '--out', '--rscript'].includes(argv[i])) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; } else if (argv[i] === '--help') return null; else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  for (const key of ['cases', 'decisions', 'out']) if (!args[key]) throw new Error(`Missing --${key}`);
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { const args = parseArgs(process.argv.slice(2)); if (!args) process.stdout.write('Usage: node bulk_rna_analysis_decision_bound_executor_v1.mjs --cases <cases.json> --decisions <decisions.json> --out <dir> [--rscript <Rscript>]\n'); else process.stdout.write(`${JSON.stringify(runBulkRnaAnalysisDecisionBoundExecutor({ casesPath: args.cases, decisionsPath: args.decisions, out: path.resolve(args.out), rscript: args.rscript }), null, 2)}\n`); } catch (error) { process.stderr.write(`${JSON.stringify(typedNull('executor_failure', error instanceof Error ? error.message : String(error)))}\n`); process.exitCode = 1; }
}
