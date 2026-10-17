"""Figures for the corpus v2 campaign: LLM-only, RAGUnitTest4SC (rag-v2), Advanced-RAGUnitTest4SC (advanced-v3) (ethers 6, 30 contracts x 3 reps).

Same aggregation as AdvancedRAG/analyze_corpus_v2_campaign.py: FPSR over all suites, TPR over reported tests,
mean target coverage over available reports (missing values are not replaced by zero).
Usage: RAGUnitTest4SC-/.venv/Scripts/python.exe evaluation/plot_corpus_v2_campaign.py
"""
import csv
import json
import os
import tempfile
from collections import Counter
from pathlib import Path
from statistics import mean

os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir()) / 'enase-matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'AdvancedRAG/outputs'
OUT = BASE / 'corpus-v2-campaign-figures'
KINDS = ['llm-only', 'rag-v2', 'advanced-v3']
SPLITS = [('development14', 14), ('heldout16', 16)]
COLORS = ['#D97706', '#168A87', '#2F6DB5']
KEYS = ['statements', 'branches', 'functions', 'lines']
SCOPE = 'target-contract-only; benchmark fixtures excluded'
STATUSES = ['passed', 'test_failures', 'syntax_error', 'execution_error', 'execution_timeout', 'incomplete_tests']
TEXT = {
    'en': dict(methods=['LLM-only', 'Modified-RAGUnitTest4SC', 'Advanced-RAGUnitTest4SC'],
               pct='Percentage (%)', fpsr='Fully passing suites — FPSR (30 contracts)', tpr='Passing reported tests — TPR (30 contracts)',
               cov='Mean target-contract coverage (all 30 contracts)', cov_keys=['Statements', 'Branches', 'Functions', 'Lines'],
               status_title='Final status of the 90 suites per method', suites='Number of suites',
               status_labels=['Fully passing', 'Failing tests', 'Syntax error', 'Execution error', 'Timeout', 'Pending tests'],
               heat='Fully passing repetitions per contract', heat_y='Repetitions (out of 3)',
               heat_note='Only the {n} contracts with at least one fully passing suite are shown; the other {m} fail in all configurations and repetitions.',
               title='Corpus v2 campaign — three configurations',
               subtitle='30 contracts · 3 repetitions · 90 suites per method · ethers 6 · Codestral 2508, temperature 0',
               notes=['FPSR is the primary metric.',
                      'TPR = passing / (passing + failing) reported tests; failing hooks can prevent tests from running.',
                      'Mean of available target-coverage reports, fixtures excluded; missing values are not replaced by zero.',
                      'Every suite counts in the denominator; a completed run can contain failing tests or an error.',
                      'Repetitions use temperature 0 and seed 42; they are not independent draws.'],
               pairs='Paired vs LLM-only (exact McNemar, 30 contracts): {items}.'),
    'fr': dict(methods=['LLM seul', 'Modified-RAGUnitTest4SC', 'Advanced-RAGUnitTest4SC'],
               pct='Pourcentage (%)', fpsr='Suites entièrement réussies — FPSR (30 contrats)', tpr='Tests rapportés réussis — TPR (30 contrats)',
               cov='Couverture moyenne des contrats cibles (30 contrats)', cov_keys=['Instructions', 'Branches', 'Fonctions', 'Lignes'],
               status_title='Résultat final des 90 suites par méthode', suites='Nombre de suites',
               status_labels=['Suite réussie', 'Tests échoués', 'Erreur de syntaxe', "Erreur d’exécution", 'Délai dépassé', 'Tests en attente'],
               heat='Répétitions entièrement réussies par contrat', heat_y='Répétitions (sur 3)',
               heat_note='Seuls les {n} contrats ayant au moins une suite entièrement réussie sont représentés ; les {m} autres échouent dans toutes les configurations et répétitions.',
               title='Campagne corpus v2 — trois configurations',
               subtitle='30 contrats · 3 répétitions · 90 suites par méthode · ethers 6 · Codestral 2508, température 0',
               notes=['FPSR : métrique principale.',
                      'TPR = tests réussis / (réussis + échoués) ; les échecs de hooks peuvent empêcher certains tests de s’exécuter.',
                      'Moyenne des rapports de couverture cibles disponibles, fixtures exclues ; valeurs manquantes non remplacées par zéro.',
                      'Toutes les suites comptent au dénominateur ; une exécution terminée peut contenir des tests échoués ou une erreur.',
                      'Répétitions à température 0 et seed 42 : ce ne sont pas des tirages indépendants.'],
               pairs='Comparaison appariée avec le LLM seul (McNemar exact, 30 contrats) : {items}.'),
}


