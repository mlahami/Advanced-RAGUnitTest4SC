"""Exact source spans, strict AST units, and explicitly labelled lexical fallback."""
from bisect import bisect_right
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

VERSION = 'code-aware-v2'
HEADER = re.compile(r'^\s*(?:(?:Contract|Tests?)\s*:\s*)?([\w.$-]+\.(?:sol|js|ts))\s*(?:file\s*)?:?\s*$', re.I | re.M)
PAGE = re.compile(r'^## Page (\d+)[^\n]*', re.M)

def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def mask_pages(text):
    return PAGE.sub(lambda m: ' ' * len(m.group()), text)

def lexical_mask(text):
    """Hide strings/comments without changing offsets; not a syntax validator."""
    result = list(text)
    pattern = re.compile(r'//[^\n]*|/\*[\s\S]*?(?:\*/|$)|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|`(?:\\.|[^`\\])*`')
    for match in pattern.finditer(text):
        for pos in range(match.start(), match.end()):
            if text[pos] != '\n':
                result[pos] = ' '
    return ''.join(result)

def balanced_end(masked, start, opening, closing):
    stack = []
    pairs = {')':'(', ']':'[', '}':'{'}
    for pos in range(start, len(masked)):
        char = masked[pos]
        if char in '([{':
            stack.append(char)
        elif char in pairs:
            if not stack or stack.pop() != pairs[char]:
                return None
            if not stack:
                return pos + 1
    return None

def fallback_units(text, language):
    masked = lexical_mask(text)
    units = []
    if language == 'solidity':
        pattern = re.compile(r'\b(contract|library|interface|function|constructor|receive|fallback|modifier|event|error)\b\s*([A-Za-z_$][\w$]*)?')
        for match in pattern.finditer(masked):
            keyword, name = match.groups()
            kind = 'contract' if keyword in ('contract','library','interface') else 'function' if keyword in ('constructor','receive','fallback') else keyword
            tail = re.search(r'[;{]', masked[match.end():])
            if not tail:
                continue
            delimiter = match.end() + tail.start()
            if keyword in ('contract','library','interface') and (
                masked[delimiter] != '{' or not re.fullmatch(r'\s*(?:is\s+[\w\s,().]+)?', masked[match.end():delimiter])):
                continue
            end = delimiter + 1 if masked[delimiter] == ';' else balanced_end(masked, delimiter, '{','}')
            if end:
                units.append(dict(type=kind, name=name or keyword, start=match.start(), end=end))
    else:
        pattern = re.compile(r'\b(describe|context|contract|suite|it|test|specify)(?:\s*\.\s*(?:only|skip))?\s*\(')
        for match in pattern.finditer(masked):
            start_paren = masked.rfind('(', match.start(), match.end())
            end = balanced_end(masked, start_paren, '(', ')')
            if end:
                title = re.match(r'\s*([\x27"`])([\s\S]*?)\1', text[start_paren+1:])
                units.append(dict(type='test_case' if match[1] in ('it','test','specify') else 'test_suite',
                    name=title[2] if title else '<dynamic title>', start=match.start(), end=end))
    return units

