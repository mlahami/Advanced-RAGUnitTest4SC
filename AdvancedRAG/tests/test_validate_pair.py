import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "corpus_v2"))
import validate_pair as vp  # noqa: E402

TIPJAR = """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TipJar {
    address public immutable keeper;
    uint256 public total;
    event Tipped(address indexed from, uint256 amount);

    constructor() { keeper = msg.sender; }

    function tip() external payable {
        require(msg.value > 0, "empty tip");
        total += msg.value;
        emit Tipped(msg.sender, msg.value);
    }

    function sweep() external {
        require(msg.sender == keeper, "not keeper");
        uint256 amount = address(this).balance;
        (bool ok, ) = keeper.call{value: amount}("");
        require(ok, "transfer failed");
    }
}
"""

TIPJAR_TEST = """const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TipJar", function () {
  let jar, keeper, alice;
  beforeEach(async function () {
    [keeper, alice] = await ethers.getSigners();
    jar = await ethers.deployContract("TipJar");
    await jar.waitForDeployment();
  });
  it("records tips and emits Tipped", async function () {
    await expect(jar.connect(alice).tip({ value: ethers.parseEther("1") }))
      .to.emit(jar, "Tipped").withArgs(alice.address, ethers.parseEther("1"));
    expect(await jar.total()).to.equal(ethers.parseEther("1"));
  });
  it("rejects empty tips", async function () {
    await expect(jar.tip({ value: 0n })).to.be.revertedWith("empty tip");
  });
  it("lets only the keeper sweep", async function () {
    await jar.connect(alice).tip({ value: 5n });
    await expect(jar.connect(alice).sweep()).to.be.revertedWith("not keeper");
    await expect(jar.sweep()).to.changeEtherBalances([jar, keeper], [-5n, 5n]);
  });
});
"""


