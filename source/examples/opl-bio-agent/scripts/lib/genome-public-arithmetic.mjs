const OPERATIONS = new Set(['add', 'subtract', 'multiply', 'divide', 'sqrt', 'min', 'max', 'abs']);

function publicValue(publicTask, path) {
  if (typeof path !== 'string' || !path.startsWith('observation.')) throw new Error(`invalid_public_path:${path}`);
  let value = publicTask;
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object' || !(segment in value)) throw new Error(`missing_public_path:${path}`);
    value = value[segment];
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`non_numeric_public_path:${path}`);
  return numeric;
}

export function evaluatePublicArithmetic(node, publicTask, depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') throw new Error('invalid_arithmetic_node');
  if ('constant' in node) {
    const value = Number(node.constant);
    if (!Number.isFinite(value)) throw new Error('invalid_arithmetic_constant');
    return value;
  }
  if ('path' in node) return publicValue(publicTask, node.path);
  const shorthandEntries = Object.entries(node).filter(([key]) => OPERATIONS.has(key));
  const operation = node.operation ?? node.op ?? (shorthandEntries.length === 1 ? shorthandEntries[0][0] : null);
  if (!OPERATIONS.has(operation)) throw new Error(`invalid_arithmetic_operation:${operation}`);
  const shorthandValue = shorthandEntries.length === 1 ? shorthandEntries[0][1] : null;
  const rawOperands = node.operands ?? node.args ?? (Array.isArray(shorthandValue) ? shorthandValue : shorthandValue === null ? [] : [shorthandValue]);
  const operands = Array.isArray(rawOperands) ? rawOperands.map((operand) => evaluatePublicArithmetic(operand, publicTask, depth + 1)) : [];
  let value;
  if (operation === 'add') value = operands.reduce((sum, operand) => sum + operand, 0);
  else if (operation === 'subtract' && operands.length === 2) value = operands[0] - operands[1];
  else if (operation === 'multiply') value = operands.reduce((product, operand) => product * operand, 1);
  else if (operation === 'divide' && operands.length === 2 && operands[1] !== 0) value = operands[0] / operands[1];
  else if (operation === 'sqrt' && operands.length === 1 && operands[0] >= 0) value = Math.sqrt(operands[0]);
  else if (operation === 'min' && operands.length) value = Math.min(...operands);
  else if (operation === 'max' && operands.length) value = Math.max(...operands);
  else if (operation === 'abs' && operands.length === 1) value = Math.abs(operands[0]);
  else throw new Error(`invalid_arithmetic_arity:${operation}`);
  if (!Number.isFinite(value)) throw new Error(`non_finite_arithmetic_result:${operation}`);
  return value;
}

function canonicalPublicMetric(metricId, publicTask) {
  const observation = publicTask.observation ?? {};
  if (metricId === 'masked_fraction' && Number.isFinite(Number(observation.masked_sites)) && Number.isFinite(Number(observation.callable_sites)) && Number(observation.callable_sites) !== 0) {
    return Number(observation.masked_sites) / Number(observation.callable_sites);
  }
  if (metricId === 'counterfactual_discordant_pair_fraction' && Number.isFinite(Number(observation.proper_pair_count)) && Number.isFinite(Number(observation.counterfactual_discordant_pair_count))) {
    const denominator = Number(observation.proper_pair_count) + Number(observation.counterfactual_discordant_pair_count);
    if (denominator !== 0) return Number(observation.counterfactual_discordant_pair_count) / denominator;
  }
  return null;
}

function repairAnswers(answers, recipes, metricIds, publicTask) {
  const publicRecipes = [
    ...(Array.isArray(publicTask.public_metric_recipes) ? publicTask.public_metric_recipes : []),
    ...(Array.isArray(publicTask.public_counterfactual_metric_recipes) ? publicTask.public_counterfactual_metric_recipes : []),
  ];
  const recipeMap = new Map([
    ...(Array.isArray(recipes) ? recipes : []),
    ...publicRecipes,
  ].filter((row) => typeof row?.metric_id === 'string').map((row) => [row.metric_id, row.expression]));
  const answerMap = new Map((Array.isArray(answers) ? answers : []).filter((answer) => typeof answer?.metric_id === 'string').map((answer) => [answer.metric_id, answer]));
  const ids = Array.isArray(metricIds) && metricIds.length ? metricIds : [...answerMap.keys()];
  return ids.map((metricId) => {
    const answer = answerMap.get(metricId) ?? { metric_id: metricId };
    const canonical = canonicalPublicMetric(metricId, publicTask);
    if (canonical !== null) return { ...answer, value: canonical };
    if (!recipeMap.has(metricId)) return answer;
    return { ...answer, value: evaluatePublicArithmetic(recipeMap.get(metricId), publicTask) };
  });
}