def infer_metadata(name, text, filename, language):
    """Heuristic labels with evidence; unknown is explicit, not a guessed standard."""
    labels = {'contract_family':[], 'tested_behavior':[], 'test_type':[], 'testing_framework':[]}
    evidence = []
    # Identity hints only: mentions in comments/body do not establish family.
    family_text = filename + ' ' + name
    rules = {
        'contract_family': {'ERC20':r'\b(?:I?ERC20\w*|ERC[ -]20)\b', 'ERC721':r'\b(?:I?ERC721\w*|ERC[ -]721)\b',
            'ERC1155':r'\b(?:I?ERC1155\w*|ERC[ -]1155)\b', 'voting':r'\b(?:voting|vote|ballot)\b',
            'DeFi':r'\b(?:flashloan|lending|liquidity|staking|swap)\b'},
        'tested_behavior': {'transfer':r'\b\w*transfer\w*\b', 'minting':r'\b\w*mint\w*\b',
            'burning':r'\b\w*burn\w*\b', 'authorization':r'\b(?:onlyOwner|onlyRole|approve|allowance|grantRole|revokeRole|authorized|unauthorized)\b',
            'voting':r'\b\w*vot\w*\b', 'storage':r'\b(?:storedData|storedWord|storage)\b|\.\s*(?:set|get|setWord|getWord)\s*\('},
        'test_type': {'negative':r'\b(?:revert\w*|reject\w*|invalid|unauthorized|fail\w*)\b',
            'boundary':r'\b(?:MaxUint\w*|zero|overflow|underflow|boundary|maximum|minimum)\b',
            'security':r'\b(?:reentran\w*|attack\w*|malicious|exploit\w*)\b',
            'positive':r'\b(?:success\w*|should allow|should accept|correctly)\b'},
        'testing_framework': {'Hardhat':r'\bhardhat\b', 'Chai':r'\bchai\b',
            'Mocha':r'\b(?:describe|it|beforeEach)\s*\(', 'Truffle':r'\bartifacts\s*\.\s*require\b'}
    }
    for field, options in rules.items():
        if field in ('test_type','testing_framework') and language != 'javascript':
            continue
        for label, regex in options.items():
            haystack = family_text if field == 'contract_family' else name + '\n' + text
            if field == 'tested_behavior':
                haystack = lexical_mask(text)
            match = re.search(regex, haystack, re.I)
            if match:
                labels[field].append(label)
                evidence.append(dict(field=field,label=label,matched_text=match.group(),method='lexical_heuristic'))
    mentions = [label for label, regex in rules['contract_family'].items() if re.search(regex,text,re.I)]
    return {**labels, 'family_mentions':mentions, 'behavior_scope':'code_mentions_may_include_setup',
            'metadata_evidence':evidence, 'metadata_status':'heuristic_not_validated'}

