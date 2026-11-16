#!/usr/bin/env python3
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((ROOT/'metadata/file-manifest.json').read_text()); failures=[]
for row in manifest['files']:
    p=ROOT/row['path']
    if not p.is_file() or p.is_symlink() or sha(p)!=row['sha256']: failures.append(row['path'])
ids=json.loads((ROOT/'metadata/agents.json').read_text())['current_agents']
if {x['agent_id'] for x in ids}!={'opl_bio_bulk_rna_seq_agent','opl_bio_sc_rna_seq_agent','opl_bio_genome_analysis_agent'}: failures.append('metadata/agents.json')
for name in ['bulk-rna-seq','scrna-seq','genome-analysis']:
    for rel in [f'agents/{name}/README.md',f'agents/{name}/BUILD_INPUTS.md',f'inputs/{name}/contracts']:
        if not (ROOT/rel).exists(): failures.append(rel)
print(json.dumps({'status':'passed' if not failures else 'failed','files_checked':len(manifest['files']),'agents':len(ids),'failures':failures},indent=2)); sys.exit(bool(failures))
