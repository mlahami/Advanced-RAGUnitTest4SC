"""Import candidate pairs from public repositories at a pinned commit into the corpus v2 pair layout.

Input: a JSON list of candidates
    {"repository", "commit", "license", "contract_paths", "targets", "test_paths", "domain", "level", "notes"}
Each candidate is fetched with a shallow, sparse git checkout of exactly that commit. Files are copied
unchanged, except (a) relative Solidity imports between copied files, rewritten to "./Name.sol"
(the pair layout is flat), and (b) the approved test transformations of transform_tests.py
(TypeScript type stripping, ESM to CommonJS, toolbox helper path); every change is recorded in
manifest.transformations, and the upstream SHA-256 of every file is kept.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from transform_tests import transform_test  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "data/corpus-v2"
SOURCES = CORPUS / "_sources"
LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING", "UNLICENSE", "UNLICENSE.md", "UNLICENSE.txt"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def fetch(candidate):
    owner, repo = re.match(r"https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", candidate["repository"]).groups()
    folder = SOURCES / f"{owner}__{repo}@{candidate['commit'][:10]}"
    wanted = candidate["contract_paths"] + candidate["test_paths"]
    if (folder / ".git").exists():
        # Same repository and commit, other files or new licence names: widen the sparse checkout instead of re-cloning.
        sparse = folder / ".git/info/sparse-checkout"
        patterns = set(sparse.read_text().split()) | {"/" + p for p in wanted + LICENSE_NAMES}
        if patterns != set(sparse.read_text().split()):
            sparse.write_text("\n".join(sorted(patterns)) + "\n")
            git(["read-tree", "-mu", "HEAD"], folder)
    elif not all((folder / p).exists() for p in wanted):
        folder.mkdir(parents=True)
        git(["init", "-q"], folder)
        git(["remote", "add", "origin", candidate["repository"]], folder)
        git(["config", "core.sparseCheckout", "true"], folder)
        (folder / ".git/info/sparse-checkout").write_text("\n".join(["/" + p for p in wanted] + ["/" + n for n in LICENSE_NAMES]) + "\n")
        git(["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", candidate["commit"]], folder)
        git(["checkout", "-q", "FETCH_HEAD"], folder)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=folder, capture_output=True, text=True, check=True).stdout.strip()
    if head != candidate["commit"]: raise ValueError(f"checked out {head}, expected {candidate['commit']}")
    missing = [p for p in wanted if not (folder / p).exists()]
    if missing: raise FileNotFoundError(f"missing in repository: {missing}")
    return folder, f"{owner}/{repo}"


def read_source(path, upstream):
    """Read UTF-8 text; a leading byte-order mark is removed (solc rejects it) and recorded."""
    text = path.read_text(encoding="utf-8")
    if text.startswith("﻿"):
        return text[1:], [dict(file=Path(upstream).name, kind="strip-bom", upstream_path=upstream)]
    return text, []


def pair_id(candidate, slug):
    target = Path(candidate["targets"][0]).stem
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", target).lower()
    return f"{words}--{slug.split('/')[0].lower()}"[:60]


def rewrite_imports(code, names, source_name):
    changes = []
    def replace(match):
        path = match.group(2)
        if path.startswith("@") or path.startswith("hardhat/"): return match.group(0)
        if Path(path).name in names and path != "./" + Path(path).name:
            changes.append(dict(file=source_name, kind="import-path", before=path, after="./" + Path(path).name))
            return f"{match.group(1)}./{Path(path).name}{match.group(3)}"
        return match.group(0)
    code = re.sub(r"""(import\s+(?:[^"';]*from\s+)?["'])([^"']+)(["'])""", replace, code)
    return code, changes


def import_candidate(candidate, force=False):
    source, slug = fetch(candidate)
    pid = candidate.get("id") or pair_id(candidate, slug)
    pair = CORPUS / "pairs" / pid
    if pair.exists():
        if not force: return pair, "exists"
        shutil.rmtree(pair)
    (pair / "contracts").mkdir(parents=True)
    (pair / "test").mkdir()
    names = {Path(p).name for p in candidate["contract_paths"]}
    if len(names) != len(candidate["contract_paths"]): raise ValueError("duplicate contract file names after flattening")
    transformations = []
    for path in candidate["contract_paths"]:
        text, bom = read_source(source / path, path)
        code, changes = rewrite_imports(text, names, Path(path).name)
        transformations += bom
        (pair / "contracts" / Path(path).name).write_text(code, encoding="utf-8", newline="")
        transformations += changes
    for path in candidate["test_paths"]:
        text, bom = read_source(source / path, path)
        transformations += bom
        code, name, changes = transform_test(text, Path(path).name)
        (pair / "test" / name).write_text(code, encoding="utf-8", newline="")
        for change in changes: change["upstream_path"] = path
        transformations += changes
    licence = next((source / n for n in LICENSE_NAMES if (source / n).exists()), None)
    if licence: shutil.copyfile(licence, pair / "LICENSE")
    manifest = dict(id=pid, domain=candidate["domain"], level=candidate["level"], origin="human",
                    targets=[Path(t).name for t in candidate["targets"]],
                    source=dict(repository=candidate["repository"], commit=candidate["commit"], license=candidate["license"],
                                contract_paths=candidate["contract_paths"], test_paths=candidate["test_paths"],
                                license_file=licence.name if licence else None,
                                upstream_sha256={p: sha(source / p) for p in candidate["contract_paths"] + candidate["test_paths"]}),
                    transformations=transformations, convention="hardhat2-ethers6",
                    test_language=candidate.get("test_language", "ts" if any(p.endswith(".ts") for p in candidate["test_paths"]) else "js"),
                    discovery_notes=candidate.get("notes", ""), authorship_doubt="DOUBTFUL" in candidate.get("notes", ""), imported_utc=datetime.now(timezone.utc).isoformat())
    (pair / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return pair, "imported" if licence else "imported (no licence file found)"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("candidates", type=Path)
    parser.add_argument("--force", action="store_true", help="Re-import existing pairs")
    args = parser.parse_args()
    rows = []
    for candidate in json.loads(args.candidates.read_text(encoding="utf-8")):
        try:
            pair, status = import_candidate(candidate, args.force)
            rows.append(dict(repository=candidate["repository"], pair=pair.name, status=status))
        except Exception as exc:  # keep going: an unavailable candidate is a result, not a crash
            rows.append(dict(repository=candidate["repository"], targets=candidate.get("targets"), status=f"failed: {exc}"))
        print(rows[-1], flush=True)
    (CORPUS / "import_log.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
