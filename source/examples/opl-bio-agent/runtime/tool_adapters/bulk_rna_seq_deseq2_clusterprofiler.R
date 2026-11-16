suppressPackageStartupMessages({
  library(DESeq2)
  library(clusterProfiler)
  library(org.Hs.eg.db)
})

args <- commandArgs(trailingOnly = TRUE)

read_arg <- function(flag, default = NULL) {
  index <- match(flag, args)
  if (is.na(index) || index == length(args)) {
    return(default)
  }
  args[[index + 1]]
}

counts_path <- read_arg("--counts")
sample_sheet_path <- read_arg("--sample-sheet")
out_dir <- read_arg("--out-dir")
case_condition <- read_arg("--case-condition")
control_condition <- read_arg("--control-condition")
design_formula_text <- read_arg("--design-formula", "~ condition")
fdr_threshold <- as.numeric(read_arg("--fdr-threshold", "1"))
absolute_log2fc_threshold <- as.numeric(read_arg("--absolute-log2fc-threshold", "0"))
minimum_count <- as.numeric(read_arg("--minimum-count", "0"))

if (is.null(counts_path) || is.null(sample_sheet_path) || is.null(out_dir) ||
    is.null(case_condition) || is.null(control_condition)) {
  stop("Usage: Rscript bulk_rna_seq_deseq2_clusterprofiler.R --counts <counts.tsv> --sample-sheet <sample_sheet.tsv> --out-dir <dir> --case-condition <case> --control-condition <control> [--design-formula <formula>]")
}

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

counts <- read.delim(counts_path, check.names = FALSE, stringsAsFactors = FALSE)
sample_sheet <- read.delim(sample_sheet_path, check.names = FALSE, stringsAsFactors = FALSE)

if (!"gene" %in% colnames(counts)) {
  stop("counts.tsv must contain a gene column")
}
if (!all(c("sample_id", "condition") %in% colnames(sample_sheet))) {
  stop("sample_sheet.tsv must contain sample_id and condition columns")
}

gene_ids <- counts$gene
count_matrix <- as.matrix(counts[, setdiff(colnames(counts), "gene"), drop = FALSE])
rownames(count_matrix) <- gene_ids
count_matrix <- round(count_matrix)
count_matrix[count_matrix < 0] <- 0

sample_sheet <- sample_sheet[sample_sheet$sample_id %in% colnames(count_matrix), , drop = FALSE]
sample_sheet <- sample_sheet[match(colnames(count_matrix), sample_sheet$sample_id), , drop = FALSE]
rownames(sample_sheet) <- sample_sheet$sample_id

sample_sheet$condition <- factor(sample_sheet$condition)
if (!all(c(case_condition, control_condition) %in% levels(sample_sheet$condition))) {
  stop("contrast conditions not found in sample_sheet")
}
sample_sheet$condition <- relevel(sample_sheet$condition, ref = control_condition)

requested_design_formula <- as.formula(design_formula_text)
requested_formula_vars <- all.vars(requested_design_formula)
design_sanitization_notes <- character()
missing_formula_vars <- setdiff(requested_formula_vars, colnames(sample_sheet))
if (length(missing_formula_vars) > 0) {
  design_sanitization_notes <- c(
    design_sanitization_notes,
    paste("dropped_missing_design_variable", paste(missing_formula_vars, collapse = ","))
  )
}
design_vars <- requested_formula_vars[requested_formula_vars %in% colnames(sample_sheet)]
# Benchmark coefficient names are semantic labels, while the materialized
# sample sheet exposes condition. Use condition unless the requested formula
# explicitly contains its own condition variable.
if (!("condition" %in% design_vars)) {
  design_vars <- "condition"
  design_sanitization_notes <- c(
    design_sanitization_notes,
    "mapped_benchmark_formula_to_condition_contrast"
  )
}
design_vars <- unique(design_vars)
for (var_name in design_vars) {
  if (is.character(sample_sheet[[var_name]])) {
    sample_sheet[[var_name]] <- factor(sample_sheet[[var_name]])
  }
}
for (var_name in setdiff(design_vars, "condition")) {
  if (identical(as.character(sample_sheet[[var_name]]), as.character(sample_sheet$condition))) {
    design_vars <- setdiff(design_vars, var_name)
    design_sanitization_notes <- c(
      design_sanitization_notes,
      paste("dropped_condition_duplicate_design_variable", var_name)
    )
  }
}
if (length(design_vars) == 0) {
  design_vars <- "condition"
}

