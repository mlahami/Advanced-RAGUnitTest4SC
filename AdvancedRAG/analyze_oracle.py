"""Compare oracle-context arms with the existing development14 configurations (descriptive)."""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "outputs"
METHODS = {
    "llm-only": "development14-llm-only-fixtures-v2-{rep}",
    "ragunittest4sc": "development14-ragunittest4sc-fixtures-v2-{rep}",
    "advanced": "development14-advanced-fixtures-v2-{rep}",
    "oracle-domain": "development14-oracle-domain-v1-{rep}",
    "oracle-mismatched": "development14-oracle-mismatched-v1-{rep}",
}
REPS = ["rep01", "rep02", "rep03"]


def category(error):
    e = (error or "").splitlines()[0] if error else ""
    if re.search(r"Event .* doesn't exist", e): return "invented event"
    if "is not a function" in e or "Cannot read properties" in e: return "invented function/API"
    if re.search(r"revert", e, re.I): return "revert mismatch"
    if re.search(r"expected|AssertionError", e, re.I): return "wrong assertion value"
    return "other"


def load(method):
    rows = []
    for rep in REPS:
        folder = OUT / METHODS[method].format(rep=rep)
        if not folder.exists(): continue
        for result in sorted(folder.glob("*/result.json")):
            r = json.loads(result.read_text(encoding="utf-8"))
            r["rep"] = rep
            rows.append(r)
    return rows


def mean(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 2) if values else None


def main():
    data = {m: load(m) for m in METHODS}
    table, failures, per_contract = [], {}, defaultdict(dict)
    for m, rows in data.items():
        if not rows: continue
        passed = sum(r.get("passed_tests", 0) or 0 for r in rows)
        failed = sum(r.get("failed_tests", 0) or 0 for r in rows)
        cov = [r.get("coverage") for r in rows if r.get("coverage")]
        table.append(dict(method=m, suites=len(rows), fully_passing=sum(r["status"] == "passed" for r in rows),
                          fpsr=round(100 * sum(r["status"] == "passed" for r in rows) / len(rows), 1),
                          tpr=round(100 * passed / (passed + failed), 1) if passed + failed else None,
                          statements=mean([c["statements"] for c in cov]), branches=mean([c["branches"] for c in cov]),
                          statuses=dict(Counter(r["status"] for r in rows))))
        failures[m] = dict(Counter(category(f.get("error")) for r in rows for f in r.get("failures", []) or []))
        for r in rows:
            per_contract[r["contract"]].setdefault(m, 0)
            per_contract[r["contract"]][m] += r["status"] == "passed"
    # Paired contract x repetition comparison against LLM-only (discordant pairs for McNemar).
    base = {(r["contract"], r["rep"]): r["status"] == "passed" for r in data["llm-only"]}
    paired = {}
    for m, rows in data.items():
        if m == "llm-only" or not rows: continue
        b = c = 0
        for r in rows:
            key = (r["contract"], r["rep"])
            if key not in base: continue
            ok = r["status"] == "passed"
            b += ok and not base[key]
            c += base[key] and not ok
        paired[m] = {"method_only_passes": b, "llm_only_passes": c}
    report = dict(summary=table, failure_categories=failures, passing_reps_per_contract=per_contract, paired_vs_llm_only=paired)
    (OUT / "oracle_comparison_v1.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
