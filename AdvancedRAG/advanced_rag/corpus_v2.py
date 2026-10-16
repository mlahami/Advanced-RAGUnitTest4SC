"""Corpus v2 index: structural units of the frozen human-written pairs, test/function links, dense retriever.

Units (spec CORPUS_V2_SPEC.md section 6):
- one `function` chunk per Solidity function/constructor/modifier of every pair contract;
- one `test_case` chunk per it() block, delivered with the setup it needs: the requires and the
  declarations it references (program or enclosing suites), and the before/beforeEach hooks of its
  enclosing suites. The embedding covers the suite path, the title and the it() block only.
- `source_artifact` chunks keep every whole file for traceability; they are not indexed.
Links are static and heuristic: a test "calls" a pair function when `.name(` appears in its body.
All labels are lexical hints (metadata_status = heuristic_not_validated), never ground truth.
"""
from bisect import bisect_right
from collections import Counter, defaultdict
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from .chunking import lexical_mask

VERSION = 'corpus-v2-units-v1'
BLOCK = re.compile(r'^## (Contract|Tests): (\S+?)(?: \((primary target|dependency)\))?\n\n```(solidity|javascript)\n', re.M)
SETUP_HOOKS = {'before', 'beforeEach', 'beforeAll'}
INDEXED = ('function', 'test_case')
FILTERS = {'artifact_type', 'domain_group', 'domain', 'level', 'role', 'test_type', 'function_role', 'language', 'pair_id'}


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf-8')).hexdigest()


def verify_frozen(corpus_dir):
    """Return (frozen record, manifest) after checking every md file against the frozen fingerprints."""
    corpus_dir = Path(corpus_dir)
    frozen = json.loads((corpus_dir / 'CORPUS_FROZEN.json').read_text(encoding='utf-8'))
    manifest_path = corpus_dir / 'corpus_manifest.json'
    if sha(manifest_path.read_bytes()) != frozen['corpus_manifest_sha256']:
        raise ValueError('corpus_manifest.json differs from the frozen record')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for entry in manifest['entries']:
        if sha((corpus_dir / 'md' / entry['md']).read_bytes()) != entry['md_sha256']:
            raise ValueError(f"{entry['md']} differs from its frozen fingerprint")
    corpus_sha = sha(json.dumps([(e['id'], e['md_sha256']) for e in manifest['entries']]))
    if corpus_sha != frozen['corpus_sha256'] or len(manifest['entries']) != frozen['pairs']:
        raise ValueError('corpus fingerprint differs from the frozen record')
    return frozen, manifest


def md_blocks(text):
    """Source blocks of one pair Markdown file, with exact offsets of the code inside the file."""
    blocks = []
    for match in BLOCK.finditer(text):
        start = match.end()
        end = text.find('\n```', start)
        if end < 0:
            raise ValueError(f'unterminated code block for {match[2]}')
        blocks.append(dict(kind=match[1], filename=match[2], role=match[3] or ('test' if match[1] == 'Tests' else None),
                           language=match[4], start=start, end=end, text=text[start:end]))
    return blocks