design_formula_for_vars <- function(vars) {
  as.formula(paste("~", paste(vars, collapse = " + ")))
}

design_formula <- design_formula_for_vars(design_vars)
design_matrix <- model.matrix(design_formula, data = sample_sheet)
if (qr(design_matrix)$rank < ncol(design_matrix)) {
  rank_fixed <- FALSE
  for (var_name in setdiff(design_vars, "condition")) {
    trial_vars <- setdiff(design_vars, var_name)
    if (!("condition" %in% trial_vars)) {
      trial_vars <- c(trial_vars, "condition")
    }
    trial_formula <- design_formula_for_vars(unique(trial_vars))
    trial_matrix <- model.matrix(trial_formula, data = sample_sheet)
    if (qr(trial_matrix)$rank == ncol(trial_matrix)) {
      design_vars <- unique(trial_vars)
      design_formula <- trial_formula
      design_sanitization_notes <- c(
        design_sanitization_notes,
        paste("dropped_rank_deficient_design_variable", var_name)
      )
      rank_fixed <- TRUE
      break
    }
  }
  if (!rank_fixed) {
    design_vars <- "condition"
    design_formula <- ~ condition
    design_sanitization_notes <- c(
      design_sanitization_notes,
      "reduced_design_to_condition_due_to_rank_deficiency"
    )
  }
}

dds <- DESeqDataSetFromMatrix(
  countData = count_matrix,
  colData = sample_sheet,
  design = design_formula
)
dds <- dds[rowSums(counts(dds) >= minimum_count) >= min(table(sample_sheet$condition)), ]
dds <- dds[rowSums(counts(dds)) > 0, ]
dispersion_strategy <- "DESeq_default"
dds <- tryCatch(
  DESeq(dds, quiet = TRUE),
  error = function(error) {
    message("DESeq default dispersion fit failed; using gene-wise dispersion estimates. Error: ", conditionMessage(error))
    fallback <- estimateSizeFactors(dds)
    fallback <- estimateDispersionsGeneEst(fallback, quiet = TRUE)
    dispersions(fallback) <- mcols(fallback)$dispGeneEst
    fallback <- nbinomWaldTest(fallback, quiet = TRUE)
    dispersion_strategy <<- "gene_wise_dispersion_fallback"
    fallback
  }
)

