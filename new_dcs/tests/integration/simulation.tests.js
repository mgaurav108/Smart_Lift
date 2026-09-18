/* Smart Lift - New DCS integration tests: simulation engine behavior.
 * End-to-end request lifecycle (§34), motion/doors (§26), determinism (§52),
 * bounds and occupancy invariants.
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;
  var assertEqArr = TestSuite.assertEqArr;

  var Engine = require('../../simulation/engine.js');

  var suite = new TestSuite.Suite();

  function runTo(sim, predicate, maxTicks) {
    var guard = maxTicks || 400;
    for (var t = 0; t < guard; t += 1) {
      sim.tick();
      if (predicate()) return sim.state.clock.now();
    }
    return -1;
  }

  suite.test('26.1 Full lifecycle: request -> pickup -> deliver (golden timing)', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 15, 15, 15, 15, 15] } });
    var r = sim.request(1, 15, 1);
    assert(r.ok, 'assigned instantly');
    assertEq(r.assignment.elevatorId, 0, 'E1 takes the call');
    var req = sim.state.requests[r.requestId];
    assertEq(req.status, 'ASSIGNED', 'status ASSIGNED right after request');

    var at = runTo(sim, function () { return req.status === 'DELIVERED'; });
    assert(at !== -1, 'delivered within budget');
    assertEq(req.pickedUpAt, 1, 'picked up when doors opened at t=1');
    // Doors open/shut cycle (open 2 + close 1) + one idle tick + 14 floors:
    // t=1 board, t=2-3 dwell, t=4 close->idle, t=5 depart, t=19 arrive.
    assertEq(req.deliveredAt, 19, 'delivered at t=19 (deterministic)');
    assertEq(sim.state.elevators[0].occupancy, 0, 'car empty again');
    assertEq(sim.state.elevators[0].currentFloor, 15, 'car finished at F15');
  });

  suite.test('26.2 Doors dwell: open 2 ticks, close 1 tick', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 15, 15, 15, 15, 15] } });
    sim.request(1, 15, 1);
    sim.tick(); // drivers open at t=1
    assertEq(sim.state.elevators[0].state, 'DOOR_OPEN', 'open at t1');
    sim.tick(); // t2
    assertEq(sim.state.elevators[0].state, 'DOOR_OPEN', 'still open at t2');
    sim.tick(); // t3
    assertEq(sim.state.elevators[0].state, 'DOOR_CLOSING', 'closing at t3');
    sim.tick(); // t4
    assertEq(sim.state.elevators[0].state, 'IDLE', 'idle at t4');
    assertEq(sim.state.elevators[0].currentFloor, 1, 'has not moved yet');
  });

  suite.test('26.3 One floor per tick while moving', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 15, 15, 15, 15, 15] } });
    sim.request(1, 15, 1);
    runTo(sim, function () { return sim.state.elevators[0].state === 'MOVING_UP'; });
    var f0 = sim.state.elevators[0].currentFloor;
    sim.tick();
    assertEq(sim.state.elevators[0].currentFloor, f0 + 1, 'gains exactly one floor');
  });

  suite.test('34.1 Lifecycle status sequence for a journey', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 15, 15, 15, 15, 15] } });
    var r = sim.request(1, 12, 1);
    var req = sim.state.requests[r.requestId];
    var seen = [req.status];
    for (var t = 0; t < 40; t += 1) {
      sim.tick();
      if (seen[seen.length - 1] !== req.status) seen.push(req.status);
      if (req.status === 'DELIVERED') break;
    }
    assertEqArr(seen, ['ASSIGNED', 'PICKED_UP', 'DELIVERED'], 'clean lifecycle');
  });

  suite.test('48.1 Grouped riders share one car and drop in order', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 15, 15, 15, 15, 15] } });
    var r0 = sim.request(1, 10, 2);
    var r1 = sim.request(1, 11, 1);
    assertEq(r0.assignment.elevatorId, r1.assignment.elevatorId, 'same car (F1->F10 + F1->F11)');
    runTo(sim, function () {
      return sim.state.requests[r0.requestId].status === 'DELIVERED' &&
        sim.state.requests[r1.requestId].status === 'DELIVERED';
    });
    var a = sim.state.requests[r0.requestId], b = sim.state.requests[r1.requestId];
    assert(a.deliveredAt < b.deliveredAt, 'F10 dropped before F11 (route order kept)');
    assertEq(sim.state.elevators[0].occupancy, 0, 'car empty after both drops');
    assertEq(sim.state.elevators[0].currentFloor, 11, 'finished at F11 without overshoot');
  });

  suite.test('52.1 Determinism: identical inputs -> identical event traces', function () {
    var script = function (sim) {
      var out = [];
      sim.request(1, 15, 2);
      sim.request(3, 9, 1);
      sim.request(9, 4, 3);
      for (var t = 0; t < 120; t += 1) {
        out.push(JSON.stringify(sim.tick()));
      }
      return out;
    };
    var a = script(Engine.create({ elevators: { initialFloors: [1, 3, 5, 8, 12, 15] } }));
    var b = script(Engine.create({ elevators: { initialFloors: [1, 3, 5, 8, 12, 15] } }));
    assertEqArr(a, b, 'full 120-tick event trace identical');
  });

  suite.test('52.2 Engine instances share no mutable state', function () {
    var sA = Engine.create({ elevators: { initialFloors: [1, 2, 3, 4, 5, 6] } });
    var sB = Engine.create({ elevators: { initialFloors: [1, 2, 3, 4, 5, 6] } });
    sA.request(1, 15, 4);
    sA.tick();
    assertEq(sB.state.requests['R0'], undefined, 'B unaffected by A');
    assert(sB.state.elevators.every(function (e) {
      return e.targetFloors.length === 0 && e.occupancy === 0;
    }), 'B elevators untouched');
  });

  suite.test('62.1 Floors never leave the 1..15 bounds at any tick', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 2, 3, 4, 5, 6] } });
    sim.request(1, 15, 2);
    sim.request(15, 1, 3);
    sim.request(8, 2, 1);
    var inBounds = true;
    for (var t = 0; t < 200; t += 1) {
      sim.tick();
      sim.state.elevators.forEach(function (e) {
        if (e.currentFloor < 1 || e.currentFloor > 15) inBounds = false;
      });
    }
    assert(inBounds, 'every elevator stayed within F1..F15');
    assertEq(sim.state.elevators[0].occupancy, 0, 'all riders delivered, cars empty');
  });

  suite.test('26.4 Occupancy never exceeds capacity during a ride', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 2, 3, 4, 5, 6] } });
    sim.request(1, 10, 10);
    sim.request(10, 1, 10);
    var over = false;
    for (var t = 0; t < 200; t += 1) {
      sim.tick();
      sim.state.elevators.forEach(function (e) {
        if (e.occupancy > e.capacity) over = true;
      });
    }
    assert(!over, 'occupancy stayed at or under capacity');
  });

  module.exports = { suites: { simulation: suite } };
}(typeof window !== 'undefined' ? window : globalThis));