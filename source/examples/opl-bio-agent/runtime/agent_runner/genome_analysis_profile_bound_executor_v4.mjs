#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF_PATH), '../../../..');
const DEFAULT_REGISTRY_PATH = path.join(
  REPO_ROOT,
  'examples/opl-bio-agent/contracts/genome_analysis_execution_profile_registry_v3.json',
);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const sha256File = (filePath) => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

function typedNull(failureType, message, details = {}) {
  return {
    status: 'typed_terminal_null',
    failure_type: failureType,
    failure_message: message,
    retryable: false,
    accuracy_score: null,
    zero_imputed: false,
    details,
  };
}

function profileIndex(registry) {
  const index = new Map();
  for (const domain of registry.domains ?? []) {
    for (const profile of domain.profiles ?? []) {
      if (index.has(profile.profile_id)) throw new Error(`duplicate_execution_profile_id:${profile.profile_id}`);
      index.set(profile.profile_id, { domain_id: domain.domain_id, ...profile });
    }
  }
  return index;
}

export function bindGenomeProfileDecision({ decision, publicTask, registry }) {
  if (!decision || !publicTask || !registry) throw new Error('decision, publicTask and registry are required');
  if (decision.truth_accessed !== false || publicTask.private_truth_visible !== false) {
    return typedNull('truth_boundary_violation', 'The decision or task does not preserve the private-truth boundary.');
  }
  if (decision.decision_version !== 'genome_analysis_execution_profile_decision_v3') {
    return typedNull('decision_contract_mismatch', 'The decision does not use the frozen v3 execution-profile contract.');
  }
  if (decision.task_id !== publicTask.task_id || decision.domain_id !== publicTask.domain_id) {
    return typedNull('task_identity_mismatch', 'Decision task or domain identity differs from the frozen public task.');
  }
  const profile = profileIndex(registry).get(decision.execution_profile_id);
  if (!profile) {
    return typedNull('unsupported_execution_profile', 'The selected execution profile is outside the frozen registry.', {
      execution_profile_id: decision.execution_profile_id ?? null,
    });
  }
  if (profile.domain_id !== publicTask.domain_id) {
    return typedNull('domain_profile_mismatch', 'The selected execution profile belongs to another domain.', {
      task_domain_id: publicTask.domain_id,
      profile_domain_id: profile.domain_id,
    });
  }
  const allowed = new Set(publicTask.allowed_execution_profile_ids ?? []);
  if (allowed.size === 0 || !allowed.has(profile.profile_id)) {
    return typedNull('profile_not_released_for_case', 'The profile is not in the case-visible frozen allowlist.', {
      execution_profile_id: profile.profile_id,
    });
  }
  return {
    status: 'bound',
    task_id: publicTask.task_id,
    domain_id: publicTask.domain_id,
    system_id: decision.system_id,
    execution_profile_id: profile.profile_id,
    local_pipeline_family: profile.local_pipeline_family,
    configuration: profile.configuration,
    truth_accessed: false,
    hidden_task_id_route_used: false,
  };
}

function resolveContained(ownerPath, configuredPath, label) {
  if (typeof configuredPath !== 'string' || configuredPath.length === 0 || path.isAbsolute(configuredPath)) {
    throw new Error(`${label}_must_be_relative`);
  }
  const ownerRoot = fs.realpathSync(path.dirname(ownerPath));
  const resolved = path.resolve(ownerRoot, configuredPath);
  const real = fs.realpathSync(resolved);
  if (real !== ownerRoot && !real.startsWith(`${ownerRoot}${path.sep}`)) throw new Error(`${label}_escapes_manifest_root`);
  if (!fs.statSync(real).isFile()) throw new Error(`${label}_not_file`);
  return real;
}

function verifyArtifact(ownerPath, entry, pathField, hashField, label) {
  const artifactPath = resolveContained(ownerPath, entry[pathField], label);
  const actual = sha256File(artifactPath);
  if (actual !== entry[hashField]) throw new Error(`${label}_sha256_mismatch`);
  return { path: artifactPath, sha256: actual };
}

