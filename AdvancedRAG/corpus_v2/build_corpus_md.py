"""Build the indexed Markdown view of corpus v2 from validated pairs, plus a frozen corpus manifest.

Only pairs whose validation.json is accepted AND whose files still match the validated hashes are
emitted. Near-duplicate pairs inside the corpus (same structural threshold as the leakage check) keep
only the first pair in id order; the others are listed as excluded.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_pair as vp  # noqa: E402

CORPUS = vp.ROOT / "data/corpus-v2"
GROUPS = CORPUS / "domain_groups.json"


def domain_group(domain):
    groups = {label: g for g, labels in json.loads(GROUPS.read_text(encoding="utf-8")).items() if not g.startswith("_") for label in labels}
    if domain not in groups: raise ValueError(f"domain {domain!r} missing from {GROUPS.name}")
    return groups[domain]


def current_hashes(pair):
    return {str(p.relative_to(pair)).replace("\\", "/"): vp.sha(p) for p in vp.pair_files(pair) if ".validation" not in p.parts}


def render(pair, manifest, validation):
    src = manifest["source"]
    cov = validation["execution"]["coverage"]["targets"]
    stats = validation["execution"]["test"]["mocha"]
    lines = [f"# {manifest['id']}", "",
             f"- domain: {domain_group(manifest['domain'])} ({manifest['domain']})", f"- level: {manifest['level']}", f"- origin: {manifest['origin']}",
             f"- convention: {manifest.get('convention', 'hardhat2-ethers6')}",
             f"- source: {src['repository']} @ {src['commit']}", f"- license: {src['license']}",
             f"- targets: {', '.join(manifest['targets'])}",
             f"- validation: {stats['passes']} passing tests, 0 failing; statement coverage "
             + ", ".join(f"{t} {c['statements']} %" for t, c in cov.items()), ""]
    for path in sorted((pair / "contracts").glob("*.sol")):
        role = "primary target" if path.name == manifest["targets"][0] else "dependency"
        lines += [f"## Contract: {path.name} ({role})", "", "```solidity", path.read_text(encoding="utf-8").rstrip(), "```", ""]
    for path in sorted((pair / "test").glob("*.js")):
        lines += [f"## Tests: {path.name}", "", "```javascript", path.read_text(encoding="utf-8").rstrip(), "```", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pairs", type=Path, default=CORPUS / "pairs")
    parser.add_argument("--out", type=Path, default=CORPUS / "md")
    args = parser.parse_args()
    accepted, excluded = [], []
    for pair in sorted(p for p in args.pairs.iterdir() if (p / "manifest.json").exists()):
        validation_path = pair / "validation.json"
        if not validation_path.exists():
            excluded.append(dict(pair=pair.name, reason="not validated")); continue
        validation = json.loads(validation_path.read_text(encoding="utf-8"))
        if not validation.get("accepted"):
            excluded.append(dict(pair=pair.name, reason="rejected", errors=validation["errors"])); continue
        if validation["files_sha256"] != current_hashes(pair):
            excluded.append(dict(pair=pair.name, reason="files changed since validation")); continue
        accepted.append((pair, json.loads((pair / "manifest.json").read_text(encoding="utf-8")), validation))
    kept, seen = [], {}
    for pair, manifest, validation in accepted:
        # Compare primary targets only: shared dependencies (ERC20 mocks, a project's own token) are not duplicates.
        contracts = [pair / "contracts" / manifest["targets"][0]]
        dup = vp.leakage(contracts, seen)["flagged"] if seen else []
        if dup:
            excluded.append(dict(pair=pair.name, reason="near-duplicate of another corpus pair", closest=dup[0])); continue
        for c in contracts: seen[f"{pair.name}/{c.name}"] = c.read_text(encoding="utf-8")
        kept.append((pair, manifest, validation))
    if args.out.exists():
        for old in args.out.glob("*.md"): old.unlink()
    args.out.mkdir(parents=True, exist_ok=True)
    entries = []
    for pair, manifest, validation in kept:
        path = args.out / f"{pair.name}.md"
        path.write_text(render(pair, manifest, validation), encoding="utf-8", newline="\n")
        entries.append(dict(id=pair.name, domain=manifest["domain"], domain_group=domain_group(manifest["domain"]),
                            level=manifest["level"], md=path.name,
                            md_sha256=vp.sha(path), pair_sha256=validation["pair_sha256"],
                            repository=manifest["source"]["repository"], commit=manifest["source"]["commit"],
                            license=manifest["source"]["license"],
                            test_language=manifest.get("test_language", "js"),
                            transformations=sorted({t["kind"] for t in manifest.get("transformations", [])})))
    corpus_sha = hashlib.sha256(json.dumps([(e["id"], e["md_sha256"]) for e in entries]).encode()).hexdigest()
    summary = dict(corpus="corpus-v2", built_utc=datetime.now(timezone.utc).isoformat(), corpus_sha256=corpus_sha,
                   pairs=len(entries), by_level=_count(entries, "level"), by_domain=_count(entries, "domain"),
                   by_domain_group=_count(entries, "domain_group"), domain_groups_sha256=vp.sha(GROUPS),
                   by_test_language=_count(entries, "test_language"),
                   test_transformed=sum(bool(set(e["transformations"]) - {"import-path", "strip-bom"}) for e in entries),
                   entries=entries, excluded=excluded)
    (CORPUS / "corpus_manifest.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ["pairs", "by_level", "corpus_sha256"]} | {"excluded": len(excluded)}, indent=2))


def _count(entries, key):
    out = {}
    for e in entries: out[e[key]] = out.get(e[key], 0) + 1
    return out


if __name__ == "__main__":
    main()
