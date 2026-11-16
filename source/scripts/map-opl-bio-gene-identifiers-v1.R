#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2) {
  stop("Usage: map-opl-bio-gene-identifiers-v1.R <input.tsv> <output.tsv>")
}

suppressPackageStartupMessages({
  library(AnnotationDbi)
  library(org.Hs.eg.db)
})

rows <- read.delim(args[[1]], stringsAsFactors = FALSE, check.names = FALSE)
if (!all(c("identifier", "keytype") %in% colnames(rows))) {
  stop("Input must contain identifier and keytype columns")
}

mapped <- rep(NA_character_, nrow(rows))
for (keytype in unique(rows$keytype)) {
  indexes <- which(rows$keytype == keytype)
  values <- as.character(rows$identifier[indexes])
  if (keytype == "SYMBOL") {
    mapped[indexes] <- values
    next
  }
  valid_keys <- keys(org.Hs.eg.db, keytype = keytype)
  values <- values[values %in% valid_keys]
  indexes <- indexes[as.character(rows$identifier[indexes]) %in% valid_keys]
  if (length(values) == 0) next
  result <- mapIds(
    org.Hs.eg.db,
    keys = values,
    column = "SYMBOL",
    keytype = keytype,
    multiVals = "first"
  )
  mapped[indexes] <- unname(result[values])
}

write.table(
  data.frame(identifier = rows$identifier, keytype = rows$keytype, symbol = mapped),
  file = args[[2]],
  sep = "\t",
  quote = FALSE,
  row.names = FALSE,
  na = ""
)