def load(kind, split, expected):
    rows = []
    for rep in range(1, 4):
        batch = json.loads((BASE / f'{split}-{kind}-ethers6-v1-rep{rep:02d}/summary.json').read_text(encoding='utf-8'))['results']
        assert len(batch) == expected and len({r['contract'] for r in batch}) == expected, (kind, split, rep)
        assert all(r['status'] not in {'started', 'generation_error'} for r in batch), (kind, split, rep)
        rows.extend(dict(r, split=split, rep=rep) for r in batch)
    return rows


def metrics(rows):
    counts = Counter(r['status'] for r in rows)
    passed = sum(r.get('passed_tests', 0) or 0 for r in rows)
    failed = sum(r.get('failed_tests', 0) or 0 for r in rows)
    coverage = [r['coverage'] for r in rows if r.get('coverage_scope') == SCOPE and r.get('coverage')]
    return dict(suites=len(rows), fully_passed=counts['passed'], fpsr=100 * counts['passed'] / len(rows),
                passed_tests=passed, failed_tests=failed, tpr=100 * passed / (passed + failed) if passed + failed else 0,
                coverage_reports=len(coverage), **{k: mean(c[k] for c in coverage) if coverage else 0 for k in KEYS},
                **{f'status_{k}': counts[k] for k in STATUSES})