export function runProfileBoundGenomeUnit({
  publicTaskPath,
  profileArtifactManifestPath,
  decisionPath,
  out,
  registryPath = DEFAULT_REGISTRY_PATH,
}) {
  if (fs.existsSync(out)) throw new Error(`Output already exists; refusing to overwrite: ${out}`);
  const publicTask = readJson(publicTaskPath);
  const decision = readJson(decisionPath);
  const registry = readJson(registryPath);
  const binding = bindGenomeProfileDecision({ decision, publicTask, registry });
  fs.mkdirSync(out, { recursive: false });
  writeJson(path.join(out, 'decision-binding.json'), binding);
  if (binding.status !== 'bound') {
    const receipt = {
      surface_kind: 'opl_bio_genome_profile_bound_execution_receipt_v4',
      version: 'v4',
      ...binding,
      task_id: publicTask.task_id,
      domain_id: publicTask.domain_id,
      system_id: decision.system_id,
    };
    writeJson(path.join(out, 'receipt.json'), receipt);
    return receipt;
  }
  const manifest = readJson(profileArtifactManifestPath);
  if (manifest.task_id !== publicTask.task_id || manifest.domain_id !== publicTask.domain_id) {
    throw new Error('profile_artifact_manifest_task_identity_mismatch');
  }
  if (manifest.generated_before_prediction !== true || manifest.truth_accessed_during_generation !== false) {
    throw new Error('profile_artifact_manifest_blind_boundary_invalid');
  }
  const registrySha256 = sha256File(registryPath);
  if (manifest.profile_registry_sha256 !== registrySha256) throw new Error('profile_registry_sha256_mismatch');
  const expectedProfileIds = registry.domains
    .find((domain) => domain.domain_id === publicTask.domain_id)
    ?.profiles.map((profile) => profile.profile_id).sort() ?? [];
  const observedProfileIds = (manifest.profile_results ?? []).map((entry) => entry.profile_id).sort();
  if (JSON.stringify(observedProfileIds) !== JSON.stringify(expectedProfileIds)) {
    throw new Error('profile_artifact_manifest_incomplete_domain_profile_set');
  }
  const verifiedProfiles = new Map((manifest.profile_results ?? []).map((entry) => {
    const result = verifyArtifact(profileArtifactManifestPath, entry, 'result_path', 'result_sha256', 'profile_result');
    const executionReceipt = verifyArtifact(
      profileArtifactManifestPath,
      entry,
      'execution_receipt_path',
      'execution_receipt_sha256',
      'profile_execution_receipt',
    );
    const toolchainManifest = verifyArtifact(
      profileArtifactManifestPath,
      entry,
      'toolchain_manifest_path',
      'toolchain_manifest_sha256',
      'profile_toolchain_manifest',
    );
    return [entry.profile_id, { result, executionReceipt, toolchainManifest }];
  }));
  const selected = (manifest.profile_results ?? []).find((entry) => entry.profile_id === binding.execution_profile_id);
  if (!selected) throw new Error('selected_profile_result_missing_after_preflight');
  const { result, executionReceipt, toolchainManifest } = verifiedProfiles.get(binding.execution_profile_id);
  const resultDocument = readJson(result.path);
  if (resultDocument.surface_kind !== 'opl_bio_genome_analysis_normalized_result_v3'
    || resultDocument.status !== 'completed_local_pipeline_result'
    || resultDocument.task_id !== publicTask.task_id
    || resultDocument.domain_id !== publicTask.domain_id
    || resultDocument.system_id !== null
    || resultDocument.execution_profile_id !== binding.execution_profile_id
    || resultDocument.private_truth_accessed !== false) {
    throw new Error('selected_profile_result_contract_mismatch');
  }
  const executionDocument = readJson(executionReceipt.path);
  if (executionDocument.task_id !== publicTask.task_id
    || executionDocument.domain_id !== publicTask.domain_id
    || executionDocument.execution_profile_id !== binding.execution_profile_id
    || executionDocument.truth_accessed !== false) {
    throw new Error('selected_profile_execution_receipt_contract_mismatch');
  }
  const selectedResultPath = path.join(out, 'selected-result.json');
  writeJson(selectedResultPath, {
    ...resultDocument,
    system_id: decision.system_id,
  });
  const receipt = {
    surface_kind: 'opl_bio_genome_profile_bound_execution_receipt_v4',
    version: 'v4',
    status: 'completed',
    task_id: publicTask.task_id,
    domain_id: publicTask.domain_id,
    system_id: decision.system_id,
    agent_id: decision.system_id === 'opl_bio_genome_analysis_agent'
      ? 'opl_bio_genome_analysis_agent'
      : null,
    binding,
    selected_result: {
      path: path.basename(selectedResultPath),
      sha256: sha256File(selectedResultPath),
    },
    source_profile_result_sha256: result.sha256,
    profile_execution_receipt_sha256: executionReceipt.sha256,
    profile_toolchain_manifest_sha256: toolchainManifest.sha256,
    complete_domain_profile_artifact_count: observedProfileIds.length,
    identical_profile_result_reuse_allowed: true,
    private_truth_accessed: false,
    accuracy_score: null,
    zero_imputed: false,
  };
  writeJson(path.join(out, 'receipt.json'), receipt);
  return receipt;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    const fields = {
      '--public-task': 'publicTaskPath',
      '--profile-artifact-manifest': 'profileArtifactManifestPath',
      '--decision': 'decisionPath',
      '--out': 'out',
      '--registry': 'registryPath',
    };
    if (!fields[token] || !value) throw new Error(`Unknown or incomplete argument: ${token}`);
    args[fields[token]] = path.resolve(value);
  }
  for (const field of ['publicTaskPath', 'profileArtifactManifestPath', 'decisionPath', 'out']) {
    if (!args[field]) throw new Error(`Required argument missing: ${field}`);
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF_PATH) {
  const receipt = runProfileBoundGenomeUnit(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
