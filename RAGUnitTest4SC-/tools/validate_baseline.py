"""Headless functional check: real RAG generation, Babel and Hardhat for 14 inputs.

One generation per contract, no repairs, no reference tests in prompts. This is
a functional pilot, not a repeated comparative experiment or a judge evaluation.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
BENCH = ROOT / "data/benchmarks/enase14"
HARDHAT = ROOT / "src/main/resources/HardhatProject"

def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def command(args, cwd, env, log, timeout=180):
    start = time.perf_counter()
    with log.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            return {"exit_code": None, "seconds": time.perf_counter() - start, "timeout": True}
    return {"exit_code": code, "seconds": time.perf_counter() - start}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight", action="store_true", help="No model API calls")
    args = parser.parse_args()
    # Use the already downloaded embedding model; only generation needs network.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    server = ROOT / "flask/RAGUnitTest4SC-main/rag_server.py"
    spec = importlib.util.spec_from_file_location("baseline_runtime", server)
    rag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rag)
    manifest = json.loads((BENCH / "manifest.json").read_text(encoding="utf-8"))
    selection = json.loads((ROOT / "data/corpus/baseline-selection.json").read_text())
    if sha(rag.CORPUS) != selection["sha256"]:
        raise SystemExit("Selected corpus differs from the frozen baseline manifest.")
    for item in manifest["files"]:
        if sha(BENCH / item["path"]) != item["sha256"]:
            raise SystemExit("Benchmark file changed: " + item["path"])
    node = shutil.which("node")
    cli = HARDHAT / "node_modules/hardhat/internal/cli/cli.js"
    if not node or not cli.exists():
        raise SystemExit("Node/Hardhat installation missing.")
    print("Initializing frozen Markdown corpus (offline MiniLM)...", flush=True)
    retriever = rag.get_retriever()
    info = {"corpus": str(rag.CORPUS), "corpus_sha256": retriever.sha256,
            "chunks": len(retriever.chunks), "initialization_seconds": retriever.initialization_seconds,
            "model": rag.MODEL, "provider": rag.PROVIDER, "contract_count": len(manifest["pairs"])}
    print(json.dumps(info), flush=True)
    if args.preflight:
        return
    run_id = datetime.now(timezone.utc).strftime("baseline-check-%Y%m%dT%H%M%S%fZ")
    out = ROOT / "outputs" / run_id
    out.mkdir(parents=True)
    save(out / "setup.json", {**info, "scope": "Single-run functional validation; repaired baseline",
                              "server_sha256": sha(server), "benchmark_manifest_sha256": sha(BENCH / "manifest.json"),
                              "temperature": 0, "seed": 42, "manual_repairs": False,
                              "references_given_to_generator": False, "python": sys.version})
    shutil.copyfile(rag.CORPUS, out / "corpus.md")
    original_generate = rag.generate
    results = []
    for item in manifest["pairs"]:
        identifier = item["id"]
        folder = out / identifier
        folder.mkdir()
        run = HARDHAT / "runs" / run_id / identifier
        (run / "contracts").mkdir(parents=True)
        (run / "test").mkdir()
        target = run / "contracts" / Path(item["contract"]).name
        shutil.copyfile(BENCH / item["contract"], target)
        row = {"contract": identifier, "status": "started", "hardhat_run": str(run)}
        def recorded_generate(prompt):
            (folder / "prompt.txt").write_text(prompt, encoding="utf-8")
            return original_generate(prompt)
        rag.generate = recorded_generate
        payload = {"solidityCode": target.read_text(encoding="utf-8"),
                   "context": "Generate a unit test suite for the supplied Solidity contract.",
                   "generalInstructions": "Use Hardhat 2, ethers 5, Mocha and hardhat-chai-matchers. No external helper files.",
                   "requirements": "Cover actual public functions, state changes, events, access restrictions, relevant boundaries and revert conditions. Use fresh deployments. Do not invent behavior.",
                   "exampleTest": ""}
        save(folder / "request.json", payload)
        print("Generating:", identifier, flush=True)
        try:
            start = time.perf_counter()
            response = rag.app.test_client().post("/query", json=payload)
            row["request_seconds"] = time.perf_counter() - start
            data = response.get_json()
            save(folder / "generation.json", data)
            if response.status_code != 200:
                row.update(status="generation_error", error=data.get("error"))
                continue
            metadata = data["metadata"]
            row["generation_seconds"] = metadata["generation_seconds"]
            row["retrieval_seconds"] = metadata["retrieval_seconds"]
            row["usage"] = metadata["usage"]
            save(folder / "retrieved_contexts.json", [dict(hit, text=retriever.chunks[hit["chunk_id"]])
                                                    for hit in metadata["retrieved_chunks"]])
            test = run / "test/generated.test.js"
            test.write_text(data["reply"], encoding="utf-8")
            shutil.copyfile(test, folder / "generated.test.js")
            # Never pass the API key to generated JavaScript processes.
            child_env = {k: v for k, v in os.environ.items() if k != "MISTRAL_API_KEY"}
            child_env.update(RAG_RUN_DIR=str(run), HARDHAT_DISABLE_TELEMETRY="true", NO_COLOR="1")
            syntax = command([node, str(HARDHAT / "check.js"), str(test)], HARDHAT, child_env, folder / "syntax.json", 30)
            syntax_report = json.loads((folder / "syntax.json").read_text(encoding="utf-8"))
            row["syntax_valid"] = syntax_report.get("valid") is True and syntax["exit_code"] == 0
            if not row["syntax_valid"]:
                row["status"] = "syntax_error"
                continue
            execution = command([node, str(cli), "coverage", "--config", str(HARDHAT / "hardhat.config.js")],
                                run, child_env, folder / "execution.log")
            row["execution"] = execution
            mocha = run / "mocha-results.json"
            if mocha.exists():
                shutil.copyfile(mocha, folder / "mocha-results.json")
                result = json.loads(mocha.read_text(encoding="utf-8"))
                row["passed_tests"] = result["stats"].get("passes", 0)
                row["failed_tests"] = result["stats"].get("failures", 0)
                row["failures"] = [{"title": f.get("fullTitle"), "error": f.get("err", {}).get("message")}
                                   for f in result.get("failures", [])]
            output = (folder / "execution.log").read_text(encoding="utf-8", errors="replace")
            coverage = re.search(r"All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)", output)
            if coverage:
                row["coverage"] = dict(zip(["statements", "branches", "functions", "lines"], map(float, coverage.groups())))
            if execution.get("timeout"):
                row["status"] = "execution_timeout"
            elif row.get("failed_tests", 0):
                row["status"] = "test_failures"
            elif execution["exit_code"] == 0 and row.get("passed_tests", 0) > 0 and coverage:
                row["status"] = "passed"
            else:
                row["status"] = "execution_error"
        except Exception as error:
            row.update(status="runner_error", error_type=type(error).__name__)
        finally:
            rag.generate = original_generate
            results.append(row)
            save(folder / "result.json", row)
            summary = {"run_id": run_id, "completed": len(results), "total": len(manifest["pairs"]),
                       "statuses": dict(Counter(result["status"] for result in results)), "results": results}
            save(out / "summary.json", summary)
            print(identifier, row["status"], row.get("passed_tests"), row.get("failed_tests"), flush=True)
    print("RESULTS:", out, flush=True)
    print(json.dumps(summary["statuses"]), flush=True)

if __name__ == "__main__":
    main()
