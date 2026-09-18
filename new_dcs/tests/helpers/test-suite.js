/* Smart Lift - New DCS tests: shared TestSuite harness.
 * Same contract as the existing `simulation/` test suites, kept generic so a
 * future browser runner (run-tests.html) can consume the same files.
 */
(function (global) {
  'use strict';

  function Suite() {
    this.cases = [];
  }

  Suite.prototype.test = function (name, fn) {
    this.cases.push({ name: name, fn: fn });
    return this;
  };

  Suite.prototype.run = function () {
    var pass = 0, fail = 0, skipped = 0, output = [];
    this.cases.forEach(function (c) {
      if (!c.fn) { skipped += 1; return; }
      try {
        c.fn();
        pass += 1;
        output.push('PASS: ' + c.name);
      } catch (e) {
        fail += 1;
        output.push('FAIL: ' + c.name + ' -> ' + (e && e.message ? e.message : e));
      }
    });
    return { pass: pass, fail: fail, skipped: skipped, output: output };
  };

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }

  function assertEq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || 'assertEq') + ' (expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(actual) + ')');
    }
  }

  function assertEqArr(actual, expected, msg) {
    assertEq(JSON.stringify(actual), JSON.stringify(expected), msg || 'array mismatch');
  }

  function assertThrows(fn, pattern, msg) {
    var threw = false, got = null;
    try { fn(); } catch (e) { threw = true; got = String(e.message || e); }
    assert(threw, (msg || 'expected function to throw') + ' (nothing thrown)');
    if (pattern) assert(got.indexOf(pattern) !== -1,
      (msg || 'expected throw to mention ') + JSON.stringify(pattern) + ' but got: ' + got);
  }

  var TestSuite = {
    Suite: Suite,
    assert: assert,
    assertEq: assertEq,
    assertEqArr: assertEqArr,
    assertThrows: assertThrows
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TestSuite;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.TestSuite = TestSuite;
}(typeof window !== 'undefined' ? window : globalThis));