#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import {
  BLIND_SOURCE_LITERATURE_BLOCKERS,
  blindPredictionLeakageSummary,
} from '../../scripts/lib/blind-benchmark-split.mjs';

function usage() {
  return 'Usage: node runtime/authority_functions/bulk_rna_seq_benchmark_verifier.mjs --cases <cases.json> --predictions <predictions.json> [--oracle <private-oracle.json>]';
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cases' || token === '--predictions' || token === '--oracle') {
      out[token.slice(2)] = argv[index + 1];
      index += 1;
    } else if (token === '--help') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeGene(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeFormula(value) {
  return normalize(value).replace(/\s+/g, '');
}

function flattenStrings(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenStrings(entry));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((entry) => flattenStrings(entry));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [String(value)];
}

function includesText(values, needle) {
  const normalizedNeedle = normalize(needle);
  if (!normalizedNeedle) {
    return false;
  }
  return values.some((value) => {
    const normalizedValue = normalize(value);
    if (!normalizedValue) {
      return false;
    }
    return normalizedValue.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedValue);
  });
}

function textMatches(value, needle) {
  return includesText([value], needle);
}

function hasGene(values, gene) {
  const observed = new Set(values.map(normalizeGene));
  return observed.has(normalizeGene(gene));
}

function uniqueByNormalized(values, normalizer = normalize) {
  const out = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const normalized = normalizer(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(String(value));
  }
  return out;
}

function artifactPresent(artifacts, artifactName) {
  return Boolean(artifacts && typeof artifacts === 'object' && artifacts[artifactName]);
}

function artifactPathFor(prediction, artifactName) {
  const value = prediction?.artifacts?.[artifactName];
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof value.path === 'string') {
    return value.path;
  }
  return null;
}

