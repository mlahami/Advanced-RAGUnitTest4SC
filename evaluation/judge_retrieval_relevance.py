"""Graded relevance of the retrieved tests, corpus v2: RAGUnitTest4SC (rag-v2) vs Advanced-RAGUnitTest4SC (advanced-v3).

Why not the stock RAGAS prompts: ContextRelevance / ContextUtilization ask whether the context contains the information
needed to answer the question. Here the context is, by design, tests of *other* contracts used as templates, so the pilot
judge rated almost everything 0 ("tests for a different contract"), including RAGUnitTest4SC on AccessControl, which
passed in all three repetitions (outputs/ragas-corpus-v2-v1, pilot). This protocol keeps the RAGAS samples
(samples.json, exact retrieved tests checked against the retrieval traces) and asks a template-oriented question,
one judge call per (target contract, retrieved test):
  2 = directly adaptable: the test exercises a behaviour the target also implements; setup, calls, assertions or revert
      checks can be reused after renaming.
  1 = partially useful: generic testing pattern applicable to the target (access-control revert, event check, time
      travel, balance change, ...), but the tested behaviour is absent from the target.
  0 = not useful for testing the target.
The judge never sees the configuration nor the rank; identical (contract, test) pairs get one judgment (request cache).
Per contract and configuration: mean graded relevance (/2), precision (rating >= 1), share rated 2, nDCG in prompt order.
Usage (workspace root, judge venv):
  evaluation/.venv-judge/Scripts/python.exe -u evaluation/judge_retrieval_relevance.py --contracts AccessControl,BatchTransfer
  evaluation/.venv-judge/Scripts/python.exe -u evaluation/judge_retrieval_relevance.py            # all 60 samples
  evaluation/.venv-judge/Scripts/python.exe evaluation/judge_retrieval_relevance.py --report
"""
import argparse
import json
import math
import time

from dotenv import load_dotenv
from pydantic import BaseModel, Field

import run_ragas_corpus_v2 as base
from run_ragas_corpus_v2 import CONFIGS, JUDGES, ROOT, RUNS, Stop, now, save, sha, sha_json

PROTOCOL = 'retrieval-relevance-v1'
SAMPLES = RUNS / 'ragas-corpus-v2-v1' / 'samples.json'
OUT = RUNS / PROTOCOL
INSTRUCTIONS = """You assess retrieved reference tests for unit-test generation.
A generator must write a Hardhat (ethers 6, Mocha/Chai) unit-test suite for the TARGET Solidity contract below.
It receives example tests retrieved from a corpus of OTHER contracts. Such examples are never written for the target:
a different contract name is expected and is NOT a reason for a low rating. Judge only their value as a template.

Rate the RETRIEVED TEST:
2 = directly adaptable: it exercises a behaviour that the target also implements (same kind of operation, state change,
    access rule or revert condition); its setup, calls, assertions or revert checks could be reused after renaming.
1 = partially useful: it shows a generic testing pattern applicable to the target (e.g., access-control revert, event
    assertion, time manipulation, balance change, deployment with constructor arguments), but the specific behaviour it
    tests does not exist in the target.
0 = not useful: neither its behaviour nor its testing pattern applies to the target.

Give a reason of at most 30 words, then the rating.

TARGET CONTRACT:
{target}

RETRIEVED TEST:
{test}"""


class Judgment(BaseModel):
    reason: str = Field(description='At most 30 words')
    rating: int = Field(description='0, 1 or 2')


def target_source(sample):
    marker = 'Target Solidity contract:\n'
    if sample['user_input'].count(marker) != 1: raise ValueError(f"{sample['id']}: target source not found")
    return sample['user_input'].split(marker, 1)[1].strip()


def judge_sample(sample, transport):
    ratings, usage = [], dict(prompt_tokens=0, completion_tokens=0, calls=0)
    for chunk, test in zip(sample['chunk_ids'], sample['retrieved_contexts']):
        result, used = transport.complete(INSTRUCTIONS.format(target=target_source(sample), test=test), Judgment)
        if result.rating not in (0, 1, 2): raise Stop(f"{sample['id']} chunk {chunk}: invalid rating {result.rating}")
        ratings.append(dict(chunk_id=chunk, rating=result.rating, reason=result.reason))
        usage['prompt_tokens'] += used.get('prompt_tokens', 0); usage['completion_tokens'] += used.get('completion_tokens', 0)
        usage['calls'] += 1
    return ratings, usage


