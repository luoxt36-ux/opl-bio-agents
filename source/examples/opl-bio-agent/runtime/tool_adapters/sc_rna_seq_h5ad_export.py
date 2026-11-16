#!/usr/bin/env python3
import argparse
import json
import os
import sys
import traceback


def parse_args():
    parser = argparse.ArgumentParser(description="Export a processed h5ad object into OPL-Bio scRNA TSV inputs.")
    parser.add_argument("--h5ad", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--case-id", required=True)
    return parser.parse_args()


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def blocked_receipt(args, blocker, detail=None):
    return {
        "surface_kind": "opl_bio_sc_rna_seq_h5ad_export_receipt",
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


def dense_array(matrix):
    if hasattr(matrix, "toarray"):
        return matrix.toarray()
    return matrix


def load_h5ad(h5ad_path):
    attempts = []
    read_failed = False
    for reader_name in ("anndata", "scanpy"):
        try:
            module = __import__(reader_name)
        except Exception as error:
            attempts.append({
                "reader": reader_name,
                "status": "import_failed",
                "detail": f"{error.__class__.__name__}: {error}",
            })
            continue

        if not hasattr(module, "read_h5ad"):
            attempts.append({
                "reader": reader_name,
                "status": "missing_read_h5ad",
                "version": getattr(module, "__version__", "unknown"),
            })
            continue

        try:
            return module.read_h5ad(h5ad_path), {
                "reader": reader_name,
                "reader_version": getattr(module, "__version__", "unknown"),
                "attempts": attempts,
            }
        except Exception as error:
            read_failed = True
            attempts.append({
                "reader": reader_name,
                "status": "read_failed",
                "version": getattr(module, "__version__", "unknown"),
                "detail": f"{error.__class__.__name__}: {error}",
            })

    if read_failed:
        raise RuntimeError(json.dumps({
            "blocker": "h5ad_read_failed",
            "attempts": attempts,
        }))

    raise RuntimeError(json.dumps({
        "blocker": "h5ad_reader_dependency_missing",
        "attempts": attempts,
    }))


def main():
    args = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    receipt_path = os.path.join(args.out_dir, "h5ad_export_receipt.json")
    try:
        import pandas as pd
    except Exception as error:
        write_json(receipt_path, blocked_receipt(
            args,
            "h5ad_export_dependency_missing",
            f"{error.__class__.__name__}: {error}",
        ))
        return 0

    try:
        adata, reader_info = load_h5ad(args.h5ad)
        if adata.n_obs == 0 or adata.n_vars == 0:
            raise ValueError("h5ad object has no cells or no genes")

        counts = dense_array(adata.X)
        obs_names = [str(value) for value in adata.obs_names]
        var_names = [str(value) for value in adata.var_names]
        counts_df = pd.DataFrame(counts.T, index=var_names, columns=obs_names)
        counts_df.insert(0, "gene", var_names)
        counts_path = os.path.join(args.out_dir, "counts.tsv")
        counts_df.to_csv(counts_path, sep="\t", index=False)

        metadata_df = adata.obs.copy()
        if "cell_id" in metadata_df.columns:
            metadata_df = metadata_df.drop(columns=["cell_id"])
        metadata_df.insert(0, "cell_id", obs_names)
        metadata_path = os.path.join(args.out_dir, "cell_metadata.tsv")
        metadata_df.to_csv(metadata_path, sep="\t", index=False)

        receipt = {
            "surface_kind": "opl_bio_sc_rna_seq_h5ad_export_receipt",
            "status": "generated",
            "case_id": args.case_id,
            "h5ad_reader": reader_info["reader"],
            "h5ad_reader_version": reader_info["reader_version"],
            "cell_count": int(adata.n_obs),
            "gene_count": int(adata.n_vars),
            "outputs": {
                "counts_tsv": counts_path,
                "cell_metadata_tsv": metadata_path,
            },
            "authority_boundary": {
                "receipt_can_claim_article_grade_replay": False,
                "receipt_can_claim_clinical_validity": False,
            },
        }
        write_json(receipt_path, receipt)
    except Exception as error:
        blocker = "h5ad_export_failed"
        detail = {
            "message": f"{error.__class__.__name__}: {error}",
            "traceback_tail": traceback.format_exc().splitlines()[-8:],
        }
        try:
            parsed = json.loads(str(error))
            if parsed.get("blocker") in {"h5ad_reader_dependency_missing", "h5ad_read_failed"}:
                blocker = parsed["blocker"]
                detail = parsed
        except Exception:
            pass
        write_json(receipt_path, blocked_receipt(
            args,
            blocker,
            detail,
        ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
