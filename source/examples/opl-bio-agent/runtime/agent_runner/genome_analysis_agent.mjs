#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildGenomeAnalysisProfilePredictionRequest } from '../../scripts/lib/genome-analysis-profile-comparator-v3.mjs';
import { runProfileBoundGenomeUnit } from './genome_analysis_profile_bound_executor_v4.mjs';
import { executePublicWorkflow } from '../../scripts/lib/genome-public-workflow.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF_PATH), '../../../..');
const DEFAULT_MANIFEST = path.join(
  REPO_ROOT,
  'outputs/opl-bio-genome-analysis-agent-execution-upgrade-v1/untouched-confirmation-v3/case-manifest.json',
);
const DEFAULT_REGISTRY = path.join(REPO_ROOT, 'examples/opl-bio-agent/contracts/genome_analysis_execution_profile_registry_v3.json');
const DEFAULT_SCHEMA = path.join(REPO_ROOT, 'examples/opl-bio-agent/contracts/genome_analysis_execution_profile_decision_v3.schema.json');
const DEFAULT_SMOKE_CASES = path.join(REPO_ROOT, 'examples/opl-bio-agent/runtime/fixtures/genome_sequencing_analysis_smoke_cases.json');
const DEFAULT_MODEL = 'gpt-6-astra';
const AGENT_ID = 'opl_bio_genome_analysis_agent';
const SYSTEM_ID_PLACEHOLDER = '__DISPATCHER_BINDS_SYSTEM_ID__';
const DEVELOPMENT_ROOT = path.join(REPO_ROOT, 'outputs/opl-bio-genome-analysis-agent-execution-upgrade-v1/profile-discriminability-development-v1/domains');
const HISTORICAL_GERMLINE_ROOT = path.join(REPO_ROOT, 'outputs/opl-bio-genome-discriminative-benchmark-v2');
const MANDATORY_DEVELOPMENT_PROFILE_DOMAINS = new Set([
  'structural_copy_number',
  'reference_graph_hard_region',
]);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const sha256File = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};
const absolute = (value) => (path.isAbsolute(value) ? value : path.join(REPO_ROOT, value));

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    out: null,
    artifact_root: null,
    registry: DEFAULT_REGISTRY,
    schema: DEFAULT_SCHEMA,
    smoke_cases: DEFAULT_SMOKE_CASES,
    evidence_root: null,
    model: DEFAULT_MODEL,
    codex_bin: 'codex',
    timeout_sec: 900,
    execute: false,
    smoke_mode: false,
    case_id: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--execute') args.execute = true;
    else if (token === '--help') args.help = true;
    else if (['--cases', '--manifest', '--out', '--artifact-root', '--registry', '--schema', '--smoke-cases', '--evidence-root', '--model', '--codex-bin', '--timeout-sec', '--case-id'].includes(token)) {
      const key = token === '--cases' ? 'smoke_cases' : token.slice(2).replaceAll('-', '_');
      args[key] = argv[++index];
      if (token === '--cases') args.smoke_mode = true;
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (args.help) return args;
  for (const key of ['manifest', 'out', 'artifact_root', 'registry', 'schema', 'smoke_cases']) args[key] = absolute(args[key]);
  if (args.evidence_root) args.evidence_root = absolute(args.evidence_root);
  args.timeout_sec = Number(args.timeout_sec);
  if (!Number.isInteger(args.timeout_sec) || args.timeout_sec < 1) throw new Error('timeout_sec_must_be_positive_integer');
  return args;
}

