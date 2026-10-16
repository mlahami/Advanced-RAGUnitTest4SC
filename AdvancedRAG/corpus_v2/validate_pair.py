"""Validate a contract/test pair before it may enter corpus v2 (see CORPUS_V2_SPEC.md, section 3).

Pair layout:
    <pair>/manifest.json      provenance, licence, domain, level, targets
    <pair>/contracts/*.sol    target contracts plus mocks taken from the same repository
    <pair>/test/*.js          human-written Hardhat + ethers 6 tests

Checks: manifest and licence, ethers 6 convention, Solidity imports, execution (100 % passing,
no pending), target statement coverage, and leakage against the benchmark contracts.
Results are written to <pair>/validation.json. Mutation score is not measured yet.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from run_generation import target_coverage  # noqa: E402

WORKSPACE = ROOT.parent
HH = WORKSPACE / "RAGUnitTest4SC-/src/main/resources/HardhatProject-ethers6"
BENCHMARK = WORKSPACE / "RAGUnitTest4SC-/data/benchmarks/enase30/manifest.json"
VALIDATOR_VERSION = "corpus-v2-validate-pair-v4"  # v3: licence file required; v4: coverage threshold 80 -> 70 % (2026-09-30)

LEVELS = {"simple", "moderate", "complex"}
ORIGINS = {"human", "llm-assisted"}
LICENSES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense", "CC0-1.0",
            "GPL-2.0", "GPL-3.0", "LGPL-3.0", "AGPL-3.0"}
MIN_STATEMENT_COVERAGE = 70.0  # 80.0 up to v3; relaxed on 2026-09-30, before any generation from corpus v2
LEAK_THRESHOLD = 0.6
SIGNATURE_THRESHOLD = 0.8
MIN_SIGNATURE_FUNCTIONS = 3  # signature overlap is meaningless on one or two functions (e.g. withdraw())

# Test-file convention: Hardhat 2 + ethers 6, self-contained.
FORBIDDEN_JS = {
    "ethers 5 .deployed()": r"\.deployed\(\)",
    "ethers 5 ethers.utils": r"\bethers\.utils\.",
    "ethers 5 ethers.constants": r"\bethers\.constants\.",
    "ethers 5 BigNumber": r"\bBigNumber\b",
    "ethers 5 .toNumber()": r"\.toNumber\(\)",
    "hardhat-exposed $ mock": r"""(deployContract|getContractFactory)\(\s*["']\$""",
    "ES module import": r"^\s*import\s",
    "truffle/web3 API": r"\bartifacts\.require\(|\bweb3\.|\bcontract\(\s*[\"']",
}
ALLOWED_REQUIRES = {"chai", "hardhat", "ethers", "@nomicfoundation/hardhat-network-helpers",
                    "@nomicfoundation/hardhat-chai-matchers/withArgs", "@nomicfoundation/hardhat-chai-matchers/panic"}
ALLOWED_SOL_IMPORT = ("@openzeppelin/contracts/", "hardhat/console.sol")

SOL_KEYWORDS = set("""pragma solidity import contract library interface abstract is using for function modifier event
error struct enum mapping public private internal external view pure payable virtual override returns return
memory storage calldata constant immutable if else while do break continue new delete emit revert require assert
try catch unchecked constructor receive fallback true false this super msg block tx gasleft keccak256 sha256
abi address bool string bytes uint int wei gwei ether seconds minutes hours days weeks indexed anonymous type
selfdestruct length push pop value sender data timestamp number transfer send call delegatecall staticcall""".split())
TYPE_RE = re.compile(r"^(u?int\d*|bytes\d*)$")
TOKEN_RE = re.compile(r"0x[0-9a-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e\d+)?|[A-Za-z_$][A-Za-z0-9_$]*"
                      r"|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|/=|=>|[-+*/%<>=!&|^~?:;,.(){}\[\]]")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pair_files(pair):
    return sorted(p for p in pair.rglob("*") if p.is_file() and p.name != "validation.json")


def check_manifest(pair, manifest):
    errors = []
    for key in ["id", "domain", "level", "origin", "source", "targets"]:
        if key not in manifest: errors.append(f"manifest: missing {key}")
    if errors: return errors
    if manifest["id"] != pair.name: errors.append("manifest: id differs from folder name")
    if manifest["level"] not in LEVELS: errors.append(f"manifest: level must be one of {sorted(LEVELS)}")
    if manifest["origin"] not in ORIGINS: errors.append(f"manifest: origin must be one of {sorted(ORIGINS)}")
    source = manifest["source"]
    if not re.match(r"https://(github\.com|gitlab\.com)/[\w.-]+/[\w.-]+", source.get("repository", "")):
        errors.append("manifest: source.repository must be a public GitHub/GitLab URL")
    if not re.fullmatch(r"[0-9a-f]{40}", source.get("commit", "")): errors.append("manifest: source.commit must be a full SHA-1")
    if source.get("license") not in LICENSES: errors.append(f"manifest: licence {source.get('license')!r} not accepted")
    if not source.get("license_file") or not (pair / "LICENSE").exists():
        errors.append("manifest: no licence file copied from the repository (an SPDX header does not cover the tests)")
    for key in ["contract_paths", "test_paths"]:
        if not source.get(key): errors.append(f"manifest: source.{key} missing")
    for target in manifest["targets"]:
        if not (pair / "contracts" / target).exists(): errors.append(f"manifest: target {target} not in contracts/")
    return errors


def check_tests_code(name, code):
    errors = []
    for label, pattern in FORBIDDEN_JS.items():
        if re.search(pattern, code, re.M): errors.append(f"{name}: {label}")
    for module in re.findall(r"""require\(\s*["']([^"']+)["']\s*\)""", code):
        if module not in ALLOWED_REQUIRES: errors.append(f"{name}: undeclared require {module!r}")
    if not re.search(r"\bit\s*\(", code): errors.append(f"{name}: no it() block")
    if not re.search(r"\bexpect\s*\(|\bassert[.(]", code): errors.append(f"{name}: no assertion (expect/assert)")
    return errors


def check_tests(tests):
    return [e for test in tests for e in check_tests_code(test.name, test.read_text(encoding="utf-8", errors="replace"))]


def check_solidity_code(name, code, names):
    errors = []
    for target in re.findall(r"""import\s+(?:[^"';]*from\s+)?["']([^"']+)["']""", code):
        if target.startswith(ALLOWED_SOL_IMPORT): continue
        if target.startswith("./") and Path(target).name in names and "/" not in target[2:]: continue
        errors.append(f"{name}: import {target!r} not available in the frozen project")
    return errors


def check_solidity(contracts):
    names = {p.name for p in contracts}
    return [e for source in contracts
            for e in check_solidity_code(source.name, source.read_text(encoding="utf-8", errors="replace"), names)]


def strip_solidity(code):
    code = re.sub(r"/\*.*?\*/", " ", code, flags=re.S)
    code = re.sub(r"//[^\n]*", " ", code)
    return re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', ' "S" ', code)


def normalized_tokens(code):
    tokens = []
    for token in TOKEN_RE.findall(strip_solidity(code)):
        if token == '"S"' or token == "S": tokens.append("S")
        elif token[0].isdigit(): tokens.append("N")
        elif token in SOL_KEYWORDS or TYPE_RE.match(token) or not (token[0].isalpha() or token[0] in "_$"): tokens.append(token)
        else: tokens.append("ID")
    return tokens


def shingles(tokens, n=5):
    return {tuple(tokens[i:i + n]) for i in range(max(len(tokens) - n + 1, 1))}


def signatures(code):
    result = set()
    for name, params in re.findall(r"function\s+(\w+)\s*\(([^)]*)\)", strip_solidity(code)):
        types = [p.split()[0] for p in params.split(",") if p.strip()]
        result.add(f"{name}({','.join(types)})")
    return result


def jaccard(a, b):
    return round(len(a & b) / len(a | b), 3) if a | b else 0.0


def leakage(contracts, references):
    """Structural (normalized 5-gram) and signature similarity of each pair contract to each reference."""
    rows = []
    for source in contracts:
        code = source.read_text(encoding="utf-8", errors="replace")
        s, f = shingles(normalized_tokens(code)), signatures(code)
        for ref_name, ref_code in references.items():
            rows.append(dict(contract=source.name, reference=ref_name,
                             structural=jaccard(s, shingles(normalized_tokens(ref_code))),
                             signatures=jaccard(f, signatures(ref_code)),
                             min_functions=min(len(f), len(signatures(ref_code)))))
    rows.sort(key=lambda r: (r["structural"], r["signatures"]), reverse=True)
    flagged = [r for r in rows if r["structural"] >= LEAK_THRESHOLD
               or (r["signatures"] >= SIGNATURE_THRESHOLD and r["min_functions"] >= MIN_SIGNATURE_FUNCTIONS)]
    return dict(threshold_structural=LEAK_THRESHOLD, threshold_signatures=SIGNATURE_THRESHOLD,
                closest=rows[:3], flagged=flagged)


def benchmark_references():
    manifest = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    return {Path(e["path"]).name: (BENCHMARK.parent / e["path"]).read_text(encoding="utf-8")
            for e in manifest["files"] if e["path"].endswith(".sol")}


def run_hardhat(task, run_dir, log, timeout):
    env = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
           "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "PROGRAMFILES", "PROGRAMFILES(X86)", "NUMBER_OF_PROCESSORS"}}
    env.update(RAG_RUN_DIR=str(run_dir), HARDHAT_DISABLE_TELEMETRY="true", NO_COLOR="1")
    cli = HH / "node_modules/hardhat/internal/cli/cli.js"
    start = time.perf_counter()
    with log.open("w", encoding="utf-8") as out:
        try:
            code = subprocess.run([shutil.which("node"), str(cli), task, "--config", str(HH / "hardhat.config.js")],
                                  cwd=run_dir, env=env, stdout=out, stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            return dict(exit_code=None, timeout=True, seconds=round(time.perf_counter() - start, 2))
    return dict(exit_code=code, timeout=False, seconds=round(time.perf_counter() - start, 2))


def mocha_stats(run_dir):
    path = run_dir / "mocha-results.json"
    if not path.exists(): return None
    data = json.loads(path.read_text(encoding="utf-8"))
    stats = data["stats"]
    return dict(tests=stats.get("tests", 0), passes=stats.get("passes", 0), failures=stats.get("failures", 0),
                pending=stats.get("pending", 0),
                failed=[dict(title=f.get("fullTitle"), error=(f.get("err", {}).get("message") or "").splitlines()[0][:300])
                        for f in data.get("failures", [])])


def execute(pair, manifest, timeout):
    run_dir = HH / "runs/corpus-v2-validation" / pair.name
    if run_dir.exists(): shutil.rmtree(run_dir)
    shutil.copytree(pair / "contracts", run_dir / "contracts")
    shutil.copytree(pair / "test", run_dir / "test")
    logs = pair / ".validation"
    logs.mkdir(exist_ok=True)
    result = {}
    test = run_hardhat("test", run_dir, logs / "test.log", timeout)
    test["mocha"] = mocha_stats(run_dir)
    result["test"] = test
    (run_dir / "mocha-results.json").unlink(missing_ok=True)
    cov = run_hardhat("coverage", run_dir, logs / "coverage.log", timeout)
    cov["mocha"] = mocha_stats(run_dir)
    detailed = run_dir / "coverage/coverage-final.json"
    cov["targets"] = {t: target_coverage(detailed, t) for t in manifest["targets"]} if detailed.exists() else None
    result["coverage"] = cov
    return result


def execution_errors(result):
    errors, test = [], result["test"]
    stats = test.get("mocha")
    if test.get("timeout"): errors.append("execution: timeout")
    elif stats is None: errors.append("execution: no mocha results (compilation or load failure, see .validation/test.log)")
    else:
        if stats["failures"]: errors.append(f"execution: {stats['failures']} failing test(s)")
        if stats["pending"]: errors.append(f"execution: {stats['pending']} pending test(s)")
        if not stats["passes"]: errors.append("execution: no passing test")
        if test.get("exit_code") != 0 and not stats["failures"]: errors.append(f"execution: exit code {test.get('exit_code')}")
    targets = result["coverage"].get("targets")
    if not targets: errors.append("coverage: target coverage missing")
    else:
        # Threshold on the primary target only (targets[0]); other targets are recorded as dependencies.
        name, cov = next(iter(targets.items()))
        if cov["statements"] < MIN_STATEMENT_COVERAGE:
            errors.append(f"coverage: {name} statements {cov['statements']} % < {MIN_STATEMENT_COVERAGE} %")
    return errors


def validate(pair, run=True, timeout=300, references=None):
    pair = Path(pair).resolve()
    report = dict(pair=pair.name, validator=VALIDATOR_VERSION, validated_utc=datetime.now(timezone.utc).isoformat(),
                  hardhat_project=str(HH), hardhat_lock_sha256=sha(HH / "package-lock.json"),
                  hardhat_config_sha256=sha(HH / "hardhat.config.js"), errors=[], warnings=[])
    manifest_path = pair / "manifest.json"
    if not manifest_path.exists():
        report["errors"].append("manifest: missing manifest.json")
        return finish(pair, report)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    contracts = sorted((pair / "contracts").glob("*.sol"))
    tests = sorted((pair / "test").glob("*.js"))
    if not contracts: report["errors"].append("layout: no contracts/*.sol")
    if not tests: report["errors"].append("layout: no test/*.js")
    report["errors"] += check_manifest(pair, manifest)
    if manifest.get("origin") == "llm-assisted": report["warnings"].append("origin: llm-assisted, requires human review")
    report["errors"] += check_tests(tests) + check_solidity(contracts)
    report["files_sha256"] = {str(p.relative_to(pair)).replace("\\", "/"): sha(p) for p in pair_files(pair)
                              if ".validation" not in p.parts}
    report["pair_sha256"] = hashlib.sha256(json.dumps(report["files_sha256"], sort_keys=True).encode()).hexdigest()
    report["leakage"] = leakage(contracts, references if references is not None else benchmark_references())
    for row in report["leakage"]["flagged"]:
        report["errors"].append(f"leakage: {row['contract']} close to benchmark {row['reference']} "
                                f"(structural {row['structural']}, signatures {row['signatures']})")
    report["coverage_policy"] = f"statements >= {MIN_STATEMENT_COVERAGE} % on primary target (manifest targets[0]) only"
    report["mutation"] = "not measured (validator v2)"
    if run and not report["errors"] and manifest.get("targets"):
        report["execution"] = execute(pair, manifest, timeout)
        report["errors"] += execution_errors(report["execution"])
    elif run:
        report["execution"] = "skipped: static checks failed"
    return finish(pair, report)


def finish(pair, report):
    report["accepted"] = not report["errors"]
    (pair / "validation.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pairs", nargs="*", type=Path, help="Pair folders")
    parser.add_argument("--all", type=Path, help="Validate every pair folder under this directory")
    parser.add_argument("--static-only", action="store_true", help="Skip compilation and execution")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()
    pairs = list(args.pairs) + (sorted(p for p in args.all.iterdir() if (p / "manifest.json").exists()) if args.all else [])
    if not pairs: parser.error("no pair given")
    references = benchmark_references()
    summary = []
    for pair in pairs:
        report = validate(pair, run=not args.static_only, timeout=args.timeout, references=references)
        summary.append(dict(pair=report["pair"], accepted=report["accepted"], errors=report["errors"]))
        print(("ACCEPTED " if report["accepted"] else "REJECTED ") + report["pair"], flush=True)
        for error in report["errors"]: print("   -", error, flush=True)
    print(json.dumps(dict(total=len(summary), accepted=sum(s["accepted"] for s in summary)), indent=2))


if __name__ == "__main__":
    main()
