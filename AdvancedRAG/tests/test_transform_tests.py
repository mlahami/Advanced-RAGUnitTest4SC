import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "corpus_v2"))
sys.path.insert(0, str(ROOT / "tests"))
import transform_tests as tt  # noqa: E402
import validate_pair as vp  # noqa: E402
from test_validate_pair import make_pair  # noqa: E402

TIPJAR_TS = """import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TipJar } from "../typechain-types";

describe("TipJar", function () {
  async function deploy(): Promise<{ jar: TipJar; keeper: HardhatEthersSigner; alice: HardhatEthersSigner }> {
    const [keeper, alice] = await ethers.getSigners();
    const jar = (await ethers.deployContract("TipJar")) as unknown as TipJar;
    await jar.waitForDeployment();
    return { jar, keeper, alice };
  }

  it("records tips and emits Tipped", async function () {
    const { jar, alice } = await loadFixture(deploy);
    const amount: bigint = ethers.parseEther("1");
    await expect(jar.connect(alice).tip({ value: amount })).to.emit(jar, "Tipped").withArgs(alice.address, amount);
    expect(await jar.total()).to.equal(amount);
  });

  it("rejects empty tips", async function () {
    const { jar } = await loadFixture(deploy);
    await expect(jar.tip({ value: 0n })).to.be.revertedWith("empty tip");
  });

  it("lets only the keeper sweep", async function () {
    const { jar, keeper, alice } = await loadFixture(deploy);
    await jar.connect(alice).tip({ value: 5n });
    await expect(jar.connect(alice).sweep()).to.be.revertedWith("not keeper");
    await expect(jar.sweep()).to.changeEtherBalances([jar, keeper], [-5n, 5n]);
    expect(hre.network.name).to.equal("hardhat");
  });
});
"""


class TransformTests(unittest.TestCase):
    def test_typescript_becomes_commonjs_without_types(self):
        code, name, changes = tt.transform_test(TIPJAR_TS, "TipJar.test.ts")
        self.assertEqual(name, "TipJar.test.js")
        self.assertNotRegex(code, r"^\s*import\s", "no ES import left")
        for fragment in [": TipJar", "HardhatEthersSigner", "as unknown", "Promise<", "typechain-types", "hardhat-toolbox"]:
            self.assertNotIn(fragment, code)
        self.assertIn('const { expect } = require("chai");', code)
        self.assertIn('const hre = require("hardhat");', code)
        self.assertIn('const { ethers } = require("hardhat");', code)
        self.assertIn('const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");', code)
        self.assertIn('const amount = ethers.parseEther("1");', code)
        kinds = [c["kind"] for c in changes]
        self.assertEqual(kinds[:2], ["ts-type-strip", "esm-to-cjs"])
        elided = {m for c in changes if c["kind"] == "type-only-import-elided" for m in [c["module"]]}
        self.assertEqual(elided, {"../typechain-types"})
        self.assertIn("test-import-path", kinds)

    def test_string_literals_are_never_touched(self):
        code, _, _ = tt.transform_test('const x: string = "a   b ;";\nit("t  ,", () => {});\n', "a.ts")
        self.assertIn('"a   b ;"', code)
        self.assertIn('"t  ,"', code)

    def test_runtime_typechain_factory_is_kept_and_then_rejected(self):
        ts = TIPJAR_TS.replace('import { TipJar } from "../typechain-types";', 'import { TipJar, TipJar__factory } from "../typechain-types";')
        ts = ts.replace('const [keeper, alice] = await ethers.getSigners();', 'const [keeper, alice] = await ethers.getSigners();\n    new TipJar__factory(keeper);')
        code, _, _ = tt.transform_test(ts, "TipJar.test.ts")
        self.assertIn('const { TipJar__factory } = require("../typechain-types");', code)
        self.assertTrue(any("undeclared require '../typechain-types'" in e for e in vp.check_tests_code("TipJar.test.js", code)))

    def test_exported_declarations_lose_export_keyword(self):
        code, _, changes = tt.transform_test('import { ethers } from "hardhat";\nexport async function setupFixture() { return ethers; }\n', "a.ts")
        self.assertNotIn("export", code)
        self.assertIn("async function setupFixture()", code)
        self.assertIn({"kind": "esm-to-cjs", "removed_export": ["setupFixture"], "file": "a.js"}, changes)

    def test_enums_are_refused(self):
        with self.assertRaises(ValueError):
            tt.transform_test("enum Side { A, B }\nit('x', () => {});\n", "a.ts")

    def test_javascript_toolbox_helpers_are_remapped(self):
        js = 'const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");\n'
        code, name, changes = tt.transform_test(js, "a.test.js")
        self.assertEqual(name, "a.test.js")
        self.assertIn('require("@nomicfoundation/hardhat-network-helpers")', code)
        self.assertEqual([c["kind"] for c in changes], ["test-import-path"])


class TransformedExecution(unittest.TestCase):
    def test_transformed_typescript_suite_passes_the_validator(self):
        code, name, _ = tt.transform_test(TIPJAR_TS, "TipJar.test.ts")
        with tempfile.TemporaryDirectory() as tmp:
            report = vp.validate(make_pair(tmp, name="tipjar-ts", test=code))
        self.assertTrue(report["accepted"], report["errors"])
        self.assertEqual(report["execution"]["test"]["mocha"]["passes"], 3)


if __name__ == "__main__":
    unittest.main()
