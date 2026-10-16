# ENASE30 benchmark v1

This benchmark contains 30 Solidity contracts:

- `development-original14`: the 14 contracts used during pipeline development and grounding-rule diagnosis;
- `heldout-new16`: 16 user-supplied contracts selected on 23 September 2026 for independent evaluation.

The primary final comparison between LLM-Only (Zero-Shot + Code), RAGUnitTest4SC, and Advanced-RAGUnitTest4SC must be reported on `heldout-new16`. Results over all 30 contracts may be descriptive, but the combined set is not entirely independent because the original 14 informed development decisions.

## Selected held-out contracts

| Contract | Complexity | Functional family |
|---|---|---|
| BondingCurve | complex | tokenomics |
| CrossChainBridge | complex | bridge |
| DAOGovernor | complex | governance |
| DEX | complex | DeFi exchange |
| GaslessRelayer | complex | meta-transactions |
| InsurancePool | complex | insurance |
| LendingPool | complex | lending |
| NFTMarketplace | complex | NFT marketplace |
| NFTStaking | complex | NFT staking |
| PriceOracle | complex | oracle |
| RateLimiter | complex | rate limiting |
| YieldVault | complex | vault |
| BatchTransfer | moderate | batch transfer |
| MerkleAirdrop | moderate | airdrop |
| SubscriptionService | moderate | subscription payments |
| TokenVesting | moderate | vesting |

## Selection safeguards

- Every candidate compiled individually with Solidity 0.8.24.
- No selected new source was found as exact normalized content in the RAG corpus.
- SHA-256 checksums and provenance are recorded in `manifest.json`.
- Same-name and close variants of the original benchmark were excluded, including Escrow, MultiSigWallet, voting, AuctionHouse, CrowdfundingCampaign, SplitPayment, TimeLock, and ERC20Token.
- Additional valid candidates were excluded to reduce domain redundancy and keep the requested total at 30.

No reference tests are included for the 16 held-out contracts. Their absence prevents accidental test leakage; independent behavioral specifications or mutation operators should be prepared separately for semantic and fault-detection evaluation.
