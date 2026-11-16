import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

const INPUT_LANES = {
  PROCESSED_TSV: 'processed_count_matrix_with_cell_metadata',
  TENX_MTX: 'cellranger_feature_barcode_matrix',
  H5AD: 'h5ad_processed_object',
};

function readText(filePath) {
  const buffer = fs.readFileSync(filePath);
  return filePath.endsWith('.gz')
    ? zlib.gunzipSync(buffer).toString('utf8')
    : buffer.toString('utf8');
}

function readRows(filePath) {
  return readText(filePath)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeTsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => row.join('\t')).join('\n')}\n`);
}

function repoRelativePath(repoRoot, maybeRelativePath) {
  if (!maybeRelativePath) {
    return null;
  }
  return path.isAbsolute(maybeRelativePath) ? maybeRelativePath : path.join(repoRoot, maybeRelativePath);
}

function resolveInputPath(repoRoot, agentRoot, maybeRelativePath) {
  const first = repoRelativePath(repoRoot, maybeRelativePath);
  if (!first || fs.existsSync(first) || path.isAbsolute(maybeRelativePath ?? '')) {
    return first;
  }
  const candidates = [
    path.join(agentRoot, maybeRelativePath),
    path.join(repoRoot, 'examples/opl-bio-agent', maybeRelativePath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function uniqueFeatureNames(features) {
  const seen = new Map();
  return features.map((feature) => {
    const raw = String(feature.name || feature.id || '').trim() || 'unknown_gene';
    const count = seen.get(raw) ?? 0;
    seen.set(raw, count + 1);
    return count === 0 ? raw : `${raw}_${count + 1}`;
  });
}

function findTenxFile(tenxDir, names) {
  return names
    .map((name) => path.join(tenxDir, name))
    .find((candidate) => fs.existsSync(candidate));
}

function readTenxFeatures(filePath) {
  return readRows(filePath).map((columns) => ({
    id: columns[0] ?? '',
    name: columns[1] || columns[0] || '',
    type: columns[2] ?? '',
  }));
}

function readTenxBarcodes(filePath) {
  return readText(filePath)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim());
}

function parseMatrixMarketCoordinate(filePath) {
  const lines = readText(filePath).split(/\r?\n/);
  const dataLines = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%'));
  const [shapeLine, ...entryLines] = dataLines;
  const [rowCount, columnCount] = shapeLine.split(/\s+/).map((value) => Number(value));
  const matrix = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => 0));
  for (const line of entryLines) {
    const [rowIndex, columnIndex, value] = line.split(/\s+/);
    const row = Number(rowIndex) - 1;
    const column = Number(columnIndex) - 1;
    if (Number.isInteger(row) && Number.isInteger(column) && row >= 0 && column >= 0) {
      matrix[row][column] = Number(value ?? 0);
    }
  }
  return { rowCount, columnCount, matrix };
}

function materializeProcessedTsv({ repoRoot, agentRoot, localInputs, materializedDir }) {
  const countsPath = resolveInputPath(repoRoot, agentRoot, localInputs.counts_tsv);
  const metadataPath = resolveInputPath(repoRoot, agentRoot, localInputs.cell_metadata_tsv);
  if (!countsPath || !metadataPath || !fs.existsSync(countsPath) || !fs.existsSync(metadataPath)) {
    return {
      status: 'blocked',
      blocker: 'processed_tsv_input_missing',
      requested_lane: INPUT_LANES.PROCESSED_TSV,
      counts_path: countsPath,
      metadata_path: metadataPath,
    };
  }
  const materializedCountsPath = path.join(materializedDir, 'counts.tsv');
  const materializedMetadataPath = path.join(materializedDir, 'cell_metadata.tsv');
  copyFile(countsPath, materializedCountsPath);
  copyFile(metadataPath, materializedMetadataPath);
  return {
    status: 'generated',
    requested_lane: INPUT_LANES.PROCESSED_TSV,
    materialized_lane: INPUT_LANES.PROCESSED_TSV,
    source_paths: {
      counts_tsv: countsPath,
      cell_metadata_tsv: metadataPath,
    },
    counts_path: materializedCountsPath,
    metadata_path: materializedMetadataPath,
  };
}

function materializeTenxMtx({ repoRoot, agentRoot, localInputs, materializedDir }) {
  const tenxDir = resolveInputPath(repoRoot, agentRoot, localInputs.tenx_mtx_dir || localInputs.tenx_dir);
  const metadataPath = resolveInputPath(repoRoot, agentRoot, localInputs.cell_metadata_tsv);
  if (!tenxDir || !fs.existsSync(tenxDir) || !metadataPath || !fs.existsSync(metadataPath)) {
    return {
      status: 'blocked',
      blocker: 'tenx_mtx_input_missing',
      requested_lane: INPUT_LANES.TENX_MTX,
      tenx_dir: tenxDir,
      metadata_path: metadataPath,
    };
  }
  const matrixPath = findTenxFile(tenxDir, ['matrix.mtx', 'matrix.mtx.gz', 'matrix.mtx.txt']);
  const featuresPath = findTenxFile(tenxDir, ['features.tsv', 'features.tsv.gz', 'genes.tsv', 'genes.tsv.gz']);
  const barcodesPath = findTenxFile(tenxDir, ['barcodes.tsv', 'barcodes.tsv.gz']);
  if (!matrixPath || !featuresPath || !barcodesPath) {
    return {
      status: 'blocked',
      blocker: 'tenx_mtx_required_file_missing',
      requested_lane: INPUT_LANES.TENX_MTX,
      tenx_dir: tenxDir,
      matrix_path: matrixPath,
      features_path: featuresPath,
      barcodes_path: barcodesPath,
    };
  }
  const features = readTenxFeatures(featuresPath);
  const barcodes = readTenxBarcodes(barcodesPath);
  const { rowCount, columnCount, matrix } = parseMatrixMarketCoordinate(matrixPath);
  if (features.length !== rowCount || barcodes.length !== columnCount) {
    return {
      status: 'blocked',
      blocker: 'tenx_mtx_shape_mismatch',
      requested_lane: INPUT_LANES.TENX_MTX,
      feature_count: features.length,
      barcode_count: barcodes.length,
      matrix_row_count: rowCount,
      matrix_column_count: columnCount,
    };
  }
  const genes = uniqueFeatureNames(features);
  const rows = [
    ['gene', ...barcodes],
    ...genes.map((gene, index) => [gene, ...matrix[index].map((value) => String(value))]),
  ];
  const materializedCountsPath = path.join(materializedDir, 'counts.tsv');
  const materializedMetadataPath = path.join(materializedDir, 'cell_metadata.tsv');
  writeTsv(materializedCountsPath, rows);
  copyFile(metadataPath, materializedMetadataPath);
  return {
    status: 'generated',
    requested_lane: INPUT_LANES.TENX_MTX,
    materialized_lane: INPUT_LANES.PROCESSED_TSV,
    source_paths: {
      tenx_dir: tenxDir,
      matrix_mtx: matrixPath,
      features_tsv: featuresPath,
      barcodes_tsv: barcodesPath,
      cell_metadata_tsv: metadataPath,
    },
    counts_path: materializedCountsPath,
    metadata_path: materializedMetadataPath,
    feature_count: features.length,
    barcode_count: barcodes.length,
  };
}

function materializeH5ad({ repoRoot, agentRoot, localInputs, materializedDir, pythonBin, testCase }) {
  const h5adPath = resolveInputPath(repoRoot, agentRoot, localInputs.h5ad);
  if (!h5adPath || !fs.existsSync(h5adPath)) {
    return {
      status: 'blocked',
      blocker: 'h5ad_input_missing',
      requested_lane: INPUT_LANES.H5AD,
      h5ad_path: h5adPath,
    };
  }
  const scriptPath = [
    path.join(agentRoot, 'runtime/tool_adapters/sc_rna_seq_h5ad_export.py'),
    path.resolve('examples/opl-bio-agent/runtime/tool_adapters/sc_rna_seq_h5ad_export.py'),
    path.resolve('runtime/tool_adapters/sc_rna_seq_h5ad_export.py'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!scriptPath) {
    return {
      status: 'blocked',
      blocker: 'h5ad_export_adapter_missing',
      requested_lane: INPUT_LANES.H5AD,
      h5ad_path: h5adPath,
    };
  }
  const result = spawnSync(pythonBin ?? 'python3', [
    scriptPath,
    '--h5ad', h5adPath,
    '--out-dir', materializedDir,
    '--case-id', testCase.case_id,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MPLCONFIGDIR: path.join(materializedDir, 'matplotlib_config'),
    },
    timeout: 20 * 60 * 1000,
  });
  const receiptPath = path.join(materializedDir, 'h5ad_export_receipt.json');
  const receipt = fs.existsSync(receiptPath)
    ? JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
    : {
        status: 'blocked',
        blocker: result.error ? result.error.message : 'h5ad_export_failed_without_receipt',
        stdout_tail: `${result.stdout ?? ''}`.trim().split(/\r?\n/).slice(-8).join('\n') || null,
        stderr_tail: `${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-12).join('\n') || null,
      };
  return {
    status: receipt.status === 'generated' ? 'generated' : 'blocked',
    blocker: receipt.blocker ?? null,
    requested_lane: INPUT_LANES.H5AD,
    materialized_lane: receipt.status === 'generated' ? INPUT_LANES.PROCESSED_TSV : null,
    source_paths: {
      h5ad: h5adPath,
    },
    counts_path: receipt.outputs?.counts_tsv ?? path.join(materializedDir, 'counts.tsv'),
    metadata_path: receipt.outputs?.cell_metadata_tsv ?? path.join(materializedDir, 'cell_metadata.tsv'),
    h5ad_export_receipt_path: receiptPath,
    h5ad_export_receipt: receipt,
  };
}

