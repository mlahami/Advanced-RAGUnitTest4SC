"""Mechanical, behaviour-preserving transformations of human-written tests (approved 2026-09-27).

1. ts-type-strip: TypeScript types removed by Node's stripTypeScriptTypes (mode "strip": types only,
   no code generation; enums, namespaces and parameter properties are refused, so the pair is rejected).
2. esm-to-cjs: top-level `import` statements rewritten to `require`, as the generator writes CommonJS.
3. type-only-import-elided: imported names no longer used after type stripping are dropped, as tsc does.
4. test-import-path: @nomicfoundation/hardhat-toolbox/network-helpers -> @nomicfoundation/hardhat-network-helpers
   (the toolbox module only re-exports the latter).
Every change is returned so it can be recorded in manifest.transformations; the result is then
executed by validate_pair.py like any other test.
"""
import json
import re
import shutil
import subprocess

TOOLBOX_HELPERS = "@nomicfoundation/hardhat-toolbox/network-helpers"
NETWORK_HELPERS = "@nomicfoundation/hardhat-network-helpers"
STRIP_JS = ("const {stripTypeScriptTypes}=require('node:module');let s='';process.stdin.on('data',d=>s+=d);"
            "process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify({code:stripTypeScriptTypes(s,{mode:'strip'})}))}"
            "catch(e){process.stdout.write(JSON.stringify({error:String(e.message||e)}))}});")
STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`')
IMPORT_RE = re.compile(r'^[ \t]*import\s+(?P<clause>[^;"\']*?)\s+from\s+(?P<q>["\'])(?P<module>[^"\']+)(?P=q)\s*;?[ \t]*$'
                       r'|^[ \t]*import\s+(?P<q2>["\'])(?P<side>[^"\']+)(?P=q2)\s*;?[ \t]*$', re.M | re.S)


def strip_types(code):
    result = subprocess.run([shutil.which("node"), "--no-warnings", "-e", STRIP_JS], input=code,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    data = json.loads(result.stdout)
    if "error" in data: raise ValueError(f"TypeScript construct not strippable: {data['error'][:200]}")
    return data["code"]


def tidy(original, stripped):
    """Remove whitespace left by stripped types, outside string literals only."""
    out = []
    for before, line in zip(original.split("\n"), stripped.split("\n")):
        if not line.strip() and before.strip(): continue  # the whole line was a type (e.g. `import type`)
        indent = re.match(r"[ \t]*", line).group(0)
        body, parts, last = line[len(indent):], [], 0
        for m in STRING_RE.finditer(body):
            parts.append(("code", body[last:m.start()])); parts.append(("str", m.group(0))); last = m.end()
        parts.append(("code", body[last:]))
        cleaned = []
        for kind, text in parts:
            if kind == "code":
                text = re.sub(r"(?<=\S) {2,}", " ", text)
                text = re.sub(r" +(?=[;,)\]])", "", text)
            cleaned.append(text)
        out.append((indent + "".join(cleaned)).rstrip())
    return "\n".join(out)


def parse_clause(clause):
    """Return (default, namespace, [(imported, local)]) for an import clause."""
    default = namespace = None
    named = []
    clause = clause.strip()
    m = re.search(r"\{(.*)\}", clause, re.S)
    if m:
        for spec in m.group(1).split(","):
            spec = re.sub(r"^\s*type\s+", "", spec.strip())
            if not spec: continue
            imported, _, local = spec.partition(" as ")
            named.append((imported.strip(), (local or imported).strip()))
        clause = (clause[:m.start()] + clause[m.end():]).strip().rstrip(",").strip()
    m = re.search(r"\*\s+as\s+(\w+)", clause)
    if m:
        namespace = m.group(1); clause = clause.replace(m.group(0), "").strip().rstrip(",").strip()
    if clause.startswith("type "): return None, None, []
    if clause: default = clause.strip(" ,")
    return default, namespace, named


def esm_to_cjs(code):
    changes = []
    imports = list(IMPORT_RE.finditer(code))
    # A name counts as used only in code: string literals and comments are ignored ("TipJar" in deployContract).
    body = STRING_RE.sub('""', IMPORT_RE.sub("", code))
    body = re.sub(r"/\*.*?\*/|//[^\n]*", " ", body, flags=re.S)
    used = lambda name: re.search(rf"(?<![\w$.]){re.escape(name)}(?![\w$])", body) is not None
    lines = []
    for m in imports:
        if m.group("side"):
            lines.append(f'require("{m.group("side")}");'); continue
        module = m.group("module")
        default, namespace, named = parse_clause(m.group("clause"))
        kept = [(i, l) for i, l in named if used(l)]
        dropped = [l for i, l in named if not used(l)] + [n for n in [default, namespace] if n and not used(n)]
        if dropped: changes.append(dict(kind="type-only-import-elided", module=module, names=dropped))
        if namespace and used(namespace): lines.append(f'const {namespace} = require("{module}");')
        if default and used(default): lines.append(f'const {default} = require("{module}");')
        if kept:
            specs = ", ".join(i if i == l else f"{i}: {l}" for i, l in kept)
            lines.append(f'const {{ {specs} }} = require("{module}");')
    if imports: changes.insert(0, dict(kind="esm-to-cjs", statements=len(imports)))
    # Re-insert the require block where the first import stood.
    if imports:
        code = IMPORT_RE.sub("\0", code)
        code = code.replace("\0", "\n".join(lines), 1).replace("\0", "")
        code = re.sub(r"\n{3,}", "\n\n", code)
    return code, changes


def map_helpers(code):
    if TOOLBOX_HELPERS not in code: return code, []
    return code.replace(TOOLBOX_HELPERS, NETWORK_HELPERS), [dict(kind="test-import-path", before=TOOLBOX_HELPERS, after=NETWORK_HELPERS)]


def transform_test(code, filename):
    """Return (javascript, output filename, changes)."""
    changes = []
    if filename.endswith(".ts"):
        code = tidy(code, strip_types(code))
        changes.append(dict(kind="ts-type-strip", tool="node:module.stripTypeScriptTypes (mode strip)"))
        filename = filename[:-3] + ".js"
    if re.search(r"^\s*import\s", code, re.M):
        code, more = esm_to_cjs(code); changes += more
    # `export` on a declaration makes Node load the file as an ES module; a test file exports nothing it needs.
    exported = re.findall(r"^export\s+(?:async\s+function|function|const|let|var|class)\s+(\w+)", code, re.M)
    if exported:
        code = re.sub(r"^export\s+(?=(?:async\s+function|function|const|let|var|class)\s)", "", code, flags=re.M)
        changes.append(dict(kind="esm-to-cjs", removed_export=exported))
    code, more = map_helpers(code); changes += more
    for change in changes: change["file"] = filename
    return code, filename, changes