def setup_record(judge, samples):
    spec = {k: v for k, v in JUDGES[judge].items() if k != 'key'}
    return dict(protocol=PROTOCOL, judge=judge, judge_spec=spec, temperature=0, seed=42, max_tokens=4096, system=base.SYSTEM,
                instructions_sha256=sha(INSTRUCTIONS), samples_sha256=sha_json(samples))


def run(args):
    samples = json.loads(SAMPLES.read_text(encoding='utf-8'))
    setup = setup_record(args.judge, samples)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'setup-{args.judge}.json'
    if path.exists():
        previous = json.loads(path.read_text(encoding='utf-8'))
        if {k: v for k, v in previous.items() if k != 'created_utc'} != setup: raise Stop('setup changed; use a new protocol name')
    else:
        save(path, dict(setup, created_utc=now()))
    transport = base.Transport(args.judge)
    transport.cache = OUT / 'api_cache' / args.judge  # own cache and call cap, separate from the stock RAGAS run
    transport.cache.mkdir(parents=True, exist_ok=True)
    wanted = set(args.contracts.split(',')) if args.contracts else None
    scores = OUT / 'scores' / args.judge
    scores.mkdir(parents=True, exist_ok=True)
    selected = [s for s in samples if wanted is None or s['contract'] in wanted]
    for sample in selected:
        target = scores / f"{sample['id']}.json"
        if target.exists(): continue
        started = time.perf_counter()
        ratings, usage = judge_sample(sample, transport)
        save(target, dict({k: sample[k] for k in ['id', 'config', 'method', 'contract', 'chunk_ids', 'context_sha256']},
                          ratings=ratings, usage=usage, judge=args.judge, seconds=round(time.perf_counter() - started, 1),
                          evaluated_utc=now()))
        print(f"{sample['id']}: {[r['rating'] for r in ratings]} ({usage['prompt_tokens']} prompt tokens)", flush=True)
    done = sum((scores / f"{s['id']}.json").exists() for s in selected)
    print(json.dumps(dict(judge=args.judge, completed=done, expected=len(selected))))


def metrics(ratings):
    r = [x['rating'] for x in ratings]
    dcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(r))
    ideal = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(sorted(r, reverse=True)))
    # Reciprocal rank of the first directly adaptable test (rating 2) in prompt order; 0 when there is none.
    mrr = next((1 / (i + 1) for i, g in enumerate(r) if g == 2), 0.0)
    return dict(relevance=sum(r) / (2 * len(r)), precision=sum(g >= 1 for g in r) / len(r), adaptable=sum(g == 2 for g in r) / len(r),
                mrr=mrr, ndcg=dcg / ideal if ideal else 0.0)


def outcomes():
    """Fully passing repetitions (out of 3) and mean statement coverage per configuration and contract."""
    out = {}
    for config in CONFIGS:
        for split in base.SPLITS:
            for rep in ['rep01', 'rep02', 'rep03']:
                folder = RUNS / f'{split}-{config}-ethers6-v1-{rep}'
                for run in folder.iterdir():
                    if not (run / 'result.json').exists(): continue
                    result = json.loads((run / 'result.json').read_text(encoding='utf-8'))
                    entry = out.setdefault((config, run.name), dict(passes=0, coverage=[]))
                    entry['passes'] += result['status'] == 'passed'
                    if (result.get('coverage') or {}).get('statements') is not None: entry['coverage'].append(result['coverage']['statements'])
    return out


