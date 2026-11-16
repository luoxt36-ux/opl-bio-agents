#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const BASE_VERIFIER = path.resolve('examples/opl-bio-agent/runtime/authority_functions/sc_rna_seq_benchmark_verifier.mjs');

function usage() {
  return 'Usage: node runtime/authority_functions/sc_rna_seq_routine_analysis_verifier.mjs --cases <cases.json> --predictions <predictions.json> [--oracle <private-oracle.json>]';
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cases' || token === '--predictions' || token === '--oracle') {
      out[token.slice(2)] = argv[index + 1];
      index += 1;
    } else if (token === '--help') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runBaseVerifier(args) {
  const verifierArgs = [BASE_VERIFIER, '--cases', args.cases, '--predictions', args.predictions];
  if (args.oracle) verifierArgs.push('--oracle', args.oracle);
  const result = spawnSync(process.execPath, verifierArgs, { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 });
  const stdout = String(result.stdout ?? '').trim();
  if (!stdout) throw new Error(String(result.stderr ?? 'base verifier produced no JSON').trim());
  return JSON.parse(stdout);
}

function verifyCoverage(prediction) {
  const coverage = prediction?.routine_analysis_coverage;
  const rows = coverage?.routine_capabilities ?? [];
  const coreRows = rows.filter((row) => row.class === 'core');
  const coveredRows = coreRows.filter((row) => ['verified', 'partial'].includes(row.status));
  const explicitUnsupported = rows.filter((row) => row.class === 'specialized' && row.status === 'unsupported');
  const missingCoreEvidence = coreRows.filter((row) => {
    const artifactPath = row?.evidence_refs?.artifact;
    return typeof artifactPath !== 'string' || !fs.existsSync(artifactPath);
  }).map((row) => row.capability_id);
  const requiredArtifacts = [
    'routine_analysis_coverage',
    'scaled_expression',
    'cell_cycle_scores',
    'module_scores',
    'pathway_enrichment',
    'cell_composition',
    'scanpy_highly_variable_genes',
    'scanpy_cluster_assignments',
    'scanpy_umap_coordinates',
    'scanpy_pseudobulk_de',
    'batch_diagnostic',
    'doublet_screen',
    'trajectory_readiness',
  ];
  const missingArtifacts = requiredArtifacts.filter((name) => {
    const artifactPath = prediction?.artifacts?.[name];
    return typeof artifactPath !== 'string' || !fs.existsSync(artifactPath);
  });
  const checks = {
    coverage_receipt_present: Boolean(coverage),
    core_capability_count_complete: coreRows.length === 17,
    every_core_capability_explicitly_covered: coveredRows.length === 17,
    every_core_evidence_artifact_present: missingCoreEvidence.length === 0,
    specialized_boundaries_explicit: explicitUnsupported.length === 6,
    raw_read_boundary_explicit: rows.some((row) => row.class === 'upstream' && row.capability_id === 'raw_fastq_to_feature_barcode_matrix' && row.status === 'unsupported'),
    routine_artifacts_present: missingArtifacts.length === 0,
  };
  return {
    case_id: prediction?.case_id ?? null,
    status: Object.values(checks).every(Boolean) ? 'passed' : 'blocked',
    checks,
    core_capability_count: coreRows.length,
    covered_core_capability_count: coveredRows.length,
    verified_core_capability_count: coreRows.filter((row) => row.status === 'verified').length,
    partial_core_capability_count: coreRows.filter((row) => row.status === 'partial').length,
    specialized_unsupported_count: explicitUnsupported.length,
    missing_artifacts: missingArtifacts,
    missing_core_evidence: missingCoreEvidence,
    authority_boundary: {
      verifier_can_claim_core_workflow_support: Object.values(checks).every(Boolean),
      verifier_can_claim_article_grade_replay: false,
      verifier_can_claim_clinical_validity: false,
      verifier_can_claim_specialized_modality_support: false,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.cases || !args.predictions) throw new Error(usage());
  const baseVerification = runBaseVerifier(args);
  const predictions = readJson(args.predictions);
  const routineResults = (predictions.predictions ?? []).map(verifyCoverage);
  const passedCount = routineResults.filter((result) => result.status === 'passed').length;
  const status = baseVerification.status === 'passed' && passedCount === routineResults.length ? 'passed' : 'blocked';
  const result = {
    surface_kind: 'opl_bio_sc_rna_seq_routine_analysis_verification',
    version: 'opl-bio-sc-rna-seq-routine-analysis-verifier.v2',
    owner: 'opl-bio-agent',
    status,
    base_verification: baseVerification,
    cases_path: path.resolve(args.cases),
    predictions_path: path.resolve(args.predictions),
    oracle_path: args.oracle ? path.resolve(args.oracle) : null,
    case_count: routineResults.length,
    passed_count: passedCount,
    blocked_count: routineResults.length - passedCount,
    routine_case_results: routineResults,
    coverage_contract_ref: 'examples/opl-bio-agent/contracts/sc_rna_seq_routine_analysis_coverage_v1.json',
    authority_boundary: {
      verifier_can_claim_core_workflow_support: status === 'passed',
      verifier_can_claim_article_grade_replay: false,
      verifier_can_claim_biological_quality_verdict: false,
      verifier_can_claim_clinical_validity: false,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (status !== 'passed') process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ surface_kind: 'opl_bio_sc_rna_seq_routine_analysis_verification', status: 'blocked', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
