"""Token consumption and time of the corpus v2 campaign: LLM-only, RAGUnitTest4SC (rag-v2), Advanced-RAGUnitTest4SC (advanced-v3).

Read-only over the frozen run folders. Sources per suite (contract x repetition):
- generation.json  metadata.usage (prompt/completion tokens returned by the Mistral API), metadata.generation_seconds
- result.json      execution.seconds (Hardhat compile + Mocha under solidity-coverage), status
- retrieval-trace.json (prepared folder) retrieval_seconds, hits; retrieval runs once per contract and is shared by the
  three repetitions, so it is counted once per contract and amortised over the repetitions in the end-to-end time.
The first contract of each run process pays the model-loading time (cold start), hence medians are reported with means.
Usage (workspace root): python evaluation/measure_cost_corpus_v2.py
Writes AdvancedRAG/outputs/cost-corpus-v2-v1/{COST_REPORT.md, cost_suites.csv, cost_summary.json}.
"""
import csv
import json
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'AdvancedRAG/outputs'
OUT = RUNS / 'cost-corpus-v2-v1'
CONFIGS = {'llm-only': 'LLM-only', 'rag-v2': 'RAGUnitTest4SC', 'advanced-v3': 'Advanced-RAGUnitTest4SC'}
SPLITS = ['development14', 'heldout16']  # run folder names only; results are reported over the 30 contracts
REPS = ['rep01', 'rep02', 'rep03']


def load(path): return json.loads(path.read_text(encoding='utf-8'))


def collect():
    suites, retrievals = [], []
    for config in CONFIGS:
        for split in SPLITS:
            prepared = RUNS / f'{split}-{config}-ethers6-v1'
            for contract in sorted(p.name for p in prepared.iterdir() if (p / 'prompt.txt').exists()):
                trace = load(prepared / contract / 'retrieval-trace.json')
                hits = trace.get('hits', [])
                retrievals.append(dict(config=config, contract=contract, retrieval_seconds=trace.get('retrieval_seconds', 0.0),
                                       retrieved_tests=len(hits), distinct_pairs=len({h['pair'] for h in hits}),
                                       context_chars=sum(h['chars'] for h in hits)))
                for rep in REPS:
                    run = RUNS / f'{split}-{config}-ethers6-v1-{rep}' / contract
                    meta, result = load(run / 'generation.json')['metadata'], load(run / 'result.json')
                    usage = meta['usage']
                    suites.append(dict(config=config, contract=contract, rep=rep, status=result['status'],
                                       prompt_tokens=usage['prompt_tokens'], completion_tokens=usage['completion_tokens'],
                                       total_tokens=usage['prompt_tokens'] + usage['completion_tokens'],
                                       generation_seconds=meta['generation_seconds'],
                                       execution_seconds=(result.get('execution') or {}).get('seconds') or 0.0))
    return suites, retrievals


def stats(values):
    return dict(mean=mean(values), median=median(values), min=min(values), max=max(values), total=sum(values))


def summarise(suites, retrievals):
    summary = {}
    for config in CONFIGS:
        rows = [s for s in suites if s['config'] == config]
        ret = {r['contract']: r for r in retrievals if r['config'] == config}
        if len(rows) != 90 or len(ret) != 30: raise ValueError(f'{config}: {len(rows)} suites, {len(ret)} contracts')
        passing = sum(s['status'] == 'passed' for s in rows)
        for s in rows:  # retrieval is shared by the three repetitions of a contract
            s['end_to_end_seconds'] = ret[s['contract']]['retrieval_seconds'] / len(REPS) + s['generation_seconds'] + s['execution_seconds']
        total_tokens = sum(s['total_tokens'] for s in rows)
        summary[config] = dict(
            method=CONFIGS[config], suites=len(rows), fully_passing=passing,
            **{k: stats([s[k] for s in rows]) for k in ['prompt_tokens', 'completion_tokens', 'total_tokens', 'generation_seconds',
                                                         'execution_seconds', 'end_to_end_seconds']},
            retrieval_seconds=stats([r['retrieval_seconds'] for r in ret.values()]),
            retrieved_tests=stats([r['retrieved_tests'] for r in ret.values()]),
            distinct_pairs=stats([r['distinct_pairs'] for r in ret.values()]),
            context_chars=stats([r['context_chars'] for r in ret.values()]),
            tokens_per_fully_passing_suite=total_tokens / passing if passing else None)
    return summary


def report(summary):
    base = summary['llm-only']
    f0, f1 = (lambda v: f'{v:,.0f}'), (lambda v: f'{v:,.1f}')
    lines = ['# Token consumption and time, corpus v2 campaign', '',
             'Codestral 2508 through the Mistral API (token counts returned by the API), 30 contracts x 3 repetitions = 90 suites '
             'per configuration. Retrieval runs on CPU once per contract and is shared by the repetitions. Means (medians).', '',
             '| | ' + ' | '.join(CONFIGS.values()) + ' |', '|---|' + '---:|' * len(CONFIGS)]

    def row(label, key, fmt, field='mean', both=True):
        cells = []
        for c in CONFIGS:
            s = summary[c][key]
            cells.append(fmt(s[field]) + (f' ({fmt(s["median"])})' if both else ''))
        lines.append(f'| {label} | ' + ' | '.join(cells) + ' |')

    row('Prompt tokens per suite', 'prompt_tokens', f0)
    row('Completion tokens per suite', 'completion_tokens', f0)
    row('Total tokens per suite', 'total_tokens', f0)
    lines.append('| Prompt overhead vs LLM-only | ' + ' | '.join(
        f"{summary[c]['prompt_tokens']['mean'] / base['prompt_tokens']['mean'] - 1:+.1%}" for c in CONFIGS) + ' |')
    row('Total tokens, campaign (90 suites)', 'total_tokens', f0, 'total', False)
    lines.append('| Tokens per fully passing suite | ' + ' | '.join(
        f"{f0(summary[c]['tokens_per_fully_passing_suite'])} ({summary[c]['fully_passing']} suites)" for c in CONFIGS) + ' |')
    row('Retrieved tests per prompt', 'retrieved_tests', f1)
    row('Distinct corpus pairs per prompt', 'distinct_pairs', f1)
    row('Retrieval time per contract (s)', 'retrieval_seconds', lambda v: f'{v:.2f}')
    row('Generation time per suite (s)', 'generation_seconds', f1)
    row('Execution time per suite (s)', 'execution_seconds', f1)
    row('End-to-end time per suite (s)', 'end_to_end_seconds', f1)
    for c in CONFIGS:
        r = summary[c]['retrieval_seconds']
        if r['max'] > 0: lines.append(f"\n{CONFIGS[c]}: retrieval max {r['max']:.2f} s (cold start, model loading), min {r['min']:.2f} s.")
    lines += ['', 'End-to-end = retrieval / 3 + generation + execution. Execution includes compilation and coverage instrumentation, '
                  'which is identical across configurations; it varies with the number of generated tests.']
    return '\n'.join(lines) + '\n'


def main():
    suites, retrievals = collect()
    summary = summarise(suites, retrievals)
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / 'cost_suites.csv').open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(suites[0]))
        writer.writeheader(); writer.writerows(suites)
    (OUT / 'cost_summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    text = report(summary)
    (OUT / 'COST_REPORT.md').write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
