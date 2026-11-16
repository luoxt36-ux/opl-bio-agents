import crypto from 'node:crypto';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function publicCaseId(casePrefix, index) {
  return `${casePrefix}_case_${String(index + 1).padStart(3, '0')}`;
}

function defaultRedactInputTask(inputTask) {
  return inputTask;
}

function defaultRedactOracleTargets(oracleTargets) {
  return oracleTargets;
}

export const BLIND_SOURCE_LITERATURE_POLICY = {
  source_literature_lookup_allowed: false,
  source_paper_lookup_allowed: false,
  published_findings_lookup_allowed: false,
  private_oracle_lookup_allowed: false,
  public_input_may_include_dataset_accessions: true,
};

export const BLIND_SOURCE_LITERATURE_BLOCKERS = {
  prompt_leakage: 'public_prompt_contains_source_oracle_leakage',
  prediction_leakage: 'prediction_contains_source_oracle_leakage',
  source_literature_rule_used: 'case_specific_literature_rule_used_in_blind_case',
  source_literature_lookup_declared: 'source_literature_lookup_declared_in_blind_case',
};

export function makeBlindPublicSuite(suite, version, options) {
  const {
    surfaceKind,
    casePrefix,
    neutralScenario,
    redactInputTask = defaultRedactInputTask,
  } = options;
  return {
    surface_kind: surfaceKind,
    version,
    owner: suite.owner ?? 'opl-bio-agent',
    state: 'public_model_comparison_input',
    source_surface_kind: suite.surface_kind,
    leakage_policy: {
      ...BLIND_SOURCE_LITERATURE_POLICY,
      private_oracle_included: false,
      oracle_targets_removed: true,
      gold_public_summary_removed: true,
      paper_ref_removed: true,
      source_literature_removed: true,
      published_findings_removed: true,
      original_case_ids_removed: true,
      external_models_must_not_receive_private_answer_key: true,
      external_models_must_not_lookup_source_papers_or_published_findings: true,
      public_input_is_blind_to_source_literature_findings: true,
      public_input_may_include_user_goal_dataset_refs_and_task_constraints: true,
    },
    cases: (suite.cases ?? []).map((testCase, index) => ({
      case_id: publicCaseId(casePrefix, index),
      benchmark_id: `${casePrefix}_benchmark_${String(index + 1).padStart(3, '0')}`,
      data_ref: testCase.data_ref,
      scenario: neutralScenario,
      input_task: redactInputTask(clone(testCase.input_task ?? {}), testCase, index),
      private_oracle_removed: true,
      blinding: {
        ...BLIND_SOURCE_LITERATURE_POLICY,
        blind_case_index: index + 1,
        paper_ref_removed: true,
        source_literature_removed: true,
        published_findings_removed: true,
        oracle_targets_removed: true,
        gold_public_summary_removed: true,
        original_case_id_removed: true,
        public_input_is_blind_to_source_literature_findings: true,
      },
      authority_boundary: {
        public_case_can_claim_gold_target_visibility: false,
        public_case_can_claim_source_paper_visibility: false,
        public_case_can_claim_biological_quality_verdict: false,
      },
    })),
  };
}

export function makeBlindPrivateOracleSuite(suite, version, options) {
  const {
    surfaceKind,
    casePrefix,
    redactOracleTargets = defaultRedactOracleTargets,
  } = options;
  return {
    surface_kind: surfaceKind,
    version,
    owner: suite.owner ?? 'opl-bio-agent',
    state: 'private_oracle_fixture',
    source_surface_kind: suite.surface_kind,
    leakage_policy: {
      external_models_must_not_receive_this_file: true,
      verifier_only: true,
      contains_private_answer_key: true,
      contains_source_literature_refs: true,
      may_contain_gold_summary_for_internal_review: true,
    },
    cases: (suite.cases ?? []).map((testCase, index) => {
      const privateOracle = {
        case_id: publicCaseId(casePrefix, index),
        original_case_id: testCase.case_id,
        original_benchmark_id: testCase.benchmark_id,
        benchmark_id: `${casePrefix}_benchmark_${String(index + 1).padStart(3, '0')}`,
        paper_ref: testCase.paper_ref,
        data_ref: testCase.data_ref,
        task_kind: testCase.input_task?.task_kind,
        gold_public_summary: testCase.gold_public_summary,
        oracle_targets: {
          ...redactOracleTargets(clone(testCase.oracle_targets ?? {}), testCase, index),
          forbid_case_specific_literature_rule: true,
          forbid_source_literature_lookup: true,
        },
        original_oracle_targets: clone(testCase.oracle_targets ?? {}),
      };
      return {
        ...privateOracle,
        oracle_sha256: sha256(privateOracle),
      };
    }),
  };
}