def main():
    data = {k: {s: load(k, s, n) for s, n in SPLITS} for k in KINDS}
    table = {k: metrics(data[k]['development14'] + data[k]['heldout16']) for k in KINDS}
    paired = json.loads((BASE / 'corpus_v2_campaign_v1.json').read_text(encoding='utf-8'))['paired_vs_llm_only']
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / 'metrics.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['method'] + list(table[KINDS[0]]))
        writer.writeheader()
        for k in KINDS:
            writer.writerow(dict(method=k, **table[k]))
    passes = {k: Counter() for k in KINDS}
    for k in KINDS:
        for r in data[k]['development14'] + data[k]['heldout16']:
            passes[k][r['contract']] += r['status'] == 'passed'
    contracts = sorted({r['contract'] for s, _ in SPLITS for r in data['llm-only'][s]}, key=str.lower)
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
                         'axes.spines.right': False, 'svg.fonttype': 'none', 'pdf.fonttype': 42})
    for lang, t in TEXT.items():
        out = OUT / lang
        out.mkdir(exist_ok=True)
        names = dict(zip(KINDS, t['methods']))
        ticks = [m.replace('Advanced-', 'Advanced-\n').replace('Modified-', 'Modified-\n') for m in t['methods']]
        pair_note = t['pairs'].format(items='; '.join(f"{names[k]} {p['all30']['only_config_passes']} vs {p['all30']['only_llm_only_passes']}, p = {p['all30']['mcnemar_exact_p']:.3f}" for k, p in paired.items() if k in names))

        def style(ax, title, ymax=100):
            ax.set_title(title, loc='left', fontsize=12, fontweight='bold', pad=15)
            ax.set_ylim(0, ymax); ax.set_ylabel(t['pct']); ax.grid(axis='y', alpha=.18); ax.set_axisbelow(True)

        def grouped(ax, key, title):
            vals = [table[k][key] for k in KINDS]
            bars = ax.bar(range(len(KINDS)), vals, width=.58, color=COLORS)
            labels = [f'{v:.1f}' + (f"\n{table[k]['fully_passed']}/{table[k]['suites']}" if key == 'fpsr' else '') for v, k in zip(vals, KINDS)]
            ax.bar_label(bars, labels=labels, padding=3, fontsize=9)
            ax.set_xticks(range(len(KINDS)), ticks)
            style(ax, title, 40 if key == 'fpsr' else 100)

        def coverage(ax):
            x = np.arange(4); w = .26
            for i, k in enumerate(KINDS):
                m = table[k]
                bars = ax.bar(x + (i - (len(KINDS) - 1) / 2) * w, [m[c] for c in KEYS], width=w * .92, color=COLORS[i],
                              label=f"{t['methods'][i]} (n={m['coverage_reports']})")
                ax.bar_label(bars, fmt='%.1f', padding=3, fontsize=7.5)
            ax.set_xticks(x, t['cov_keys'])
            style(ax, t['cov'])
            ax.legend(loc='upper center', bbox_to_anchor=(.5, -.1), ncol=len(KINDS), frameon=False, fontsize=9)

        def statuses(ax):
            bottom = np.zeros(len(KINDS))
            palette = ['#21845B', '#C5CBD3', '#E89B35', '#BA4A55', '#8B5CF6', '#64748B']
            for key, label, color in zip(STATUSES, t['status_labels'], palette):
                vals = np.array([table[k]['status_' + key] for k in KINDS])
                if not vals.any(): continue
                ax.bar(range(len(KINDS)), vals, bottom=bottom, color=color, label=label, width=.58)
                for i, v in enumerate(vals):
                    if v >= 3: ax.text(i, bottom[i] + v / 2, str(v), ha='center', va='center', fontsize=9)
                bottom += vals
            style(ax, t['status_title'], 92)
            ax.set_ylabel(t['suites']); ax.set_yticks(range(0, 91, 15))
            ax.set_xticks(range(len(KINDS)), ticks)
            ax.legend(loc='upper center', bbox_to_anchor=(.5, -.16), ncol=3, frameon=False, fontsize=9)

        def save(fig, name):
            for ext in ['png', 'pdf', 'svg']:
                fig.savefig(out / f'{name}.{ext}', dpi=220, bbox_inches='tight', facecolor='white')
            plt.close(fig)

        panels = [('fpsr', lambda ax: grouped(ax, 'fpsr', t['fpsr'])), ('tpr', lambda ax: grouped(ax, 'tpr', t['tpr'])),
                  ('coverage', coverage), ('statuses', statuses)]
        notes = [t['notes'][0].format(pairs=pair_note)] + t['notes'][1:4]
        for (name, draw), note in zip(panels, notes):
            fig, ax = plt.subplots(figsize=(10, 6))
            draw(ax)
            if name != 'fpsr':  # the FPSR figure of the paper carries no footnote
                fig.text(.06, .015, note, fontsize=8, color='#4B5563', wrap=True)
            fig.subplots_adjust(bottom=.25 if name != 'fpsr' else .15, top=.88)
            save(fig, name)
        fig, axes = plt.subplots(2, 2, figsize=(16, 11.5))
        for ax, (_, draw) in zip(axes.flat, panels):
            draw(ax)
        fig.suptitle(t['title'], fontsize=18, fontweight='bold', y=.985)
        fig.text(.5, .945, t['subtitle'], ha='center', fontsize=11)
        fig.subplots_adjust(top=.88, bottom=.14, hspace=.6, wspace=.2)
        fig.text(.06, .02, '\n'.join([notes[0]] + t['notes'][1:3] + [t['notes'][4]]), fontsize=8.5, color='#4B5563')
        save(fig, 'comparison_3_configurations')
        # Per-contract passes: grouped bars over the contracts solved at least once, most solved first.
        solved = sorted((c for c in contracts if any(passes[k][c] for k in KINDS)),
                        key=lambda c: (-sum(passes[k][c] for k in KINDS), c.lower()))
        fig, ax = plt.subplots(figsize=(10, 4.6))
        x = np.arange(len(solved)); w = .26
        for i, k in enumerate(KINDS):
            ax.bar(x + (i - (len(KINDS) - 1) / 2) * w, [passes[k][c] for c in solved], width=w * .92, color=COLORS[i], label=t['methods'][i])
        ax.set_xticks(x, solved, rotation=35, ha='right')
        ax.set_title(t['heat'], loc='left', fontsize=12, fontweight='bold', pad=15)
        ax.set_ylim(0, 3.75); ax.set_yticks(range(4)); ax.set_ylabel(t['heat_y'])
        ax.grid(axis='y', alpha=.18); ax.set_axisbelow(True)
        ax.legend(loc='upper right', ncol=len(KINDS), frameon=False, fontsize=9)
        fig.text(.06, .015, t['heat_note'].format(n=len(solved), m=len(contracts) - len(solved)), fontsize=8, color='#4B5563')
        fig.subplots_adjust(bottom=.3, top=.88)
        save(fig, 'per_contract_passes')
    print(json.dumps({k: round(m['fpsr'], 1) for k, m in table.items()}, indent=2))
    print(f'Exports: {OUT}')


if __name__ == '__main__':
    main()