function fileExists(filePath) {
  return typeof filePath === 'string' && filePath.length > 0 && fs.existsSync(filePath);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readArtifactJson(prediction, artifactName) {
  const artifactPath = artifactPathFor(prediction, artifactName);
  if (!fileExists(artifactPath)) {
    return null;
  }
  return readJson(artifactPath);
}

function readArtifactJsonl(prediction, artifactName) {
  const artifactPath = artifactPathFor(prediction, artifactName);
  if (!fileExists(artifactPath)) {
    return [];
  }
  return readJsonl(artifactPath);
}

function ratio(matched, expected) {
  return expected.length === 0 ? 1 : matched.length / expected.length;
}

function ratioFromCounts(matchedCount, expectedCount) {
  return expectedCount === 0 ? 1 : matchedCount / expectedCount;
}

function precisionFromCounts(matchedCount, predictedCount, expectedCount) {
  if (predictedCount === 0) {
    return expectedCount === 0 ? 1 : 0;
  }
  return matchedCount / predictedCount;
}

function f1Score(precision, recall) {
  if (precision + recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

function meanScore(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return 0;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function roundMetric(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function coverageFromMissing(requiredItems, missingItems) {
  const requiredCount = (requiredItems ?? []).length;
  return ratioFromCounts(requiredCount - (missingItems ?? []).length, requiredCount);
}

function privateOracleByCase(oracleSuite) {
  if (!oracleSuite) {
    return new Map();
  }
  const entries = [];
  for (const entry of oracleSuite.cases ?? []) {
    entries.push([entry.case_id, entry]);
    if (entry.original_case_id) {
      entries.push([entry.original_case_id, entry]);
    }
  }
  return new Map(entries);
}

function attachPrivateOracle(testCase, oracleByCase) {
  const privateOracle = oracleByCase.get(testCase.case_id);
  if (!privateOracle) {
    return testCase;
  }
  return {
    ...testCase,
    oracle_targets: privateOracle.oracle_targets ?? privateOracle,
    private_oracle_case_id: privateOracle.case_id,
    original_case_id: privateOracle.original_case_id,
    original_benchmark_id: privateOracle.original_benchmark_id,
  };
}

function scoreCohortSummary(expected, observed) {
  if (!expected) {
    return { ok: true, missing: [] };
  }
  const missing = [];
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'required_metadata_fields') {
      const observedFields = flattenStrings(observed?.required_metadata_fields ?? observed?.metadata_fields ?? observed);
      const missingFields = value.filter((field) => !includesText(observedFields, field));
      missing.push(...missingFields.map((field) => `metadata:${field}`));
    } else if (observed?.[key] !== value) {
      missing.push(`${key}:${value}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

function scoreContrastDesign(testCase, prediction) {
  const missing = [];
  const expectedContrast = testCase.input_task?.contrast ?? null;
  const observedContrast = prediction?.contrast ?? null;
  if (expectedContrast && Object.keys(expectedContrast).length > 0) {
    if (!observedContrast || typeof observedContrast !== 'object') {
      missing.push('contrast');
    } else {
      for (const [key, value] of Object.entries(expectedContrast)) {
        if (!textMatches(observedContrast[key], value)) {
          missing.push(`contrast.${key}:${value}`);
        }
      }
    }
  }

  const expectedDesignFormula = testCase.input_task?.design_formula ?? null;
  if (expectedDesignFormula) {
    const observedDesignFormula = prediction?.design_formula ?? null;
    if (!observedDesignFormula) {
      missing.push(`design_formula:${expectedDesignFormula}`);
    } else if (normalizeFormula(observedDesignFormula) !== normalizeFormula(expectedDesignFormula)) {
      missing.push(`design_formula:${expectedDesignFormula}`);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    expected: {
      contrast: expectedContrast,
      design_formula: expectedDesignFormula,
    },
    observed: {
      contrast: observedContrast,
      design_formula: prediction?.design_formula ?? null,
    },
  };
}

function bindingRequiredTokens(binding) {
  if (typeof binding === 'string') {
    return [binding];
  }
  if (!binding || typeof binding !== 'object') {
    return [];
  }
  if (Array.isArray(binding.required_tokens)) {
    return binding.required_tokens.map(String);
  }
  if (Array.isArray(binding.expected_values)) {
    return binding.expected_values.map(String);
  }
  if (Array.isArray(binding.evidence_tokens)) {
    return binding.evidence_tokens.map(String);
  }
  return [];
}

function bindingAnyOfGroups(binding) {
  if (!binding || typeof binding !== 'object' || !Array.isArray(binding.any_of)) {
    return [];
  }
  return binding.any_of
    .filter((group) => Array.isArray(group))
    .map((group) => group.map(String));
}

function includesBindingToken(values, token) {
  const normalizedToken = normalize(token);
  if (!normalizedToken) {
    return false;
  }
  return values.some((value) => normalize(value) === normalizedToken);
}

function scoreInputDataBinding(oracle, textSurface) {
  const requiredBindings = oracle.required_input_data_bindings
    ?? oracle.required_input_dataset_bindings
    ?? [];
  const missing = [];
  for (const binding of requiredBindings) {
    const bindingId = typeof binding === 'object' && binding?.binding_id
      ? String(binding.binding_id)
      : String(binding);
    for (const token of bindingRequiredTokens(binding)) {
      if (!includesBindingToken(textSurface, token)) {
        missing.push(`${bindingId}:${token}`);
      }
    }
    for (const group of bindingAnyOfGroups(binding)) {
      if (!group.some((token) => includesBindingToken(textSurface, token))) {
        missing.push(`${bindingId}:any_of:${group.join('|')}`);
      }
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    required_count: requiredBindings.length,
  };
}

function zeroDimensionScores() {
  return {
    data_readiness: 0,
    statistical_concordance: 0,
    biological_concordance: 0,
    artifact_delivery: 0,
    evidence_grounding: 0,
    safety: 0,
    deeper_mining: 0,
  };
}

function scoreCase(testCase, prediction) {
  const oracle = testCase.oracle_targets ?? {};
  if (!prediction) {
    const contrastDesign = scoreContrastDesign(testCase, null);
    return {
      case_id: testCase.case_id,
      status: 'blocked',
      sample_id_recall: 0,
      gene_direction_recall: 0,
      gene_precision: 0,
      gene_direction_f1: 0,
      enrichment_recall: 0,
      term_precision: 0,
      artifact_delivery_rate: 0,
      contrast_design_ok: false,
      matched_up_genes: [],
      matched_predicted_up_genes: [],
      matched_terms: [],
      matched_predicted_terms: [],
      matched_sample_ids: [],
      missing_up_genes: oracle.expected_up_genes ?? [],
      missing_terms: oracle.expected_terms ?? [],
      missing_sample_ids: oracle.required_sample_ids ?? [],
      missing_input_data_bindings: oracle.required_input_data_bindings ?? [],
      missing_expression_matrix_refs: oracle.required_expression_matrix_refs ?? [],
      missing_contrast_design_items: contrastDesign.missing,
      missing_claims: oracle.required_claims ?? [],
      missing_limitations: oracle.required_limitations ?? [],
      forbidden_claim_hits: [],
      missing_artifacts: oracle.required_artifacts ?? [],
      missing_deeper_mining_options: oracle.required_deeper_mining_options ?? [],
      missing_stage_ids: oracle.required_stage_ids ?? [],
      evidence_coverage_ok: false,
      review_status_ok: false,
      dimension_scores: zeroDimensionScores(),
      composite_score: 0,
      blockers: ['prediction_missing'],
    };
  }

  const textSurface = flattenStrings(prediction);
  const predictedGenes = Array.isArray(prediction.predicted_up_genes) ? prediction.predicted_up_genes : [];
  const enrichmentTerms = Array.isArray(prediction.enrichment_terms) ? prediction.enrichment_terms : [];
  const claims = Array.isArray(prediction.claims) ? prediction.claims : [];
  const limitations = Array.isArray(prediction.limitations) ? prediction.limitations : [];
  const sampleIds = Array.isArray(prediction.sample_ids) ? prediction.sample_ids : [];
  const evidenceRefs = Array.isArray(prediction.evidence_refs) ? prediction.evidence_refs : [];
  const deeperMiningOptions = Array.isArray(prediction.deeper_mining_options) ? prediction.deeper_mining_options : [];

  const expectedUpGenes = oracle.expected_up_genes ?? [];
  const expectedTerms = oracle.expected_terms ?? [];
  const predictedUniqueGenes = uniqueByNormalized(predictedGenes, normalizeGene);
  const predictedUniqueTerms = uniqueByNormalized(enrichmentTerms, normalize);
  const expectedGeneSet = new Set(expectedUpGenes.map(normalizeGene).filter(Boolean));
  const matchedUpGenes = expectedUpGenes.filter((gene) => hasGene(predictedUniqueGenes, gene));
  const matchedPredictedUpGenes = predictedUniqueGenes.filter((gene) => expectedGeneSet.has(normalizeGene(gene)));
  const matchedTerms = expectedTerms.filter((term) => includesText(predictedUniqueTerms, term));
  const matchedPredictedTerms = predictedUniqueTerms.filter((term) => expectedTerms.some((expectedTerm) => textMatches(term, expectedTerm)));
  const geneDirectionRecall = ratio(matchedUpGenes, expectedUpGenes);
  const genePrecision = precisionFromCounts(matchedPredictedUpGenes.length, predictedUniqueGenes.length, expectedUpGenes.length);
  const geneDirectionF1 = f1Score(genePrecision, geneDirectionRecall);
  const enrichmentRecall = oracle.enrichment_evaluable === false
    ? 0
    : ratio(matchedTerms, expectedTerms);
  const termPrecision = precisionFromCounts(matchedPredictedTerms.length, predictedUniqueTerms.length, expectedTerms.length);

  const requiredSampleIds = oracle.required_sample_ids ?? [];
  const requiredExpressionMatrixRefs = oracle.required_expression_matrix_refs ?? [];
  const requiredClaims = oracle.required_claims ?? [];
  const requiredLimitations = oracle.required_limitations ?? [];
  const requiredArtifacts = oracle.required_artifacts ?? [];
  const requiredOutputFiles = oracle.required_output_files ?? [];
  const requiredDeeperMiningOptions = oracle.required_deeper_mining_options ?? [];
  const requiredStageIds = oracle.required_stage_ids ?? [];
  const matchedSampleIds = requiredSampleIds.filter((sampleId) => includesText(sampleIds, sampleId));
  const missingSampleIds = requiredSampleIds.filter((sampleId) => !matchedSampleIds.includes(sampleId));
  const sampleIdRecall = ratio(matchedSampleIds, requiredSampleIds);
  const missingExpressionMatrixRefs = requiredExpressionMatrixRefs
    .filter((matrixRef) => !includesText(textSurface, matrixRef));
  const missingClaims = requiredClaims.filter((claim) => !includesText(claims, claim));
  const missingLimitations = requiredLimitations.filter((limitation) => !includesText(limitations, limitation));
  const forbiddenClaimHits = (oracle.forbidden_claims ?? []).filter((claim) => includesText(claims, claim));
  const missingArtifacts = requiredArtifacts
    .filter((artifactName) => !artifactPresent(prediction.artifacts, artifactName));
  const missingOutputFiles = requiredOutputFiles.filter((fileName) => {
    const artifactName = fileName.replace(/\.[^.]+$/, '');
    const artifactPath = artifactPathFor(prediction, artifactName);
    if (artifactPath && fileExists(artifactPath)) {
      return false;
    }
    const artifactRoot = prediction.artifact_root;
    return !(artifactRoot && fileExists(path.join(artifactRoot, fileName)));
  });
  const missingDeeperMiningOptions = requiredDeeperMiningOptions
    .filter((option) => !includesText(deeperMiningOptions, option));
  const stageReceipts = readArtifactJsonl(prediction, 'stage_receipts');
  const stageIds = stageReceipts.map((receipt) => receipt.stage_id).filter(Boolean);
  const missingStageIds = requiredStageIds.filter((stageId) => !includesText(stageIds, stageId));
  const reviewReceipt = readArtifactJson(prediction, 'review_receipt');
  const requiredReviewStatus = oracle.required_review_status ?? 'generated';
  const basicReviewStatusOk = reviewReceipt?.status === requiredReviewStatus
    && Array.isArray(reviewReceipt?.blockers)
    && reviewReceipt.blockers.length === 0;
  const independentReviewRequired = prediction.review_contract_version === 'independent-review.v0.2';
  const reviewedManifestPath = reviewReceipt?.reviewed_manifest_path;
  const independentReviewStatusOk = !independentReviewRequired || (
    typeof reviewReceipt?.reviewer_id === 'string'
    && reviewReceipt.reviewer_id.length > 0
    && typeof reviewReceipt?.producer_id === 'string'
    && reviewReceipt.producer_id.length > 0
    && reviewReceipt.reviewer_id !== reviewReceipt.producer_id
    && reviewReceipt.independence_attestation?.separate_execution_identity === true
    && reviewReceipt.independence_attestation?.reviewer_did_not_generate_analysis_outputs === true
    && reviewReceipt.independence_attestation?.private_oracle_access_used === false
    && fileExists(reviewedManifestPath)
    && reviewReceipt.reviewed_manifest_sha256 === sha256File(reviewedManifestPath)
  );
  const reviewStatusOk = basicReviewStatusOk && independentReviewStatusOk;
  const cohortSummary = scoreCohortSummary(oracle.required_cohort_summary, prediction.cohort_summary);
  const contrastDesign = scoreContrastDesign(testCase, prediction);
  const inputDataBinding = scoreInputDataBinding(oracle, textSurface);
  const accessionOk = oracle.required_geo_accession
    ? includesText(textSurface, oracle.required_geo_accession)
    : true;
  const evidenceCoverageOk = evidenceRefs.length > 0;
  const liveReplayTruthful = prediction.execution_mode !== 'live_deseq2_replay'
    || prediction.authority_boundary?.prediction_can_claim_live_deseq2_replay === true;
  const leakageSummary = blindPredictionLeakageSummary(prediction);
  const literatureRuleUsed = prediction.inference_basis?.case_specific_accession_rule_used === true
    || prediction.inference_basis?.case_specific_literature_rule_used === true;
  const blindLiteratureRuleOk = oracle.forbid_case_specific_literature_rule !== true || !literatureRuleUsed;
  const blindSourceLookupOk = oracle.forbid_source_literature_lookup !== true
    || leakageSummary.source_literature_lookup_declared !== true;

  const expressionMatrixRefRecall = coverageFromMissing(requiredExpressionMatrixRefs, missingExpressionMatrixRefs);
  const claimCoverage = coverageFromMissing(requiredClaims, missingClaims);
  const limitationCoverage = coverageFromMissing(requiredLimitations, missingLimitations);
  const artifactKeyCoverage = coverageFromMissing(requiredArtifacts, missingArtifacts);
  const outputFileCoverage = coverageFromMissing(requiredOutputFiles, missingOutputFiles);
  const deeperMiningCoverage = coverageFromMissing(requiredDeeperMiningOptions, missingDeeperMiningOptions);
  const stageIdCoverage = coverageFromMissing(requiredStageIds, missingStageIds);
  const stageReceiptPresence = stageReceipts.length > 0 ? 1 : 0;
  const artifactDeliveryRate = meanScore([
    artifactKeyCoverage,
    outputFileCoverage,
    stageReceiptPresence,
    stageIdCoverage,
    reviewStatusOk ? 1 : 0,
  ]);
  const dimensionScores = {
    data_readiness: roundMetric(meanScore([
      inputDataBinding.ok ? 1 : 0,
      accessionOk ? 1 : 0,
      expressionMatrixRefRecall,
      sampleIdRecall,
      cohortSummary.ok ? 1 : 0,
      contrastDesign.ok ? 1 : 0,
    ])),
    statistical_concordance: roundMetric(meanScore([
      geneDirectionRecall,
      genePrecision,
      geneDirectionF1,
    ])),
    biological_concordance: roundMetric(meanScore([
      oracle.enrichment_evaluable === false ? 1 : enrichmentRecall,
      oracle.enrichment_evaluable === false ? 1 : termPrecision,
      claimCoverage,
      limitationCoverage,
      forbiddenClaimHits.length === 0 ? 1 : 0,
    ])),
    artifact_delivery: roundMetric(artifactDeliveryRate),
    evidence_grounding: roundMetric(meanScore([
      evidenceCoverageOk ? 1 : 0,
      expressionMatrixRefRecall,
    ])),
    safety: roundMetric(meanScore([
      forbiddenClaimHits.length === 0 ? 1 : 0,
      liveReplayTruthful ? 1 : 0,
      blindLiteratureRuleOk ? 1 : 0,
      blindSourceLookupOk ? 1 : 0,
    ])),
    deeper_mining: roundMetric(deeperMiningCoverage),
  };
  const compositeScore = [
    0.20 * dimensionScores.data_readiness,
    0.20 * dimensionScores.statistical_concordance,
    0.20 * dimensionScores.biological_concordance,
    0.15 * dimensionScores.artifact_delivery,
    0.15 * dimensionScores.evidence_grounding,
    0.10 * dimensionScores.safety,
  ].reduce((sum, value) => sum + value, 0);

  const blockers = [
    ...(inputDataBinding.ok ? [] : ['input_data_binding_missing']),
    ...(accessionOk ? [] : ['required_geo_accession_missing']),
    ...(missingExpressionMatrixRefs.length === 0 ? [] : ['required_expression_matrix_ref_missing']),
    ...(missingSampleIds.length === 0 ? [] : ['required_sample_id_missing']),
    ...(cohortSummary.ok ? [] : ['required_cohort_summary_missing']),
    ...(contrastDesign.ok ? [] : ['contrast_design_incorrect']),
    ...(geneDirectionRecall >= Number(oracle.minimum_gene_direction_recall ?? 0.6)
      ? []
      : ['gene_direction_recall_below_threshold']),
    ...(oracle.enrichment_evaluable === false
      || enrichmentRecall >= Number(oracle.minimum_enrichment_recall ?? 0.6)
      ? []
      : ['enrichment_recall_below_threshold']),
    ...(missingClaims.length === 0 ? [] : ['required_claim_missing']),
    ...(missingLimitations.length === 0 ? [] : ['required_limitation_missing']),
    ...(forbiddenClaimHits.length === 0 ? [] : ['forbidden_claim_present']),
    ...(missingArtifacts.length === 0 ? [] : ['required_artifact_missing']),
    ...(missingOutputFiles.length === 0 ? [] : ['required_output_file_missing']),
    ...(missingDeeperMiningOptions.length === 0 ? [] : ['deeper_mining_option_missing']),
    ...(stageReceipts.length > 0 ? [] : ['stage_receipt_missing']),
    ...(missingStageIds.length === 0 ? [] : ['required_stage_id_missing']),
    ...(reviewReceipt ? [] : ['review_receipt_missing']),
    ...(!independentReviewStatusOk ? ['review_independence_unverified'] : []),
    ...(reviewStatusOk ? [] : ['review_receipt_blocked']),
    ...(evidenceCoverageOk ? [] : ['evidence_ref_missing']),
    ...(liveReplayTruthful ? [] : ['live_replay_claim_without_authority']),
    ...(blindLiteratureRuleOk ? [] : [BLIND_SOURCE_LITERATURE_BLOCKERS.source_literature_rule_used]),
    ...(blindSourceLookupOk ? [] : [BLIND_SOURCE_LITERATURE_BLOCKERS.source_literature_lookup_declared]),
  ];

  return {
    case_id: testCase.case_id,
    status: blockers.length === 0 ? 'passed' : 'blocked',
    sample_id_recall: roundMetric(sampleIdRecall),
    gene_direction_recall: roundMetric(geneDirectionRecall),
    gene_precision: roundMetric(genePrecision),
    gene_direction_f1: roundMetric(geneDirectionF1),
    enrichment_recall: roundMetric(enrichmentRecall),
    term_precision: roundMetric(termPrecision),
    artifact_delivery_rate: roundMetric(artifactDeliveryRate),
    contrast_design_ok: contrastDesign.ok,
    matched_up_genes: matchedUpGenes,
    matched_predicted_up_genes: matchedPredictedUpGenes,
    matched_terms: matchedTerms,
    matched_predicted_terms: matchedPredictedTerms,
    matched_sample_ids: matchedSampleIds,
    missing_up_genes: (oracle.expected_up_genes ?? []).filter((gene) => !matchedUpGenes.includes(gene)),
    missing_terms: (oracle.expected_terms ?? []).filter((term) => !matchedTerms.includes(term)),
    missing_sample_ids: missingSampleIds,
    input_data_binding_ok: inputDataBinding.ok,
    missing_input_data_bindings: inputDataBinding.missing,
    missing_expression_matrix_refs: missingExpressionMatrixRefs,
    missing_cohort_items: cohortSummary.missing,
    missing_contrast_design_items: contrastDesign.missing,
    observed_contrast_design: contrastDesign.observed,
    expected_contrast_design: contrastDesign.expected,
    missing_claims: missingClaims,
    missing_limitations: missingLimitations,
    forbidden_claim_hits: forbiddenClaimHits,
    missing_artifacts: missingArtifacts,
    missing_output_files: missingOutputFiles,
    missing_deeper_mining_options: missingDeeperMiningOptions,
    missing_stage_ids: missingStageIds,
    evidence_coverage_ok: evidenceCoverageOk,
    review_status_ok: reviewStatusOk,
    review_status: reviewReceipt?.status ?? null,
    review_blockers: reviewReceipt?.blockers ?? null,
    literature_rule_used: literatureRuleUsed,
    blind_literature_rule_ok: blindLiteratureRuleOk,
    source_literature_lookup_declared: leakageSummary.source_literature_lookup_declared,
    blind_source_literature_lookup_ok: blindSourceLookupOk,
    leakage_blockers: leakageSummary.blockers,
    dimension_scores: dimensionScores,
    composite_score: roundMetric(compositeScore),
    blockers,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.cases || !args.predictions) {
    throw new Error(usage());
  }

  const casesPath = path.resolve(args.cases);
  const predictionsPath = path.resolve(args.predictions);
  const oraclePath = args.oracle ? path.resolve(args.oracle) : null;
  const suite = readJson(casesPath);
  const oracleSuite = oraclePath ? readJson(oraclePath) : null;
  const oracleByCase = privateOracleByCase(oracleSuite);
  const predictions = readJson(predictionsPath);
  const byCase = new Map((predictions.predictions ?? []).map((prediction) => [prediction.case_id, prediction]));
  const caseResults = (suite.cases ?? []).map((testCase) => scoreCase(
    attachPrivateOracle(testCase, oracleByCase),
    byCase.get(testCase.case_id),
  ));
  const passedCount = caseResults.filter((result) => result.status === 'passed').length;
  const result = {
    surface_kind: 'opl_bio_bulk_rna_seq_benchmark_verification',
    version: 'opl-bio-bulk-rna-seq-benchmark-verifier.v0.2-p0-metrics',
    owner: 'opl-bio-agent',
    status: passedCount === caseResults.length ? 'passed' : 'blocked',
    cases_path: casesPath,
    oracle_path: oraclePath,
    predictions_path: predictionsPath,
    case_count: caseResults.length,
    passed_count: passedCount,
    blocked_count: caseResults.length - passedCount,
    case_results: caseResults,
    authority_boundary: {
      verifier_can_claim_domain_ready: false,
      verifier_can_claim_production_ready: false,
      verifier_can_authorize_biological_quality_verdict: false,
      verifier_can_claim_live_deseq2_replay: false,
      verifier_uses_private_oracle_when_oracle_path_is_present: oraclePath !== null,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    surface_kind: 'opl_bio_bulk_rna_seq_benchmark_verification',
    status: 'blocked',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