def run_parser(items, parser_package=None):
    env = os.environ.copy()
    if parser_package:
        env['AR_PARSER_PACKAGE'] = str(Path(parser_package).resolve())
    process = subprocess.run(['node', str(Path(__file__).with_name('parse_corpus_v2.cjs'))], input=json.dumps(items).encode(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=600)
    if process.returncode:
        raise RuntimeError('Node parser failed: ' + process.stderr.decode('utf-8', errors='replace')[:1000])
    return json.loads(process.stdout)


# ---- heuristic labels -------------------------------------------------------------------------------

TEST_TYPES = {
    'revert': r'\.to\.be\.reverted|\.revertedWith|\.revertedWithCustomError|\.revertedWithPanic|\.to\.be\.rejected',
    'event': r'\.to\.emit\s*\(',
    'balance': r'changeEtherBalances?|changeTokenBalances?',
    'time': r'\btime\s*\.\s*(?:increase|increaseTo|latest|setNextBlockTimestamp)|evm_increaseTime|evm_mine|\bmine\s*\(',
    'boundary': r'MaxUint256|ZeroAddress|\b0n\b|\bzero\b|exceed|\blimit|overflow|underflow|\bmax\w*|\bmin\w*',
    'access': r'onlyOwner|OwnableUnauthorizedAccount|AccessControlUnauthorizedAccount|unauthori[sz]ed|not (?:the )?owner|missing role',
}
FUNCTION_ROLES = {
    'payment': r'\bpayable\b|msg\.value|\.transfer\s*\(|\.call\s*\{\s*value|safeTransfer|transferFrom|\.send\s*\(',
    'access_control': r'onlyOwner|onlyRole|hasRole|_checkOwner|msg\.sender\s*[!=]=|==\s*msg\.sender',
    'temporal': r'block\.timestamp|block\.number',
    'emits_events': r'\bemit\s+\w+',
    'reverts': r'\brequire\s*\(|\brevert\b',
}


def labels(patterns, text):
    found = []
    evidence = []
    for label, regex in patterns.items():
        match = re.search(regex, text, re.I if label in ('boundary', 'access') else 0)
        if match:
            found.append(label)
            evidence.append(dict(label=label, matched_text=match.group(), method='lexical_heuristic'))
    return found, evidence


# ---- chunk construction ----------------------------------------------------------------------------

def build_chunks(corpus_dir, parser_package=None):
    corpus_dir = Path(corpus_dir)
    frozen, manifest = verify_frozen(corpus_dir)
    corpus_sha = frozen['corpus_sha256']
    files, items = [], []
    for entry in manifest['entries']:
        raw = (corpus_dir / 'md' / entry['md']).read_bytes()
        text = raw.decode('utf-8')  # exact characters, CRLF kept, offsets are code points of this string
        blocks = md_blocks(text)
        pair = corpus_dir / 'pairs' / entry['id']
        for block in blocks:
            folder = 'contracts' if block['kind'] == 'Contract' else 'test'
            # build_corpus_md.py rendered files with read_text (universal newlines) and rstrip.
            if block['text'] != (pair / folder / block['filename']).read_text(encoding='utf-8').rstrip():
                raise ValueError(f"{entry['md']}: block {block['filename']} differs from the validated pair file")
            block_id = f"{entry['id']}/{folder}/{block['filename']}"
            files.append(dict(entry=entry, md_text=text, id=block_id, **block))
            items.append(dict(id=block_id, language=block['language'], text=block['text']))
    parsed = run_parser(items, parser_package)
    chunks, diagnostics = [], []
    by_pair = defaultdict(list)
    for file, result in zip(files, parsed):
        by_pair[file['entry']['id']].append((file, result))
        diagnostics.append(dict(file=file['id'], status=result['status'], error=result.get('error'), units=len(result['units'])))
    for pair_id, pair_files in by_pair.items():
        chunks.extend(pair_chunks(pair_id, pair_files, corpus_sha))
    link_tests(chunks)
    indexed = [c for c in chunks if c['artifact_type'] in INDEXED]
    tests = [c for c in chunks if c['artifact_type'] == 'test_case']
    functions = [c for c in chunks if c['artifact_type'] == 'function']
    report = dict(version=VERSION, corpus_sha256=corpus_sha, pairs=len(by_pair), files=len(files),
                  parse_status=dict(Counter(d['status'] for d in diagnostics)),
                  parse_failures=[d for d in diagnostics if d['status'] != 'ast'],
                  chunk_count=len(chunks), indexed_chunks=len(indexed),
                  artifact_types=dict(Counter(c['artifact_type'] for c in chunks)),
                  test_cases_linked=sum(bool(c['called_functions']) for c in tests),
                  test_cases_linked_to_primary=sum(any(f['role'] == 'primary target' for f in c['called_functions']) for c in tests),
                  primary_functions=sum(c['role'] == 'primary target' for c in functions),
                  primary_functions_tested=sum(c['role'] == 'primary target' and bool(c['tested_by']) for c in functions),
                  test_types=dict(Counter(t for c in tests for t in c['test_type'])),
                  function_roles=dict(Counter(r for c in functions for r in c['function_role'])),
                  delivered_chars=dict(test_case=_quantiles([len(c['text']) for c in tests]),
                                       function=_quantiles([len(c['text']) for c in functions])),
                  limitations=['Labels and test-to-function links are lexical heuristics, not validated annotations.',
                               'A link means the test body calls a function of that name on some object; overloads and '
                               'same-named functions of several pair contracts are all linked.',
                               'Test setup keeps before/beforeEach hooks and referenced declarations; after hooks are omitted.',
                               'The dense encoder truncates embedding_text to its token limit; delivered text is never truncated.'])
    return chunks, report


def _quantiles(values):
    if not values: return {}
    values = sorted(values)
    pick = lambda q: values[min(len(values) - 1, int(q * len(values)))]
    return dict(min=values[0], median=pick(0.5), p90=pick(0.9), max=values[-1])


def pair_chunks(pair_id, pair_files, corpus_sha):
    chunks = []
    entry = pair_files[0][0]['entry']
    base = dict(pair_id=pair_id, md_file=entry['md'], domain=entry['domain'], domain_group=entry['domain_group'],
                level=entry['level'], repository=entry['repository'], commit=entry['commit'], source_sha256=corpus_sha,
                metadata_status='heuristic_not_validated')
    header = f"// corpus-v2 pair {pair_id} ({entry['domain_group']}, {entry['level']})"
    for file, result in pair_files:
        text, offset = file['md_text'], file['start']
        lines = [0] + [m.end() for m in re.finditer('\n', text)]

        def record(kind, name, start, end, delivered, embedded, **extra):
            s, e = offset + start, offset + end
            return dict(id=sha(f"{VERSION}:{corpus_sha}:{file['id']}:{kind}:{s}:{e}")[:24], artifact_id=file['id'],
                        artifact_type=kind, name=name, source_file=file['filename'], language=file['language'],
                        role=file['role'], start_char=s, end_char=e, start_line=bisect_right(lines, s),
                        end_line=bisect_right(lines, e - 1), parser='strict_ast' if result['status'] == 'ast' else 'none',
                        parse_error=result.get('error'), text=delivered, embedding_text=embedded, **base, **extra)

        source = file['text']
        chunks.append(record('source_artifact', file['filename'], 0, len(source), source, None, parent_id=None))
        artifact_id = chunks[-1]['id']
        if file['language'] == 'solidity':
            for unit in result['units']:
                if unit['type'] not in ('function', 'modifier') or not unit.get('has_body', True):
                    continue
                body = source[unit['start']:unit['end']]
                role, evidence = labels(FUNCTION_ROLES, lexical_mask(body))
                if unit['type'] == 'function':
                    role.append('view' if unit.get('state_mutability') in ('view', 'pure') else 'state_changing')
                qualified = f"{unit['contract_name']}.{unit['name']}"
                chunks.append(record('function', unit['name'], unit['start'], unit['end'],
                                     f"{header}\n// {file['filename']} ({file['role']}), {unit['type']} {qualified}\n{body}",
                                     f"{unit['type']} {qualified}\n{body}",
                                     parent_id=artifact_id, contract_name=unit['contract_name'], declaration_kind=unit['type'],
                                     visibility=unit.get('visibility'), state_mutability=unit.get('state_mutability'),
                                     modifiers=unit.get('modifiers', []), function_role=role, metadata_evidence=evidence,
                                     tested_by=[], test_type=[]))
        else:
            chunks.extend(test_chunks(file, result, record, header, artifact_id))
    return chunks


def test_chunks(file, result, record, header, artifact_id):
    source = file['text']
    units = result['units']
    suites = {u['suite_id']: u for u in units if u['type'] == 'test_suite'}
    declarations = [u for u in units if u['type'] == 'declaration']
    hooks = [u for u in units if u['type'] == 'hook' and u['name'] in SETUP_HOOKS]
    out = []
    for case in (u for u in units if u['type'] == 'test_case'):
        chain, suite = [], case['parent_suite']
        while suite is not None:
            chain.insert(0, suite); suite = suites[suite]['parent_suite']
        scopes = [None] + chain
        path = ' > '.join(suites[s]['name'] for s in chain)
        body = source[case['start']:case['end']]
        setup_hooks = [h for h in hooks if h['parent_suite'] in chain]
        visible = [d for d in declarations if d['scope'] in scopes]
        # Requires always; other declarations only when referenced by the test, a hook, or an included declaration.
        included = [d for d in visible if d['scope'] is None and re.search(r'\brequire\s*\(', source[d['start']:d['end']])]
        needed = lexical_mask(body) + ''.join(lexical_mask(source[h['start']:h['end']]) for h in setup_hooks)
        for _ in range(4):
            added = [d for d in visible if d not in included and any(re.search(rf'(?<![\w$.]){re.escape(n)}(?![\w$])', needed) for n in d['names'])]
            if not added: break
            included += added
            needed += ''.join(lexical_mask(source[d['start']:d['end']]) for d in added)
        included.sort(key=lambda d: d['start'])
        parts = [header, f"// {file['filename']}: {path or '(top level)'} > {case['name']}"]
        parts += [source[d['start']:d['end']] for d in included]
        parts += [f"// {h['call']} of suite \"{suites[h['parent_suite']]['name']}\"\n{source[h['start']:h['end']]}" for h in setup_hooks]
        parts.append(body)
        test_type, evidence = labels(TEST_TYPES, body)
        if 'revert' not in test_type: test_type.insert(0, 'positive')
        out.append(record('test_case', case['name'], case['start'], case['end'], '\n'.join(parts) + '\n',
                          f"test {path + ' > ' if path else ''}{case['name']}\n{body}",
                          parent_id=artifact_id, suite_path=path, contract_name=None, test_type=test_type,
                          metadata_evidence=evidence, setup_hooks=len(setup_hooks), setup_declarations=len(included),
                          body_calls=sorted(set(re.findall(r'\.\s*([A-Za-z_$][\w$]*)\s*\(', lexical_mask(body)))),
                          asserted_events=sorted(set(re.findall(r'\.to\.emit\s*\([^,]+,\s*["\'](\w+)["\']', body))),
                          called_functions=[], function_role=[]))
    return out


def link_tests(chunks):
    functions = defaultdict(list)
    for c in chunks:
        if c['artifact_type'] == 'function' and c['declaration_kind'] == 'function':
            functions[(c['pair_id'], c['name'])].append(c)
    for c in chunks:
        if c['artifact_type'] != 'test_case': continue
        for name in c['body_calls']:
            for f in functions.get((c['pair_id'], name), []):
                c['called_functions'].append(dict(id=f['id'], contract=f['contract_name'], name=name, role=f['role']))
                f['tested_by'].append(c['id'])


# ---- retrieval ------------------------------------------------------------------------------------

def query_view(query, view):
    """'full' keeps the frozen server query; 'target_code' keeps only the solidityCode field."""
    if view == 'full': return query
    if view == 'target_code':
        marker = '\n\nsolidityCode: '
        return query.split(marker, 1)[1] if marker in query else query
    raise ValueError(f'unknown query view {view!r}')


class UnitRetriever:
    """One dense entry per structural unit; same encoder and exact L2 search as the baseline.

    Interface-compatible with advanced_rag.hybrid.HybridRetriever (chunks, entries, by_id, sha256, search)."""

    def __init__(self, chunks, cache_dir, types=INDEXED, view='full', vectors_cache=None):
        import faiss
        import numpy as np
        from sentence_transformers import SentenceTransformer
        started = time.perf_counter()
        self.chunks, self.view = chunks, view
        self.sha256 = chunks[0]['source_sha256']
        self.by_id = {c['id']: c for c in chunks}
        self.embedder = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu', cache_folder=str(cache_dir), local_files_only=True)
        tokenizer = self.embedder.tokenizer
        limit = self.embedder.max_seq_length
        selected = [c for c in chunks if c['artifact_type'] in types]
        self.entries = [dict(chunk_id=i, structural_id=c['id'], text=c['text'], embedding_text=c['embedding_text'],
                             embedding_truncated=len(tokenizer.encode(c['embedding_text'])) > limit)
                        for i, c in enumerate(selected)]
        key = sha(json.dumps([e['embedding_text'] for e in self.entries]))
        vectors = None
        if vectors_cache and Path(vectors_cache).with_suffix('.json').exists():
            meta = json.loads(Path(vectors_cache).with_suffix('.json').read_text(encoding='utf-8'))
            if meta.get('embedding_texts_sha256') == key:
                vectors = np.load(vectors_cache)
        if vectors is None:
            vectors = self.embedder.encode([e['embedding_text'] for e in self.entries], batch_size=32, show_progress_bar=False).astype('float32')
            if vectors_cache:
                np.save(vectors_cache, vectors)
                Path(vectors_cache).with_suffix('.json').write_text(json.dumps(dict(embedding_texts_sha256=key, entries=len(self.entries),
                    encoder='sentence-transformers/all-MiniLM-L6-v2', max_seq_length=limit)), encoding='utf-8')
        self.index = faiss.IndexFlatL2(vectors.shape[1])
        self.index.add(vectors)
        self.initialization_seconds = time.perf_counter() - started

    def search(self, query, top_k=10, filters=None, max_context_chars=15000):
        started = time.perf_counter()
        if top_k < 1: raise ValueError('top_k must be positive')
        filters = filters or {}
        if set(filters) - FILTERS: raise ValueError('Unknown metadata filter')
        vector = self.embedder.encode([query_view(query, self.view)], show_progress_bar=False).astype('float32')
        distances, indices = self.index.search(vector, len(self.entries))
        hits, used = [], 0
        for distance, index in zip(distances[0], indices[0]):
            entry = self.entries[int(index)]
            chunk = self.by_id[entry['structural_id']]
            if any(value not in (chunk.get(key) if isinstance(chunk.get(key), list) else [chunk.get(key)]) for key, value in filters.items()):
                continue
            if used + len(entry['text']) > max_context_chars:
                continue
            hits.append({**entry, 'distance': float(distance),
                         'metadata': {k: v for k, v in chunk.items() if k not in ('text', 'embedding_text')}})
            used += len(entry['text'])
            if len(hits) >= top_k: break
        return hits, time.perf_counter() - started


class TestPivotRetriever:
    """Delivers test cases only: a retrieved test is kept, a retrieved function is replaced by the tests that call it.

    Decision of 2026-09-30 (option b): functions act as entry points because code-to-code matching works, but the
    generator only receives tests. The rule wraps any base retriever (dense, hybrid, reranked) identically.
    For a function, at most `per_function` linked tests are taken, most focused first (fewest pair functions
    called), then in file order. Functions without linked tests are skipped."""

    def __init__(self, base, per_function=2, candidates=200):
        if per_function < 1: raise ValueError('per_function must be positive')
        self.base, self.per_function, self.candidates = base, per_function, candidates
        self.chunks, self.sha256 = base.chunks, base.sha256
        self.initialization_seconds = base.initialization_seconds
        dense = getattr(base, 'dense', base)
        self.by_id = dense.by_id
        self.entry_of = {e['structural_id']: e for e in dense.entries}
        self.last_trace = {}

    def linked_tests(self, function):
        tests = [self.by_id[t] for t in dict.fromkeys(function['tested_by'])]
        return sorted(tests, key=lambda t: (len({f['name'] for f in t['called_functions']}), t['artifact_id'], t['start_char']))[:self.per_function]

    def search(self, query, top_k=10, filters=None, max_context_chars=15000):
        started = time.perf_counter()
        ranked, _ = self.base.search(query, top_k=self.candidates, filters=filters, max_context_chars=10**12)
        hits, seen, used, steps = [], set(), 0, []
        for hit in ranked:
            chunk = self.by_id[hit['structural_id']]
            if chunk['artifact_type'] == 'test_case':
                tests, via = [chunk], None
            else:
                tests, via = self.linked_tests(chunk), chunk['id']
            steps.append(dict(retrieved=chunk['id'], type=chunk['artifact_type'], delivered=[t['id'] for t in tests]))
            for test in tests:
                if test['id'] in seen or used + len(test['text']) > max_context_chars:
                    continue
                entry = self.entry_of[test['id']]
                hits.append({**entry, 'distance': hit.get('distance'), 'via_function': via, 'retrieved_rank': len(steps),
                             'metadata': {k: v for k, v in test.items() if k not in ('text', 'embedding_text')}})
                seen.add(test['id']); used += len(test['text'])
                if len(hits) >= top_k: break
            if len(hits) >= top_k: break
        self.last_trace = dict(base_trace=getattr(self.base, 'last_trace', None), pivot_steps=steps,
                               selected=[h['chunk_id'] for h in hits], context_chars=used, per_function=self.per_function)
        return hits, time.perf_counter() - started


class FunctionDecomposedRetriever:
    """Advanced v3 (2026-10-01): one retrieval per public target function, code-to-code.

    For each public/external function of the target (parsed from the solidityCode field of the query), corpus
    functions are ranked by hybrid BM25 + dense (RRF) and by the cross-encoder fed with the target function code
    (not the instructions); both rankings are fused by RRF. The best corpus functions that have linked tests are
    replaced by those tests (pivot), and tests are taken round-robin across target functions until top_k or budget."""

    def __init__(self, hybrid, reranker=None, parser_package=None, per_target=8, per_function=2, constant=60):
        self.hybrid, self.reranker, self.parser_package = hybrid, reranker, parser_package
        self.per_target, self.per_function, self.constant = per_target, per_function, constant
        self.chunks, self.sha256 = hybrid.chunks, hybrid.sha256
        self.initialization_seconds = hybrid.initialization_seconds
        self.by_id = hybrid.dense.by_id
        self.entry_of = {e['structural_id']: e for e in hybrid.dense.entries}
        self.pivot = TestPivotRetriever(hybrid, per_function=per_function)
        self.last_trace = {}

    def target_functions(self, source):
        result = run_parser([dict(id='target', language='solidity', text=source)], self.parser_package)[0]
        units = [u for u in result['units'] if u['type'] == 'function' and u.get('has_body') and u['name'] not in ('constructor', 'receive', 'fallback')
                 and (u.get('visibility') in ('public', 'external', 'default', None))]
        return [(u['name'], source[u['start']:u['end']]) for u in units]

    def search(self, query, top_k=10, filters=None, max_context_chars=15000):
        from .hybrid import rrf
        started = time.perf_counter()
        source = query_view(query, 'target_code')
        queues, trace = [], []
        for name, code in self.target_functions(source):
            hits, _ = self.hybrid.search(code, top_k=self.per_target, filters={'artifact_type': 'function'}, max_context_chars=10**12)
            ids = [h['chunk_id'] for h in hits]
            ranking = ids
            if self.reranker and ids:
                scores = self.reranker.score(code, [self.hybrid.entries[i]['embedding_text'] for i in ids])
                by_ce = [i for _, i in sorted(zip(scores, ids), key=lambda p: -p[0])]
                ranking, _ = rrf([ids, by_ce], self.constant)
            tests = []
            for i in ranking:
                for t in self.pivot.linked_tests(self.by_id[self.hybrid.entries[i]['structural_id']]):
                    tests.append((t, self.hybrid.entries[i]['structural_id']))
            queues.append(tests)
            trace.append(dict(target_function=name, corpus_functions=[self.hybrid.entries[i]['structural_id'] for i in ranking],
                              candidate_tests=[t['id'] for t, _ in tests]))
        hits, seen, used = [], set(), 0
        while queues and len(hits) < top_k:
            progressed = False
            for queue in queues:
                while queue:
                    test, via = queue.pop(0)
                    if test['id'] in seen or used + len(test['text']) > max_context_chars: continue
                    entry = self.entry_of[test['id']]
                    hits.append({**entry, 'distance': None, 'via_function': via,
                                 'metadata': {k: v for k, v in test.items() if k not in ('text', 'embedding_text')}})
                    seen.add(test['id']); used += len(test['text']); progressed = True
                    break
                if len(hits) >= top_k: break
            if not progressed: break
        self.last_trace = dict(target_functions=trace, selected=[h['chunk_id'] for h in hits], context_chars=used,
                               per_target=self.per_target, per_function=self.per_function, reranker_input='target function code')
        return hits, time.perf_counter() - started
