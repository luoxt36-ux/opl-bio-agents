import crypto from 'node:crypto';

import {
  classifyM2ExecutionFailure,
  m2FailureFingerprint,
  m2RetryRecoveryAction,
} from './m2-source-truth-retry-policy.mjs';
import {
  assertDecisionShape,
  scoreRoutineGenomeDecision,
} from '../score-opl-bio-genome-routine-analysis-decision-v1.mjs';

export const GENOME_ROUTINE_COMPARATOR_SYSTEMS = Object.freeze([
  { system_id: 'gflab_gpt_5_5', provider: 'gflab', adapter: 'openai_responses_compatible', model: 'gpt-5.5', system_class: 'general_model' },
  { system_id: 'claude_sonnet_4_6', provider: 'claude', adapter: 'anthropic_api', model: 'claude-sonnet-4-6', system_class: 'general_model' },
  { system_id: 'gemini_3_5_flash', provider: 'gemini', adapter: 'gemini_api', model: 'gemini-3.5-flash', system_class: 'general_model' },
  { system_id: 'modelarts_glm_5_1', provider: 'modelarts', adapter: 'openai_chat_compatible', model: 'GLM-5.1', system_class: 'general_model' },
  { system_id: 'modelarts_deepseek_v4_pro', provider: 'modelarts', adapter: 'openai_chat_compatible', model: 'deepseek-v4-Pro', system_class: 'general_model' },
  { system_id: 'modelarts_kimi_k2_6', provider: 'modelarts', adapter: 'openai_chat_compatible', model: 'Kimi-K2.6', system_class: 'general_model' },
  { system_id: 'modelarts_qwen3_32b', provider: 'modelarts', adapter: 'openai_chat_compatible', model: 'Qwen3-32B', system_class: 'general_model' },
  { system_id: 'codex_gpt_5_6_sol', provider: 'codex_current', adapter: 'codex_cli', model: 'gpt-5.6-sol', system_class: 'code_agent' },
  { system_id: 'biomni_gpt_5_5', provider: 'gflab', adapter: 'biomni_agent', model: 'gpt-5.5', system_class: 'biomedical_agent' },
]);

export const GENOME_ROUTINE_REQUEST_VERSION = 'opl_bio_genome_routine_analysis_prediction_request_v1';
export const GENOME_ROUTINE_SYSTEM_ID_PLACEHOLDER = '__DISPATCHER_BINDS_SYSTEM_ID__';
export const GENOME_ROUTINE_MAX_AUTOMATIC_RETRIES = 3;

const FORBIDDEN_OUTBOUND_KEYS = new Set([
  'analysis_goal_id',
  'domain_id',
  'modality_id',
  'private_truth',
  'private_verifier',
  'truth_manifest',
  'decision_rubric',
  'scorer',
  'scoring_code',
  'expected_method',
  'answer_key',
]);

const RETRYABLE_OUTPUT_FAILURES = new Set([
  'network_transient',
  'api_timeout',
  'api_rate_limit',
  'provider_5xx',
  'transport_reset',
  'token_or_context_limit_recoverable',
  'provider_policy_false_positive',
  'malformed_schema',
]);

