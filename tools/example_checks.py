import hashlib, json
from pathlib import Path

def check_genome(predictions, cases, output_root):
    agent='opl_bio_genome_analysis_agent'; expected={c['case_id'] for c in cases['cases']}; rows=predictions['cases']
    if predictions.get('agent_id')!=agent or {x['case_id'] for x in rows}!=expected: raise ValueError('Genome identity/case mismatch')
    for row in rows:
        if row.get('agent_id')!=agent or row.get('private_truth_accessed') is not False or row.get('fixture_only') is not True: raise ValueError('Genome boundary mismatch')
        for key in ['decision','analysis_report','tool_invocation']:
            binding=row[key]; p=Path(binding['path']).resolve()
            if not p.is_relative_to(output_root.resolve()) or not p.is_file(): raise ValueError('Genome artifact missing')
            if hashlib.sha256(p.read_bytes()).hexdigest()!=binding['sha256']: raise ValueError('Genome artifact hash mismatch')
            doc=json.loads(p.read_text())
            if key!='tool_invocation' and doc.get('case_id')!=row['case_id']: raise ValueError('Genome artifact case mismatch')
            if key=='decision' and doc.get('agent_id')!=agent: raise ValueError('Genome decision identity mismatch')
            if key=='tool_invocation' and doc.get('exit_code')!=0: raise ValueError('Genome tool invocation failed')

def check_scanpy(receipt, case_id, output_root):
    if receipt.get('status')!='generated' or receipt.get('case_id')!=case_id: raise ValueError('Scanpy did not complete')
    expected={'hvg_status':'generated','dimensionality_reduction_status':'generated','clustering_status':'scanpy_neighbors_leiden','sample_aware_pseudobulk_status':'generated'}
    for key,value in expected.items():
        if receipt.get('routine_analysis',{}).get(key)!=value: raise ValueError('Scanpy core step incomplete: '+key)
    names=['scanpy_processed_h5ad','scanpy_rank_genes_groups','scanpy_condition_response','scanpy_pca_coordinates','scanpy_highly_variable_genes','scanpy_cluster_assignments','scanpy_pseudobulk_de']
    for name in names:
        p=Path(receipt.get('outputs',{}).get(name,'')).resolve()
        if not p.is_relative_to(output_root.resolve()) or not p.is_file() or p.stat().st_size==0: raise ValueError('Scanpy output missing: '+name)
