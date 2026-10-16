"""Build the corpus v2 unit catalogue and dense cache, then replay retrieval offline on the 14 development tasks.

No generation and no API call. The retrieval replay is a sanity check (which pairs come back, with which
domain), not the relevance annotation of CORPUS_V2_SPEC.md section 8 step 5.
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / 'RAGUnitTest4SC-'
CORPUS = ROOT / 'data/corpus-v2'
OUT = ROOT / 'outputs/corpus-v2-index-v1'
REQUESTS = ROOT / 'outputs/development14-llm-only-ethers6-v1'
RERANKER = ROOT / 'models/ms-marco-MiniLM-L-6-v2'
for key, value in dict(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false').items():
    os.environ.setdefault(key, value)
# Sanity mapping of the development contracts to corpus domain groups (None: no matching application domain).
EXPECTED_GROUP = dict(AccessControl='access-control', Adoption='registries-identity', Auction='auctions', Counter=None,
                      Crowdfunding='crowdfunding', Escrow='escrow-conditional-payments', MetaCoin='fungible-tokens',
                      MultiSigWallet='multisig-treasury', PaymentSplitter='escrow-conditional-payments',
                      Registry='registries-identity', SimpleStorage=None, TimelockVault='vesting-timelock',
                      Token='fungible-tokens', Voting='voting-governance')
FIELDS = ['context', 'generalInstructions', 'requirements', 'exampleTest', 'solidityCode']


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def server_query(request):
    # Identical to vendor/baseline/rag_server.py handle_query().
    return '\n\n'.join(f"{field}: {request.get(field, '')}" for field in FIELDS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-replay', action='store_true')
    args = parser.parse_args()
    from advanced_rag.corpus_v2 import build_chunks, UnitRetriever, VERSION
    OUT.mkdir(parents=True, exist_ok=True)
    package = None if (ROOT / 'node_modules/@solidity-parser/parser').exists() else BASE / 'src/main/resources/HardhatProject/package.json'
    chunks, report = build_chunks(CORPUS, package)
    with (OUT / 'chunks.jsonl').open('w', encoding='utf-8', newline='\n') as f:
        for chunk in chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + '\n')
    save(OUT / 'index-report.json', report)
    print(json.dumps({k: v for k, v in report.items() if k not in ('limitations', 'parse_failures')}, indent=2), flush=True)
    import torch
    torch.set_num_threads(4)
    cache = BASE / '.cache/huggingface/hub'
    dense = UnitRetriever(chunks, cache, view='full', vectors_cache=OUT / 'embeddings.npy')
    truncated = sum(e['embedding_truncated'] for e in dense.entries)
    save(OUT / 'config.json', dict(version=VERSION, corpus_sha256=dense.sha256, corpus_frozen=str(CORPUS / 'CORPUS_FROZEN.json'),
         indexed_types=['function', 'test_case'], entries=len(dense.entries), entries_embedding_truncated=truncated,
         encoder='sentence-transformers/all-MiniLM-L6-v2', max_seq_length=dense.embedder.max_seq_length, dense='FAISS IndexFlatL2',
         bm25=dict(k1=1.5, b=0.75, tokenizer='identifiers plus camelCase/snake_case components', text='embedding_text'),
         delivered_text='full unit (test cases with setup); never truncated', parser_package=str(package),
         query_views=dict(full='frozen server query (instructions first, target source last)', target_code='solidityCode field only, dense branch only'),
         initialization_seconds=dense.initialization_seconds, api_calls=0))
    print(f'dense entries {len(dense.entries)}, embedding truncated {truncated}', flush=True)
    if args.skip_replay:
        return
    from advanced_rag.hybrid import HybridRetriever, LocalCrossEncoder
    from advanced_rag.corpus_v2 import TestPivotRetriever
    dense_code = UnitRetriever(chunks, cache, view='target_code', vectors_cache=OUT / 'embeddings.npy')
    reranker = LocalCrossEncoder(RERANKER) if RERANKER.is_dir() else None
    configs = dict(dense_full=dense, dense_target_code=dense_code, hybrid_full=HybridRetriever(dense),
                   hybrid_target_code=HybridRetriever(dense_code))
    if reranker:
        configs['hybrid_full_reranked'] = HybridRetriever(dense, reranker=reranker)
        configs['hybrid_target_code_reranked'] = HybridRetriever(dense_code, reranker=reranker)
    # Option (b), 2026-09-30: every configuration also runs with function hits replaced by their linked tests.
    configs.update({f'{k}+pivot': TestPivotRetriever(v) for k, v in list(configs.items())})
    replay, table = {}, []
    for name, expected in EXPECTED_GROUP.items():
        request = json.loads((REQUESTS / name / 'request.json').read_text(encoding='utf-8'))
        query = server_query(request)
        replay[name] = {}
        for label, retriever in configs.items():
            hits, seconds = retriever.search(query)
            rows = [dict(pair=h['metadata']['pair_id'], type=h['metadata']['artifact_type'], name=h['metadata']['name'],
                         domain_group=h['metadata']['domain_group'], chars=len(h['text']), via_function=h.get('via_function')) for h in hits]
            replay[name][label] = dict(seconds=seconds, hits=rows, context_chars=sum(r['chars'] for r in rows))
            match = sum(r['domain_group'] == expected for r in rows) if expected else None
            table.append(dict(contract=name, config=label, hits=len(rows), domain_match=match,
                              tests=sum(r['type'] == 'test_case' for r in rows), distinct_pairs=len({r['pair'] for r in rows})))
    save(OUT / 'retrieval-replay-development14.json', dict(expected_group=EXPECTED_GROUP, replay=replay, table=table))
    by_config = {}
    for row in table:
        agg = by_config.setdefault(row['config'], Counter())
        agg['hits'] += row['hits']; agg['tests'] += row['tests']; agg['pairs'] += row['distinct_pairs']
        if row['domain_match'] is not None:
            agg['match'] += row['domain_match']; agg['match_hits'] += row['hits']
    summary = {k: dict(domain_match=f"{v['match']}/{v['match_hits']}", test_case_share=f"{v['tests']}/{v['hits']}",
                       mean_distinct_pairs=round(v['pairs'] / len(EXPECTED_GROUP), 1)) for k, v in by_config.items()}
    save(OUT / 'retrieval-replay-summary.json', summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
