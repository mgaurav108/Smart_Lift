/* Smart Lift - New DCS integration tests: dispatch behavior on a live engine.
 * Covers grouping (§48), capacity/reservation (§47), queueing (§31),
 * starvation (§45) and reassignment (§35).
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;

  var Engine = require('../../simulation/engine.js');
  var Config = require('../../config/default-config.js');
  var SimulationState = require('../../simulation/state.js');
  var Strategy = require('../../dispatch/strategy.js');

  var suite = new TestSuite.Suite();

  function simWith(spread) {
    return Engine.create({ elevators: { initialFloors: spread } });
  }

  function runUntil(sim, predicate, maxTicks) {
    var guard = maxTicks || 200;
    for (var t = 0; t < guard; t += 1) {
      sim.tick();
      if (predicate()) return true;
    }
    return predicate();
  }

  suite.test('48.1 F1->F10 and F1->F11 share one car (grouping)', function () {
    var sim = simWith([1, 15, 15, 15, 15, 15]); // E1 at F1, others far
    var r0 = sim.request(1, 10, 2);
    var r1 = sim.request(1, 11, 1);
    assert(r0.ok && r1.ok, 'both requests assigned');
    assertEq(r0.assignment.elevatorId, 0, 'E1 takes F1->F10');
    assertEq(r1.assignment.elevatorId, 0, 'E1 also takes F1->F11');
    assertEqArr(r1.assignment.route, [1, 10, 11], 'single upward tour serves both');
  });
  function assertEqArr(a, b, msg) { TestSuite.assertEq(JSON.stringify(a), JSON.stringify(b), msg); }

  suite.test('47.1 Full elevator is ineligible; demand goes elsewhere', function () {
    var sim = simWith([1, 1, 1, 1, 1, 1]);
    var r0 = sim.request(1, 15, 10); // packs E1
    assert(r0.ok, 'E1 takes a full bus');
    var r1 = sim.request(1, 14, 1);
    assert(r1.ok, '1-seat request assigned elsewhere');
    assert(r1.assignment.elevatorId !== 0, 'full E1 skipped');
  });

  suite.test('47.2 Reservation semantics: overbooking blocked, exact fit allowed', function () {
    var sim = simWith([1, 15, 15, 15, 15, 15]);
    sim.request(1, 15, 9);          // E1 reserved for 9
    var r = sim.request(1, 14, 2);  // 2 extra would exceed 10
    assert(r.ok, 'large request assigned');
    assert(r.assignment.elevatorId !== 0, 'E1 has only 1 seat left -> skipped');
    var fit = sim.request(1, 13, 1); // 1 seat exactly fits
    assert(fit.ok && fit.assignment.elevatorId === 0, 'E1 takes the exact-fit request');
  });

  suite.test('47.3 Capacity never exceeded while simulating an overload', function () {
    var sim = simWith([1, 1, 1, 1, 1, 1]);
    sim.request(1, 15, 8);
    sim.request(2, 14, 8);
    sim.request(3, 13, 8);
    sim.request(4, 12, 8);
    sim.request(5, 11, 8);
    sim.request(6, 10, 8); // fleet saturated
    var overflow = sim.request(7, 9, 3);
    assert(!overflow.ok && overflow.queued, 'no elevator can fit -> queued, not overflowing');
    assertEq(overflow.reason, 'capacity', 'queued for capacity');
    assertEq(sim.state.queuedRequestIds.length, 1, 'FIFO queue holds the overflow');
    var ok = runUntil(sim, function () {
      return sim.state.elevators.every(function (e) {
        return e.occupancy + e.assignedPassengerCount <= e.capacity;
      });
    }, 300);
    assert(ok, 'dispatcher never over-books at any tick');
  });

  suite.test('31.1 No available elevator queues the request (FIFO)', function () {
    var sim = simWith([1, 1, 1, 1, 1, 1]);
    for (var i = 0; i < 6; i += 1) sim.setMaintenance(i);
    var r0 = sim.request(3, 9, 2);
    var r1 = sim.request(5, 11, 1);
    assert(!r0.ok && r1.queued, 'first request queued');
    assert(!r1.ok, 'second also queued');
    assertEqArr(sim.state.queuedRequestIds, [r0.requestId, r1.requestId],
      'FIFO order preserved');
  });

  suite.test('45.1 Waiting time accrues and starvation penalty kicks in', function () {
    var sim = simWith([1, 1, 1, 1, 1, 1]);
    for (var i = 0; i < 6; i += 1) sim.setMaintenance(i);
    var r0 = sim.request(3, 9, 2);
    for (var t = 0; t < 40; t += 1) sim.tick();
    var req = sim.state.requests[r0.requestId];
    assert(req.waitingTime >= 40, 'waiting time accrued (' + req.waitingTime + ')');

    var fresh = SimulationState.create(Config.create({}));
    var eval_ = Strategy.WeightedDCSStrategy.evaluate(fresh, {
      requestId: r0.requestId, originFloor: 3, destinationFloor: 9,
      passengerCount: 2, waitingTime: req.waitingTime
    });
    assert(eval_.winner, 'evaluation succeeds against eligible fleet');
    // (40 - 30) threshold * 2 weight = 20
    assertEq(eval_.winner.starvationPenalty, 20, 'additive starvation penalty');
  });

  suite.test('45.2 Restoring a lift frees queued requests (starved passenger served)', function () {
    var sim = simWith([1, 1, 1, 1, 1, 1]);
    for (var i = 0; i < 6; i += 1) sim.setMaintenance(i);
    var r0 = sim.request(3, 9, 2);
    for (var t = 0; t < 32; t += 1) sim.tick();
    sim.restore(0); // reconsiderQueue runs inside restore
    var req = sim.state.requests[r0.requestId];
    assertEq(req.assignedElevatorId, 0, 'restored E1 takes the long-waiting request');
    assertEq(req.status, 'ASSIGNED', 'status transitions to ASSIGNED');
    assertEq(sim.state.queuedRequestIds.length, 0, 'queue drained');
    var ok = runUntil(sim, function () {
      return sim.state.requests[r0.requestId].status === 'DELIVERED';
    }, 200);
    assert(ok, 'starved request delivered end-to-end');
  });

  suite.test('35.1 Busy lift taken to maintenance reassigns waiting requests', function () {
    var sim = simWith([1, 1, 1, 1, 1, 1]);
    sim.request(1, 10, 1); // E1 (id 0) assigned, nobody aboard yet
    var set = sim.setMaintenance(0);
    assert(set.ok && set.pending === true, 'transition declared pending');
    var req = sim.state.requests['R0'];
    assertEq(req.status, 'REASSIGNED', 'waiting request bounced to REASSIGNED');
    assertEq(req.assignedElevatorId, null, 'release elevator binding');
    assert(req.reassignedCount >= 1, 'reassignment counted');

    runUntil(sim, function () { return sim.state.elevators[0].state === 'MAINTENANCE'; }, 20);
    // runUntil ends on the tick whose reconsiderQueue re-assigned R0; E2
    // (id 1, idle at F1) won it but has not opened doors yet.
    var reborn = sim.state.requests['R0'];
    assert(reborn.assignedElevatorId !== null && reborn.assignedElevatorId !== 0,
      'request re-assigned to a different lift');
    assertEq(reborn.status, 'ASSIGNED', 're-assigned and active again');
  });

  module.exports = { suites: { dispatch: suite } };
}(typeof window !== 'undefined' ? window : globalThis));