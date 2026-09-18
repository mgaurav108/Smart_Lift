/* Smart Lift - regression helper (Node).
 * Runs the pre-existing Phase 1 (simulation/) and Phase 2 (simulation/dcs/)
 * suites plus the new Phase 3 (new_dcs/) suite, and reports a combined
 * summary. Exit code 0 only when everything passes.
 *
 *   node scripts/regression.js
 */
(function () {
  'use strict';

  var path = require('path');
  var root = path.join(__dirname, '..');

  var totalPass = 0, totalFail = 0;

  function runOne(label, setup, suiteModule, suiteAccessor) {
    global.SmartLift = {};
    if (setup) setup();
    var mod = require(suiteModule);
    var names = suiteAccessor ? suiteAccessor(mod) : ['self'];
    var list = Array.isArray(names) ? names : [names];
    list.forEach(function (name) {
      var s = name === 'self' ? mod : mod.suites[name];
      if (!s) throw new Error('Missing suite ' + name + ' in ' + suiteModule);
      var r = s.run();
      totalPass += r.pass;
      totalFail += r.fail;
      r.output.forEach(function (o) { console.log('  ' + o); });
    });
    console.log(label + ': pass=' + (totalPass - totalPass + r.pass) + ' ...');
  }

  // Phase 1 - base simulation engine (singleton TestSuite on global).
  global.SmartLift = {};
  require(path.join(root, 'simulation', 'js', 'engine.js'));
  require(path.join(root, 'simulation', 'tests', 'tests.js'));
  var r1 = global.TestSuite.run();
  totalPass += r1.pass;
  totalFail += r1.fail;
  r1.output.forEach(function (o) { console.log('  ' + o); });
  console.log('Phase 1 base: pass=' + r1.pass + ' fail=' + r1.fail);

  // Phase 2 - DCS simulation engine.
  global.SmartLift = {};
  require(path.join(root, 'simulation', 'dcs', 'js', 'engine.js'));
  require(path.join(root, 'simulation', 'dcs', 'tests', 'tests.js'));
  var r2 = global.TestSuite.run();
  totalPass += r2.pass;
  totalFail += r2.fail;
  r2.output.forEach(function (o) { console.log('  ' + o); });
  console.log('Phase 2 DCS: pass=' + r2.pass + ' fail=' + r2.fail);

  // Phase 3 - new DCS (multi-file suites).
  var r3 = require(path.join(root, 'new_dcs', 'tests', 'run-tests.js')).runAll();
  totalPass += r3.pass;
  totalFail += r3.fail;

  console.log('\nRegression summary: pass=' + totalPass + ' fail=' + totalFail);
  process.exit(totalFail === 0 ? 0 : 1);
})();