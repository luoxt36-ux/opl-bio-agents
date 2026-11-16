#!/usr/bin/env node
import fs from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (['--cases', '--predictions'].includes(token)) { args[token.slice(2)] = argv[index + 1]; index += 1; }
    else if (token === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.cases || !args.predictions) throw new Error('Required: --cases <json> --predictions <json>');
  return args;
}
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log('Usage: node genome_analysis_verifier.mjs --cases <json> --predictions <json>'); process.exit(0); }
const suite = readJson(args.cases);
const predictions = readJson(args.predictions);
if (predictions.agent_id !== 'opl_bio_genome_analysis_agent') throw new Error('Predictions are bound to the wrong Agent');
const rows = (suite.cases ?? []).map((testCase) => {
  const prediction = (predictions.cases ?? []).find((entry) => entry.case_id === testCase.case_id);
  const metrics = prediction?.metrics ?? {};
  if (testCase.task_kind === 'genome_sequencing_analysis_coverage') {
    const passed = prediction?.status === 'completed_real_domain_coverage_assessment'
      && Number(metrics.case_count) === Number(testCase.required_case_count)
      && Number(metrics.scientific_or_analysis_case_count) === Number(testCase.required_scientific_case_count)
      && Number(metrics.governance_case_count) === Number(testCase.required_governance_case_count)
      && Number(metrics.covered_domain_count) === Number(testCase.required_covered_domain_count)
      && Number(metrics.covered_stage_count) === Number(testCase.required_covered_stage_count)
      && Number(metrics.objective_endpoint_pass_count) === Number(testCase.required_case_count)
      && metrics.coverage_gate_passed === true
      && metrics.private_truth_separate === true
      && Boolean(prediction?.coverage_assessment?.sha256);
    return { case_id: testCase.case_id, status: passed ? 'passed' : 'blocked', checks: { real_domain_case_count: Number(metrics.case_count) === Number(testCase.required_case_count), scientific_cases: Number(metrics.scientific_or_analysis_case_count) === Number(testCase.required_scientific_case_count), governance_cases_separated: Number(metrics.governance_case_count) === Number(testCase.required_governance_case_count), covered_domains: Number(metrics.covered_domain_count) === Number(testCase.required_covered_domain_count), covered_stages: Number(metrics.covered_stage_count) === Number(testCase.required_covered_stage_count), objective_endpoint: Number(metrics.objective_endpoint_pass_count) === Number(testCase.required_case_count), coverage_gate: metrics.coverage_gate_passed === true, private_truth_separate: metrics.private_truth_separate === true, provenance_complete: Boolean(prediction?.coverage_assessment?.sha256) } };
  }
  const passed = Boolean(prediction)
    && prediction.status === 'completed_genome_sequencing_analysis_smoke'
    && prediction.private_truth_accessed === false
    && prediction.fixture_only === true
    && Number(metrics.alignment_record_count) > 0
    && Number(metrics.reference_contig_count) > 0
    && metrics.candidate_variant_records_present === true
    && prediction.decision?.sha256
    && prediction.analysis_report?.sha256
    && prediction.tool_invocation?.sha256;
  return { case_id: testCase.case_id, status: passed ? 'passed' : 'blocked', checks: { agent_identity: prediction?.agent_id === 'opl_bio_genome_analysis_agent', alignment_records: Number(metrics.alignment_record_count) > 0, reference_contigs: Number(metrics.reference_contig_count) > 0, candidate_variants: metrics.candidate_variant_records_present === true, private_truth_hidden: prediction?.private_truth_accessed === false, provenance_complete: Boolean(prediction?.decision?.sha256 && prediction?.analysis_report?.sha256 && prediction?.tool_invocation?.sha256) } };
});
const passedCount = rows.filter((row) => row.status === 'passed').length;
const verification = {
  surface_kind: 'opl_bio_genome_sequencing_analysis_verification_receipt_v1',
  version: 'v1',
  status: passedCount === rows.length && rows.length > 0 ? 'passed' : 'blocked',
  agent_id: predictions.agent_id,
  case_count: rows.length,
  passed_count: passedCount,
  rows,
  claim_boundary: 'Qualification smoke validates genome sequencing analysis workflow identity and provenance only; it does not establish accuracy, superiority, clinical validity, or publication authority.',
};
console.log(JSON.stringify(verification, null, 2));