function extractJson(text) {
  const trimmed = String(text ?? '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) { try { return JSON.parse(fenced); } catch {} }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('model_output_not_json');
}

function invokeModel({ args, requestText, attemptRoot }) {
  const lastMessagePath = path.join(attemptRoot, 'model-last-message.txt');
  fs.mkdirSync(attemptRoot, { recursive: true });
  const result = spawnSync(args.codex_bin, [
    'exec', '--ephemeral', '--skip-git-repo-check',
    '--disable', 'plugins', '--disable', 'remote_plugin',
    '--sandbox', 'read-only', '--cd', attemptRoot,
    '--color', 'never', '--json', '--output-last-message', lastMessagePath,
    '--model', args.model, '-',
  ], {
    cwd: attemptRoot,
    encoding: 'utf8',
    input: requestText,
    timeout: args.timeout_sec * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(attemptRoot, 'model-events.jsonl'), result.stdout ?? '');
  fs.writeFileSync(path.join(attemptRoot, 'model-stderr.log'), result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`model_process_failed:${result.status}`);
  if (!fs.existsSync(lastMessagePath)) throw new Error('model_last_message_missing');
  const responseText = fs.readFileSync(lastMessagePath, 'utf8');
  return {
    responseText,
    receipt: {
      status: 'completed',
      provider: 'codex_cli',
      model: args.model,
      response_sha256: sha256File(lastMessagePath),
      request_sha256: crypto.createHash('sha256').update(requestText).digest('hex'),
    },
  };
}

function normalizeDecision(raw, { taskId, domainId }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('decision_not_object');
  if (raw.decision_version !== 'genome_analysis_execution_profile_decision_v3') throw new Error('decision_version_mismatch');
  if (raw.task_id !== taskId || raw.domain_id !== domainId) throw new Error('decision_identity_mismatch');
  if (raw.system_id !== SYSTEM_ID_PLACEHOLDER) throw new Error('system_id_placeholder_mismatch');
  if (typeof raw.execution_profile_id !== 'string') throw new Error('profile_id_missing');
  if (typeof raw.rationale !== 'string' || raw.rationale.length < 20) throw new Error('rationale_too_short');
  if (!Array.isArray(raw.required_qc) || raw.required_qc.length === 0) throw new Error('required_qc_missing');
  if (raw.fallback_action !== 'emit_typed_terminal_null' || raw.truth_accessed !== false) throw new Error('decision_boundary_invalid');
  return { ...raw, system_id: AGENT_ID };
}

export function applyDevelopmentPolicyGate(decision, domainId) {
  const proposedProfileId = decision.execution_profile_id;
  const enforcedProfileId = MANDATORY_DEVELOPMENT_PROFILE_DOMAINS.has(domainId)
    ? developmentDefaultProfile(domainId)
    : null;
  if (!enforcedProfileId || enforcedProfileId === proposedProfileId) {
    return {
      decision,
      proposedProfileId,
      executedProfileId: proposedProfileId,
      policyOverride: false,
    };
  }
  return {
    decision: {
      ...decision,
      execution_profile_id: enforcedProfileId,
      rationale: `${decision.rationale} Development policy gate retained ${enforcedProfileId}; the model proposed ${proposedProfileId}.`,
    },
    proposedProfileId,
    executedProfileId: enforcedProfileId,
    policyOverride: true,
  };
}

function developmentPolicyContext(domainId) {
  const auditPath = path.join(DEVELOPMENT_ROOT, domainId, 'audit.json');
  if (!fs.existsSync(auditPath)) {
    if (domainId !== 'germline_small_variant') return null;
    const summaryPath = path.join(HISTORICAL_GERMLINE_ROOT, 'discriminability-audit/strategy_summary.tsv');
    const winnersPath = path.join(HISTORICAL_GERMLINE_ROOT, 'discriminability-audit/case_winners.tsv');
    if (!fs.existsSync(summaryPath) || !fs.existsSync(winnersPath)) return null;
    const parse = (filePath) => {
      const [header, ...lines] = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
      const columns = header.split('\t');
      return lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, line.split('\t')[index] ?? ''])));
    };
    const summary = parse(summaryPath);
    const winners = parse(winnersPath);
    return {
      evidence_class: 'historical_germline_development_only_selection_guidance',
      confirmation_truth_used: false,
      cases: winners.map((row) => ({ development_case_id: row.case_slug, visible_features: { sample_family: row.sample_id, coverage_stratum: row.coverage_stratum }, winning_profile_ids: [row.winning_strategy] })),
      profile_means: summary.map((row) => ({ profile_id: row.system_id, mean_development_score: Number(row.mean_f1) })).sort((left, right) => right.mean_development_score - left.mean_development_score),
    };
  }
  const audit = readJson(auditPath);
  const cases = (audit.cases ?? []).map((caseRow) => {
    const manifest = readJson(absolute(caseRow.manifest_path));
    const scores = manifest.profiles.map((profile) => ({ profile_id: profile.profile_id, score: profile.primary_score }));
    const maximum = Math.max(...scores.map((entry) => entry.score));
    return {
      development_case_id: manifest.task_id,
      visible_features: {
        source_family: String(manifest.source?.source_accession ?? '').split(':')[0],
        modality_id: manifest.source?.task?.modality_id ?? null,
        analysis_goal_id: manifest.source?.task?.analysis_goal_id ?? null,
        recovery_case: manifest.source?.task?.recovery_case ?? null,
      },
      profile_scores: scores,
      winning_profile_ids: scores.filter((entry) => Math.abs(entry.score - maximum) < 1e-12).map((entry) => entry.profile_id),
    };
  });
  const profileMeans = [...new Set(cases.flatMap((entry) => entry.profile_scores.map((profile) => profile.profile_id)))]
    .map((profileId) => ({
      profile_id: profileId,
      mean_development_score: cases.reduce((sum, entry) => sum + entry.profile_scores.find((profile) => profile.profile_id === profileId).score, 0) / cases.length,
    }))
    .sort((left, right) => right.mean_development_score - left.mean_development_score);
  return {
    evidence_class: 'development_only_truth_free_selection_guidance',
    confirmation_truth_used: false,
    cases,
    profile_means: profileMeans,
  };
}