def build_chunks(corpus, parser_package=None):
    raw = Path(corpus).read_bytes()
    text = raw.decode('utf-8')  # retain original CRLF and exact character offsets
    corpus_hash = hashlib.sha256(raw).hexdigest()
    headings = list(HEADER.finditer(text))
    if not headings:
        raise ValueError('No source artifact headings recognized')
    lines = [0] + [m.end() for m in re.finditer('\n', text)]
    pages = [(m.start(), int(m[1])) for m in PAGE.finditer(text)]
    artifacts = []
    for index, heading in enumerate(headings):
        start, end = heading.end(), headings[index+1].start() if index+1 < len(headings) else len(text)
        filename = heading[1]
        artifacts.append(dict(id=sha(f'{corpus_hash}:artifact:{start}:{end}')[:24], filename=filename,
            start=start,end=end,language='solidity' if filename.lower().endswith('.sol') else 'javascript',
            text=mask_pages(text[start:end])))
    env = os.environ.copy()
    if parser_package:
        env['AR_PARSER_PACKAGE'] = str(Path(parser_package).resolve())
    process = subprocess.run(['node',str(Path(__file__).with_name('parse_artifacts.cjs'))],
        input=json.dumps(artifacts).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=120)
    if process.returncode:
        raise RuntimeError('Node parser failed: ' + process.stderr.decode('utf-8', errors='replace')[:1000])
    parsed = json.loads(process.stdout)
    chunks, diagnostics = [], []
    for artifact, result in zip(artifacts, parsed):
        units = result['units'] if result['status'] == 'ast' else fallback_units(artifact['text'], artifact['language'])
        # The whole source artifact is always retained, including text not understood by parsers.
        records = [dict(type='source_artifact',name=artifact['filename'],start=0,end=len(artifact['text']))] + units
        dedup = {(r['type'],r['start'],r['end']): r for r in records}
        local = []
        for unit in dedup.values():
            start, end = artifact['start'] + unit['start'], artifact['start'] + unit['end']
            if not artifact['start'] <= start < end <= artifact['end']:
                raise ValueError('Invalid parser offsets')
            source = text[start:end]
            identifier = sha(f'{VERSION}:{corpus_hash}:{unit["type"]}:{start}:{end}')[:24]
            metadata = infer_metadata(unit['name'], mask_pages(source), artifact['filename'], artifact['language'])
            selected_pages = [page for offset,page in pages if start <= offset < end]
            previous = [page for offset,page in pages if offset <= start]
            if previous:
                selected_pages.insert(0, previous[-1])
            local.append(dict(id=identifier, artifact_id=artifact['id'],artifact_type=unit['type'], name=unit['name'],
                declaration_kind=unit.get('declaration_kind'),
                language=artifact['language'],source_file=artifact['filename'],source_sha256=corpus_hash,
                start_char=start,end_char=end,start_line=bisect_right(lines,start),end_line=bisect_right(lines,end-1),
                pages=sorted(set(selected_pages)),text=source,parser='strict_ast' if result['status']=='ast' else 'lexical_fallback',
                parse_error=result.get('error'),parent_id=None,**metadata))
        for chunk in local:
            candidates = [p for p in local if p['id'] != chunk['id'] and p['start_char'] <= chunk['start_char']
                and p['end_char'] >= chunk['end_char'] and
                (p['end_char']-p['start_char'] > chunk['end_char']-chunk['start_char'] or p['artifact_type']=='source_artifact')]
            if chunk['artifact_type'] != 'source_artifact' and candidates:
                chunk['parent_id'] = min(candidates,key=lambda p:p['end_char']-p['start_char'])['id']
            if artifact['language'] == 'javascript':
                file_meta = infer_metadata(artifact['filename'],artifact['text'],artifact['filename'],artifact['language'])
                for label in file_meta['testing_framework']:
                    if label not in chunk['testing_framework']:
                        chunk['testing_framework'].append(label)
                        chunk['metadata_evidence'].extend({**e,'scope':'source_artifact'} for e in file_meta['metadata_evidence']
                            if e['field']=='testing_framework' and e['label']==label)
            contracts = [p for p in local if p['artifact_type']=='contract' and p['start_char'] <= chunk['start_char'] < p['end_char']]
            chunk['contract_name'] = min(contracts,key=lambda p:p['end_char']-p['start_char'])['name'] if contracts else None
            chunk['requires_parent_context'] = chunk['artifact_type']=='test_case'
            chunk['solidity_elements'] = [{'kind':p['artifact_type'],'name':p['name']} for p in local
                if p['artifact_type'] in ('function','modifier','event','error') and chunk['start_char'] <= p['start_char'] < chunk['end_char']]
        chunks.extend(local)
        diagnostics.append(dict(artifact_id=artifact['id'],source_file=artifact['filename'],status=result['status'],
            parse_error=result.get('error'),units=len(units),start_char=artifact['start'],end_char=artifact['end']))
    report = dict(version=VERSION,source_sha256=corpus_hash,source_bytes=len(raw),
        artifact_count=len(artifacts),chunk_count=len(chunks),
        artifact_types={kind:sum(c['artifact_type']==kind for c in chunks) for kind in
            ('source_artifact','contract','function','modifier','event','error','test_suite','test_case')},
        parse_status=dict(Counter(d['status'] for d in diagnostics)),diagnostics=diagnostics,
        limitations=['Metadata labels are lexical hints, not validated ground truth.',
                    'PDF transcription is not repaired. Failed parses use explicitly labelled lexical fallback.',
                    'Whole source artifacts preserve text not understood as code.',
                    'A test case may depend on imports, fixtures, helpers and parent suites; it is not standalone.'])
    return chunks, report
