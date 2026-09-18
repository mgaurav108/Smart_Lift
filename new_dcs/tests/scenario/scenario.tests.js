/* Smart Lift - New DCS scenario tests (Spec §38/§51/§52/§53/§54/§67).
 * Drives the deterministic ScenarioGenerator + runner end-to-end:
 *   - §51 golden routing case (fixed initial layout -> fixed winner E3)
 *   - §67 final acceptance scenario (70 requests + failures + restore)
 *   - §38 A-J generator smoke tests (plans produce, replay, never violate
 *     capacity, and are deterministic)
 *   - §52 property tests (bounds, capacity, maintenance, destination match,
 *     single-journey ownership, no ASSIGNED+QUEUED overlap)
 *   - §53 burst/concurrency test (100 requests in a short window)
 *   - §54 stress test (1000+ requests remain stable)
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;
  var assertEqArr = TestSuite.assertEqArr;

  var Engine = require('../../simulation/engine.js');
  var Config = require('../../config/default-config.js');
  var Rng = require('../../scenarios/rng.js');
  var Generator = require('../../scenarios/generator.js');
  var Scenarios = require('../../scenarios/runner.js');

  var suite = new TestSuite.Suite();

  function trace(plan, opts) {
    return Scenarios.run(plan, opts);
  }

  function countByType(log, type) {
    return log.filter(function (e) { return e.type === type; });
  }

  function after(log, tick) {
    return log.filter(function (e) { return e.t >= tick; });
  }

  suite.test('51.1 Golden routing: F7->F14 from spread [1,5,8,10,12,15] picks E3', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 5, 8, 10, 12, 15] } });
    var r = sim.request(7, 14, 1);
    assert(r.ok, 'request assigned');
    assertEq(r.assignment.elevatorId, 2, 'E3 wins the golden case');
    assertEq(r.assignment.elevatorName, 'E3', 'name matches');
    assertEqArr(r.assignment.route, [7, 14], 'direct route with no detour');
    assertEq(r.assignment.score, 47, 'deterministic score 47 (recorded golden)');
  });

  suite.test('51.2 Golden routing is reproducible across replay', function () {
    var plan = {
      id: 'GOLD', name: 'Golden', kind: 'golden',
      events: [{ t: 1, origin: 7, destination: 14, passengers: 1 }],
      script: []
    };
    var a = trace(plan, { maxTicks: 60, config: { elevators: { initialFloors: [1, 5, 8, 10, 12, 15] } } });
    var b = trace(plan, { maxTicks: 60, config: { elevators: { initialFloors: [1, 5, 8, 10, 12, 15] } } });
    assertEqArr(a.log, b.log, 'identical event traces');
    var req = countByType(a.log, 'request')[0];
    assertEq(req.assignedElevatorId, 2, 'E3 assigned in replay too');
  });

  suite.test('67.1 Final acceptance: failures respected, capacity kept, all delivered', function () {
    var rng = Rng.mulberry32(2026);
    var between = Rng.intBetween;
    var min = 1, max = 15;
    var events = [];
    function push(t, o, d, p) {
      events.push({ t: t, origin: o, destination: d, passengers: p });
    }
    function odPair() {
      var o = between(rng, min, max);
      var d = o;
      while (d === o) d = between(rng, min, max);
      return { o: o, d: d };
    }
    // 20 simultaneous requests.
    for (var i = 0; i < 20; i += 1) {
      var p1 = odPair();
      push(1, p1.o, p1.d, between(rng, 1, 3));
    }
    // E2 (id 1) and E5 (id 4) go to maintenance; E2 is restored later.
    var script = [
      { t: 5, action: 'maintenance', elevatorId: 1 },
      { t: 5, action: 'maintenance', elevatorId: 4 },
      { t: 120, action: 'restore', elevatorId: 1 }
    ];
    for (i = 0; i < 50; i += 1) {
      var p2 = odPair();
      push(between(rng, 6, 14), p2.o, p2.d, between(rng, 1, 4));
    }
    events.sort(function (a, b) { return a.t - b.t; });

    var plan = { id: 'ACC', name: 'Final Acceptance', kind: 'acceptance',
      events: events, script: script };
    var out = trace(plan, { maxTicks: 900 });
    var log = out.log;
    var m = out.metrics.snapshot();

    // 1-2. E2/E5 are rejected as candidates once in maintenance.
    assertEq(after(log, 5).filter(function (e) {
      return e.type === 'request' &&
        (e.assignedElevatorId === 1 || e.assignedElevatorId === 4);
    }).length, 0, 'no request ever assigned to E2/E5 during maintenance');

    // 3. Capacity respected on every elevator.
    assert(m.elevators.every(function (e) { return e.maxOccupancy <= 10; }),
      'no elevator exceeded capacity 10');

    // 6. Starvation prevented: every request ultimately delivered.
    var all = Object.keys(out.engine.state.requests);
    assertEq(arrStatus(out.engine).remaining(), 0, 'no request left pending');
    assertEq(all.length, 70, 'all 70 requests accounted for');

    // 10. Complete all feasible requests.
    assert(all.every(function (rid) {
      return out.engine.state.requests[rid].status === 'DELIVERED';
    }), 'every request delivered');

    // 7. Reassignments happened and produced additional journeys.
    assert(m.system.reassigned >= 1, 'at least one reassignment recorded');

    // 11. Never exceed elevator capacity (double check vs snapshots).
    assertEq(m.system.served, all.length, 'served metric matches delivered count');
    assert(m.system.pending === 0, 'pending metric is exactly 0');
  });

  suite.test('67.2 Final acceptance replays deterministically', function () {
    var mk = function () {
      var rng = Rng.mulberry32(2026);
      var between = Rng.intBetween;
      var events = [];
      function push(t, o, d, p) { events.push({ t: t, origin: o, destination: d, passengers: p }); }
      function odPair() {
        var o = between(rng, 1, 15); var d = o;
        while (d === o) d = between(rng, 1, 15);
        return { o: o, d: d };
      }
      for (var i = 0; i < 20; i += 1) { var p1 = odPair(); push(1, p1.o, p1.d, between(rng, 1, 3)); }
      for (i = 0; i < 50; i += 1) { var p2 = odPair(); push(between(rng, 6, 14), p2.o, p2.d, between(rng, 1, 4)); }
      events.sort(function (a, b) { return a.t - b.t; });
      return {
        id: 'ACC2', name: 'Acceptance replay', kind: 'acceptance', events: events,
        script: [
          { t: 5, action: 'maintenance', elevatorId: 1 },
          { t: 5, action: 'maintenance', elevatorId: 4 },
          { t: 120, action: 'restore', elevatorId: 1 }
        ]
      };
    };
    var a = trace(mk(), { maxTicks: 900 });
    var b = trace(mk(), { maxTicks: 900 });
    assertEqArr(a.log, b.log, 'seed-identical acceptance replays produce identical traces');
  });

  suite.test('38.1 Every generator (A-J) yields a valid, deterministic, safe run', function () {
    var ids = Object.keys(Generator.GENERATORS);
    ids.forEach(function (id) {
      var plan = Generator.generate(id, 101, 60);
      assert(plan.id === id, 'plan id ' + id);
      var a = trace(plan, { maxTicks: 700 });
      var b = trace(plan, { maxTicks: 700 });
      assertEqArr(a.log, b.log, id + ' replay deterministic');
      var s = a.metrics.snapshot();
      assert(s.elevators.every(function (e) { return e.maxOccupancy <= 10; }),
        id + ' capacity never exceeded');
      assert(typeof s.system.total === 'number' && s.system.total > 0, id + ' produced requests');
    });
    assertEq(ids.length, 10, 'all ten generators present');
  });

  suite.test('52.1 Property: floors never leave F1..F15', function () {
    var plan = Generator.generate('J', 7, 120);
    var out = trace(plan, { maxTicks: 700 });
    var ok = true;
    out.engine.state.elevators.forEach(function (e) {
      if (e.currentFloor < 1 || e.currentFloor > 15) ok = false;
    });
    assert(ok, 'all elevators within bounds at the end');
    out.log.forEach(function (ev) {
      if (ev.floor !== undefined && (ev.floor < 1 || ev.floor > 15)) ok = false;
      if (ev.origin !== undefined && (ev.origin < 1 || ev.origin > 15)) ok = false;
      if (ev.destination !== undefined && (ev.destination < 1 || ev.destination > 15)) ok = false;
    });
    assert(ok, 'no event references an out-of-bounds floor');
  });

  suite.test('52.2 Property: maintenance elevators receive zero new assignments', function () {
    var plan = Generator.generate('G', 11, 100);
    var out = trace(plan, { maxTicks: 700 });
    var maintAt = {};
    out.log.filter(function (e) { return e.type === 'maintenance' && e.ok; }).forEach(function (e) {
      maintAt[e.elevatorId] = e.t;
    });
    var restoredAt = {};
    out.log.filter(function (e) { return e.type === 'restore' && e.ok; }).forEach(function (e) {
      restoredAt[e.elevatorId] = e.t;
    });
    var bad = out.log.filter(function (e) {
      if (e.type !== 'request') return false;
      var id = e.assignedElevatorId;
      if (id === null || id === undefined) return false;
      if (maintAt[id] !== undefined && e.t >= maintAt[id]) {
        if (restoredAt[id] === undefined || e.t <= restoredAt[id]) return true;
      }
      return false;
    });
    assertEq(bad.length, 0, 'G scenario: no assignment to serviced lift while out');
  });

  suite.test('52.3 Property: delivered passengers arrive at their requested destination', function () {
    var plan = Generator.generate('J', 21, 150);
    var out = trace(plan, { maxTicks: 700 });
    var byRequest = {};
    out.log.filter(function (e) { return e.type === 'request'; }).forEach(function (e) {
      byRequest[e.requestId] = { origin: e.origin, destination: e.destination };
    });
    var ok = true;
    out.log.filter(function (e) { return e.type === 'delivered'; }).forEach(function (e) {
      var req = byRequest[e.requestId];
      if (!req || e.floor !== req.destination) ok = false;
    });
    assert(ok, 'every delivered request landed on its requested floor');
  });

  suite.test('52.4 Property: a passenger belongs to exactly one elevator journey', function () {
    var plan = Generator.generate('H', 31, 100);
    var out = trace(plan, { maxTicks: 700 });
    var seen = {};
    var ok = true;
    out.engine.state.elevators.forEach(function (e) {
      e.aboardRequestIds.forEach(function (rid) {
        if (seen[rid]) ok = false; // aboard two cars at once
        seen[rid] = true;
      });
    });
    assert(ok, 'no request aboard more than one elevator at the end');
  });

  suite.test('52.5 Property: no request is ASSIGNED and QUEUED simultaneously', function () {
    var plan = Generator.generate('E', 41, 80);
    var out = trace(plan, { maxTicks: 700 });
    var ok = true;
    out.engine.state.queuedRequestIds.forEach(function (rid) {
      var req = out.engine.state.requests[rid];
      if (req && req.status === 'ASSIGNED') ok = false;
    });
    assert(ok, 'queue never holds an ASSIGNED request at the end');
  });

  suite.test('53.1 Burst: 100 requests, no losses/duplicates, deterministic', function () {
    var plan = Generator.generate('H', 17, 100);
    var a = trace(plan, { maxTicks: 700 });
    var b = trace(plan, { maxTicks: 700 });
    assertEqArr(a.log, b.log, 'burst replay identical');

    var reqs = countByType(a.log, 'request');
    assertEq(reqs.length, 100, 'all 100 requests arrived');
    var ids = {};
    var dup = false;
    reqs.forEach(function (r) { if (ids[r.requestId]) dup = true; ids[r.requestId] = true; });
    assert(!dup, 'no duplicate request IDs');
    assertEq(Object.keys(a.engine.state.requests).length, 100, 'no lost requests');
    var s = a.metrics.snapshot();
    assert(s.elevators.every(function (e) { return e.maxOccupancy <= 10; }),
      'burst respects capacity');
    assertEq(s.system.served + s.system.pending, 100, 'every burst request accounted for');
  });

  suite.test('54.1 Stress: 1000+ requests run stable with valid metrics', function () {
    var plan = Generator.generate('A', 99, 1100);
    var out = trace(plan, { maxTicks: 1600 });
    var s = out.metrics.snapshot();
    assertEq(s.system.total, 1100, 'all 1100 requests submitted');
    assertEq(s.system.served + s.system.pending, 1100, 'none lost, none duplicated');
    assert(typeof s.passengers.avgWait === 'number' && s.passengers.avgWait >= 0,
      'avg wait computed');
    assert(typeof s.passengers.maxWait === 'number' && s.passengers.maxWait >= 0,
      'max wait computed');
    assert(typeof s.passengers.p95Wait === 'number' && s.passengers.p95Wait >= 0,
      'p95 wait computed');
    assert(s.elevators.every(function (e) { return e.maxOccupancy <= 10; }),
      'capacity never violated under stress');
    assert(typeof s.system.throughput === 'number' && s.system.throughput >= 0,
      'throughput computed');
  });

  suite.test('64.1 Same scenario benchmarks across dispatch strategies', function () {
    var plan = Generator.generate('J', 7, 150);
    var weighted = trace(plan, { maxTicks: 800, config: { dispatch: { strategy: 'weighted-dcs' } } });
    var nearest = trace(plan, { maxTicks: 800, config: { dispatch: { strategy: 'nearest' } } });
    var w = weighted.metrics.snapshot();
    var n = nearest.metrics.snapshot();
    assertEq(w.system.total, n.system.total, 'both strategies evaluated the same request set');
    assert(typeof w.passengers.avgWait === 'number' && w.passengers.avgWait >= 0,
      'weighted-DCS metrics available');
    assert(typeof n.passengers.avgWait === 'number' && n.passengers.avgWait >= 0,
      'nearest-elevator metrics available');
    var weighted2 = trace(plan, { maxTicks: 800, config: { dispatch: { strategy: 'weighted-dcs' } } });
    assertEqArr(weighted.log, weighted2.log, 'weighted-DCS benchmark replay is deterministic');
  });

  suite.test('57.1 Every assignment carries an explainable score breakdown', function () {
    var plan = Generator.generate('A', 5, 40);
    var out = trace(plan, { maxTicks: 500 });
    var assigned = 0;
    Object.keys(out.engine.state.requests).forEach(function (rid) {
      var req = out.engine.state.requests[rid];
      if (!req.assignmentExplanation) return;
      assigned += 1;
      assert(Array.isArray(req.assignmentExplanation), 'explanation is a list of factors');
      assert(req.assignmentExplanation.join(' ').indexOf('Final score') !== -1,
        'explanation exposes the final score');
      assert(typeof req.assignmentScore === 'number', 'numeric assignment score stored');
    });
    assert(assigned > 0, 'at least one assignment was explained');
  });

  function arrStatus(engine) {
    var tmp = {};
    tmp.remaining = function () {
      return Object.keys(engine.state.requests).filter(function (rid) {
        return !isTerminalOf(engine.state.requests[rid].status);
      }).length;
    };
    return tmp;
  }

  function isTerminalOf(status) {
    return status === 'DELIVERED' || status === 'CANCELLED';
  }

  module.exports = { suites: { scenario: suite } };
}(typeof window !== 'undefined' ? window : globalThis));