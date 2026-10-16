# Relevance of the retrieved tests (gpt-oss-120b, retrieval-relevance-v1)

One judge call per retrieved test; rubric 0/1/2 for template value (see judge_retrieval_relevance.py). Means over contracts; LLM-only has no retrieved context.

| Metric | RAGUnitTest4SC | Advanced-RAGUnitTest4SC | Paired (Advanced - RAGUnitTest4SC) |
|---|---:|---:|---|
| Mean graded relevance (/2) | 0.517 | 0.574 | 21 vs 8 contracts, Wilcoxon p = 0.012 |
| Precision@K (rating >= 1) | 0.872 | 0.924 | 13 vs 6 contracts, Wilcoxon p = 0.099 |
| Precision@K (rating 2) | 0.162 | 0.224 | 16 vs 6 contracts, Wilcoxon p = 0.038 |
| MRR (rating 2) | 0.324 | 0.478 | 13 vs 6 contracts, Wilcoxon p = 0.076 |
| nDCG@K (graded, prompt order) | 0.899 | 0.871 | 13 vs 16 contracts, Wilcoxon p = 0.314 |

Rating distribution (retrieved tests): RAGUnitTest4SC n=246: 0=32, 1=175, 2=39; Advanced-RAGUnitTest4SC n=266: 0=21, 1=185, 2=60

Spearman, mean graded relevance vs fully passing repetitions: rho = -0.03, p = 0.805 (n = 60); vs statement coverage: rho = 0.39, p = 0.002 (n = 60).

Samples: 60/60; judge tokens: 856,641.
