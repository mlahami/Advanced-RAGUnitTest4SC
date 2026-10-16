"""Offline checks and immutable identities for controlled generation runs."""
import hashlib
import json
from pathlib import Path

PROTOCOL_VERSION = 'controlled-fixtures-v2'
TARGET_COVERAGE = 'target-contract-only; benchmark fixtures excluded'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def input_identity(folder, items, fixture_metadata, fixture_block):
    """Validate every input before any API call, including target/prompt consistency."""
    from fixture_support import COMMON_FIXTURE_RULE, LEGACY_FIXTURE_RULE
    folder = Path(folder)
    config = json.loads((folder/'config.json').read_text(encoding='utf-8'))
    for key, expected in fixture_metadata.items():
        if config.get(key) != expected:
            raise ValueError(f'Prompt fixture metadata mismatch: {key}')
    files = {'config.json': sha(folder/'config.json')}
    for item in items:
        name = item['id']
        prompt = (folder/name/'prompt.txt').read_text(encoding='utf-8')
        request = json.loads((folder/name/'request.json').read_text(encoding='utf-8'))
        if LEGACY_FIXTURE_RULE in prompt or COMMON_FIXTURE_RULE not in prompt:
            raise ValueError(f'{name}: conflicting or missing fixture policy')
        if prompt.count('BENCHMARK FIXTURES (identical for every experimental configuration):') != 1 or fixture_block not in prompt:
            raise ValueError(f'{name}: missing, duplicate, or stale fixture catalogue')
        if not request.get('solidityCode') or request['solidityCode'] not in prompt:
            raise ValueError(f'{name}: missing target source in prompt')
        for filename in ['prompt.txt', 'request.json', 'retrieval-trace.json', 'target-inventory.json']:
            path = folder/name/filename
            if filename != 'target-inventory.json' or path.exists():
                files[f'{name}/{filename}'] = sha(path)
    return files


def check_resume(previous, current):
    keys = set(previous) | set(current)
    changed = sorted(k for k in keys if k != 'generation_started_utc' and previous.get(k) != current.get(k))
    if changed:
        raise ValueError('Run protocol changed; use a new run directory: ' + ', '.join(changed))


def execution_status(execution, passed, failed, pending):
    if execution.get('timeout'):
        return 'execution_timeout'
    if failed:
        return 'test_failures'
    if execution.get('exit_code') != 0 or not passed:
        return 'execution_error'
    if pending:
        return 'incomplete_tests'
    return 'passed'
