"""Compare LLM-only, RAG v2 and Advanced v2 (ethers 6, corpus v2) on 30 contracts x 3 repetitions.

Primary endpoint: fully passing suite rate (FPSR). Paired comparison per (contract, repetition) against
LLM-only with an exact two-sided McNemar test on discordant pairs. Coverage: target contract only.
Repetitions use temperature 0 and seed 42 (as the frozen protocol), so they are not independent draws.
"""
from collections import Counter, defaultdict
import json
from math import comb
from pathlib import Path
from analyze_oracle import category, mean

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'outputs'
CONFIGS = ['llm-only', 'rag-v2', 'advanced-v2', 'advanced-v3']
SPLITS = ['development14', 'heldout16']
REPS = ['rep01', 'rep02', 'rep03']
EXPECTED = {'development14': 14, 'heldout16': 16}


def load(config, split):
    rows = []
    for rep in REPS:
        folder = OUT / f'{split}-{config}-ethers6-v1-{rep}'
        for path in sorted(folder.glob('*/result.json')) if folder.exists() else []:
            r = json.loads(path.read_text(encoding='utf-8'))
            if r['status'] in {'started', 'generation_error'}: continue
            rows.append(dict(r, rep=rep, split=split))
    return rows


def mcnemar(b, c):
    n = b + c
    if n == 0: return 1.0
    tail = sum(comb(n, i) for i in range(0, min(b, c) + 1)) / 2 ** n
    return round(min(1.0, 2 * tail), 4)


def summarize(rows):
    passed = sum(r.get('passed_tests', 0) or 0 for r in rows)
    failed = sum(r.get('failed_tests', 0) or 0 for r in rows)
    cov = [r['coverage'] for r in rows if r.get('coverage')]
    ok = sum(r['status'] == 'passed' for r in rows)
    return dict(suites=len(rows), fully_passing=ok, fpsr=round(100 * ok / len(rows), 1) if rows else None,
                tpr=round(100 * passed / (passed + failed), 1) if passed + failed else None,
                statements=mean([c['statements'] for c in cov]), branches=mean([c['branches'] for c in cov]),
                coverage_reports=len(cov), statuses=dict(Counter(r['status'] for r in rows)))


def main():
    data = {c: {s: load(c, s) for s in SPLITS} for c in CONFIGS}
    report = dict(summary={}, paired_vs_llm_only={}, per_contract=defaultdict(dict), failure_categories={}, completeness={})
    for c in CONFIGS:
        allrows = data[c]['development14'] + data[c]['heldout16']
        report['summary'][c] = {s: summarize(data[c][s]) for s in SPLITS} | {'all30': summarize(allrows)}
        report['completeness'][c] = {s: f"{len(data[c][s])}/{3 * EXPECTED[s]}" for s in SPLITS}
        report['failure_categories'][c] = dict(Counter(category(f.get('error')) for r in allrows for f in r.get('failures', []) or []))
        for r in allrows:
            report['per_contract'][r['contract']].setdefault(c, 0)
            report['per_contract'][r['contract']][c] += r['status'] == 'passed'
    base = {(r['contract'], r['rep']): r['status'] == 'passed' for s in SPLITS for r in data['llm-only'][s]}
    for c in CONFIGS[1:]:
        for scope in SPLITS + ['all30']:
            rows = data[c]['development14'] + data[c]['heldout16'] if scope == 'all30' else data[c][scope]
            pairs = [(r['status'] == 'passed', base[(r['contract'], r['rep'])]) for r in rows if (r['contract'], r['rep']) in base]
            b = sum(x and not y for x, y in pairs)
            d = sum(y and not x for x, y in pairs)
            report['paired_vs_llm_only'].setdefault(c, {})[scope] = dict(pairs=len(pairs), only_config_passes=b,
                                                                       only_llm_only_passes=d, mcnemar_exact_p=mcnemar(b, d))
    (OUT / 'corpus_v2_campaign_v1.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    lines = ['# Campagne corpus v2 — LLM seul, RAG v2, Advanced v2 (ethers 6)', '',
             'Codestral 2508, température 0, seed 42, 4096 tokens, fixtures v2, aucune correction manuelle. '
             'Prompt = prompt LLM seul ethers 6 + tests récupérés (RAG v2, Advanced v2) ; aucune autre différence. '
             'Corpus v2 figé (225 paires, `5cabf7d0…`), pivot fonction → tests.', '',
             '| Configuration | Portée | Suites | Réussies | FPSR | TPR | Instr. | Branches |', '|---|---|---:|---:|---:|---:|---:|---:|']
    for c in CONFIGS:
        for scope in SPLITS + ['all30']:
            s = report['summary'][c][scope]
            lines.append(f"| {c} | {scope} | {s['suites']} | {s['fully_passing']} | {s['fpsr']} % | {s['tpr']} % | {s['statements']} | {s['branches']} |")
    lines += ['', '## Comparaison appariée avec le LLM seul (contrat × répétition)', '',
              '| Configuration | Portée | Paires | Seule la config. réussit | Seul le LLM seul réussit | McNemar exact p |',
              '|---|---|---:|---:|---:|---:|']
    for c in CONFIGS[1:]:
        for scope, p in report['paired_vs_llm_only'][c].items():
            lines.append(f"| {c} | {scope} | {p['pairs']} | {p['only_config_passes']} | {p['only_llm_only_passes']} | {p['mcnemar_exact_p']} |")
    lines += ['', '## Répétitions réussies par contrat (sur 3)', '', '| Contrat | ' + ' | '.join(CONFIGS) + ' |', '|---|' + '---:|' * len(CONFIGS)]
    for contract in sorted(report['per_contract']):
        lines.append(f"| {contract} | " + ' | '.join(str(report['per_contract'][contract].get(c, '–')) for c in CONFIGS) + ' |')
    lines += ['', f"Complétude : {json.dumps(report['completeness'])}", '',
              "Limites : répétitions non indépendantes (température 0, même seed) ; le split development14 a servi à la conception ; "
              "heldout16 est le jeu de confirmation. Les couvertures sont des moyennes sur les rapports disponibles, fixtures exclues."]
    (OUT / 'CORPUS_V2_CAMPAIGN_RESULTS.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
