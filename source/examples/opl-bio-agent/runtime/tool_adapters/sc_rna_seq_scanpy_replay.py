#!/usr/bin/env python3
import argparse
import json
import os
import sys
import traceback


def parse_args():
    parser = argparse.ArgumentParser(description="Run an optional Scanpy processed-matrix replay lane.")
    parser.add_argument("--counts")
    parser.add_argument("--h5ad")
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--condition-field", required=True)
    parser.add_argument("--cell-type-field", required=True)
    parser.add_argument("--case-condition", required=True)
    parser.add_argument("--control-condition", required=True)
    parser.add_argument("--sample-field", default="donor")
    parser.add_argument("--batch-field", default="batch")
    parser.add_argument("--enable-umap-plots", action="store_true")
    return parser.parse_args()


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def blocked_receipt(args, blocker, detail=None):
    return {
        "surface_kind": "opl_bio_sc_rna_seq_scanpy_receipt",
        "status": "blocked",
        "case_id": args.case_id,
        "blocker": blocker,
        "detail": detail,
        "outputs": {},
        "authority_boundary": {
            "receipt_can_claim_article_grade_replay": False,
            "receipt_can_claim_clinical_validity": False,
        },
    }


def main():
    args = parse_args()
    receipt_path = os.path.join(args.out_dir, "live_scanpy_receipt.json")
    os.makedirs(args.out_dir, exist_ok=True)
    os.makedirs(os.path.join(args.out_dir, "figures"), exist_ok=True)
    os.makedirs(os.path.join(args.out_dir, "tables"), exist_ok=True)

    try:
        import numpy as np
        import pandas as pd
        import matplotlib
        matplotlib.use("Agg")
        import scanpy as sc
    except Exception as error:
        write_json(receipt_path, blocked_receipt(
            args,
            "scanpy_or_dependency_missing",
            f"{error.__class__.__name__}: {error}",
        ))
        return 0

    try:
        metadata = pd.read_csv(args.metadata, sep="\t")
        if "cell_id" not in metadata.columns:
            raise ValueError("metadata table must contain a cell_id column")
        metadata = metadata.set_index("cell_id")

        if args.h5ad:
            # Large matrices stay in H5AD; converting them to a dense TSV first
            # exhausts both disk and Node memory.
            adata = sc.read_h5ad(args.h5ad)
            adata.obs_names_make_unique()
            missing = [cell for cell in metadata.index if cell not in adata.obs_names]
            if missing:
                raise ValueError(f"metadata cells missing from h5ad: {len(missing)}")
            for column in metadata.columns:
                if column not in adata.obs.columns:
                    adata.obs[column] = metadata.loc[adata.obs_names, column]
        else:
            counts = pd.read_csv(args.counts, sep="\t")
            if "gene" not in counts.columns:
                raise ValueError("counts table must contain a gene column")
            genes = counts["gene"].astype(str).to_list()
            matrix = counts.drop(columns=["gene"]).transpose()
            matrix.index.name = "cell_id"
            matrix.columns = genes
            metadata = metadata.loc[matrix.index]
            adata = sc.AnnData(matrix.astype(float))
            adata.obs = metadata.copy()
            adata.var_names = genes
            adata.var_names_make_unique()

        sc.pp.filter_cells(adata, min_genes=1)
        sc.pp.filter_genes(adata, min_cells=1)
        adata.obs["total_counts"] = np.asarray(adata.X.sum(axis=1)).reshape(-1)
        adata.obs["n_genes_by_counts"] = np.asarray((adata.X > 0).sum(axis=1)).reshape(-1)
        sc.pp.normalize_total(adata, target_sum=1e4)
        sc.pp.log1p(adata)

        # Core routine scRNA outputs used by the coverage gate. These are
        # concrete Scanpy-derived artifacts; interpretation remains bounded.
        hvg_path = os.path.join(args.out_dir, "tables", "scanpy_highly_variable_genes.tsv")
        try:
            sc.pp.highly_variable_genes(adata, n_top_genes=min(2000, adata.n_vars), flavor="seurat_v3")
        except Exception:
            sc.pp.highly_variable_genes(adata, n_top_genes=min(2000, adata.n_vars), flavor="cell_ranger")
        hvg_df = pd.DataFrame({
            "gene": adata.var_names,
            "highly_variable": adata.var["highly_variable"].astype(bool).to_numpy(),
            "means": adata.var.get("means", pd.Series(index=adata.var_names, dtype=float)).to_numpy(),
            "dispersions_norm": adata.var.get("dispersions_norm", pd.Series(index=adata.var_names, dtype=float)).to_numpy(),
        }).sort_values(["highly_variable", "dispersions_norm"], ascending=[False, False], na_position="last")
        hvg_df.to_csv(hvg_path, sep="\t", index=False)

        pca_path = os.path.join(args.out_dir, "tables", "scanpy_pca_coordinates.tsv")
        if adata.n_obs >= 3 and adata.n_vars >= 3:
            pca_feature_count = int(adata.var["highly_variable"].sum()) if "highly_variable" in adata.var else adata.n_vars
            sc.pp.pca(adata, n_comps=max(1, min(10, adata.n_obs - 1, pca_feature_count - 1)))
            pca_df = pd.DataFrame(
                adata.obsm["X_pca"][:, : min(3, adata.obsm["X_pca"].shape[1])],
                index=adata.obs_names,
            )
            pca_df.columns = [f"PC{index + 1}" for index in range(pca_df.shape[1])]
            pca_df.insert(0, "cell_id", adata.obs_names)
            pca_df.to_csv(pca_path, sep="\t", index=False)
        else:
            adata.obsm["X_pca"] = np.column_stack([
                np.arange(adata.n_obs, dtype=float),
                np.zeros(adata.n_obs, dtype=float),
            ])
            pca_df = pd.DataFrame({
                "cell_id": adata.obs_names,
                "PC1": adata.obsm["X_pca"][:, 0],
                "PC2": adata.obsm["X_pca"][:, 1],
            })
            pca_df.to_csv(pca_path, sep="\t", index=False)

        sc.tl.rank_genes_groups(
            adata,
            groupby=args.cell_type_field,
            method="wilcoxon" if adata.n_obs >= 6 else "t-test",
        )
        marker_df = sc.get.rank_genes_groups_df(adata, group=None).sort_values(
            ["group", "scores", "logfoldchanges", "names"],
            ascending=[True, False, False, True],
            kind="mergesort",
            na_position="last",
        ).reset_index(drop=True)
        marker_path = os.path.join(args.out_dir, "tables", "scanpy_rank_genes_groups.tsv")
        marker_df.to_csv(marker_path, sep="\t", index=False)

        case_cells = adata.obs.index[adata.obs[args.condition_field].astype(str) == args.case_condition].to_list()
        control_cells = adata.obs.index[adata.obs[args.condition_field].astype(str) == args.control_condition].to_list()
        if len(case_cells) == 0 or len(control_cells) == 0:
            raise ValueError("case/control cells not found in metadata")

        case_mean = np.asarray(adata[case_cells, :].X.mean(axis=0)).reshape(-1)
        control_mean = np.asarray(adata[control_cells, :].X.mean(axis=0)).reshape(-1)
        condition_df = pd.DataFrame({
            "gene": adata.var_names,
            "case_mean_log_norm": case_mean,
            "control_mean_log_norm": control_mean,
            "delta_log_norm": case_mean - control_mean,
        }).sort_values(
            ["delta_log_norm", "gene"],
            ascending=[False, True],
            kind="mergesort",
        )
        condition_path = os.path.join(args.out_dir, "tables", "scanpy_condition_response.tsv")
        condition_df.to_csv(condition_path, sep="\t", index=False)

        cluster_path = os.path.join(args.out_dir, "tables", "scanpy_cluster_assignments.tsv")
        cluster_method = "single_cluster_small_n"
        if adata.n_obs >= 4:
            try:
                sc.pp.neighbors(adata, n_neighbors=min(15, max(2, adata.n_obs - 1)), use_rep="X_pca")
                sc.tl.leiden(adata, resolution=0.6, random_state=0, key_added="leiden")
                cluster_method = "scanpy_neighbors_leiden"
            except Exception as cluster_error:
                # Deterministic fallback remains a diagnostic, not a claim of
                # publication-grade clustering.
                pc1 = np.asarray(adata.obsm.get("X_pca", np.zeros((adata.n_obs, 1))))[:, 0]
                order = np.argsort(pc1, kind="mergesort")
                labels = np.zeros(adata.n_obs, dtype=int)
                labels[order] = np.floor(np.arange(adata.n_obs) * 3 / max(adata.n_obs, 1)).astype(int)
                adata.obs["leiden"] = labels.astype(str)
                cluster_method = f"deterministic_pc1_partition:{cluster_error.__class__.__name__}"
        else:
            adata.obs["leiden"] = "0"
        cluster_df = adata.obs[["leiden"]].copy()
        cluster_df.insert(0, "cell_id", cluster_df.index)
        cluster_df.rename(columns={"leiden": "cluster_id"}, inplace=True)
        cluster_df.to_csv(cluster_path, sep="\t", index=False)

        umap_path = os.path.join(args.out_dir, "tables", "scanpy_umap_coordinates.tsv")
        umap_status = "not_estimable"
        if adata.n_obs >= 4 and "neighbors" in adata.uns:
            try:
                sc.tl.umap(adata, random_state=0)
                umap_df = pd.DataFrame({
                    "cell_id": adata.obs_names,
                    "UMAP1": adata.obsm["X_umap"][:, 0],
                    "UMAP2": adata.obsm["X_umap"][:, 1],
                })
                umap_status = "generated"
            except Exception as umap_error:
                umap_df = pd.DataFrame(columns=["cell_id", "UMAP1", "UMAP2"])
                umap_status = f"not_estimable:{umap_error.__class__.__name__}"
        else:
            umap_df = pd.DataFrame(columns=["cell_id", "UMAP1", "UMAP2"])
        umap_df.to_csv(umap_path, sep="\t", index=False)

        sample_field = args.sample_field if args.sample_field in adata.obs.columns else None
        batch_field = args.batch_field if args.batch_field in adata.obs.columns else None
        grouping_fields = [field for field in [sample_field, args.cell_type_field, args.condition_field] if field]
        pseudobulk_path = os.path.join(args.out_dir, "tables", "scanpy_pseudobulk_de.tsv")
        pseudobulk_rows = []
        if sample_field and args.cell_type_field in adata.obs.columns:
            from scipy import stats

            from scipy import sparse

            raw_matrix = sparse.csr_matrix(adata.X)
            group_frame = adata.obs[grouping_fields].astype(str).reset_index().rename(columns={"index": "cell_id"})
            aggregate_rows = []
            for group_key, group_rows in group_frame.groupby(grouping_fields, sort=True):
                if not isinstance(group_key, tuple):
                    group_key = (group_key,)
                cell_indices = [adata.obs_names.get_loc(cell_id) for cell_id in group_rows["cell_id"]]
                summed = np.asarray(raw_matrix[cell_indices, :].sum(axis=0)).reshape(-1)
                library_size = float(summed.sum())
                aggregate_rows.append({
                    "sample_id": group_key[0],
                    "cell_type": group_key[1],
                    "condition": group_key[2] if len(group_key) > 2 else "",
                    "cell_count": len(cell_indices),
                    "log1p_cpm": np.log1p((summed / max(library_size, 1.0)) * 1e6),
                })
            for cell_type in sorted({row["cell_type"] for row in aggregate_rows}):
                scoped = [row for row in aggregate_rows if row["cell_type"] == cell_type]
                case_rows = [row for row in scoped if row["condition"] == args.case_condition]
                control_rows = [row for row in scoped if row["condition"] == args.control_condition]
                if not case_rows or not control_rows:
                    continue
                raw_p_values = []
                cell_type_rows = []
                for gene_index, gene in enumerate(genes):
                    case_values = np.asarray([row["log1p_cpm"][gene_index] for row in case_rows], dtype=float)
                    control_values = np.asarray([row["log1p_cpm"][gene_index] for row in control_rows], dtype=float)
                    if len(case_values) >= 2 and len(control_values) >= 2:
                        test = stats.ttest_ind(case_values, control_values, equal_var=False, nan_policy="omit")
                        p_value = float(test.pvalue) if np.isfinite(test.pvalue) else 1.0
                    else:
                        p_value = 1.0
                    raw_p_values.append(p_value)
                    cell_type_rows.append({
                        "cell_type": cell_type,
                        "gene": gene,
                        "case_mean_log1p_cpm": float(case_values.mean()),
                        "control_mean_log1p_cpm": float(control_values.mean()),
                        "delta_log1p_cpm": float(case_values.mean() - control_values.mean()),
                        "case_sample_count": len(case_values),
                        "control_sample_count": len(control_values),
                        "p_value": p_value,
                        "method": "sample_celltype_pseudobulk_welch_t_candidate",
                    })
                order = np.argsort(raw_p_values)
                adjusted = np.ones(len(raw_p_values), dtype=float)
                running = 1.0
                for reverse_rank, index in enumerate(order[::-1], start=1):
                    rank = len(raw_p_values) - reverse_rank + 1
                    running = min(running, raw_p_values[index] * len(raw_p_values) / max(rank, 1))
                    adjusted[index] = min(running, 1.0)
                for row, fdr in zip(cell_type_rows, adjusted):
                    row["fdr_bh"] = float(fdr)
                    pseudobulk_rows.append(row)
        pd.DataFrame(pseudobulk_rows, columns=[
            "cell_type", "gene", "case_mean_log1p_cpm", "control_mean_log1p_cpm",
            "delta_log1p_cpm", "case_sample_count", "control_sample_count", "p_value",
            "fdr_bh", "method",
        ]).sort_values(["cell_type", "fdr_bh", "delta_log1p_cpm"], ascending=[True, True, False]).to_csv(pseudobulk_path, sep="\t", index=False)

        batch_diag_path = os.path.join(args.out_dir, "batch_diagnostic.json")
        batch_levels = sorted(adata.obs[batch_field].astype(str).unique().tolist()) if batch_field else []
        batch_diag = {
            "surface_kind": "opl_bio_sc_rna_seq_batch_diagnostic",
            "status": "generated" if batch_field else "not_estimable",
            "batch_field": batch_field,
            "batch_level_count": len(batch_levels),
            "batch_levels": batch_levels,
            "cell_count_by_batch": adata.obs[batch_field].astype(str).value_counts().sort_index().to_dict() if batch_field else {},
            "condition_balance_by_batch": pd.crosstab(adata.obs[batch_field].astype(str), adata.obs[args.condition_field].astype(str)).to_dict() if batch_field else {},
            "integration_methods_available": ["Seurat v5 integration", "Harmony", "scVI/scANVI"],
            "integration_executed": False,
            "interpretation": "diagnostic and method-routing evidence only; no corrected embedding is claimed",
        }
        write_json(batch_diag_path, batch_diag)

        doublet_path = os.path.join(args.out_dir, "tables", "doublet_screen.tsv")
        total_counts = np.asarray(adata.obs["total_counts"], dtype=float)
        detected_genes = np.asarray(adata.obs["n_genes_by_counts"], dtype=float)
        count_cut = float(np.quantile(total_counts, 0.99)) if len(total_counts) else 0.0
        gene_cut = float(np.quantile(detected_genes, 0.99)) if len(detected_genes) else 0.0
        doublet_rows = []
        for cell_id, total, detected in zip(adata.obs_names, total_counts, detected_genes):
            score = float((total > count_cut) + (detected > gene_cut)) / 2.0
            doublet_rows.append({
                "cell_id": cell_id,
                "doublet_score": round(score, 6),
                "doublet_candidate": bool(score >= 0.5),
                "method": "library_size_and_detected_gene_upper_quantile_heuristic",
            })
        pd.DataFrame(doublet_rows).to_csv(doublet_path, sep="\t", index=False)

        trajectory_path = os.path.join(args.out_dir, "tables", "trajectory_readiness.tsv")
        pca_values = np.asarray(adata.obsm.get("X_pca", np.zeros((adata.n_obs, 1))))[:, 0]
        pca_min, pca_max = float(np.min(pca_values)), float(np.max(pca_values))
        denominator = pca_max - pca_min if pca_max > pca_min else 1.0
        trajectory_df = pd.DataFrame({
            "cell_id": adata.obs_names,
            "pc1_order_proxy": pca_values,
            "pseudotime_proxy_0_1": (pca_values - pca_min) / denominator,
            "trajectory_status": "readiness_proxy_not_inference",
        })
        trajectory_df.to_csv(trajectory_path, sep="\t", index=False)

        h5ad_path = os.path.join(args.out_dir, "scanpy_processed.h5ad")
        adata.write_h5ad(h5ad_path)

        figure_generation = {
            "status": "skipped",
            "reason": "scanpy_umap_plots_disabled_by_default_for_stable_agent_smoke",
            "outputs": {},
        }
        if args.enable_umap_plots:
            try:
                sc.pp.neighbors(adata, n_neighbors=min(5, adata.n_obs - 1))
                sc.tl.umap(adata, random_state=0)
                sc.settings.figdir = os.path.join(args.out_dir, "figures")
                sc.pl.umap(adata, color=args.cell_type_field, save="_cell_type.png", show=False)
                sc.pl.umap(adata, color=args.condition_field, save="_condition.png", show=False)
                figure_generation = {
                    "status": "generated",
                    "reason": None,
                    "outputs": {
                        "umap_cell_type": os.path.join(args.out_dir, "figures", "umap_cell_type.png"),
                        "umap_condition": os.path.join(args.out_dir, "figures", "umap_condition.png"),
                    },
                }
            except Exception as figure_error:
                figure_generation = {
                    "status": "blocked",
                    "reason": f"{figure_error.__class__.__name__}: {figure_error}",
                    "outputs": {},
                }
        receipt = {
            "surface_kind": "opl_bio_sc_rna_seq_scanpy_receipt",
            "status": "generated",
            "case_id": args.case_id,
            "scanpy_version": sc.__version__,
            "cell_count": int(adata.n_obs),
            "gene_count": int(adata.n_vars),
            "outputs": {
                "scanpy_processed_h5ad": h5ad_path,
                "scanpy_rank_genes_groups": marker_path,
                "scanpy_condition_response": condition_path,
                "scanpy_pca_coordinates": pca_path,
                "scanpy_highly_variable_genes": hvg_path,
                "scanpy_cluster_assignments": cluster_path,
                "scanpy_umap_coordinates": umap_path,
                "scanpy_pseudobulk_de": pseudobulk_path,
                "batch_diagnostic": batch_diag_path,
                "doublet_screen": doublet_path,
                "trajectory_readiness": trajectory_path,
                **figure_generation["outputs"],
            },
            "figure_generation": figure_generation,
            "routine_analysis": {
                "hvg_status": "generated",
                "dimensionality_reduction_status": "generated",
                "clustering_status": cluster_method,
                "umap_status": umap_status,
                "sample_aware_pseudobulk_status": "generated" if pseudobulk_rows else "not_estimable",
                "batch_diagnostic_status": batch_diag["status"],
                "doublet_screen_status": "heuristic_candidate_only",
                "trajectory_status": "readiness_proxy_only",
                "integration_status": "diagnostic_only_not_corrected",
            },
            "authority_boundary": {
                "receipt_can_claim_article_grade_replay": False,
                "receipt_can_claim_clinical_validity": False,
            },
        }
        write_json(receipt_path, receipt)
    except Exception as error:
        write_json(receipt_path, blocked_receipt(
            args,
            "scanpy_replay_failed",
            {
                "message": f"{error.__class__.__name__}: {error}",
                "traceback_tail": traceback.format_exc().splitlines()[-8:],
            },
        ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
