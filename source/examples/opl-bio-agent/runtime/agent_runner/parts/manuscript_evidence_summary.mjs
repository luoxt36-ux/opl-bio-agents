import fs from 'node:fs';
import path from 'node:path';

function unique(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.trim()))];
}

function relativeRefs(baseDir, artifactPaths) {
  return Object.fromEntries(Object.entries(artifactPaths ?? {})
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => [key, path.relative(baseDir, value)]));
}

function evidenceTableRows(summary) {
  const rows = [
    ['Case', summary.case_id],
    ['Scenario', summary.scenario],
    ['Execution mode', summary.execution?.execution_mode],
    ['Seed rule mode', summary.execution?.seed_rule_mode],
    ['Review status', summary.artifact_evidence?.review_status],
    ['Stage receipt count', summary.artifact_evidence?.stage_receipt_count],
    ['Primary genes', unique(summary.primary_results?.genes).join(', ')],
    ['Primary terms', unique(summary.primary_results?.terms).join('; ')],
  ];
  if (summary.primary_results?.cell_types?.length) {
    rows.push(['Cell types', unique(summary.primary_results.cell_types).join(', ')]);
  }
  return rows.map(([key, value]) => `| ${key} | ${String(value ?? 'n/a').replaceAll('\n', ' ')} |`).join('\n');
}

function markdownForCaseSummary(summary) {
  return [
    `# ${summary.case_id} Manuscript Evidence Summary`,
    '',
    'This file is a case-level writing aid generated from the OPL-Bio scenario-agent artifacts. It is not a private oracle, biological quality verdict, clinical claim, or submission-ready manuscript section.',
    '',
    '## Result Snapshot',
    '',
    '| Field | Value |',
    '| --- | --- |',
    evidenceTableRows(summary),
    '',
    '## Supported Claims',
    '',
    ...(summary.manuscript_claims?.supported_claims ?? []).map((claim) => `- ${claim}`),
    '',
    '## Required Boundaries',
    '',
    ...(summary.manuscript_claims?.required_limitations ?? []).map((limitation) => `- ${limitation}`),
    '',
    '## Leakage Boundary',
    '',
    `- Public input only: ${summary.blind_boundary?.public_input_only === true}`,
    `- Case-specific accession rule used: ${summary.blind_boundary?.case_specific_accession_rule_used === true}`,
    `- Case-specific literature rule used: ${summary.blind_boundary?.case_specific_literature_rule_used === true}`,
    `- Source-paper lookup used: ${summary.blind_boundary?.source_paper_lookup_used === true}`,
    `- Private oracle used by agent: ${summary.blind_boundary?.private_oracle_used_by_agent === true}`,
    '',
    '## Artifact Refs',
    '',
    ...Object.entries(summary.artifact_evidence?.artifact_refs ?? {}).map(([key, value]) => `- ${key}: \`${value}\``),
    '',
  ].join('\n');
}

export function writeCaseManuscriptEvidenceSummary({
  jsonPath,
  markdownPath,
  scenario,
  scenarioAgentId,
  testCase,
  dataset,
  contrast,
  execution,
  primaryResults,
  claims,
  limitations,
  deeperMiningOptions,
  artifactPaths,
  stageReceipts,
  reviewReceipt,
  inferenceBasis,
  authorityBoundary = {},
}) {
  const outDir = path.dirname(jsonPath);
  const summary = {
    surface_kind: 'opl_bio_case_manuscript_evidence_summary',
    version: 'opl-bio-case-manuscript-evidence-summary.v0.1',
    generated_at: new Date().toISOString(),
    scenario,
    scenario_agent_id: scenarioAgentId,
    case_id: testCase.case_id,
    benchmark_id: testCase.benchmark_id ?? null,
    dataset,
    contrast,
    execution,
    primary_results: {
      genes: unique(primaryResults?.genes),
      terms: unique(primaryResults?.terms),
      cell_types: unique(primaryResults?.cell_types),
      marker_genes_by_cell_type: primaryResults?.marker_genes_by_cell_type ?? null,
      quantitative_context: primaryResults?.quantitative_context ?? {},
    },
    manuscript_claims: {
      supported_claims: unique(claims),
      required_limitations: unique(limitations),
      deeper_mining_options: unique(deeperMiningOptions),
    },
    artifact_evidence: {
      artifact_refs: relativeRefs(outDir, artifactPaths),
      stage_receipt_count: (stageReceipts ?? []).length,
      stage_ids: (stageReceipts ?? []).map((receipt) => receipt.stage_id).filter(Boolean),
      review_status: reviewReceipt?.status ?? null,
      review_blockers: reviewReceipt?.blockers ?? [],
    },
    blind_boundary: {
      public_input_only: true,
      case_specific_accession_rule_used: inferenceBasis?.case_specific_accession_rule_used === true,
      case_specific_literature_rule_used: inferenceBasis?.case_specific_literature_rule_used === true,
      source_paper_lookup_used: inferenceBasis?.source_paper_lookup_used === true,
      published_findings_lookup_used: inferenceBasis?.published_findings_lookup_used === true,
      private_oracle_used_by_agent: inferenceBasis?.private_oracle_used === true,
    },
    authority_boundary: {
      summary_can_claim_submission_ready: false,
      summary_can_claim_domain_ready: false,
      summary_can_claim_biological_quality_verdict: false,
      summary_can_claim_clinical_validity: false,
      ...authorityBoundary,
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (markdownPath) {
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    fs.writeFileSync(markdownPath, markdownForCaseSummary(summary));
  }
  return summary;
}
