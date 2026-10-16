import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from advanced_rag.corpus_v2 import build_chunks, md_blocks, query_view, TestPivotRetriever

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = None if (ROOT / 'node_modules/@solidity-parser/parser').exists() else \
    ROOT.parent / 'RAGUnitTest4SC-/src/main/resources/HardhatProject/package.json'

CONTRACT = """pragma solidity ^0.8.20;
contract TipJar {
    address public owner;
    event Tipped(address from, uint256 amount);
    constructor() { owner = msg.sender; }
    function tip() external payable { require(msg.value > 0, "zero"); emit Tipped(msg.sender, msg.value); }
    function withdraw() external { require(msg.sender == owner, "not owner"); payable(owner).transfer(address(this).balance); }
}"""
TESTS = """const { expect } = require("chai");
const { ethers } = require("hardhat");
const UNUSED = 42;
const ONE = ethers.parseEther("1");
describe("TipJar", function () {
  let jar, owner, other;
  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    jar = await ethers.deployContract("TipJar");
  });
  afterEach(async function () { jar = undefined; });
  describe("tip", function () {
    it("emits Tipped", async function () {
      await expect(jar.connect(other).tip({ value: ONE })).to.emit(jar, "Tipped");
    });
    it("reverts on zero", async function () {
      await expect(jar.tip()).to.be.revertedWith("zero");
    });
  });
});"""


def make_corpus(root):
    corpus = Path(root)
    pair = corpus / 'pairs/tipjar--example'
    (pair / 'contracts').mkdir(parents=True)
    (pair / 'test').mkdir()
    (pair / 'contracts/TipJar.sol').write_text(CONTRACT, encoding='utf-8')
    (pair / 'test/TipJar.test.js').write_text(TESTS, encoding='utf-8')
    md = (f"# tipjar--example\n\n- domain: payments\n\n## Contract: TipJar.sol (primary target)\n\n```solidity\n{CONTRACT}\n```\n\n"
          f"## Tests: TipJar.test.js\n\n```javascript\n{TESTS}\n```\n")
    (corpus / 'md').mkdir()
    (corpus / 'md/tipjar--example.md').write_text(md, encoding='utf-8', newline='\n')
    md_sha = hashlib.sha256((corpus / 'md/tipjar--example.md').read_bytes()).hexdigest()
    entry = dict(id='tipjar--example', domain='payments', domain_group='escrow-conditional-payments', level='simple',
                 md='tipjar--example.md', md_sha256=md_sha, repository='https://github.com/example/tipjar', commit='a' * 40)
    (corpus / 'corpus_manifest.json').write_text(json.dumps(dict(entries=[entry])), encoding='utf-8')
    frozen = dict(pairs=1, corpus_sha256=hashlib.sha256(json.dumps([(entry['id'], md_sha)]).encode()).hexdigest(),
                  corpus_manifest_sha256=hashlib.sha256((corpus / 'corpus_manifest.json').read_bytes()).hexdigest())
    (corpus / 'CORPUS_FROZEN.json').write_text(json.dumps(frozen), encoding='utf-8')
    return corpus


class CorpusV2Index(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.corpus = make_corpus(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_md_blocks_have_exact_offsets(self):
        text = (self.corpus / 'md/tipjar--example.md').read_text(encoding='utf-8')
        blocks = md_blocks(text)
        self.assertEqual([(b['filename'], b['role']) for b in blocks], [('TipJar.sol', 'primary target'), ('TipJar.test.js', 'test')])
        self.assertEqual(text[blocks[1]['start']:blocks[1]['end']], TESTS)

    def test_test_case_carries_its_setup_and_links(self):
        chunks, report = build_chunks(self.corpus, PACKAGE)
        self.assertEqual(report['parse_status'], {'ast': 2})
        tests = {c['name']: c for c in chunks if c['artifact_type'] == 'test_case'}
        emits = tests['emits Tipped']
        self.assertEqual(emits['suite_path'], 'TipJar > tip')
        for needed in ['require("chai")', 'let jar, owner, other;', 'const ONE', 'beforeEach(', 'it("emits Tipped"']:
            self.assertIn(needed, emits['text'])
        self.assertNotIn('UNUSED', emits['text'])      # unreferenced declaration
        self.assertNotIn('afterEach', emits['text'])   # only setup hooks
        self.assertNotIn('beforeEach', emits['embedding_text'])
        self.assertEqual([f['name'] for f in emits['called_functions']], ['tip'])
        self.assertIn('event', emits['test_type'])
        self.assertIn('revert', tests['reverts on zero']['test_type'])
        tip = next(c for c in chunks if c['artifact_type'] == 'function' and c['name'] == 'tip')
        self.assertEqual(len(tip['tested_by']), 2)
        self.assertIn('payment', tip['function_role'])
        for c in chunks:
            md = (self.corpus / 'md/tipjar--example.md').read_text(encoding='utf-8')
            if c['artifact_type'] != 'test_case':
                self.assertTrue(c['text'].endswith(md[c['start_char']:c['end_char']]))

    def test_modified_corpus_is_refused(self):
        path = self.corpus / 'md/tipjar--example.md'
        path.write_text(path.read_text(encoding='utf-8').replace('zero', 'nil'), encoding='utf-8', newline='\n')
        with self.assertRaises(ValueError):
            build_chunks(self.corpus, PACKAGE)

    def test_pivot_replaces_functions_by_their_tests(self):
        chunks, _ = build_chunks(self.corpus, PACKAGE)
        indexed = [c for c in chunks if c['artifact_type'] in ('function', 'test_case')]
        entries = [dict(chunk_id=i, structural_id=c['id'], text=c['text'], embedding_text=c['embedding_text']) for i, c in enumerate(indexed)]
        by_id = {c['id']: c for c in chunks}
        order = [next(e for e in entries if by_id[e['structural_id']]['name'] == n) for n in ['withdraw', 'tip', 'reverts on zero']]

        class Fake:
            initialization_seconds = 0
            def __init__(self): self.chunks, self.sha256, self.by_id, self.entries = chunks, 'x', by_id, entries
            def search(self, query, top_k=10, filters=None, max_context_chars=0):
                return [dict(e, distance=float(i)) for i, e in enumerate(order)], 0

        hits, _ = TestPivotRetriever(Fake(), per_function=1).search('q')
        # withdraw has no test: skipped; tip -> its most focused test; the directly retrieved test is not repeated.
        self.assertEqual([h['metadata']['name'] for h in hits], ['emits Tipped', 'reverts on zero'])
        self.assertTrue(all(h['metadata']['artifact_type'] == 'test_case' for h in hits))
        self.assertIsNotNone(hits[0]['via_function'])
        self.assertIsNone(hits[1]['via_function'])

    def test_query_views(self):
        query = 'context: x\n\nrequirements: y\n\nsolidityCode: contract A {}'
        self.assertEqual(query_view(query, 'full'), query)
        self.assertEqual(query_view(query, 'target_code'), 'contract A {}')


if __name__ == '__main__':
    unittest.main()
