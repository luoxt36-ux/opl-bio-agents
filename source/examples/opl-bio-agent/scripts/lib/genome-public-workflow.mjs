import { evaluatePublicArithmetic, repairPredictionArithmetic } from './genome-public-arithmetic.mjs';

function metricValues(publicTask) {
  const recipes = [
    ...(publicTask.public_metric_recipes ?? []),
    ...(publicTask.public_counterfactual_metric_recipes ?? []),
  ];
  return new Map(recipes.map((recipe) => [recipe.metric_id, evaluatePublicArithmetic(recipe.expression, publicTask)]));
}

function resolveValue(node, publicTask, metrics) {
  if (node && typeof node === 'object' && typeof node.metric_id === 'string') {
    if (!metrics.has(node.metric_id)) throw new Error(`missing_public_metric:${node.metric_id}`);
    return metrics.get(node.metric_id);
  }
  return evaluatePublicArithmetic(node, publicTask);
}

function evaluateCondition(condition, publicTask, metrics) {
  if (!condition) return true;
  if (condition.all) return condition.all.every((item) => evaluateCondition(item, publicTask, metrics));
  if (condition.any) return condition.any.some((item) => evaluateCondition(item, publicTask, metrics));
  if (condition.not) return !evaluateCondition(condition.not, publicTask, metrics);
  const left = resolveValue(condition.left, publicTask, metrics);
  const right = resolveValue(condition.right, publicTask, metrics);
  if (condition.op === 'lt') return left < right;
  if (condition.op === 'lte') return left <= right;
  if (condition.op === 'gt') return left > right;
  if (condition.op === 'gte') return left >= right;
  if (condition.op === 'eq') return Math.abs(left - right) <= Number(condition.tolerance ?? 1e-12);
  if (condition.op === 'neq') return Math.abs(left - right) > Number(condition.tolerance ?? 1e-12);
  throw new Error(`invalid_public_condition:${condition.op}`);
}

function topologicalOrder(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map();
  const ordered = [];
  const visit = (node) => {
    const status = state.get(node.id);
    if (status === 'done') return;
    if (status === 'visiting') throw new Error(`public_workflow_cycle:${node.id}`);
    state.set(node.id, 'visiting');
    for (const dependency of node.depends_on ?? []) {
      if (!byId.has(dependency)) throw new Error(`missing_public_workflow_dependency:${dependency}`);
      visit(byId.get(dependency));
    }
    state.set(node.id, 'done');
    ordered.push(node);
  };
  for (const node of nodes) visit(node);
  return ordered;
}

function executePhase(nodes, phase, publicTask, metrics) {
  const selected = new Set();
  const outputs = { actions: [], blockers: [], evidence: [], decisions: [], claim_scopes: [] };
  const phaseNodes = nodes.filter((node) => (node.phase ?? 'primary') === phase);
  for (const node of topologicalOrder(phaseNodes)) {
    if (!(node.depends_on ?? []).every((dependency) => selected.has(dependency))) continue;
    if (!evaluateCondition(node.when, publicTask, metrics)) continue;
    selected.add(node.id);
    if (!(node.output in outputs)) throw new Error(`invalid_public_workflow_output:${node.output}`);
    outputs[node.output].push({ id: node.emit_id ?? node.id, priority: Number(node.priority ?? 0) });
  }
  outputs.blockers.sort((left, right) => right.priority - left.priority);
  return Object.fromEntries(Object.entries(outputs).map(([key, values]) => [key, values.map((value) => value.id)]));
}

function confidenceFromRules(publicTask, metrics) {
  const rules = publicTask.public_workflow_program?.confidence_rules ?? [];
  for (const rule of rules) {
    if (evaluateCondition(rule.when, publicTask, metrics)) return Number(rule.value);
  }
  return Number(publicTask.public_workflow_program?.default_confidence ?? 0.85);
}

export function executePublicWorkflow(prediction, publicTask) {
  const program = publicTask.public_workflow_program;
  if (!program?.nodes?.length) return repairPredictionArithmetic(prediction, publicTask);
  const metrics = metricValues(publicTask);
  const primary = executePhase(program.nodes, 'primary', publicTask, metrics);
  const counterfactual = executePhase(program.nodes, 'counterfactual', publicTask, metrics);
  const repaired = repairPredictionArithmetic(prediction, publicTask);
  return {
    ...repaired,
    action_sequence_ids: primary.actions,
    ranked_blocker_ids: primary.blockers,
    evidence_ids: primary.evidence,
    primary_decision_id: primary.decisions[0] ?? repaired.primary_decision_id,
    counterfactual_action_sequence_ids: counterfactual.actions,
    counterfactual_evidence_ids: counterfactual.evidence,
    counterfactual_decision_id: counterfactual.decisions[0] ?? repaired.counterfactual_decision_id,
    claim_scope_id: primary.claim_scopes[0] ?? repaired.claim_scope_id,
    confidence: confidenceFromRules(publicTask, metrics),
  };
}