export function attachOracleToPublicSuite(publicSuite, privateOracleSuite) {
  const oracleByCase = new Map((privateOracleSuite.cases ?? []).map((entry) => [entry.case_id, entry]));
  return {
    ...clone(publicSuite),
    state: 'internal_verifier_scoring_view',
    cases: (publicSuite.cases ?? []).map((testCase) => {
      const oracle = oracleByCase.get(testCase.case_id);
      return oracle
        ? {
            ...clone(testCase),
            original_case_id: oracle.original_case_id,
            original_benchmark_id: oracle.original_benchmark_id,
            paper_ref: oracle.paper_ref,
            oracle_targets: clone(oracle.oracle_targets ?? {}),
          }
        : clone(testCase);
    }),
  };
}

export function blindForbiddenPatterns(extraPatterns = []) {
  return [
    /\bPubMed\b/i,
    /pubmed\.ncbi\.nlm\.nih\.gov/i,
    /\bPMID\b/i,
    /\bDOI\b/i,
    /doi\.org/i,
    /\bKang18_8vs8\b/i,
    /\bKang et al\b/i,
    /\bmuscData\b/i,
    /\bgold_public_summary\b/i,
    /\boracle_targets\b/i,
    ...extraPatterns,
  ];
}

export function findBlindPromptLeakage(publicCases, template = null, options = {}) {
  const text = JSON.stringify({ publicCases, template });
  const forbiddenFields = options.forbiddenFields ?? [
    '"paper_ref"',
    '"oracle_targets"',
    '"gold_public_summary"',
    '"original_case_id"',
    '"original_benchmark_id"',
  ];
  const fieldHits = forbiddenFields.filter((needle) => text.includes(needle));
  const patternHits = blindForbiddenPatterns(options.extraPatterns)
    .filter((pattern) => pattern.test(text))
    .map((pattern) => `pattern:${pattern}`);
  return [...fieldHits, ...patternHits];
}

export function assertNoBlindPromptLeakage(publicCases, template = null, options = {}) {
  const hits = findBlindPromptLeakage(publicCases, template, options);
  if (hits.length > 0) {
    throw new Error(`${BLIND_SOURCE_LITERATURE_BLOCKERS.prompt_leakage}:${hits.join(',')}`);
  }
}

function predictionDeclaresSourceLiteratureUse(prediction) {
  const basis = prediction?.inference_basis ?? {};
  const provenance = prediction?.provenance ?? {};
  return basis.case_specific_literature_rule_used === true
    || basis.case_specific_accession_rule_used === true
    || basis.source_literature_lookup_used === true
    || basis.source_paper_lookup_used === true
    || basis.published_findings_lookup_used === true
    || basis.private_oracle_used === true
    || provenance.source_literature_lookup_used === true
    || provenance.source_paper_lookup_used === true
    || provenance.published_findings_lookup_used === true
    || provenance.private_oracle_used === true;
}

function predictionTextLeakageHits(prediction, options = {}) {
  const text = JSON.stringify(prediction ?? {});
  const patterns = blindForbiddenPatterns(options.extraPatterns);
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => `pattern:${pattern}`);
}

export function blindPredictionLeakageSummary(prediction, options = {}) {
  const declared = predictionDeclaresSourceLiteratureUse(prediction);
  const textHits = options.scanText === true ? predictionTextLeakageHits(prediction, options) : [];
  const blockers = [
    ...(declared ? [BLIND_SOURCE_LITERATURE_BLOCKERS.source_literature_lookup_declared] : []),
    ...(textHits.length > 0 ? [BLIND_SOURCE_LITERATURE_BLOCKERS.prediction_leakage] : []),
  ];
  return {
    source_literature_lookup_declared: declared,
    text_leakage_hits: textHits,
    blockers,
  };
}

export function assertNoBlindPublicLeakage(publicSuite) {
  const hits = [];
  for (const testCase of publicSuite.cases ?? []) {
    for (const field of ['paper_ref', 'oracle_targets', 'gold_public_summary', 'original_case_id', 'original_benchmark_id']) {
      if (Object.prototype.hasOwnProperty.call(testCase, field)) {
        hits.push(`${testCase.case_id}:${field}`);
      }
    }
  }
  hits.push(...findBlindPromptLeakage(publicSuite, null));
  if (hits.length > 0) {
    throw new Error(`Public blind suite still contains private/source-literature leakage: ${hits.join(', ')}`);
  }
}
