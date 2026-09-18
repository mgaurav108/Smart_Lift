/* Smart Lift - New DCS unit tests: eligibility (Spec §41).
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;

  var Config = require('../../config/default-config.js');
  var Domain = require('../../domain/state.js');
  var Elevator = require('../../domain/elevator.js');
  var Strategy = require('../../dispatch/strategy.js');
  var Engine = require('../../simulation/engine.js');

  var suite = new TestSuite.Suite();

  function makeElevators(kind) {
    var e = Elevator.create(0, 10, 1);
    if (kind === 'maintenance') e.maintenanceStatus = Domain.MaintenanceStatus.MAINTENANCE;
    if (kind === 'out') e.state = Domain.ElevatorState.OUT_OF_SERVICE;
    return e;
  }

  suite.test('41.1 Available elevator is eligible', function () {
    var e = makeElevators('idle');
    assert(Strategy.isEligible(e, 1), 'idle & active is eligible');
    assert(Strategy.isEligible(e, 10), 'even a full-car booking fits on an empty lift');
  });

  suite.test('41.2 Maintenance elevator is ineligible', function () {
    var e = makeElevators('maintenance');
    assert(!Strategy.isEligible(e, 1), 'MAINTENANCE elevator never eligible, even when nearest');
    assert(!Strategy.isEligible(e, 10), 'MAINTENANCE cannot take a bus');
  });

  suite.test('41.3 Out-of-service elevator is ineligible', function () {
    var e = makeElevators('out');
    assert(!Strategy.isEligible(e, 1), 'OUT_OF_SERVICE elevator is ineligible');
  });

  suite.test('41.4 Full elevator is ineligible', function () {
    var e = Elevator.create(0, 10, 1);
    Elevator.boardPassengers(e, 10);
    assert(!Strategy.isEligible(e, 1), 'no seats -> ineligible');
  });

  suite.test('41.5 Elevator with sufficient remaining capacity is eligible', function () {
    var e = Elevator.create(0, 10, 1);
    Elevator.boardPassengers(e, 8);
    assert(Strategy.isEligible(e, 2), '8+2 fits');
    assert(!Strategy.isEligible(e, 3), '8+3 does not fit');
  });

  suite.test('41.6 Restored elevator becomes eligible', function () {
    var sim = Engine.create();
    sim.setMaintenance(0);
    var e0 = sim.state.elevators[0];
    assert(!Strategy.isEligible(e0, 1), 'serviced lift ineligible');
    sim.restore(0);
    assert(Strategy.isEligible(e0, 1), 'restored lift eligible again');
  });

  suite.test('41.7 No eligible elevator -> request queued', function () {
    var sim = Engine.create();
    for (var i = 0; i < 6; i += 1) sim.setMaintenance(i);
    var res = sim.request(3, 9, 2);
    assert(!res.ok, 'request not assigned');
    assert(res.queued === true, 'request queued');
    assertEq(res.status, 'WAITING_FOR_AVAILABLE_ELEVATOR', 'status reflects availability');
    assertEq(sim.state.queuedRequestIds.length, 1, 'one queued request');
  });

  module.exports = { suites: { eligibility: suite } };
}(typeof window !== 'undefined' ? window : globalThis));