/* Smart Lift - New DCS unit tests: "varied" selection policy.
 * config.dispatch.selection = 'varied' must spread 1-person requests across
 * the fleet instead of letting one elevator absorb everything, and must stay
 * fully deterministic (Spec §25/§51/§67), while the default 'best' policy
 * keeps the exact §19 behaviour.
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;
  var assertEqArr = TestSuite.assertEqArr;

  var Config = require('../../config/default-config.js');
  var SimulationEngine = require('../../simulation/engine.js');
  var Strategy = require('../../dispatch/strategy.js');

  var suite = new TestSuite.Suite();

  function runVaried(seed, dests, origin) {
    var cfg = Config.create({ dispatch: { selection: 'varied', variationSeed: seed } });
    var sim = SimulationEngine.create(cfg);
    origin = origin || 1;
    var sequence = [];
    dests.forEach(function (d) {
      var r = sim.request(origin, d, 1);
      sequence.push(r.ok ? r.assignment.elevatorName : '?');
    });
    return { sequence: sequence, sim: sim };
  }

  function distinct(list) {
    var seen = {}, n = 0;
    list.forEach(function (e) { if (!seen[e]) { seen[e] = 1; n += 1; } });
    return n;
  }

  function tapFlow(seed, taps, origin) {
    var cfg = Config.create({ dispatch: { selection: 'varied', variationSeed: seed } });
    var sim = SimulationEngine.create(cfg);
    origin = origin || 1;
    var names = [];
    taps.forEach(function (d) {
      var r = sim.request(origin, d, 1);
      names.push(r.ok ? r.assignment.elevatorName : '?');
    });
    return { names: names, sim: sim };
  }

  suite.test('V1 Varied policy spreads taps across the whole fleet', function () {
    var dests = [12, 10, 5, 14, 3, 9, 7, 11, 2, 15, 6, 8];
    var res = runVaried(7, dests);
    assert(res.sequence.indexOf('?') === -1, 'every tap assigned immediately');
    assert(distinct(res.sequence.slice(0, 6)) >= 3, 'first 6 taps use several lifts');
    assert(distinct(res.sequence) >= 6, 'whole fleet used');
    var loads = res.sim.state.elevators.map(function (e) { return e.assignedRequestIds.length; });
    var max = Math.max.apply(null, loads), min = Math.min.apply(null, loads);
    assert(max - min <= 1, 'workload is balanced (max-min = ' + (max - min) + ')');
  });

  suite.test('V2 Varied policy replays identically for the same seed', function () {
    var dests = [12, 10, 5, 14, 3, 9, 7, 11, 2, 15, 6, 8];
    assertEqArr(runVaried(7, dests).sequence, runVaried(7, dests).sequence,
      'same seed -> same pick order');
  });

  suite.test('V3 Different seed changes the pick order', function () {
    var dests = [12, 10, 5, 14, 3, 9, 7, 11, 2, 15, 6, 8];
    var a = runVaried(1, dests).sequence;
    var b = runVaried(7, dests).sequence;
    assert(a.join('') !== b.join(''), 'seeds 1 vs 7 produce different orders');
  });

  suite.test('V4 Varied winner carries a load-balance explanation line', function () {
    var cfg = Config.create({ dispatch: { selection: 'varied', variationSeed: 7 } });
    var sim = SimulationEngine.create(cfg);
    var req = { requestId: 'R0', originFloor: 1, destinationFloor: 10,
      passengerCount: 1, waitingTime: 0 };
    var ev = Strategy.WeightedDCSStrategy.evaluate(sim.state, req);
    assert(ev.winner, 'a winner exists');
    var flag = ev.winner.explanation.some(function (l) { return l.indexOf('load balance') !== -1; });
    assert(flag, 'explanation mentions load balance');
  });

  suite.test('V5 Default best policy stays on the §19 tie-break', function () {
    var cfg = Config.create();
    var sim = SimulationEngine.create(cfg);
    var req = { requestId: 'R0', originFloor: 1, destinationFloor: 10,
      passengerCount: 1, waitingTime: 0 };
    var ev = Strategy.WeightedDCSStrategy.evaluate(sim.state, req);
    assertEq(ev.winner.elevatorId, 0, 'identical idle lifts resolve to lowest id');
  });

  suite.test('V6 Same destination, 10 taps => ONE lift (capacity group)', function () {
    var res = tapFlow(7, [12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    assert(res.names.indexOf('?') === -1, 'all 10 taps assigned');
    assertEq(distinct(res.names), 1, 'a single lift serves all 10 people');
    var lift = res.sim.state.elevators.filter(function (e) {
      return e.name === res.names[0];
    })[0];
    assertEq(lift.assignedRequestIds.length, 10, 'that lift holds all 10 passengers');
    var others = res.sim.state.elevators.filter(function (e) { return e.name !== res.names[0]; });
    assert(others.every(function (e) { return e.assignedRequestIds.length === 0; }),
      'no other lift was summoned');
  });

  suite.test('V7 One more tap after capacity is full moves to another lift', function () {
    var res = tapFlow(7, [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    var first = res.names[0];
    assert(first !== '?', 'first tap assigned');
    for (var i = 1; i < 10; i += 1) {
      assertEq(res.names[i], first, 'taps 2..10 stay on ' + first);
    }
    assert(res.names[10] !== first, '11th tap spills to a different lift');
    assert(res.names[10] !== '?', '11th tap still assigned');
  });

  suite.test('V8 Different destinations still get different lifts', function () {
    var res = tapFlow(7, [12, 10, 5]);
    assertEq(distinct(res.names), 3, 'one lift per destination');
    var back = tapFlow(7, [12, 12, 10, 10, 12]);
    assertEq(back.names[0], back.names[4], 'later same-destination tap reuses its lift');
    assertEq(back.names[1], back.names[0], 'grouped with the same lift');
    assert(back.names[2] !== back.names[0] && back.names[2] !== '?',
      'different destination pairs with another lift');
  });

  module.exports = { suites: { varied: suite } };
}(typeof window !== 'undefined' ? window : globalThis));