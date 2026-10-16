"""Derive ethers 6 LLM-only prompts from frozen ethers 5 prompts; only API convention sentences change."""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT / "outputs/development14-llm-only-fixtures-v2"
OUT = ROOT / "outputs/development14-llm-only-ethers6-v1"
HARDHAT = ROOT.parent / "RAGUnitTest4SC-/src/main/resources/HardhatProject-ethers6"

# Exact replacements: each ethers 5 sentence maps to an ethers 6 sentence of the same scope.
REPLACEMENTS = [
    ("Use Hardhat 2, ethers 5, Mocha and Chai, with hardhat-chai-matchers installed.",
     "Use Hardhat 2, ethers 6, Mocha and Chai, with hardhat-chai-matchers installed."),
    ("Use ethers.utils.parseEther, ethers.constants.MaxUint256, and contract.deployed() (ethers 5).",
     "Use ethers.parseEther, ethers.MaxUint256, await contract.waitForDeployment() and await contract.getAddress() (ethers 6)."),
    ("For BigNumber values use Chai equality matchers, not JavaScript number arithmetic.",
     "For uint256 values use BigInt literals (e.g. 10n) and Chai equality matchers, not JavaScript number arithmetic."),
    ("Use Hardhat 2, ethers 5, Mocha and hardhat-chai-matchers. No external helper files.",
     "Use Hardhat 2, ethers 6, Mocha and hardhat-chai-matchers. No external helper files."),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def convert(text: str, required: list) -> str:
    for old, new in required:
        if text.count(old) != 1:
            raise ValueError(f"Expected exactly one occurrence of: {old}")
        text = text.replace(old, new)
    if "ethers 5" in text or "ethers.utils" in text or ".deployed()" in text:
        raise ValueError("Residual ethers 5 instruction")
    return text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent", type=Path, default=PARENT)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    parent, out = args.parent.resolve(), args.out.resolve()
    config = json.loads((parent / "config.json").read_text(encoding="utf-8"))
    config.update(configuration="llm-only-ethers6-v1", api_convention="ethers6",
                  hardhat_project=str(HARDHAT),
                  prompt_policy="frozen ethers 5 LLM-only prompt; only the four API-convention sentences replaced",
                  ethers5_parent_prompt_source=str(parent),
                  convention_replacements=[{"from": a, "to": b} for a, b in REPLACEMENTS])
    out.mkdir(parents=True, exist_ok=True)
    (out / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    results = []
    for folder in sorted(p for p in parent.iterdir() if (p / "prompt.txt").exists()):
        prompt = convert((folder / "prompt.txt").read_text(encoding="utf-8"), REPLACEMENTS)
        request = json.loads((folder / "request.json").read_text(encoding="utf-8"))
        request["generalInstructions"] = convert(request["generalInstructions"], REPLACEMENTS[3:])
        target = out / folder.name
        target.mkdir(exist_ok=True)
        (target / "prompt.txt").write_text(prompt, encoding="utf-8")
        (target / "request.json").write_text(json.dumps(request, indent=2), encoding="utf-8")
        (target / "retrieval-trace.json").write_bytes((folder / "retrieval-trace.json").read_bytes())
        if (folder / "target-inventory.json").exists():
            (target / "target-inventory.json").write_bytes((folder / "target-inventory.json").read_bytes())
        results.append({"contract": folder.name, "prompt_sha256": sha256(prompt.encode()),
                        "parent_prompt_sha256": sha256((folder / "prompt.txt").read_bytes())})
    (out / "summary.json").write_text(json.dumps({"configuration": config["configuration"], "results": results}, indent=2), encoding="utf-8")
    print(json.dumps({"configuration": config["configuration"], "targets": len(results), "output": str(out)}, indent=2))


if __name__ == "__main__":
    main()
