const DEFAULT_RETRYABLE_FAILURE_CLASSES = Object.freeze([
  'network_transient',
  'api_timeout',
  'api_rate_limit',
  'provider_5xx',
  'transport_reset',
  'token_or_context_limit_recoverable',
  'provider_policy_false_positive',
  'malformed_schema',
]);

const DEFAULT_NON_RETRYABLE_FAILURE_CLASSES = Object.freeze([
  'policy_refusal',
  'invalid_input',
  'deterministic_schema_error',
  'unsupported_model_or_capability',
  'authentication_or_quota_exhausted',
  'scientific_semantics_would_change',
]);

const HASH_FIELDS = Object.freeze([
  'input_sha256',
  'logical_task_package_sha256',
  'scorer_sha256',
]);

const REQUIRED_ATTEMPT_FIELDS = Object.freeze([
  'case_id',
  'domain',
  'system_id',
  'attempt_id',
  'attempt_index',
  'input_sha256',
  'logical_task_package_sha256',
  'request_envelope_sha256',
  'scorer_sha256',
  'execution_status',
  'output_or_null',
  'retry_classification',
  'failure_fingerprint',
  'recovery_action',
  'terminal_failure_or_null',
]);

function failureClass(row) {
  return row.retry_classification ?? row.failure_class ?? null;
}

function unitKey(row) {
  return row.run_unit_id
    ? String(row.run_unit_id)
    : [row.domain, row.case_id, row.system_id].map((value) => String(value ?? '')).join('::');
}

