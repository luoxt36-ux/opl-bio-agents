#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (['--cases', '--out', '--artifact-root'].includes(token)) {
      args[token.slice(2).replaceAll('-', '_')] = argv[index + 1];
      index += 1;
    } else if (token === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.cases || !args.out || !args.artifact_root) throw new Error('Required: --cases <json> --out <json> --artifact-root <dir>');
  return args;
}

const sha256File = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); };
const requireFile = (filePath, label) => { if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`); return filePath; };

function alignmentMetrics(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const records = lines.filter((line) => !line.startsWith('@'));
  const contigs = [...new Set(records.map((line) => line.split('\t')[2]).filter(Boolean))];
  return { alignment_record_count: records.length, aligned_contig_count: contigs.length, aligned_contigs: contigs };
}

function vcfMetrics(filePath) {
  const records = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
  return { candidate_variant_record_count: records.length, candidate_variant_records_present: records.length > 0 };
}

function referenceMetrics(filePath) {
  const contigs = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.startsWith('>')).map((line) => line.slice(1).split(/\s+/)[0]);
  return { reference_contig_count: contigs.length, reference_contigs: contigs };
}

function runCase(testCase, casesPath, outPath, artifactRoot) {
  if (testCase.task_kind === 'genome_sequencing_analysis_coverage') {
    const coveragePath = path.resolve(process.cwd(), testCase.coverage_receipt_path);
    const contractPath = path.resolve(process.cwd(), testCase.coverage_contract_path);
    requireFile(coveragePath, 'real-domain coverage receipt');
    requireFile(contractPath, 'real-domain coverage contract');
    const coverage = readJson(coveragePath);
    const artifactDir = path.resolve(artifactRoot, testCase.case_id);
    fs.mkdirSync(artifactDir, { recursive: true });
    const reportPath = path.join(artifactDir, 'coverage-assessment.json');
    const report = {
      surface_kind: 'opl_bio_genome_sequencing_analysis_coverage_assessment_v1',
      case_id: testCase.case_id,
      task_kind: testCase.task_kind,
      coverage_receipt_path: testCase.coverage_receipt_path,
      coverage_receipt_sha256: sha256File(coveragePath),
      coverage_contract_path: testCase.coverage_contract_path,
      coverage_contract_sha256: sha256File(contractPath),
      metrics: {
        case_count: coverage.case_count,
        scientific_or_analysis_case_count: coverage.scientific_or_analysis_case_count,
        governance_case_count: coverage.governance_case_count,
        covered_domain_count: coverage.covered_domain_count,
        covered_stage_count: coverage.covered_stage_count,
        objective_endpoint_pass_count: coverage.objective_endpoint_pass_count,
        coverage_gate_passed: coverage.coverage_gate_passed,
        private_truth_separate: coverage.private_truth_separate,
      },
      claim_boundary: testCase.claim_boundary,
    };
    writeJson(reportPath, report);
    return {
      case_id: testCase.case_id,
      task_kind: testCase.task_kind,
      agent_id: 'opl_bio_genome_analysis_agent',
      status: 'completed_real_domain_coverage_assessment',
      coverage_assessment: { path: reportPath, sha256: sha256File(reportPath) },
      metrics: report.metrics,
      private_truth_accessed: false,
      fixture_only: false,
      scientific_claim_allowed: false,
    };
  }
  const root = path.dirname(casesPath);
  const resolveInput = (ref) => /^(?:examples|outputs)\//.test(String(ref)) ? path.resolve(process.cwd(), ref) : path.resolve(root, ref);
  const alignment = requireFile(resolveInput(testCase.alignment_path), 'alignment input');
  const reference = requireFile(resolveInput(testCase.reference_path), 'reference input');
  const candidateVcf = requireFile(resolveInput(testCase.candidate_vcf_path), 'candidate VCF input');
  if (testCase.private_truth_accessed !== false || testCase.scientific_claim_allowed !== false) throw new Error(`Smoke case boundary invalid: ${testCase.case_id}`);
  const metrics = { ...alignmentMetrics(alignment), ...referenceMetrics(reference), ...vcfMetrics(candidateVcf) };
  const decision = {
    decision_version: 'genome_sequencing_analysis_decision_v1',
    case_id: testCase.case_id,
    agent_id: 'opl_bio_genome_analysis_agent',
    method: testCase.caller_policy,
    decision_source: { kind: 'agent', provider: 'opl-bio-local-domain-runner', model: 'genome-sequencing-analysis-agent-v1' },
    truth_accessed: false,
    fallback_plan: { strategy: 'fail_closed' },
  };
  const artifactDir = path.resolve(artifactRoot, testCase.case_id);
  fs.mkdirSync(artifactDir, { recursive: true });
  const decisionPath = path.join(artifactDir, 'method-decision.json');
  const reportPath = path.join(artifactDir, 'analysis-report.json');
  const invocationPath = path.join(artifactDir, 'tool-invocation-receipt.json');
  writeJson(decisionPath, decision);
  writeJson(reportPath, {
    surface_kind: 'opl_bio_genome_sequencing_analysis_report_v1',
    case_id: testCase.case_id,
    task_kind: testCase.task_kind,
    sample_id: testCase.sample_id,
    reference_build: testCase.reference_build,
    analysis_region: testCase.analysis_region,
    metrics,
    input_artifacts: [alignment, reference, candidateVcf].map((filePath) => ({ path: filePath, sha256: sha256File(filePath) })),
    claim_boundary: testCase.claim_boundary,
  });
  writeJson(invocationPath, {
    surface_kind: 'opl_bio_genome_sequencing_analysis_tool_invocation_receipt_v1',
    tool_id: 'local_fixture_parser',
    command: 'node runtime/agent_runner/genome_analysis_agent.mjs',
    exit_code: 0,
    input_artifacts: [alignment, reference, candidateVcf].map((filePath) => ({ path: filePath, sha256: sha256File(filePath) })),
    output_artifacts: [reportPath, decisionPath].map((filePath) => ({ path: filePath, sha256: sha256File(filePath) })),
  });
  return {
    case_id: testCase.case_id,
    task_kind: testCase.task_kind,
    agent_id: 'opl_bio_genome_analysis_agent',
    status: 'completed_genome_sequencing_analysis_smoke',
    decision: { path: decisionPath, sha256: sha256File(decisionPath) },
    analysis_report: { path: reportPath, sha256: sha256File(reportPath) },
    tool_invocation: { path: invocationPath, sha256: sha256File(invocationPath) },
    metrics,
    private_truth_accessed: false,
    fixture_only: true,
    scientific_claim_allowed: false,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log('Usage: node genome_analysis_agent.mjs --cases <json> --out <json> --artifact-root <dir>'); process.exit(0); }
const casesPath = path.resolve(args.cases);
const suite = readJson(casesPath);
if (!Array.isArray(suite.cases) || suite.cases.length === 0) throw new Error('cases.json must contain at least one case');
if (fs.existsSync(path.resolve(args.out))) throw new Error(`Output already exists; refusing to overwrite: ${args.out}`);
const predictions = {
  surface_kind: 'opl_bio_genome_sequencing_analysis_predictions_v1',
  version: 'v1',
  status: 'completed_genome_sequencing_analysis_smoke',
  agent_id: 'opl_bio_genome_analysis_agent',
  domain_pack: 'contracts/genome_sequencing_analysis_scenario_domain_pack.json',
  cases: suite.cases.map((testCase) => runCase(testCase, casesPath, path.resolve(args.out), args.artifact_root)),
  authority_boundary: { scientific_performance_claim_allowed: false, clinical_validity_claim_allowed: false, publication_authority: false },
};
writeJson(path.resolve(args.out), predictions);
console.log(JSON.stringify({ status: predictions.status, agent_id: predictions.agent_id, case_count: predictions.cases.length }, null, 2));