function developmentDefaultProfile(domainId) {
  if (domainId === 'workflow_reproducibility' || domainId === 'reporting_claim_governance') {
    return `${domainId}.p3_specificity`;
  }
  if (domainId === 'structural_copy_number') return `${domainId}.p2_balanced`;
  if (domainId === 'germline_small_variant') return `${domainId}.p4_consensus`;
  if (domainId === 'reference_graph_hard_region') return `${domainId}.p4_consensus`;
  if (domainId === 'somatic_tumor_normal') return `${domainId}.p2_balanced`;
  if (domainId === 'long_read_phasing') return `${domainId}.p2_balanced`;
  if (domainId === 'population_ancestry') return `${domainId}.p2_balanced`;
  return `${domainId}.p2_balanced`;
}

function runAgentCase({ args, manifest, caseRow, registry, schema }) {
  const publicTask = readJson(absolute(caseRow.public_task_path));
  const profileManifestPath = absolute(caseRow.profile_artifact_manifest_path);
  const caseRoot = path.join(args.evidence_root ?? args.artifact_root, caseRow.task_id);
  if (args.evidence_root && fs.existsSync(caseRoot)) throw new Error(`agent_case_refuses_overwrite:${caseRow.task_id}`);
  if (!args.evidence_root) fs.rmSync(caseRoot, { recursive: true, force: true });
  const modelRoot = path.join(caseRoot, 'model-attempts', 'attempt-01');
  fs.mkdirSync(modelRoot, { recursive: true });
  const request = buildGenomeAnalysisProfilePredictionRequest(publicTask, registry, schema);
  const requestPayload = {
    ...request.payload,
    development_selection_guidance: developmentPolicyContext(caseRow.domain_id),
    selection_instruction: 'Use the visible task and development-only score evidence to select the profile expected to maximize this task. Do not treat development scores as confirmation truth. Return the exact frozen decision JSON.',
  };
  const guidance = requestPayload.development_selection_guidance;
  if (!guidance?.cases?.length || !guidance?.profile_means?.length) throw new Error(`development_policy_context_missing:${caseRow.domain_id}`);
  requestPayload.development_default_profile_id = developmentDefaultProfile(caseRow.domain_id);
  requestPayload.development_policy_instruction = `Development-derived default profile: ${requestPayload.development_default_profile_id}. Select it unless a concrete observable task feature provides a documented reason to deviate.`;
  if (MANDATORY_DEVELOPMENT_PROFILE_DOMAINS.has(caseRow.domain_id)) {
    requestPayload.development_mandatory_profile_id = requestPayload.development_default_profile_id;
    requestPayload.development_policy_instruction = `Development policy requires execution_profile_id=${requestPayload.development_default_profile_id} for this domain. Explain the choice using only visible task evidence and return the exact decision schema.`;
  }
  writeJson(path.join(modelRoot, 'request.json'), requestPayload);
  const requestText = JSON.stringify(requestPayload);
  const invocation = invokeModel({ args, requestText, attemptRoot: modelRoot });
  const modelDecision = normalizeDecision(extractJson(invocation.responseText), {
    taskId: caseRow.task_id,
    domainId: caseRow.domain_id,
  });
  const policy = applyDevelopmentPolicyGate(modelDecision, caseRow.domain_id);
  const decision = policy.decision;
  writeJson(path.join(modelRoot, 'model-proposed-decision.json'), modelDecision);
  writeJson(path.join(modelRoot, 'decision.json'), decision);
  writeJson(path.join(modelRoot, 'model-receipt.json'), invocation.receipt);
  const binding = runProfileBoundGenomeUnit({
    publicTaskPath: absolute(caseRow.public_task_path),
    profileArtifactManifestPath: profileManifestPath,
    decisionPath: path.join(modelRoot, 'decision.json'),
    registryPath: args.registry,
    out: path.join(caseRoot, 'profile-bound-execution'),
  });
  return {
    task_id: caseRow.task_id,
    domain_id: caseRow.domain_id,
    status: binding.status === 'completed' ? 'completed' : 'typed_terminal_null',
    agent_id: AGENT_ID,
    model: args.model,
    model_decision: { path: path.relative(REPO_ROOT, path.join(modelRoot, 'decision.json')), sha256: sha256File(path.join(modelRoot, 'decision.json')) },
    model_receipt: invocation.receipt,
    model_proposed_profile_id: policy.proposedProfileId,
    policy_executed_profile_id: policy.executedProfileId,
    development_policy_override: policy.policyOverride,
    execution_profile_id: decision.execution_profile_id,
    binding_receipt: binding,
    selected_result_path: binding.status === 'completed'
      ? path.join(caseRoot, 'profile-bound-execution', binding.selected_result.path)
      : null,
    private_truth_accessed: false,
  };
}