function finding(code, row, detail = {}) {
  return { code, unit: unitKey(row), attempt_id: row.attempt_id ?? null, ...detail };
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Validate the case/system attempt ledger before any scientific scoring.
 * Intermediate retryable attempts are explicitly non-evaluable; only the
 * frozen successful output or an exhausted/non-recoverable terminal failure
 * may close a unit.
 */
export function validateM2RetryLedger(attempts, options = {}) {
  const retryable = new Set(options.retryableFailureClasses ?? DEFAULT_RETRYABLE_FAILURE_CLASSES);
  const nonRetryable = new Set(options.nonRetryableFailureClasses ?? DEFAULT_NON_RETRYABLE_FAILURE_CLASSES);
  const rows = Array.isArray(attempts) ? attempts : [];
  const findings = [];
  const seenAttemptIds = new Set();
  const grouped = new Map();

  if (!Array.isArray(attempts)) {
    findings.push({ code: 'attempts_must_be_array' });
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      findings.push({ code: 'attempt_row_must_be_object' });
      continue;
    }
    for (const field of REQUIRED_ATTEMPT_FIELDS) {
      if (!Object.hasOwn(row, field)) findings.push(finding('missing_required_attempt_field', row, { field }));
    }
    if (hasValue(row.attempt_id)) {
      if (seenAttemptIds.has(row.attempt_id)) findings.push(finding('duplicate_attempt_id', row));
      seenAttemptIds.add(row.attempt_id);
    } else {
      findings.push(finding('missing_attempt_id', row));
    }
    const key = unitKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  for (const unitRows of grouped.values()) {
    unitRows.sort((a, b) => Number(a.attempt_index) - Number(b.attempt_index));
    const first = unitRows[0];
    if (Number(first.attempt_index) !== 0) findings.push(finding('attempt_index_must_start_at_zero', first));

    let closed = false;
    for (let index = 0; index < unitRows.length; index += 1) {
      const row = unitRows[index];
      const previous = unitRows[index - 1] ?? null;
      const next = unitRows[index + 1] ?? null;
      const currentIndex = Number(row.attempt_index);
      const klass = failureClass(row);
      const status = row.execution_status;

      if (currentIndex !== index) findings.push(finding('attempt_index_must_be_contiguous', row, { expected: index, actual: row.attempt_index }));
      if (closed) findings.push(finding('attempt_after_closed_unit', row));
      if (status === 'success' && index !== unitRows.length - 1) findings.push(finding('attempt_after_success', row));

      if (index > 0 && previous) {
        for (const field of HASH_FIELDS) {
          if (hasValue(row[field]) && hasValue(previous[field]) && row[field] !== previous[field]) {
            findings.push(finding('logical_binding_changed_across_retry', row, { field }));
          }
        }
      }

      if (retryable.has(klass)) {
        if (status === 'terminal_failure' && index === 0) {
          findings.push(finding('retryable_failure_cannot_be_terminal_on_first_attempt', row, { failure_class: klass }));
        }
        if (status === 'terminal_failure') {
          const disposition = row.terminal_disposition ?? row.terminal_failure_or_null?.disposition ?? null;
          const allowedDisposition = new Set([
            'retry_budget_exhausted',
            'time_budget_exhausted',
            'cost_budget_exhausted',
            'same_failure_fingerprint_repeated_after_recovery',
          ]);
          if (!allowedDisposition.has(disposition)) {
            findings.push(finding('retryable_terminal_failure_lacks_exhaustion_disposition', row, { failure_class: klass }));
          }
          if (!previous) findings.push(finding('retryable_terminal_failure_lacks_prior_attempt', row));
          closed = true;
        } else {
          if (status !== 'not_evaluable') findings.push(finding('intermediate_retryable_attempt_must_be_not_evaluable', row, { failure_class: klass }));
          if (row.retry_decision !== 'retry') findings.push(finding('retryable_attempt_requires_retry_decision', row));
          if (!hasValue(row.recovery_action)) findings.push(finding('retryable_attempt_requires_recovery_action', row));
          if (!next) findings.push(finding('retryable_failure_requires_follow_up_attempt', row));
        }
      } else if (nonRetryable.has(klass)) {
        if (status !== 'terminal_failure') findings.push(finding('non_retryable_failure_must_be_terminal', row, { failure_class: klass }));
        closed = status === 'terminal_failure';
      } else if (hasValue(klass) && status !== 'success') {
        findings.push(finding('unknown_failure_class_requires_explicit_classification', row, { failure_class: klass }));
      }

      if (status === 'success') {
        if (hasValue(klass)) findings.push(finding('success_cannot_carry_failure_class', row, { failure_class: klass }));
        closed = true;
      }
    }
  }

  return { valid: findings.length === 0, findings };
}

export function classifyM2ExecutionFailure(detail, stage = 'model') {
  const text = String(detail ?? '').toLowerCase();
  if (/flagged for possible biological risk|trusted access.*biology|涉及生物研究.*安全风险|可信访问权限/.test(text)) {
    return 'provider_policy_false_positive';
  }
  if (/policy refusal|safety refusal|content policy|refused to answer/.test(text)) {
    return 'policy_refusal';
  }
  if (/401|403|unauthori[sz]ed|forbidden|invalid api.?key|missing.*credential|quota.*exhaust|insufficient_quota|billing/.test(text)) {
    return 'authentication_or_quota_exhausted';
  }
  if (/unsupported model|invalid model|model_not_found|does not support|unsupported capability/.test(text)) return 'unsupported_model_or_capability';
  if (/context length|context_length|too many tokens|max(?:imum)? tokens|token limit|prompt is too long/.test(text)) {
    return 'token_or_context_limit_recoverable';
  }
  if (/429|rate.?limit|too many requests/.test(text)) return 'api_rate_limit';
  if (/econnreset|connection reset|broken pipe|socket hang up|transport reset|fetch failed|unexpected_eof|unexpected eof|stream ended without a terminal response/.test(text)) {
    return 'transport_reset';
  }
  if (/network|econnrefused|enotfound|dns|connection aborted|temporary failure in name resolution/.test(text)) return 'network_transient';
  if (/timeout|timed out|deadline exceeded|sigterm/.test(text)) return 'api_timeout';
  if (/\b5\d\d\b|service unavailable|temporarily unavailable|provider capacity|overloaded|bad gateway/.test(text)) return 'provider_5xx';
  if (/schema|invalid json|missing_json|incomplete_cluster|invalid_or_duplicate|label_outside|bundle_id_mismatch|model_mismatch/.test(text)) {
    return 'deterministic_schema_error';
  }
  if (/invalid input|missing_(?:bundle|output)|no such file|hash mismatch|parity/.test(text)) return 'invalid_input';
  return stage === 'model' ? 'deterministic_schema_error' : 'invalid_input';
}

export function m2RetryRecoveryAction(failureClass) {
  if (failureClass === 'provider_policy_false_positive') return 'identical_logical_request_after_provider_policy_refusal';
  if (failureClass === 'malformed_schema') return 'repeat_identical_request_after_malformed_schema';
  if (failureClass === 'token_or_context_limit_recoverable') return 'request_envelope_packing_reduction';
  if (failureClass === 'api_rate_limit') return 'bounded_exponential_backoff_then_identical_logical_request';
  if (['network_transient', 'api_timeout', 'provider_5xx', 'transport_reset'].includes(failureClass)) {
    return 'transport_reconnect_then_identical_logical_request';
  }
  return null;
}

export function m2FailureFingerprint(detail) {
  const normalized = String(detail ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(-4000);
  return normalized ? normalized : 'no_failure_detail';
}

export const M2_RETRY_POLICY_DEFAULTS = Object.freeze({
  retryable_failure_classes: DEFAULT_RETRYABLE_FAILURE_CLASSES,
  non_retryable_failure_classes: DEFAULT_NON_RETRYABLE_FAILURE_CLASSES,
  hash_fields_preserved_across_retry: HASH_FIELDS,
});
