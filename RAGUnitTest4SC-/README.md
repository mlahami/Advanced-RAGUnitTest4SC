# Files added to RAGUnitTest4SC

This folder is not a copy of the original repository (https://github.com/Feyza-sboui/RAGUnitTest4SC-).
It only contains the files added for this extension, at the paths expected by the scripts of
`AdvancedRAG/` and `evaluation/`:

- `data/benchmarks/enase30/`: the 30-contract benchmark (`development-original14`, `heldout-new16`), with
  its manifest and SHA-256 fingerprints;
- `src/main/resources/HardhatProject-ethers6/`: the frozen Hardhat project (Hardhat 2.26.3, ethers 6,
  Solidity 0.8.24, solidity-coverage) in which every corpus pair and generated suite is executed;
- `tools/validate_baseline.py`: execution helpers used by the generation runner;
- `requirements-runtime.txt`, `requirements-evaluation.txt`: pinned Python dependencies;
- `.env.example`: the API keys expected in `.env`.
