# Corpus v2 campaign: LLM-only, RAGUnitTest4SC (rag-v2), Advanced-RAGUnitTest4SC (advanced-v3), ethers 6

Codestral 2508, temperature 0, seed 42, 4096 tokens, fixtures v2, no manual correction. Prompt = LLM-only ethers 6 prompt + retrieved tests (rag-v2, advanced-v3); no other difference. Frozen corpus v2 (225 pairs, `5cabf7d0...`), function-to-test pivot.

| Configuration | Scope | Suites | Fully passing | FPSR | TPR | Statements | Branches |
|---|---|---:|---:|---:|---:|---:|---:|
| llm-only | development14 | 42 | 10 | 23.8 % | 84.3 % | 89.29 | 95.45 |
| llm-only | heldout16 | 48 | 3 | 6.2 % | 71.9 % | 72.92 | 61.98 |
| llm-only | all30 | 90 | 13 | 14.4 % | 77.1 % | 80.56 | 77.6 |
| rag-v2 | development14 | 42 | 20 | 47.6 % | 84.1 % | 75.89 | 81.72 |
| rag-v2 | heldout16 | 48 | 4 | 8.3 % | 71.3 % | 75.18 | 64.42 |
| rag-v2 | all30 | 90 | 24 | 26.7 % | 76.5 % | 75.51 | 72.5 |
| advanced-v3 | development14 | 42 | 16 | 38.1 % | 78.8 % | 76.86 | 82.16 |
| advanced-v3 | heldout16 | 48 | 4 | 8.3 % | 77.2 % | 86.49 | 73.86 |
| advanced-v3 | all30 | 90 | 20 | 22.2 % | 77.9 % | 81.89 | 77.82 |

## Paired comparison with LLM-only (contract x repetition)

| Configuration | Scope | Pairs | Only the configuration passes | Only LLM-only passes | Exact McNemar p |
|---|---|---:|---:|---:|---:|
| rag-v2 | development14 | 42 | 11 | 1 | 0.0063 |
| rag-v2 | heldout16 | 48 | 4 | 3 | 1.0 |
| rag-v2 | all30 | 90 | 15 | 4 | 0.0192 |
| advanced-v3 | development14 | 42 | 8 | 2 | 0.1094 |
| advanced-v3 | heldout16 | 48 | 4 | 3 | 1.0 |
| advanced-v3 | all30 | 90 | 12 | 5 | 0.1435 |

## Fully passing repetitions per contract (out of 3)

| Contract | llm-only | rag-v2 | advanced-v3 |
|---|---:|---:|---:|
| AccessControl | 1 | 3 | 0 |
| Adoption | 0 | 3 | 0 |
| Auction | 0 | 0 | 0 |
| BatchTransfer | 1 | 1 | 0 |
| BondingCurve | 0 | 0 | 0 |
| Counter | 0 | 1 | 3 |
| CrossChainBridge | 0 | 0 | 0 |
| Crowdfunding | 0 | 0 | 0 |
| DAOGovernor | 0 | 0 | 0 |
| DEX | 0 | 0 | 0 |
| Escrow | 0 | 0 | 0 |
| GaslessRelayer | 0 | 3 | 2 |
| InsurancePool | 0 | 0 | 0 |
| LendingPool | 0 | 0 | 1 |
| MerkleAirdrop | 0 | 0 | 0 |
| MetaCoin | 0 | 0 | 0 |
| MultiSigWallet | 0 | 0 | 0 |
| NFTMarketplace | 2 | 0 | 0 |
| NFTStaking | 0 | 0 | 0 |
| PaymentSplitter | 0 | 1 | 1 |
| PriceOracle | 0 | 0 | 0 |
| RateLimiter | 0 | 0 | 0 |
| Registry | 2 | 3 | 3 |
| SimpleStorage | 3 | 3 | 3 |
| SubscriptionService | 0 | 0 | 1 |
| TimelockVault | 1 | 3 | 1 |
| Token | 1 | 2 | 2 |
| TokenVesting | 0 | 0 | 0 |
| Voting | 2 | 1 | 3 |
| YieldVault | 0 | 0 | 0 |

Completeness: {"llm-only": {"development14": "42/42", "heldout16": "48/48"}, "rag-v2": {"development14": "42/42", "heldout16": "48/48"}, "advanced-v3": {"development14": "42/42", "heldout16": "48/48"}}

Limitations: repetitions are not independent (temperature 0, same seed); development14 was used for the design of the pipeline and heldout16 is the confirmation set. Coverage values are means over the available reports, fixtures excluded.
