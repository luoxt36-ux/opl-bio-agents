#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF_PATH), '../../..');
const DEFAULT_RUBRIC = path.join(
  REPO_ROOT,
  'examples/opl-bio-agent/contracts/genome_routine_analysis_decision_rubric_v1.json',
);
const DEFAULT_SCHEMA = path.join(
  REPO_ROOT,
  'examples/opl-bio-agent/contracts/genome_routine_analysis_decision_v1.schema.json',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function coverage(observed, required) {
  if (required.length === 0) return 1;
  const observedSet = new Set(observed);
  return required.filter((value) => observedSet.has(value)).length / required.length;
}

function enumValues(schema, definition) {
  return new Set(schema.$defs[definition].enum);
}

export function assertDecisionShape(decision, schema) {
  const required = schema.required;
  assert(decision && typeof decision === 'object' && !Array.isArray(decision), 'Decision must be an object');
  for (const field of required) assert(Object.hasOwn(decision, field), `Decision is missing required field: ${field}`);
  const allowedTopLevel = new Set(Object.keys(schema.properties));
  for (const field of Object.keys(decision)) assert(allowedTopLevel.has(field), `Unexpected decision field: ${field}`);
  assert(decision.decision_version === 'genome_routine_analysis_decision_v1', 'Unexpected decision version');
  assert(typeof decision.task_id === 'string' && decision.task_id.length > 0, 'task_id is required');
  assert(typeof decision.system_id === 'string' && decision.system_id.length > 0, 'system_id is required');
  assert(schema.properties.selected_method_family.enum.includes(decision.selected_method_family), 'Invalid method family');
  assert(decision.parameters && typeof decision.parameters === 'object' && !Array.isArray(decision.parameters), 'parameters must be an object');
  for (const [key, value] of Object.entries(decision.parameters)) {
    assert(key.length > 0 && ['string', 'number', 'boolean'].includes(typeof value), `Invalid parameter: ${key}`);
  }
  for (const [field, definition] of [
    ['ordered_actions', 'action_code'],
    ['required_qc', 'qc_code'],
    ['recovery_plan', 'recovery_code'],
    ['limitations', 'limitation_code'],
  ]) {
    assert(Array.isArray(decision[field]) && decision[field].length > 0, `${field} must be a non-empty array`);
    assert(new Set(decision[field]).size === decision[field].length, `${field} must contain unique values`);
    const allowed = enumValues(schema, definition);
    assert(decision[field].every((value) => allowed.has(value)), `${field} contains an invalid controlled term`);
  }
  assert(Array.isArray(decision.evidence_refs) && decision.evidence_refs.length > 0, 'evidence_refs must be non-empty');
  assert(new Set(decision.evidence_refs).size === decision.evidence_refs.length, 'evidence_refs must contain unique values');
  assert(schema.properties.claim_scope.enum.includes(decision.claim_scope), 'Invalid claim scope');
  assert(Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1, 'confidence must be in [0,1]');
  assert(typeof decision.rationale === 'string' && decision.rationale.length >= 20, 'rationale is too short');
  assert(decision.truth_accessed === false, 'truth_accessed must be false');
}

export function scoreRoutineGenomeDecision(decision, options = {}) {
  const rubric = options.rubric ?? readJson(options.rubricPath ?? DEFAULT_RUBRIC);
  const schema = options.schema ?? readJson(options.schemaPath ?? DEFAULT_SCHEMA);
  assertDecisionShape(decision, schema);
  const task = rubric.tasks.find((row) => row.task_id === decision.task_id);
  assert(task, `No private rubric record for ${decision.task_id}`);
  const gold = rubric.rubrics[task.rubric_id];
  assert(gold, `No rubric definition for ${task.rubric_id}`);

  const methodExact = gold.accepted_method_families.includes(decision.selected_method_family) ? 1 : 0;
  const parameterCoverage = coverage(Object.keys(decision.parameters), gold.required_parameter_keys);
  const actionCoverage = coverage(decision.ordered_actions, gold.required_actions);
  const qcCoverage = coverage(decision.required_qc, gold.required_qc);
  const recoveryCoverage = coverage(decision.recovery_plan, gold.required_recovery);
  const evidenceCoverage = coverage(decision.evidence_refs, task.required_evidence_refs);
  const limitationCoverage = coverage(decision.limitations, gold.required_limitations);
  const claimScopeExact = gold.allowed_claim_scopes.includes(decision.claim_scope) ? 1 : 0;

  const components = {
    method_and_parameter_validity: round(0.7 * methodExact + 0.3 * parameterCoverage),
    workflow_and_qc_completeness: round(0.6 * actionCoverage + 0.4 * qcCoverage),
    failure_recovery: round(recoveryCoverage),
    evidence_and_provenance: round(evidenceCoverage),
    claim_boundary_compliance: round(0.5 * limitationCoverage + 0.5 * claimScopeExact),
  };
  const total = round(Object.entries(rubric.weights).reduce(
    (sum, [component, weight]) => sum + components[component] * weight,
    0,
  ));
  return {
    surface_kind: 'opl_bio_genome_routine_analysis_decision_score_v1',
    version: 'v1',
    estimand: rubric.estimand,
    task_id: decision.task_id,
    domain_id: task.domain_id,
    system_id: decision.system_id,
    rubric_id: task.rubric_id,
    components,
    primary_decision_quality_score: total,
    variant_or_scientific_accuracy_score: null,
    truth_provider: 'private_local_rubric_only',
  };
}

function parseArgs(argv) {
  const args = { rubric: DEFAULT_RUBRIC, schema: DEFAULT_SCHEMA, decision: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--rubric') args.rubric = path.resolve(argv[++index]);
    else if (argv[index] === '--schema') args.schema = path.resolve(argv[++index]);
    else if (argv[index] === '--decision') args.decision = path.resolve(argv[++index]);
    else if (argv[index] === '--out') args.out = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  assert(args.decision, '--decision is required');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const score = scoreRoutineGenomeDecision(readJson(args.decision), {
    rubricPath: args.rubric,
    schemaPath: args.schema,
  });
  const text = `${JSON.stringify(score, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, text);
  } else process.stdout.write(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
