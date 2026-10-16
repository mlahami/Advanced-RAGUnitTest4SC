const fs = require('fs');
const path = require('path');
const Base = require('mocha').reporters.Base;

// Serialize diagnostic strings, not provider error objects with complex fields.
module.exports = class SafeJsonReporter extends Base {
  constructor(runner, options) {
    super(runner, options);
    const tests = [], passes = [], failures = [], pending = [];
    const clean = test => ({
      title: test.title, fullTitle: test.fullTitle(), file: test.file,
      duration: test.duration,
      err: test.err ? { message: String(test.err.message), stack: String(test.err.stack || '') } : {}
    });
    runner.on('test end', test => tests.push(clean(test)));
    runner.on('pass', test => passes.push(clean(test)));
    runner.on('fail', (test, err) => { test.err = err; failures.push(clean(test)); });
    runner.on('pending', test => pending.push(clean(test)));
    runner.once('end', () => {
      const result = { stats: runner.stats, tests, pending, failures, passes };
      runner.testResults = result;
      const output = options.reporterOptions.output;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(result, null, 2));
    });
  }
};