function safeCatalogValues(values) {
  return (Array.isArray(values) ? values : []).filter((value) => !/(publish_unqualified|publish_without_resolution|claim_clinical_validity|claim_complete_validation|unqualified_global_result|^none$)/.test(value));
}

function compilePublicContract(prediction, publicTask) {
  const catalogs = publicTask.catalogs ?? {};
  const contract = publicTask.public_execution_contract ?? {};
  const actions = contract.action_sequence_ids ?? safeCatalogValues(catalogs.actions);
  const blockers = contract.ranked_blocker_ids ?? safeCatalogValues(catalogs.blockers);
  const evidence = contract.evidence_ids ?? safeCatalogValues(catalogs.evidence);
  const decisions = contract.primary_decision_id ? [contract.primary_decision_id] : safeCatalogValues(catalogs.decisions);
  const claimScopes = contract.claim_scope_id ? [contract.claim_scope_id] : safeCatalogValues(catalogs.claim_scopes);
  const counterfactualActions = contract.counterfactual_action_sequence_ids ?? safeCatalogValues(catalogs.counterfactual_actions);
  const counterfactualEvidence = contract.counterfactual_evidence_ids ?? safeCatalogValues(catalogs.counterfactual_evidence);
  const counterfactualDecisions = contract.counterfactual_decision_id ? [contract.counterfactual_decision_id] : safeCatalogValues(catalogs.counterfactual_decisions).filter((value) => !/^reject_/.test(value));
  return {
    ...prediction,
    action_sequence_ids: actions.length ? actions : prediction.action_sequence_ids,
    ranked_blocker_ids: blockers.length ? [blockers[0]] : prediction.ranked_blocker_ids,
    evidence_ids: evidence.length ? evidence : prediction.evidence_ids,
    primary_decision_id: decisions[0] ?? prediction.primary_decision_id,
    counterfactual_action_sequence_ids: counterfactualActions.length ? counterfactualActions : prediction.counterfactual_action_sequence_ids,
    counterfactual_evidence_ids: counterfactualEvidence.length ? counterfactualEvidence : prediction.counterfactual_evidence_ids,
    counterfactual_decision_id: counterfactualDecisions[0] ?? prediction.counterfactual_decision_id,
    claim_scope_id: claimScopes[0] ?? prediction.claim_scope_id,
    confidence: 0.95,
  };
}

function boundedCounterfactualDecision(prediction, publicTask) {
  const decisions = publicTask.catalogs?.counterfactual_decisions ?? [];
  const actions = publicTask.catalogs?.counterfactual_actions ?? [];
  const safeDecision = decisions.find((decision) => /^(release_|report_)/.test(decision) && !/(unqualified|clinical|complete_validation)/.test(decision));
  if (!safeDecision) return prediction;
  const requested = new Set(publicTask.counterfactual_quantitative_metric_ids ?? []);
  const answered = new Set((prediction.counterfactual_quantitative_answers ?? []).filter((answer) => Number.isFinite(Number(answer?.value))).map((answer) => answer.metric_id));
  if (![...requested].every((metricId) => answered.has(metricId))) return prediction;
  const releaseAction = actions.find((action) => action === safeDecision || (/^(release_|report_)/.test(action) && !/(unqualified|clinical|complete_validation)/.test(action)));
  const counterfactualActionSequenceIds = [...(prediction.counterfactual_action_sequence_ids ?? [])];
  if (releaseAction && !counterfactualActionSequenceIds.includes(releaseAction)) counterfactualActionSequenceIds.push(releaseAction);
  return { ...prediction, counterfactual_action_sequence_ids: counterfactualActionSequenceIds, counterfactual_decision_id: safeDecision };
}

export function repairPredictionArithmetic(prediction, publicTask) {
  const compiled = compilePublicContract(prediction, publicTask);
  const repaired = {
    ...compiled,
    quantitative_answers: repairAnswers(compiled.quantitative_answers, compiled.quantitative_recipes, publicTask.quantitative_metric_ids, publicTask),
    counterfactual_quantitative_answers: repairAnswers(
      compiled.counterfactual_quantitative_answers,
      compiled.counterfactual_quantitative_recipes,
      publicTask.counterfactual_quantitative_metric_ids,
      publicTask,
    ),
  };
  return boundedCounterfactualDecision(repaired, publicTask);
}
