"""Generate from validated reranked prompts, then syntax-check and execute unchanged tests."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from dotenv import load_dotenv
from fixture_support import FIXTURE_SOURCE, fixture_metadata, fixture_prompt_block
from experiment_protocol import PROTOCOL_VERSION, TARGET_COVERAGE, input_identity, check_resume, execution_status

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent/'RAGUnitTest4SC-'
HH=BASE/'src/main/resources/HardhatProject'
INPUT=ROOT/'outputs/hybrid-v1-reranked'

def save(p,data): p.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load_module(name,p):
    spec=importlib.util.spec_from_file_location(name,p); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def target_coverage(coverage_path, target_filename):
    """Compute Istanbul percentages for the target only, excluding fixtures."""
    data=json.loads(coverage_path.read_text(encoding='utf-8'))
    matches=[entry for source,entry in data.items() if Path(source).name==target_filename]
    if len(matches)!=1: raise ValueError(f'Expected one coverage entry for {target_filename}, found {len(matches)}')
    entry=matches[0]
    def percentage(values):
        total=len(values); covered=sum(1 for value in values if value>0)
        return round(100*covered/total,2) if total else 100.0
    statements=entry.get('s',{})
    functions=entry.get('f',{})
    branches=[hit for hits in entry.get('b',{}).values() for hit in hits]
    line_hits={}
    for statement_id,hits in statements.items():
        line=entry['statementMap'][statement_id]['start']['line']
        line_hits[line]=line_hits.get(line,0)+hits
    return {'statements':percentage(statements.values()),'branches':percentage(branches),
            'functions':percentage(functions.values()),'lines':percentage(line_hits.values())}

def main():
    global INPUT
    parser=argparse.ArgumentParser(); parser.add_argument('--run',default='advanced-generation-v1'); parser.add_argument('--grounded',action='store_true'); parser.add_argument('--input-dir',type=Path)
    parser.add_argument('--manifest',type=Path,default=BASE/'data/benchmarks/enase14/manifest.json')
    parser.add_argument('--split',help='Only contracts with this manifest split')
    parser.add_argument('--preflight', action='store_true', help='Validate inputs and resume identity without generation or execution')
    parser.add_argument('--max-tokens', type=int, default=4096)
    parser.add_argument('--generation-timeout', type=int, default=240)
    parser.add_argument('--execution-timeout', type=int, default=180)
    args=parser.parse_args()
    if args.input_dir:
        if args.grounded: raise ValueError('--grounded and --input-dir are mutually exclusive')
        INPUT=args.input_dir.resolve()
    if args.grounded:
        INPUT=ROOT/'outputs/hybrid-v1-reranked-grounded'
        if args.run=='advanced-generation-v1': args.run='advanced-generation-grounded-v1'
    if not re.fullmatch(r'[A-Za-z0-9_-]+',args.run): raise ValueError('Invalid run name')
    if min(args.max_tokens,args.generation_timeout,args.execution_timeout) <= 0: raise ValueError('Budgets must be positive')
    out=ROOT/'outputs'/args.run
    load_dotenv(BASE/'.env'); load_dotenv(ROOT/'.env',override=True)
    os.environ['LLM_PROVIDER']='mistral'; os.environ['MISTRAL_MODEL']='codestral-2508'
    os.environ['LLM_MAX_TOKENS']=str(args.max_tokens)
    os.environ['LLM_TIMEOUT_SECONDS']=str(args.generation_timeout)
    rag=load_module('generation_runtime',ROOT/'vendor/baseline/rag_server.py')
    runner=load_module('baseline_helpers',BASE/'tools/validate_baseline.py')
    manifest_path=args.manifest.resolve(); benchmark=manifest_path.parent
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    items=manifest.get('contracts',manifest.get('pairs',[]))
    if args.split: items=[item for item in items if item.get('split')==args.split]
    if not items: raise ValueError('Benchmark selection is empty')
    config=json.loads((INPUT/'config.json').read_text(encoding='utf-8'))
    inputs=input_identity(INPUT,items,fixture_metadata(),fixture_prompt_block())
    for item in items:
        source=benchmark/item.get('path',item.get('contract'))
        entry=next(e for e in manifest['files'] if e['path']==item.get('path',item.get('contract')))
        if sha(source)!=entry['sha256']: raise ValueError(f'Target hash changed: {source}')
        request=json.loads((INPUT/item['id']/'request.json').read_text(encoding='utf-8'))
        if request['solidityCode']!=source.read_text(encoding='utf-8'): raise ValueError(f'Target request mismatch: {source}')
    if config.get('corpus_sha256'):
        corpus_path=Path(config['corpus_path']) if config.get('corpus_path') else ROOT/'data/corpus-corrected-v2/compatibility.md'
        if config['corpus_sha256']!=sha(corpus_path): raise ValueError('Corpus hash mismatch')
    setup=dict(model=rag.MODEL,provider=rag.PROVIDER,temperature=0,seed=42,manual_repairs=False,
        prompt_source=str(INPUT),retrieval_config=config,scope='controlled generation run; one output per contract; no best-of selection',
        benchmark_manifest=str(manifest_path),benchmark_manifest_sha256=sha(manifest_path),benchmark_split=args.split,
        generation_started_utc=datetime.now(timezone.utc).isoformat())
    setup.update(fixture_metadata())
    runtime_paths=[Path(__file__), ROOT/'experiment_protocol.py', ROOT/'fixture_support.py',
        ROOT/'vendor/baseline/rag_server.py', BASE/'tools/validate_baseline.py',
        HH/'hardhat.config.js', HH/'safe-json-reporter.js', HH/'check.js', HH/'package-lock.json']
    setup.update(protocol_version=PROTOCOL_VERSION,input_sha256=inputs,max_tokens=args.max_tokens,
        generation_timeout_seconds=args.generation_timeout,execution_timeout_seconds=args.execution_timeout,
        syntax_timeout_seconds=30,connect_timeout_seconds=15,
        runtime_sha256={str(p):sha(p) for p in runtime_paths},primary_endpoint='fully-passing-suite-rate',
        pending_policy='any pending test prevents full suite success',coverage_policy=TARGET_COVERAGE)
    if (out/'setup.json').exists():
        check_resume(json.loads((out/'setup.json').read_text(encoding='utf-8')),setup)
    elif out.exists() and any(out.iterdir()): raise ValueError('Nonempty run directory lacks setup identity')
    if args.preflight:
        print(json.dumps({'valid':True,'contracts':len(items),'run':str(out),'protocol':PROTOCOL_VERSION,'api_calls':0},indent=2))
        return
    if not os.getenv('MISTRAL_API_KEY'): raise RuntimeError('MISTRAL_API_KEY missing')
    out.mkdir(exist_ok=True)
    if not (out/'setup.json').exists(): save(out/'setup.json',setup)
    results=[]
    node=shutil.which('node'); cli=HH/'node_modules/hardhat/internal/cli/cli.js'
    for item in items:
        name=item['id']; folder=out/name; folder.mkdir(exist_ok=True)
        if (folder/'result.json').exists():
            previous=json.loads((folder/'result.json').read_text(encoding='utf-8'))
            if previous.get('prompt_sha256')!=sha(INPUT/name/'prompt.txt'): raise ValueError(f'{name}: cached prompt mismatch')
            if previous['status'] not in {'generation_error','started'}: results.append(previous); continue
        row=dict(contract=name,status='started')
        prompt=(INPUT/name/'prompt.txt').read_text(encoding='utf-8')
        (folder/'prompt.txt').write_text(prompt,encoding='utf-8')
        shutil.copyfile(INPUT/name/'request.json',folder/'request.json')
        shutil.copyfile(INPUT/name/'retrieval-trace.json',folder/'retrieval-trace.json')
        row['prompt_sha256']=sha(folder/'prompt.txt')
        if (INPUT/name/'target-inventory.json').exists(): shutil.copyfile(INPUT/name/'target-inventory.json',folder/'target-inventory.json')
        print('Generating',name,flush=True)
        try:
            if (folder/'generation.json').exists():
                generated=json.loads((folder/'generation.json').read_text(encoding='utf-8')); code=generated['code']; metadata=generated['metadata']
                if generated.get('prompt_sha256')!=row['prompt_sha256']: raise ValueError('Cached generation uses another prompt')
            else:
                code,metadata=rag.generate(prompt)
                save(folder/'generation.json',dict(code=code,metadata=metadata,prompt_sha256=row['prompt_sha256']))
            row['generation_seconds']=metadata['generation_seconds']; row['usage']=metadata.get('usage')
            run=HH/'runs'/args.run/name; (run/'contracts').mkdir(parents=True,exist_ok=True); (run/'test').mkdir(exist_ok=True)
            # Remove only known output files before re-executing an interrupted generation.
            for old_output in [run/'mocha-results.json',run/'coverage/coverage-final.json',run/'coverage.json',folder/'mocha-results.json',folder/'coverage-final.json',folder/'coverage.json']:
                old_output.unlink(missing_ok=True)
            source=benchmark/item['path' if 'path' in item else 'contract']
            entry=next(e for e in manifest['files'] if e['path']==item.get('path',item.get('contract'))); assert sha(source)==entry['sha256']
            shutil.copyfile(source,run/'contracts'/source.name)
            shutil.copyfile(FIXTURE_SOURCE,run/'contracts'/FIXTURE_SOURCE.name)
            test=run/'test/generated.test.js'; test.write_text(code,encoding='utf-8'); shutil.copyfile(test,folder/'generated.test.js')
            # Explicit environment allowlist: provider credentials never reach JavaScript.
            env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','PATHEXT','APPDATA','LOCALAPPDATA','USERPROFILE','PROGRAMFILES','PROGRAMFILES(X86)','NUMBER_OF_PROCESSORS'}}
            env.update(RAG_RUN_DIR=str(run),HARDHAT_DISABLE_TELEMETRY='true',NO_COLOR='1')
            syntax=runner.command([node,str(HH/'check.js'),str(test)],HH,env,folder/'syntax.json',30)
            row['syntax_valid']=syntax['exit_code']==0 and json.loads((folder/'syntax.json').read_text(encoding='utf-8')).get('valid') is True
            if not row['syntax_valid']: row['status']='syntax_error'; continue
            execution=runner.command([node,str(cli),'coverage','--config',str(HH/'hardhat.config.js')],run,env,folder/'execution.log',args.execution_timeout)
            row['execution']=execution
            if (run/'mocha-results.json').exists():
                shutil.copyfile(run/'mocha-results.json',folder/'mocha-results.json')
                mocha=json.loads((run/'mocha-results.json').read_text(encoding='utf-8'))
                row['passed_tests']=mocha['stats'].get('passes',0); row['failed_tests']=mocha['stats'].get('failures',0)
                row['pending_tests']=mocha['stats'].get('pending',0)
                row['failures']=[dict(title=f.get('fullTitle'),error=f.get('err',{}).get('message')) for f in mocha.get('failures',[])]
            log=(folder/'execution.log').read_text(encoding='utf-8',errors='replace')
            cov=re.search(r'All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',log)
            for p in [run/'coverage/coverage-final.json',run/'coverage.json']:
                if p.exists(): shutil.copyfile(p,folder/p.name)
            detailed=folder/'coverage-final.json'
            if detailed.exists():
                row['coverage']=target_coverage(detailed,source.name)
                row['coverage_scope']=TARGET_COVERAGE
            else:
                row['coverage']=None
                row['coverage_scope']='missing-target-coverage'
            row['status']=execution_status(execution,row.get('passed_tests',0),row.get('failed_tests',0),row.get('pending_tests',0))
        except rag.ProviderError as exc:
            row.update(status='generation_error',error=str(exc))
            # Stop at provider failure; resume preserves successful generations.
            raise
        finally:
            results.append(row); save(folder/'result.json',row)
            save(out/'summary.json',dict(total=len(items),completed=len(results),statuses=dict(Counter(r['status'] for r in results)),results=results))
            print(name,row['status'],row.get('passed_tests'),row.get('failed_tests'),flush=True)
    save(out/'summary.json',dict(total=len(items),completed=len(results),statuses=dict(Counter(r['status'] for r in results)),results=results))

if __name__=='__main__': main()
