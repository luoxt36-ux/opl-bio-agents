#!/usr/bin/env python3
"""Run only the packaged public/synthetic teaching seeds."""
import argparse, json, os, shutil, subprocess, sys
from pathlib import Path
from example_checks import check_genome, check_scanpy

ROOT=Path(__file__).resolve().parents[1]; SOURCE=ROOT/'source'
p=argparse.ArgumentParser(); p.add_argument('--agent',choices=['all','bulk-rna-seq','scrna-seq','genome-analysis'],default='all'); p.add_argument('--out',type=Path,required=True); p.add_argument('--node',default='node'); p.add_argument('--rscript',default=os.environ.get('RSCRIPT_BIN','Rscript')); p.add_argument('--python',default=os.environ.get('SCRNA_PYTHON_BIN',sys.executable)); a=p.parse_args(); out=a.out.resolve(); out.mkdir(parents=True,exist_ok=False)
env=dict(os.environ,MPLCONFIGDIR=str(out/'matplotlib-cache'),NUMBA_CACHE_DIR=str(out/'numba-cache'),PYTHONDONTWRITEBYTECODE='1')
def run(cmd,log):
    x=subprocess.run(cmd,cwd=SOURCE,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=900); log.write_text(x.stdout)
    if x.returncode: raise RuntimeError(f'failed command ({x.returncode}); see {log}')
    return x.stdout
def read(path): return json.loads(Path(path).read_text())
def prepared_cases(path, work):
    doc=read(path)
    for case in doc.get('cases',[]):
        for key,value in (case.get('input_task',{}).get('local_inputs',{}) or {}).items():
            if isinstance(value,str) and value.startswith('runtime/fixtures/'):
                case['input_task']['local_inputs'][key]=str(SOURCE/'examples/opl-bio-agent'/value)
    target=work/'cases.json'; target.write_text(json.dumps(doc,indent=2)+'\n'); return target
rows=[]
for name in ['bulk-rna-seq','scrna-seq','genome-analysis']:
    if a.agent not in ['all',name]: continue
    work=out/name; work.mkdir(); cases=ROOT/'examples'/name/'cases.json'; row={'agent':name,'model_api_calls':0,'scope':'tutorial seed; not manuscript evaluation'}
    try:
        if name=='bulk-rna-seq':
            if not shutil.which(a.rscript): raise RuntimeError('Rscript missing')
            prepared=prepared_cases(cases,work)
            run([a.node,'examples/opl-bio-agent/runtime/agent_runner/bulk_rna_analysis_decision_bound_executor_v1.mjs','--cases',str(prepared),'--decisions',str(cases.with_name('decisions.json')),'--out',str(work/'analysis'),'--rscript',a.rscript],work/'run.log')
            rec=read(work/'analysis/execution_receipt.json')
            if rec['status']!='completed' or rec['truth_accessed'] is not False: raise RuntimeError('Bulk receipt boundary/status failed')
            row['checks']=['DESeq2 completed','policy bound','truth not accessed']
        elif name=='scrna-seq':
            run([a.node,'examples/opl-bio-agent/runtime/agent_runner/sc_rna_seq_agent.mjs','--cases',str(cases),'--out',str(work/'predictions.json'),'--artifact-root',str(work/'artifacts'),'--python-bin',a.python],work/'run.log')
            doc=read(work/'predictions.json'); entries=doc.get('predictions',[]); live=list((work/'artifacts').rglob('live_scanpy_receipt.json'))
            if doc.get('scenario_agent_id')!='opl_bio_sc_rna_seq_agent' or len(entries)!=1 or not live: raise RuntimeError('scRNA identity/receipt failed')
            check_scanpy(read(live[0]),entries[0]['case_id'],work); row['checks']=['public matrix read','Scanpy core steps completed','required outputs and identity verified']
        else:
            run([a.node,'examples/opl-bio-agent/runtime/agent_runner/genome_analysis_agent.mjs','--cases',str(cases),'--out',str(work/'predictions.json'),'--artifact-root',str(work/'artifacts')],work/'run.log')
            result=run([a.node,'examples/opl-bio-agent/runtime/authority_functions/genome_analysis_verifier.mjs','--cases',str(cases),'--predictions',str(work/'predictions.json')],work/'verification.log'); verified=json.loads(result)
            if verified['status']!='passed' or verified['passed_count']!=1: raise RuntimeError('Genome verifier failed')
            check_genome(read(work/'predictions.json'),read(cases),work); row['checks']=['synthetic inputs read','artifact hashes recomputed','identity and boundary verified']
        row['status']='passed'
    except Exception as exc: row.update(status='failed',error=str(exc))
    rows.append(row)
report={'status':'passed' if all(x['status']=='passed' for x in rows) else 'failed','results':rows,'scientific_reproduction':False,'fresh_environment_installation':False,'scope':'Bounded public/synthetic examples only'}
(out/'smoke-report.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2)); sys.exit(0 if report['status']=='passed' else 1)