def report(args):
    from scipy.stats import spearmanr, wilcoxon
    rows = [json.loads(p.read_text(encoding='utf-8')) for p in sorted((OUT / 'scores' / args.judge).glob('*.json'))]
    per = {(r['config'], r['contract']): metrics(r['ratings']) for r in rows}
    names = ['relevance', 'precision', 'adaptable', 'mrr', 'ndcg']
    labels = dict(relevance='Mean graded relevance (/2)', precision='Precision@K (rating >= 1)', adaptable='Precision@K (rating 2)',
                  mrr='MRR (rating 2)', ndcg='nDCG@K (graded, prompt order)')
    lines = [f'# Relevance of the retrieved tests ({args.judge}, {PROTOCOL})', '',
             'One judge call per retrieved test; rubric 0/1/2 for template value (see judge_retrieval_relevance.py). '
             'Means over contracts; LLM-only has no retrieved context.', '',
             '| Metric | ' + ' | '.join(CONFIGS.values()) + ' | Paired (Advanced - RAGUnitTest4SC) |', '|---|---:|---:|---|']
    common = sorted({c for (_, c) in per if ('rag-v2', c) in per and ('advanced-v3', c) in per})
    summary = dict(contracts=len(common), metrics={})
    for m in names:
        means = {c: sum(per[(c, k)][m] for k in common) / len(common) for c in CONFIGS} if common else {}
        diff = [per[('advanced-v3', k)][m] - per[('rag-v2', k)][m] for k in common]
        nonzero = [d for d in diff if abs(d) > 1e-12]
        p = wilcoxon(nonzero).pvalue if len(nonzero) >= 5 else float('nan')
        summary['metrics'][m] = dict(means=means, better_advanced=sum(d > 0 for d in diff), better_rag=sum(d < 0 for d in diff), wilcoxon_p=p)
        lines.append(f"| {labels[m]} | " + ' | '.join(f'{means[c]:.3f}' for c in CONFIGS) +
                     f" | {summary['metrics'][m]['better_advanced']} vs {summary['metrics'][m]['better_rag']} contracts, Wilcoxon p = {p:.3f} |")
    all_ratings = {c: [x['rating'] for r in rows if r['config'] == c for x in r['ratings']] for c in CONFIGS}
    lines += ['', 'Rating distribution (retrieved tests): ' + '; '.join(
        f"{CONFIGS[c]} n={len(v)}: 0={v.count(0)}, 1={v.count(1)}, 2={v.count(2)}" for c, v in all_ratings.items())]
    # Does relevance explain the outcome? Spearman over contract x configuration (retrieval configurations only).
    out = outcomes()
    keys = [(c, k) for c in CONFIGS for k in common]
    if len(keys) >= 10:
        rel = [per[key]['relevance'] for key in keys]
        rho_p, p_p = spearmanr(rel, [out[key]['passes'] for key in keys])
        cov = [sum(out[key]['coverage']) / len(out[key]['coverage']) if out[key]['coverage'] else float('nan') for key in keys]
        ok = [(a, b) for a, b in zip(rel, cov) if not math.isnan(b)]
        rho_c, p_c = spearmanr(*zip(*ok))
        summary['spearman'] = dict(passes=dict(rho=rho_p, p=p_p, n=len(keys)), statement_coverage=dict(rho=rho_c, p=p_c, n=len(ok)))
        lines += ['', f'Spearman, mean graded relevance vs fully passing repetitions: rho = {rho_p:.2f}, p = {p_p:.3f} (n = {len(keys)}); '
                      f'vs statement coverage: rho = {rho_c:.2f}, p = {p_c:.3f} (n = {len(ok)}).']
    usage = sum(r['usage']['prompt_tokens'] + r['usage']['completion_tokens'] for r in rows)
    lines += ['', f'Samples: {len(rows)}/60; judge tokens: {usage:,}.']
    (OUT / f'REPORT-{args.judge}.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (OUT / f'summary-{args.judge}.json').write_text(json.dumps(summary, indent=2, default=float), encoding='utf-8')
    print('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', action='store_true')
    parser.add_argument('--judge', choices=sorted(JUDGES), default='gpt-oss-120b')
    parser.add_argument('--contracts', help='comma-separated contracts (default: all 30)')
    args = parser.parse_args()
    load_dotenv(ROOT / 'RAGUnitTest4SC-/.env')
    load_dotenv(ROOT / 'AdvancedRAG/.env', override=True)
    report(args) if args.report else run(args)


if __name__ == '__main__':
    main()
