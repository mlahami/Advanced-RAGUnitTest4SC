"""Frozen benchmark-fixture catalogue shared by all generation conditions."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIXTURE_DIR = ROOT / "data/fixtures/v2"
FIXTURE_SOURCE = FIXTURE_DIR / "BenchmarkFixtures.sol"
FIXTURE_CATALOG = FIXTURE_DIR / "catalog.json"
LEGACY_FIXTURE_RULE = "Do not reference external fixtures, helper files, or undeclared mock contracts."
COMMON_FIXTURE_RULE = "Use only the declared benchmark fixtures when an external dependency is required; do not reference other helper files or undeclared mock contracts."


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture_prompt_block() -> str:
    catalog = json.loads(FIXTURE_CATALOG.read_text(encoding="utf-8"))
    return """\nBENCHMARK FIXTURES (identical for every experimental configuration):
The following precompiled auxiliary contracts are available by the exact canonical names below.
Use them only when the target requires an external dependency. Do not invent aliases, other mocks,
helper files, functions, or constructor signatures. Deploy and initialize a fresh fixture in beforeEach.
These fixtures are test infrastructure; they are not retrieved evidence and do not describe target behavior.
FIXTURE CATALOG:
""" + json.dumps(catalog, indent=2) + "\nFIXTURE SOURCE (authoritative for fixture behavior and revert conditions):\n" + FIXTURE_SOURCE.read_text(encoding="utf-8") + "\nEND BENCHMARK FIXTURES\n"


def normalize_fixture_rule(prompt: str) -> str:
    """Remove the legacy contradiction before appending the shared catalogue."""
    if LEGACY_FIXTURE_RULE in prompt:
        return prompt.replace(LEGACY_FIXTURE_RULE, COMMON_FIXTURE_RULE)
    if COMMON_FIXTURE_RULE not in prompt:
        raise ValueError("Prompt lacks the common fixture policy")
    return prompt


def fixture_metadata() -> dict:
    return {
        "fixture_version": "enase30-fixtures-v2",
        "fixture_source": str(FIXTURE_SOURCE),
        "fixture_source_sha256": sha256(FIXTURE_SOURCE),
        "fixture_catalog_sha256": sha256(FIXTURE_CATALOG),
        "fixture_retrieval_excluded": True,
    }