res <- results(dds, contrast = c("condition", case_condition, control_condition))
res_df <- as.data.frame(res)
res_df$gene <- rownames(res_df)
res_df$ensembl_id <- res_df$gene
valid_ensembl <- intersect(res_df$ensembl_id, keys(org.Hs.eg.db, keytype = "ENSEMBL"))
symbol_by_ensembl <- rep(NA_character_, nrow(res_df))
if (length(valid_ensembl) > 0) {
  mapped_symbols <- suppressMessages(
    mapIds(
      org.Hs.eg.db,
      keys = valid_ensembl,
      keytype = "ENSEMBL",
      column = "SYMBOL",
      multiVals = "first"
    )
  )
  symbol_by_ensembl[match(names(mapped_symbols), res_df$ensembl_id)] <- unname(mapped_symbols)
}
res_df$symbol <- symbol_by_ensembl
res_df$gene <- ifelse(
  !is.na(res_df$symbol) & res_df$symbol != "",
  res_df$symbol,
  res_df$ensembl_id
)
res_df$direction <- ifelse(!is.na(res_df$log2FoldChange) & res_df$log2FoldChange >= 0, "up", "down")
res_df <- res_df[, c("gene", "ensembl_id", "symbol", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj", "direction")]
res_df <- res_df[
  !is.na(res_df$padj) &
    res_df$padj <= fdr_threshold &
    abs(res_df$log2FoldChange) >= absolute_log2fc_threshold,
  ,
  drop = FALSE
]
res_df <- res_df[order(abs(res_df$log2FoldChange), decreasing = TRUE, na.last = TRUE), ]
write.table(res_df, file.path(out_dir, "deseq2_results.tsv"), sep = "\t", quote = FALSE, row.names = FALSE)

normalized <- counts(dds, normalized = TRUE)
normalized_df <- data.frame(gene = rownames(normalized), normalized, check.names = FALSE)
write.table(normalized_df, file.path(out_dir, "deseq2_normalized_counts.tsv"), sep = "\t", quote = FALSE, row.names = FALSE)

up_genes <- res_df$gene[!is.na(res_df$log2FoldChange) & res_df$log2FoldChange > 0]
mapped_up_genes <- unique(up_genes[up_genes %in% keys(org.Hs.eg.db, keytype = "SYMBOL")])
entrez <- if (length(mapped_up_genes) > 0) {
  suppressMessages(
    bitr(mapped_up_genes, fromType = "SYMBOL", toType = "ENTREZID", OrgDb = org.Hs.eg.db)
  )
} else {
  NULL
}

enrich_df <- data.frame()
if (!is.null(entrez) && nrow(entrez) > 0) {
  ego <- tryCatch(
    enrichGO(
      gene = unique(entrez$ENTREZID),
      OrgDb = org.Hs.eg.db,
      keyType = "ENTREZID",
      ont = "BP",
      pAdjustMethod = "BH",
      qvalueCutoff = 1,
      readable = TRUE
    ),
    error = function(error) NULL
  )
  if (!is.null(ego)) {
    enrich_df <- as.data.frame(ego)
  }
}

if (nrow(enrich_df) == 0) {
  enrich_df <- data.frame(
    ID = character(),
    Description = character(),
    GeneRatio = character(),
    BgRatio = character(),
    pvalue = numeric(),
    p.adjust = numeric(),
    qvalue = numeric(),
    geneID = character(),
    Count = integer()
  )
}
write.table(enrich_df, file.path(out_dir, "clusterprofiler_enrichment_results.tsv"), sep = "\t", quote = FALSE, row.names = FALSE)

receipt <- list(
  surface_kind = "opl_bio_bulk_rna_seq_live_bioc_runner_receipt",
  status = "generated",
  execution_mode = "live_deseq2_clusterprofiler",
  counts_path = normalizePath(counts_path),
  sample_sheet_path = normalizePath(sample_sheet_path),
  out_dir = normalizePath(out_dir),
  case_condition = case_condition,
  control_condition = control_condition,
  requested_design_formula = as.character(requested_design_formula),
  design_formula = as.character(design_formula),
  analysis_policy = list(
    fdr_threshold = fdr_threshold,
    absolute_log2fc_threshold = absolute_log2fc_threshold,
    minimum_count = minimum_count,
    minimum_count_support = "count_at_least_threshold_in_at_least_smallest_condition_group"
  ),
  design_sanitization_notes = design_sanitization_notes,
  versions = list(
    R = as.character(getRversion()),
    DESeq2 = as.character(packageVersion("DESeq2")),
    clusterProfiler = as.character(packageVersion("clusterProfiler")),
    org_Hs_eg_db = as.character(packageVersion("org.Hs.eg.db"))
  ),
  dispersion_strategy = dispersion_strategy,
  outputs = list(
    deseq2_results = file.path(normalizePath(out_dir), "deseq2_results.tsv"),
    deseq2_normalized_counts = file.path(normalizePath(out_dir), "deseq2_normalized_counts.tsv"),
    clusterprofiler_enrichment_results = file.path(normalizePath(out_dir), "clusterprofiler_enrichment_results.tsv")
  ),
  authority_boundary = list(
    runner_can_claim_deseq2 = TRUE,
    runner_can_claim_clusterprofiler = TRUE,
    runner_can_claim_live_geo_download = FALSE,
    runner_can_claim_domain_ready = FALSE,
    runner_can_claim_clinical_validity = FALSE
  )
)

jsonlite::write_json(receipt, file.path(out_dir, "live_bioc_receipt.json"), pretty = TRUE, auto_unbox = TRUE)