export function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function auditGenomeRoutineOutbound(value) {
  const findings = [];
  const visit = (item, pointer) => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${pointer}/${index}`));
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      const childPointer = `${pointer}/${key}`;
      if (FORBIDDEN_OUTBOUND_KEYS.has(key)) findings.push({ code: 'forbidden_outbound_key', key, pointer: childPointer });
      visit(child, childPointer);
    }
  };
  visit(value, '');
  return { valid: findings.length === 0, findings };
}

export function buildGenomeRoutinePredictionRequest(taskBundle, outputSchema, options = {}) {
  if (taskBundle?.surface_kind !== 'opl_bio_genome_routine_analysis_truth_stripped_task_v2') {
    throw new Error('invalid_truth_stripped_task_bundle');
  }
  if (taskBundle.private_truth_included !== false || taskBundle.private_verifier_included !== false) {
    throw new Error('task_bundle_truth_isolation_failed');
  }
  const schemaSha256 = options.schemaSha256 ?? sha256Text(canonicalJson(outputSchema));
  if (taskBundle.output_schema?.sha256 !== schemaSha256) throw new Error('task_bundle_output_schema_hash_mismatch');
  const payload = {
    surface_kind: GENOME_ROUTINE_REQUEST_VERSION,
    version: 'v1',
    instruction: [
      'This is a blinded, retrospective benchmark over public genomic asset metadata.',
      'Use only the embedded truth-free task bundle. Do not request, infer, reconstruct, or search for benchmark truth.',
      'Do not claim that BAM, CRAM, VCF, FASTQ, reference, annotation, or truth files were executed or inspected; only their public metadata is visible here.',
      'Do not use web search, filesystem access, a terminal, code execution, function calls, or other external tools for this prediction.',
      'Return exactly one JSON object conforming to output_schema, with no Markdown fence or commentary.',
      `Set system_id to the literal placeholder ${GENOME_ROUTINE_SYSTEM_ID_PLACEHOLDER}; the dispatcher binds the registered system identity locally after return.`,
      'Copy task_id exactly. Set truth_accessed to false.',
      'Choose the method family, parameters, ordered actions, QC, recovery, evidence, limitations, claim scope, confidence, and rationale from task semantics rather than identifiers or a fixed case lookup.',
    ].join(' '),
    task_bundle: taskBundle,
    output_schema: outputSchema,
    dispatcher_binding: {
      system_id_placeholder: GENOME_ROUTINE_SYSTEM_ID_PLACEHOLDER,
      only_system_id_is_bound_after_return: true,
      semantic_fields_are_never_rewritten: true,
    },
  };
  const audit = auditGenomeRoutineOutbound(payload);
  if (!audit.valid) throw new Error(`outbound_request_contains_forbidden_fields:${audit.findings.map((row) => row.key).join(',')}`);
  const text = canonicalJson(payload);
  return {
    payload,
    text,
    sha256: sha256Text(text),
    byte_count: Buffer.byteLength(text),
    audit,
  };
}

function balancedJsonObjects(text) {
  const candidates = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

export class RoutineGenomeOutputError extends Error {
  constructor(code, message) {
    super(`${code}:${message}`);
    this.name = 'RoutineGenomeOutputError';
    this.code = code;
  }
}

export function extractGenomeRoutineDecision(text) {
  const trimmed = String(text ?? '').trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const candidates = [unfenced, ...balancedJsonObjects(unfenced)].filter(Boolean);
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      const parsed = JSON.parse(candidates[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Keep scanning for a complete JSON object.
    }
  }
  throw new RoutineGenomeOutputError('malformed_schema', 'provider_response_did_not_contain_one_json_object');
}

export function normalizeGenomeRoutineDecision(rawDecision, { taskId, systemId, schema }) {
  if (!rawDecision || typeof rawDecision !== 'object' || Array.isArray(rawDecision)) {
    throw new RoutineGenomeOutputError('malformed_schema', 'decision_must_be_object');
  }
  if (rawDecision.task_id !== taskId) {
    throw new RoutineGenomeOutputError('malformed_schema', `task_id_mismatch:${rawDecision.task_id ?? 'missing'}:${taskId}`);
  }
  const decision = { ...rawDecision, system_id: systemId };
  try {
    assertDecisionShape(decision, schema);
  } catch (error) {
    throw new RoutineGenomeOutputError('malformed_schema', error.message);
  }
  return decision;
}

export function scoreGenomeRoutineDecisionLocally(decision, options = {}) {
  return scoreRoutineGenomeDecision(decision, options);
}

function classifyFailure(error) {
  if (error?.code === 'malformed_schema') return 'malformed_schema';
  return classifyM2ExecutionFailure(error?.message ?? error, 'model');
}

function recoveryActionFor(failureClass) {
  if (failureClass === 'malformed_schema') return 'repeat_identical_request_after_malformed_schema';
  if (failureClass === 'token_or_context_limit_recoverable') return 'repeat_identical_request_after_context_limit';
  return m2RetryRecoveryAction(failureClass);
}

function attemptId(systemId, taskId, attemptIndex) {
  return `${systemId}__${taskId}__attempt_${String(attemptIndex + 1).padStart(2, '0')}`;
}

export async function runGenomeRoutineUnitWithRetries(options) {
  const {
    system,
    taskId,
    domain = 'genome_routine_analysis',
    request,
    taskPackageSha256,
    schema,
    scorerSha256,
    rubric,
    maxAutomaticRetries = GENOME_ROUTINE_MAX_AUTOMATIC_RETRIES,
    invoke,
    normalizeDecision = normalizeGenomeRoutineDecision,
    scoreDecision = scoreGenomeRoutineDecisionLocally,
    onAttempt = async () => {},
    beforeRetry = async () => {},
  } = options;
  if (!Number.isInteger(maxAutomaticRetries) || maxAutomaticRetries < 0) throw new Error('invalid_max_automatic_retries');
  if (typeof invoke !== 'function') throw new Error('invoke_function_required');
  if (typeof normalizeDecision !== 'function') throw new Error('normalize_decision_function_required');
  if (typeof scoreDecision !== 'function') throw new Error('score_decision_function_required');
  const attempts = [];
  for (let attemptIndex = 0; attemptIndex <= maxAutomaticRetries; attemptIndex += 1) {
    const startedAt = new Date().toISOString();
    let providerResult = null;
    try {
      providerResult = await invoke({ attemptIndex, requestText: request.text, requestSha256: request.sha256 });
      const rawDecision = extractGenomeRoutineDecision(providerResult?.text);
      const decision = normalizeDecision(rawDecision, { taskId, systemId: system.system_id, schema });
      const decisionText = canonicalJson(decision);
      const decisionSha256 = sha256Text(decisionText);
      const score = scoreDecision(decision, { rubric, schema });
      const row = {
        run_unit_id: `${system.system_id}::${taskId}`,
        case_id: taskId,
        domain,
        system_id: system.system_id,
        attempt_id: attemptId(system.system_id, taskId, attemptIndex),
        attempt_index: attemptIndex,
        input_sha256: request.sha256,
        logical_task_package_sha256: taskPackageSha256,
        request_envelope_sha256: request.sha256,
        scorer_sha256: scorerSha256,
        execution_status: 'success',
        output_or_null: { decision_sha256: decisionSha256 },
        retry_classification: null,
        failure_fingerprint: null,
        recovery_action: null,
        terminal_failure_or_null: null,
        retry_decision: 'stop_success',
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        provider_metadata: providerResult?.metadata ?? {},
      };
      attempts.push(row);
      await onAttempt({ row, rawText: providerResult?.text ?? '', decision, score, providerResult });
      return { status: 'success', attempts, decision, score, provider_metadata: providerResult?.metadata ?? {} };
    } catch (error) {
      const failureClass = classifyFailure(error);
      const recoveryAction = recoveryActionFor(failureClass);
      const retryable = RETRYABLE_OUTPUT_FAILURES.has(failureClass) && Boolean(recoveryAction);
      const willRetry = retryable && attemptIndex < maxAutomaticRetries;
      const terminalFailure = willRetry ? null : {
        failure_class: failureClass,
        disposition: retryable ? 'retry_budget_exhausted' : 'nonrecoverable_failure',
      };
      const row = {
        run_unit_id: `${system.system_id}::${taskId}`,
        case_id: taskId,
        domain,
        system_id: system.system_id,
        attempt_id: attemptId(system.system_id, taskId, attemptIndex),
        attempt_index: attemptIndex,
        input_sha256: request.sha256,
        logical_task_package_sha256: taskPackageSha256,
        request_envelope_sha256: request.sha256,
        scorer_sha256: scorerSha256,
        execution_status: willRetry ? 'not_evaluable' : 'terminal_failure',
        output_or_null: null,
        retry_classification: failureClass,
        failure_fingerprint: m2FailureFingerprint(error?.message ?? error),
        recovery_action: recoveryAction,
        terminal_failure_or_null: terminalFailure,
        retry_decision: willRetry ? 'retry' : 'stop',
        terminal_disposition: terminalFailure?.disposition ?? null,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        error: String(error?.message ?? error),
        provider_metadata: providerResult?.metadata ?? {},
      };
      attempts.push(row);
      await onAttempt({
        row,
        error,
        rawText: providerResult?.text ?? '',
        providerResult,
      });
      if (willRetry) {
        await beforeRetry({ attemptIndex, failureClass, recoveryAction });
        continue;
      }
      return { status: 'terminal_failure', attempts, decision: null, score: null, terminal_failure: terminalFailure };
    }
  }
  throw new Error('retry_loop_exhausted_without_terminal_result');
}