def make_pair(root, name="tipjar", contract=TIPJAR, test=TIPJAR_TEST, **manifest):
    pair = Path(root) / name
    (pair / "contracts").mkdir(parents=True)
    (pair / "test").mkdir()
    (pair / "contracts/TipJar.sol").write_text(contract, encoding="utf-8")
    (pair / "test/TipJar.test.js").write_text(test, encoding="utf-8")
    (pair / "LICENSE").write_text("MIT License\n", encoding="utf-8")
    data = dict(id=name, domain="payments", level="simple", origin="human", targets=["TipJar.sol"],
                source=dict(repository="https://github.com/example/tipjar", commit="a" * 40, license="MIT",
                            contract_paths=["contracts/TipJar.sol"], test_paths=["test/TipJar.test.js"],
                            license_file="LICENSE"))
    data.update(manifest)
    (pair / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
    return pair


class StaticChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.refs = vp.benchmark_references()

    def tearDown(self):
        self.tmp.cleanup()

    def test_ethers5_idioms_and_helpers_are_rejected(self):
        test = TIPJAR_TEST.replace("await jar.waitForDeployment();", "await jar.deployed();\n    const u = ethers.utils.parseEther('1');")
        test = test.replace('const { ethers } = require("hardhat");', 'const { ethers } = require("hardhat");\nconst h = require("./helpers");')
        report = vp.validate(make_pair(self.tmp.name, test=test), run=False, references=self.refs)
        errors = " | ".join(report["errors"])
        self.assertFalse(report["accepted"])
        for expected in [".deployed()", "ethers.utils", "undeclared require './helpers'"]:
            self.assertIn(expected, errors)

    def test_network_helpers_and_matcher_utilities_are_allowed(self):
        test = TIPJAR_TEST.replace('const { ethers } = require("hardhat");',
            'const { ethers } = require("hardhat");\nconst { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");\n'
            'const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");')
        report = vp.validate(make_pair(self.tmp.name, test=test), run=False, references=self.refs)
        self.assertTrue(report["accepted"], report["errors"])

    def test_unavailable_solidity_imports_are_rejected(self):
        contract = TIPJAR.replace("pragma solidity ^0.8.24;", 'pragma solidity ^0.8.24;\nimport "solmate/tokens/ERC20.sol";\nimport "@openzeppelin/contracts/access/Ownable.sol";')
        report = vp.validate(make_pair(self.tmp.name, contract=contract), run=False, references=self.refs)
        self.assertEqual([e for e in report["errors"] if "import" in e], ["TipJar.sol: import 'solmate/tokens/ERC20.sol' not available in the frozen project"])

    def test_manifest_requires_provenance_and_accepted_licence(self):
        pair = make_pair(self.tmp.name, level="hard", source=dict(repository="local", commit="abc", license="Proprietary"))
        errors = " | ".join(vp.validate(pair, run=False, references=self.refs)["errors"])
        for expected in ["level must be", "public GitHub/GitLab URL", "full SHA-1", "not accepted", "contract_paths missing"]:
            self.assertIn(expected, errors)

    def test_missing_licence_file_is_rejected(self):
        pair = make_pair(self.tmp.name)
        (pair / "LICENSE").unlink()
        errors = " | ".join(vp.validate(pair, run=False, references=self.refs)["errors"])
        self.assertIn("no licence file", errors)

    def test_renamed_benchmark_contract_is_flagged_as_leak(self):
        counter = self.refs["Counter.sol"].replace("Counter", "Tally").replace("count", "total").replace("underflow", "too low")
        report = vp.validate(make_pair(self.tmp.name, contract=counter), run=False, references=self.refs)
        self.assertTrue(any(e.startswith("leakage: TipJar.sol close to benchmark Counter.sol") for e in report["errors"]))

    @unittest.skipUnless((ROOT / "data/oracle-pool-v1/contracts/Poll.sol").exists(), "oracle pool not included in the replication package")
    def test_same_domain_but_different_contract_is_not_flagged(self):
        poll = (ROOT / "data/oracle-pool-v1/contracts/Poll.sol").read_text(encoding="utf-8")
        report = vp.validate(make_pair(self.tmp.name, contract=poll), run=False, references=self.refs)
        self.assertEqual(report["leakage"]["flagged"], [])

    def test_report_records_file_hashes(self):
        report = vp.validate(make_pair(self.tmp.name), run=False, references=self.refs)
        self.assertEqual(set(report["files_sha256"]), {"manifest.json", "LICENSE", "contracts/TipJar.sol", "test/TipJar.test.js"})
        self.assertEqual(len(report["pair_sha256"]), 64)


class ImportChecks(unittest.TestCase):
    def test_relative_imports_are_flattened_and_recorded(self):
        import import_pair
        code = 'import "../interfaces/IPool.sol";\nimport {Lib} from "./lib/Lib.sol";\nimport "@openzeppelin/contracts/token/ERC20/ERC20.sol";\nimport "hardhat/console.sol";\n'
        out, changes = import_pair.rewrite_imports(code, {"IPool.sol", "Lib.sol"}, "Pool.sol")
        self.assertIn('import "./IPool.sol";', out)
        self.assertIn('import {Lib} from "./Lib.sol";', out)
        self.assertIn('"@openzeppelin/contracts/token/ERC20/ERC20.sol"', out)
        self.assertIn('"hardhat/console.sol"', out)
        self.assertEqual([c["before"] for c in changes], ["../interfaces/IPool.sol", "./lib/Lib.sol"])
        self.assertEqual(vp.check_solidity_code("Pool.sol", out, {"Pool.sol", "IPool.sol", "Lib.sol"}), [])


class ExecutionChecks(unittest.TestCase):
    """Runs the frozen ethers 6 Hardhat project (about 20 s per pair)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def test_valid_pair_is_accepted_with_target_coverage(self):
        report = vp.validate(make_pair(self.tmp.name, name="tipjar-ok"))
        self.assertTrue(report["accepted"], report["errors"])
        self.assertEqual(report["execution"]["test"]["mocha"]["passes"], 3)
        self.assertGreaterEqual(report["execution"]["coverage"]["targets"]["TipJar.sol"]["statements"], 80)

    def test_failing_and_undercovering_pair_is_rejected(self):
        test = TIPJAR_TEST.replace('.to.be.revertedWith("empty tip")', '.to.be.revertedWith("wrong message")')
        test = test.split('  it("lets only the keeper sweep"')[0] + "});\n"
        report = vp.validate(make_pair(self.tmp.name, name="tipjar-bad", test=test))
        errors = " | ".join(report["errors"])
        self.assertFalse(report["accepted"])
        self.assertIn("1 failing test(s)", errors)
        self.assertIn("coverage: TipJar.sol statements", errors)


if __name__ == "__main__":
    unittest.main()
