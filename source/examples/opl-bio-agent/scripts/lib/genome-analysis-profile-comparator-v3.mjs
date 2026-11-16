import {
  RoutineGenomeOutputError,
  canonicalJson,
  sha256Text,
} from './genome-routine-analysis-comparator-v1.mjs';

export const GENOME_ANALYSIS_PROFILE_REQUEST_VERSION = 'opl_bio_genome_analysis_profile_prediction_request_v3';
export const GENOME_ANALYSIS_SYSTEM_ID_PLACEHOLDER = '__DISPATCHER_BINDS_SYSTEM_ID__';

const FORBIDDEN_OUTBOUND_KEYS = new Set([
  'source_record_sha256',
  'source_accession',
  'source_independence_cluster_id',
  'source_uri',
  'private_truth',
  'truth_payload',
  'truth_manifest',
  'truth_record',
  'answer_key',
  'scorer',
  'scorer_sha256',
  'scoring_code',
  'expected_profile',
  'expected_result',
]);

const DECISION_KEYS = Object.freeze([
  'decision_version',
  'task_id',
  'domain_id',
  'system_id',
  'execution_profile_id',
  'required_qc',
  'rationale',
  'fallback_action',
  'truth_accessed',
]);

export function auditGenomeAnalysisProfileOutbound(value) {
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

function projectGenomeAnalysisProfileOutbound(value) {
  if (Array.isArray(value)) return value.map((entry) => projectGenomeAnalysisProfileOutbound(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FORBIDDEN_OUTBOUND_KEYS.has(key))
    .map(([key, child]) => [key, projectGenomeAnalysisProfileOutbound(child)]));
}

function domainProfiles(registry, domainId) {
  const domain = (registry.domains ?? []).find((entry) => entry.domain_id === domainId);
  if (!domain || !Array.isArray(domain.profiles) || domain.profiles.length !== 4) {
    throw new Error(`frozen_domain_profile_catalog_missing:${domainId}`);
  }
  return domain.profiles;
}

export function buildGenomeAnalysisProfilePredictionRequest(taskBundle, registry, outputSchema) {
  if (taskBundle?.surface_kind !== 'opl_bio_genome_analysis_untouched_public_task_v3'
    || taskBundle.version !== 'v3'
    || taskBundle.private_truth_visible !== false) {
    throw new Error('invalid_untouched_public_task_bundle');
  }
  if (taskBundle.visible_task?.task_id !== taskBundle.task_id
    || taskBundle.visible_task?.domain_id !== taskBundle.domain_id) {
    throw new Error('visible_task_identity_mismatch');
  }
  const profiles = domainProfiles(registry, taskBundle.domain_id);
  const expectedProfileIds = profiles.map((profile) => profile.profile_id).sort();
  const releasedProfileIds = [...(taskBundle.allowed_execution_profile_ids ?? [])].sort();
  if (JSON.stringify(expectedProfileIds) !== JSON.stringify(releasedProfileIds)) {
    throw new Error('visible_profile_catalog_mismatch');
  }
  const payload = {
    surface_kind: GENOME_ANALYSIS_PROFILE_REQUEST_VERSION,
    version: 'v3',
    instruction: [
      'This is a blinded retrospective benchmark over a de-identified public genomic analysis task.',
      'Use only the embedded visible_task and frozen execution_profiles.',
      'Do not search for benchmark sources or truth and do not call external tools.',
      'Select exactly one released execution_profile_id based on the observable task semantics.',
      'Return exactly one JSON object conforming to output_schema, without Markdown or commentary.',
      `Set system_id to ${GENOME_ANALYSIS_SYSTEM_ID_PLACEHOLDER}; the dispatcher binds the registered identity locally.`,
      'Copy task_id and domain_id exactly, set truth_accessed to false, and use the fixed fallback_action.',
    ].join(' '),
    visible_task: projectGenomeAnalysisProfileOutbound(taskBundle.visible_task),
    execution_profiles: profiles,
    output_schema: outputSchema,
    dispatcher_binding: {
      system_id_placeholder: GENOME_ANALYSIS_SYSTEM_ID_PLACEHOLDER,
      only_system_id_is_bound_after_return: true,
      semantic_fields_are_never_rewritten: true,
    },
  };
  const audit = auditGenomeAnalysisProfileOutbound(payload);
  if (!audit.valid) {
    throw new Error(`outbound_request_contains_forbidden_fields:${audit.findings.map((row) => row.key).join(',')}`);
  }
  const text = canonicalJson(payload);
  return {
    payload,
    text,
    sha256: sha256Text(text),
    byte_count: Buffer.byteLength(text),
    audit,
  };
}

function malformed(message) {
  throw new RoutineGenomeOutputError('malformed_schema', message);
}

export function normalizeGenomeAnalysisProfileDecision(rawDecision, { taskId, domainId, systemId }) {
  if (!rawDecision || typeof rawDecision !== 'object' || Array.isArray(rawDecision)) malformed('decision_must_be_object');
  const keys = Object.keys(rawDecision).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...DECISION_KEYS].sort())) malformed('decision_keys_do_not_match_frozen_schema');
  if (rawDecision.decision_version !== 'genome_analysis_execution_profile_decision_v3') malformed('decision_version_mismatch');
  if (rawDecision.task_id !== taskId) malformed(`task_id_mismatch:${rawDecision.task_id ?? 'missing'}:${taskId}`);
  if (rawDecision.domain_id !== domainId) malformed(`domain_id_mismatch:${rawDecision.domain_id ?? 'missing'}:${domainId}`);
  if (rawDecision.system_id !== GENOME_ANALYSIS_SYSTEM_ID_PLACEHOLDER) malformed('system_id_placeholder_mismatch');
  if (typeof rawDecision.execution_profile_id !== 'string'
    || !/^[a-z0-9_]+\.p[1-4]_[a-z0-9_]+$/.test(rawDecision.execution_profile_id)) malformed('execution_profile_id_invalid');
  if (!Array.isArray(rawDecision.required_qc) || rawDecision.required_qc.length < 1
    || new Set(rawDecision.required_qc).size !== rawDecision.required_qc.length
    || rawDecision.required_qc.some((value) => typeof value !== 'string' || value.length < 1)) malformed('required_qc_invalid');
  if (typeof rawDecision.rationale !== 'string' || rawDecision.rationale.length < 20) malformed('rationale_too_short');
  if (rawDecision.fallback_action !== 'emit_typed_terminal_null') malformed('fallback_action_mismatch');
  if (rawDecision.truth_accessed !== false) malformed('truth_boundary_violation');
  return { ...rawDecision, system_id: systemId };
}
