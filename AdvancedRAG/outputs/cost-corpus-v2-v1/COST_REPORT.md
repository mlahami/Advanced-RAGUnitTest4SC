# Token consumption and time, corpus v2 campaign

Codestral 2508 through the Mistral API (token counts returned by the API), 30 contracts x 3 repetitions = 90 suites per configuration. Retrieval runs on CPU once per contract and is shared by the repetitions. Means (medians).

| | LLM-only | Modified-RAGUnitTest4SC | Advanced-RAGUnitTest4SC |
|---|---:|---:|---:|
| Prompt tokens per suite | 7,569 (7,336) | 11,447 (11,256) | 11,417 (11,416) |
| Completion tokens per suite | 1,422 (1,468) | 1,556 (1,618) | 1,577 (1,564) |
| Total tokens per suite | 8,991 (8,882) | 13,004 (12,903) | 12,994 (12,837) |
| Prompt overhead vs LLM-only | +0.0% | +51.2% | +50.8% |
| Total tokens, campaign (90 suites) | 809,198 | 1,170,333 | 1,169,427 |
| Tokens per fully passing suite | 62,246 (13 suites) | 48,764 (24 suites) | 58,471 (20 suites) |
| Retrieved tests per prompt | 0.0 (0.0) | 8.2 (8.0) | 8.9 (9.0) |
| Distinct corpus pairs per prompt | 0.0 (0.0) | 4.2 (4.0) | 4.6 (4.5) |
| Retrieval time per contract (s) | 0.00 (0.00) | 0.40 (0.14) | 3.16 (2.80) |
| Generation time per suite (s) | 12.2 (12.2) | 12.3 (12.1) | 14.0 (12.9) |
| Execution time per suite (s) | 7.8 (5.7) | 5.0 (4.9) | 4.9 (4.6) |
| End-to-end time per suite (s) | 20.1 (18.3) | 17.4 (16.9) | 19.9 (18.7) |

Modified-RAGUnitTest4SC: retrieval max 7.23 s (cold start, model loading), min 0.04 s.

Advanced-RAGUnitTest4SC: retrieval max 7.36 s (cold start, model loading), min 0.69 s.

End-to-end = retrieval / 3 + generation + execution. Execution includes compilation and coverage instrumentation, which is identical across configurations; it varies with the number of generated tests.
