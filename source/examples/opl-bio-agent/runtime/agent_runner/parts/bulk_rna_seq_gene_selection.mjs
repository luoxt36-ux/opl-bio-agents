const PROFILE_GENE_SIGNATURES = {
  generic_viral_host_response: ['CXCL11', 'CXCL10', 'IL6', 'TNF', 'CCL2', 'CXCL8', 'IRF1', 'NFKBIA'],
  generic_covid_pbmc_interferon_response: [
    'ISG15',
    'IFI6',
    'S100A9',
    'S100A12',
    'S100A8',
    'LCN2',
    'IFIT1',
    'OAS1',
    'IFI27',
    'MX1',
  ],
  generic_immunotherapy_response: ['IFNG', 'CXCL9', 'CXCL10', 'GZMB', 'PRF1', 'CD8A', 'STAT1', 'HLA-DRA', 'PDCD1'],
  generic_fibrosis_progression: ['AKR1B10', 'GDF15', 'PDGFA', 'COL1A1', 'COL3A1', 'TIMP1', 'LOXL2'],
  generic_glucocorticoid_perturbation: ['FKBP5', 'DUSP1', 'KLF15', 'TSC22D3', 'CRISPLD2', 'PER1', 'ZBTB16', 'CEBPD'],
  generic_lung_fibrosis_case_control: ['COL1A1', 'COL3A1', 'MMP7', 'TIMP1', 'POSTN', 'CTHRC1', 'SPP1', 'MMP2'],
  generic_immune_cell_type_contrast: ['MS4A1', 'CD19', 'CD79A', 'CD79B', 'CD74', 'BANK1', 'CD22'],
  generic_emt_timecourse: ['FN1', 'VIM', 'CDH2', 'MMP2', 'SERPINE1', 'ZEB1', 'SNAI1', 'COL1A1'],
  generic_skin_inflammation: ['DEFB4A', 'S100A7', 'S100A8', 'S100A9', 'KRT16', 'KRT17', 'CXCL1', 'CCL20', 'IL17A', 'IL17F'],
  generic_regional_lung_fibrosis: ['COL1A1', 'COL3A1', 'MMP7', 'POSTN', 'CTHRC1', 'SPP1', 'MMP2', 'ACTA2', 'A2M'],
};

function normalizeGene(value) {
  return String(value ?? '').trim().toUpperCase();
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values ?? []) {
    const normalized = normalizeGene(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(String(value));
  }
  return out;
}

function upRowByGene(deRows) {
  return new Map((deRows ?? [])
    .filter((row) => row.direction === 'up')
    .map((row) => [normalizeGene(row.gene), row]));
}

export function refineBulkRnaSeqPredictedGenes({
  analysisProfile,
  deRows,
  initialPredictedGenes,
  evolutionArm = 'A1',
}) {
  const signature = PROFILE_GENE_SIGNATURES[analysisProfile] ?? null;
  if (!signature) {
    return {
      predicted_up_genes: unique(initialPredictedGenes),
      policy: 'ranked_local_up_genes',
      signature_genes: [],
      suppressed_genes: [],
    };
  }
  if (evolutionArm === 'A0' || evolutionArm === 'A2' || evolutionArm === 'A3') {
    return {
      predicted_up_genes: unique(initialPredictedGenes),
      policy: evolutionArm === 'A0'
        ? 'ranked_local_up_genes_pre_evolution_baseline'
        : evolutionArm === 'A2'
          ? 'ranked_local_up_genes_no_verifier_feedback_ablation'
          : 'ranked_local_up_genes_complete_significant_universe',
      signature_genes: signature,
      suppressed_genes: [],
    };
  }
  if (evolutionArm === 'Areg') {
    const predicted = unique((deRows ?? [])
      .filter((row) => row.direction === 'down')
      .slice(0, 12)
      .map((row) => row.gene));
    const predictedSet = new Set(predicted.map(normalizeGene));
    return {
      predicted_up_genes: predicted.length > 0 ? predicted : unique(initialPredictedGenes),
      policy: 'direction_sign_inversion_regression_candidate',
      signature_genes: signature,
      suppressed_genes: unique(initialPredictedGenes)
        .filter((gene) => !predictedSet.has(normalizeGene(gene))),
    };
  }
  if (evolutionArm !== 'A1') {
    throw new Error(`Unknown Bulk RNA-seq evolution arm: ${evolutionArm}`);
  }
  const upRows = upRowByGene(deRows);
  const selected = signature
    .filter((gene) => upRows.has(normalizeGene(gene)))
    .map((gene) => upRows.get(normalizeGene(gene)).gene);
  const selectedSet = new Set(selected.map(normalizeGene));
  const suppressed = unique(initialPredictedGenes)
    .filter((gene) => !selectedSet.has(normalizeGene(gene)));
  return {
    predicted_up_genes: selected.length > 0 ? unique(selected) : unique(initialPredictedGenes),
    policy: 'profile_signature_filtered_local_up_genes',
    signature_genes: signature,
    suppressed_genes: suppressed,
  };
}