export function describeScRnaSeqInputLanes() {
  return [
    INPUT_LANES.PROCESSED_TSV,
    INPUT_LANES.TENX_MTX,
    INPUT_LANES.H5AD,
  ];
}

export function materializeScRnaSeqInput({ testCase, repoRoot, agentRoot, outDir, receiptPath, pythonBin }) {
  const localInputs = testCase.input_task?.local_inputs ?? {};
  const materializedDir = path.join(outDir, 'materialized_inputs');
  fs.mkdirSync(materializedDir, { recursive: true });

  let result;
  if (localInputs.counts_tsv && localInputs.cell_metadata_tsv) {
    result = materializeProcessedTsv({ repoRoot, agentRoot, localInputs, materializedDir });
  } else if ((localInputs.tenx_mtx_dir || localInputs.tenx_dir) && localInputs.cell_metadata_tsv) {
    result = materializeTenxMtx({ repoRoot, agentRoot, localInputs, materializedDir });
  } else if (localInputs.h5ad) {
    result = materializeH5ad({ repoRoot, agentRoot, localInputs, materializedDir, pythonBin, testCase });
  } else {
    result = {
      status: 'blocked',
      blocker: 'unsupported_or_missing_scrna_input_lane',
      requested_lane: null,
    };
  }

  const receipt = {
    surface_kind: 'opl_bio_sc_rna_seq_input_materialization_receipt',
    status: result.status,
    case_id: testCase.case_id,
    accepted_input_lanes: describeScRnaSeqInputLanes(),
    requested_lane: result.requested_lane ?? null,
    materialized_lane: result.materialized_lane ?? null,
    blocker: result.blocker ?? null,
    counts_path: result.counts_path ?? null,
    metadata_path: result.metadata_path ?? null,
    source_paths: result.source_paths ?? {},
    details: Object.fromEntries(Object.entries(result)
      .filter(([key]) => !['status', 'blocker', 'counts_path', 'metadata_path', 'source_paths'].includes(key))),
    authority_boundary: {
      materializer_can_claim_raw_read_alignment: false,
      materializer_can_claim_article_grade_replay: false,
      materializer_can_claim_clinical_validity: false,
    },
  };
  writeJson(receiptPath, receipt);
  return {
    ...result,
    receipt,
    receipt_path: receiptPath,
  };
}
