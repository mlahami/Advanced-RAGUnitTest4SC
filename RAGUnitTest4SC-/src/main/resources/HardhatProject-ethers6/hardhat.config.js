require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("solidity-coverage");
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, hre, runSuper) => {
  if (solcVersion === "0.8.24") {
    return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true,
      version: solcVersion, longVersion: require("solc").version() };
  }
  return runSuper();
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  paths: process.env.RAG_RUN_DIR ? {
    sources: path.join(process.env.RAG_RUN_DIR, "contracts"),
    tests: path.join(process.env.RAG_RUN_DIR, "test"),
    cache: path.join(process.env.RAG_RUN_DIR, "cache"),
    artifacts: path.join(process.env.RAG_RUN_DIR, "artifacts"),
  } : {},
  mocha: process.env.RAG_RUN_DIR ? {
    timeout: 40000, reporter: path.join(__dirname, "safe-json-reporter.js"),
    reporterOptions: { output: path.join(process.env.RAG_RUN_DIR, "mocha-results.json") },
  } : { timeout: 40000 },
  solidity: {
    compilers: [
      { version: "0.8.0" },
      { version: "0.8.1" },
      { version: "0.8.2" },
      { version: "0.8.3" },
      { version: "0.8.4" },
      { version: "0.8.5" },
      { version: "0.8.6" },
      { version: "0.8.7" },
      { version: "0.8.8" },
      { version: "0.8.9" },
      { version: "0.8.10" },
      { version: "0.8.11" },
      { version: "0.8.12" },
      { version: "0.8.13" },
      { version: "0.8.14" },
      { version: "0.8.15" },
      { version: "0.8.16" },
      { version: "0.8.17" },
            { version: "0.4.4" }, // Add this

      { version: "0.8.18" },
      { version: "0.8.19" },
      { version: "0.8.20" },
      { version: "0.8.21" },
      { version: "0.8.22" },
      { version: "0.8.23" },
      { version: "0.8.24" },
    ],
  },
};
