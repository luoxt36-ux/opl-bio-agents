function normalizeGene(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function splitList(value, separator = /[;,]/) {
  return String(value ?? '')
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function evidenceId(claimId, evidenceKind, token) {
  return `${claimId}:${evidenceKind}:${String(token ?? 'evidence').replace(/[^a-z0-9]+/gi, '_')}`;
}

function baseEvidenceRow(testCase, claimRow, artifactPaths, extra) {
  return {
    evidence_id: evidenceId(claimRow.claim_id, extra.evidence_kind, extra.evidence_ref),
    case_id: testCase.case_id,
    claim_id: claimRow.claim_id,
    evidence_ref: extra.evidence_ref,
    evidence_kind: extra.evidence_kind,
    evidence_type: extra.evidence_type ?? extra.evidence_kind,
    support_status: claimRow.support_status,
    supporting_genes: claimRow.supporting_genes,
    supporting_terms: claimRow.supporting_terms,
    artifact_refs: {
      de_results: artifactPaths.de_results,
      enrichment_results: artifactPaths.enrichment_results,
      sample_sheet: artifactPaths.sample_sheet,
      claim_table: artifactPaths.claim_table,
      review_receipt: artifactPaths.review_receipt,
      report: artifactPaths.report,
      ...(extra.artifact_refs ?? {}),
    },
    join_policy: extra.join_policy,
    artifact_row_key: extra.artifact_row_key ?? null,
    artifact_row_found: extra.artifact_row_found ?? null,
    authority_boundary: {
      evidence_can_claim_clinical_validity: false,
      evidence_can_claim_biological_quality_verdict: false,
    },
  };
}

function sourceEvidenceRows(testCase, claimRow, artifactPaths) {
  return splitList(claimRow.evidence_refs, /;/).map((ref) => {
    const kind = ref.split(':')[0] || 'unknown';
    return baseEvidenceRow(testCase, claimRow, artifactPaths, {
      evidence_ref: ref,
      evidence_kind: kind,
      evidence_type: kind === 'matrix' ? 'data' : kind,
      join_policy: 'claim_table.evidence_refs -> evidence_ledger.evidence_ref',
      artifact_row_found: true,
    });
  });
}

function statisticalEvidenceRows(testCase, claimRow, artifactPaths, deRows) {
  const byGene = new Map((deRows ?? []).map((row) => [normalizeGene(row.gene), row]));
  return splitList(claimRow.supporting_genes).map((gene) => {
    const row = byGene.get(normalizeGene(gene));
    return baseEvidenceRow(testCase, claimRow, artifactPaths, {
      evidence_ref: `de_results.tsv#gene=${gene}`,
      evidence_kind: 'statistical',
      evidence_type: 'statistical',
      join_policy: 'claim_table.supporting_genes -> de_results.gene',
      artifact_row_key: `gene=${gene}`,
      artifact_row_found: Boolean(row),
      artifact_refs: {
        de_results_row: row
          ? {
              gene: row.gene,
              log2FC: row.log2FC,
              padj: row.padj,
              direction: row.direction,
            }
          : null,
      },
    });
  });
}

function biologicalEvidenceRows(testCase, claimRow, artifactPaths, enrichmentRows) {
  const byTerm = new Map((enrichmentRows ?? []).map((row) => [normalizeText(row.term_name), row]));
  return splitList(claimRow.supporting_terms, /;/).map((term) => {
    const row = byTerm.get(normalizeText(term));
    return baseEvidenceRow(testCase, claimRow, artifactPaths, {
      evidence_ref: `enrichment_results.tsv#term_name=${term}`,
      evidence_kind: 'biological',
      evidence_type: 'biological',
      join_policy: 'claim_table.supporting_terms -> enrichment_results.term_name',
      artifact_row_key: `term_name=${term}`,
      artifact_row_found: Boolean(row),
      artifact_refs: {
        enrichment_results_row: row
          ? {
              term_id: row.term_id,
              term_name: row.term_name,
              overlap_genes: row.overlap_genes,
              adjusted_p_value: row.adjusted_p_value,
            }
          : null,
      },
    });
  });
}

function limitationEvidenceRows(testCase, claimRow, artifactPaths) {
  return splitList(claimRow.limitations, /;/).map((limitation) => baseEvidenceRow(testCase, claimRow, artifactPaths, {
    evidence_ref: `claim_table.tsv#claim_id=${claimRow.claim_id};limitation=${limitation}`,
    evidence_kind: 'limitation',
    evidence_type: 'limitation',
    join_policy: 'claim_table.limitations -> claim_table.claim_id',
    artifact_row_key: `claim_id=${claimRow.claim_id};limitation=${limitation}`,
    artifact_row_found: true,
  }));
}

function reviewEvidenceRow(testCase, claimRow, artifactPaths) {
  return baseEvidenceRow(testCase, claimRow, artifactPaths, {
    evidence_ref: `review_receipt.json#case_id=${testCase.case_id};scope=claim_grounding`,
    evidence_kind: 'review',
    evidence_type: 'review',
    join_policy: 'claim_id -> review_receipt.claim_count/evidence_row_count',
    artifact_row_key: `case_id=${testCase.case_id}`,
    artifact_row_found: true,
  });
}

export function buildBulkRnaSeqEvidenceLedgerRows(testCase, claimRows, artifactPaths, context = {}) {
  return claimRows.flatMap((claimRow) => [
    ...sourceEvidenceRows(testCase, claimRow, artifactPaths),
    ...statisticalEvidenceRows(testCase, claimRow, artifactPaths, context.deRows),
    ...biologicalEvidenceRows(testCase, claimRow, artifactPaths, context.enrichmentRows),
    ...limitationEvidenceRows(testCase, claimRow, artifactPaths),
    reviewEvidenceRow(testCase, claimRow, artifactPaths),
  ]);
}