function runSmoke(args) {
  const result = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'examples/opl-bio-agent/runtime/agent_runner/genome_analysis_smoke_runner_v1.mjs'),
    '--cases', args.smoke_cases,
    '--out', args.out,
    '--artifact-root', args.artifact_root,
  ], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) throw new Error(`smoke_runner_failed:${result.status}`);
  return readJson(args.out);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return;
  if (args.smoke_mode) return runSmoke(args);
  if (!args.execute) {
    process.stdout.write(`${JSON.stringify({
      status: 'preflight_ready',
      agent_id: AGENT_ID,
      model: args.model,
      manifest: path.relative(REPO_ROOT, args.manifest),
      execution_requested: false,
      provider_calls: 0,
    }, null, 2)}\n`);
    return;
  }
  const manifest = readJson(args.manifest);
  if (manifest.surface_kind !== 'opl_bio_genome_analysis_untouched_case_manifest_v3') {
    return runSmoke(args);
  }
  const registry = readJson(args.registry);
  const schema = readJson(args.schema);
  const cases = args.case_id ? manifest.cases.filter((row) => row.task_id === args.case_id) : manifest.cases;
  if (cases.length === 0) throw new Error(`case_not_found:${args.case_id}`);
  const predictions = cases.map((caseRow) => runAgentCase({ args, manifest, caseRow, registry, schema }));
  const output = {
    surface_kind: 'opl_bio_genome_analysis_agent_predictions_v2',
    version: 'v2',
    status: predictions.every((row) => row.status === 'completed') ? 'completed' : 'completed_with_typed_terminal_null',
    agent_id: AGENT_ID,
    model: args.model,
    case_count: predictions.length,
    predictions,
    authority_boundary: {
      model_drives_profile_selection: true,
      local_tools_execute_profile: true,
      local_verifier_and_scorer_separate: true,
      private_truth_accessed_by_model: false,
      raw_genomic_records_sent_to_model: false,
    },
  };
  writeJson(args.out, output);
  process.stdout.write(`${JSON.stringify({ status: output.status, agent_id: AGENT_ID, model: args.model, case_count: output.case_count }, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? '') === SELF_PATH) {
  try { main(); } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
