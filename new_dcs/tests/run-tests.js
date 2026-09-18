/* Smart Lift - New DCS: headless test runner (Node).
 * Loads every test module in dependency-safe order, runs all suites, and
 * exits non-zero on any failure. Usage:
 *   node tests/run-tests.js
 */
(function (global) {
  'use strict';

  var path = require('path');
  var TestSuite = require('./helpers/test-suite.js');

  function load(file) {
    return require(path.join(__dirname, file));
  }

  /* Order matters only for global registration side effects; each file
   * returns { Suite } with a fresh harness. */
  var suites = [
    load('./unit/domain.tests.js'),
    load('./unit/eligibility.tests.js'),
    load('./unit/eta.tests.js'),
    load('./unit/scoring.tests.js'),
    load('./unit/dispatch-varied.tests.js'),
    load('./unit/routing.tests.js'),
    load('./integration/dispatch.tests.js'),
    load('./integration/simulation.tests.js'),
    load('./integration/maintenance.tests.js'),
    load('./integration/ui.tests.js'),
    load('./scenario/scenario.tests.js')
  ];

  function runAll() {
    var totalPass = 0, totalFail = 0, totalSkip = 0;
    suites.forEach(function (mod) {
      var labels = Object.keys(mod.suites || {});
      labels.forEach(function (label) {
        var r = mod.suites[label].run();
        totalPass += r.pass;
        totalFail += r.fail;
        totalSkip += r.skipped;
        r.output.forEach(function (o) { console.log(o); });
      });
    });
    return { pass: totalPass, fail: totalFail, skipped: totalSkip };
  }

  if (require.main === module) {
    var res = runAll();
    console.log('\nSummary: pass=' + res.pass + ' fail=' + res.fail + ' skipped=' + res.skipped);
    process.exit(res.fail === 0 ? 0 : 1);
  }

  module.exports = { runAll: runAll };
}(typeof window !== 'undefined' ? window : globalThis));