/* Smart Lift - New DCS integration tests: maintenance policy (Spec §46,
 * M1-M7). Driven through the live SimulationEngine so the interaction with
 * dispatch is exercised too.
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;

  var Engine = require('../../simulation/engine.js');
  var Strategy = require('../../dispatch/strategy.js');

  var suite = new TestSuite.Suite();

  function runTo(sim, predicate, maxTicks) {
    var guard = maxTicks || 400;
    for (var t = 0; t < guard; t += 1) {
      sim.tick();
      if (predicate()) return sim.state.clock.now();
    }
    return -1;
  }

  suite.test('M1 Idle empty elevator goes into MAINTENANCE immediately', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 1, 1, 1, 1, 1] } });
    var res = sim.setMaintenance(0);
    assert(res.ok && res.pending === false, 'immediate transition');
    var e = sim.state.elevators[0];
    assertEq(e.maintenanceStatus, 'MAINTENANCE', 'status MAINTENANCE');
    assertEq(e.state, 'MAINTENANCE', 'elevator state MAINTENANCE');
    assertEq(e.estimatedAvailabilityTime, 60, 'available again after default 60s');
    assert(!Strategy.isEligible(e, 1), 'ineligible while serviced');
  });

  suite.test('M2 Busy elevator: pending -> reassigns -> delivers aboard -> MAINTENANCE', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 15, 15, 15, 15, 15] } });
    var r0 = sim.request(1, 8, 1);   // E1 picks up
    sim.tick();                        // t=1: E1 doors open, R0 aboard
    var r1 = sim.request(3, 9, 1);   // same route as E1, but NOT yet boarded
    assertEq(r1.assignment.elevatorId, 0, 'R1 (origin 3) also on E1, still waiting');

    var set = sim.setMaintenance(0);
    assert(set.ok && set.pending === true, 'loaded car -> MAINTENANCE_PENDING');

    var waiting = sim.state.requests[r1.requestId];
    assertEq(waiting.status, 'REASSIGNED', 'waiting passenger reassigned off E1');
    assertEq(waiting.assignedElevatorId, null, 'no longer bound to E1');
    var aboard = sim.state.requests[r0.requestId];
    assertEq(aboard.status, 'PICKED_UP', 'aboard passenger kept');
    assertEq(sim.state.elevators[0].occupancy, 1, 'car still loaded');
    assertEq(sim.state.elevators[0].maintenanceStatus, 'MAINTENANCE_PENDING',
      'transition is pending');

    var tEnd = runTo(sim, function () {
      return sim.state.elevators[0].maintenanceStatus === 'MAINTENANCE';
    });
    assert(tEnd !== -1, 'car finally enters MAINTENANCE');
    assertEq(aboard.status, 'DELIVERED', 'R0 delivered before maintenance');
    assertEq(sim.state.elevators[0].occupancy, 0, 'car emptied first');
    assert(waiting.assignedElevatorId !== null && waiting.assignedElevatorId !== 0,
      'waiting rider re-assigned to another lift');
    assertEq(waiting.status, 'ASSIGNED', 'waiting rider re-assigned and active');
  });

  suite.test('M3 Restore returns the lift to IDLE and eligible', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 1, 1, 1, 1, 1] } });
    sim.setMaintenance(0);
    var res = sim.restore(0);
    assert(res.ok && res.restored, 'restore acknowledged');
    var e = sim.state.elevators[0];
    assertEq(e.maintenanceStatus, 'ACTIVE', 'ACTIVE again');
    assertEq(e.state, 'IDLE', 'IDLE again');
    assertEq(e.estimatedAvailabilityTime, null, 'availability estimate cleared');
    assert(Strategy.isEligible(e, 1), 'eligible again');
  });

  suite.test('M4 A serviced lift is never dispatched to, even when closest', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 3, 8, 10, 12, 15] } });
    sim.setMaintenance(0); // E1 idle at F1 immediate
    var r = sim.request(2, 9, 2);
    assert(r.ok, 'request assigned');
    assert(r.assignment.elevatorId !== 0, 'E1 skipped while under maintenance');
    assert(r.assignment.elevatorId === 1, 'E2 (next closest) selected');
  });

  suite.test('M5 Duplicate/invalid maintenance transitions are rejected', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 1, 1, 1, 1, 1] } });
    sim.setMaintenance(0);
    var again = sim.setMaintenance(0);
    assert(!again.ok && again.error && again.error.indexOf('already under maintenance') !== -1,
      'already under maintenance');
    var unknown = sim.setMaintenance(99);
    assert(!unknown.ok, 'unknown elevator rejected');
    assert(unknown.error && unknown.error.indexOf('Unknown') !== -1, 'clear error');
  });

  suite.test('M6 Service duration respected; lift works again after restore', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 1, 1, 1, 1, 1] } });
    var set = sim.setMaintenance(0);
    assertEq(set.elevatorId, 0, 'maintenance target');
    assertEq(sim.state.elevators[0].estimatedAvailabilityTime, 60, '60s estimate');
    for (var t = 0; t < 60; t += 1) sim.tick();
    assertEq(sim.state.elevators[0].maintenanceStatus, 'MAINTENANCE',
      'stays in MAINTENANCE until restored');
    sim.restore(0);
    var r = sim.request(1, 9, 1);
    assert(r.ok && r.assignment.elevatorId === 0, 'restored E1 serves calls again');
    var ok = runTo(sim, function () {
      return sim.state.requests[r.requestId].status === 'DELIVERED';
    }, 80);
    assert(ok, 'restored lift completes a full journey');
  });

  suite.test('M7 Restore immediately reconsiders queued requests', function () {
    var sim = Engine.create({ elevators: { initialFloors: [1, 1, 1, 1, 1, 1] } });
    for (var i = 0; i < 6; i += 1) sim.setMaintenance(i);
    var r = sim.request(3, 9, 2); // queued: nothing available
    assert(sim.state.queuedRequestIds.indexOf(r.requestId) !== -1, 'request parked in queue');
    sim.restore(0);
    var req = sim.state.requests[r.requestId];
    assertEq(req.assignedElevatorId, 0, 'restored E1 picks up queued request');
    assertEq(req.status, 'ASSIGNED', 'back in service');
    assertEq(sim.state.queuedRequestIds.indexOf(r.requestId), -1, 'queue drained for it');
  });

  module.exports = { suites: { maintenance: suite } };
}(typeof window !== 'undefined' ? window : globalThis));