/* Smart Lift - New DCS unit tests: domain models (Spec §40).
 * Elevator initialization, floor range, request validation, capacity.
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;
  var assertEqArr = TestSuite.assertEqArr;
  var assertThrows = TestSuite.assertThrows;

  var Domain = require('../../domain/state.js');
  var Floor = require('../../domain/floor.js');
  var Elevator = require('../../domain/elevator.js');
  var Request = require('../../domain/request.js');

  var suite = new TestSuite.Suite();

  suite.test('40.1 Elevator initializes at the correct floor', function () {
    var e = Elevator.create(0, 10, 1);
    assertEq(e.currentFloor, 1, 'starts at floor 1');
    assertEq(e.name, 'E1', 'name is E1');
    var e7 = Elevator.create(6, 10, 7);
    assertEq(e7.currentFloor, 7, 'starts at configured floor');
  });

  suite.test('40.2 Elevator capacity is 10', function () {
    var e = Elevator.create(0, 10, 1);
    assertEq(e.capacity, 10, 'capacity 10');
    assertEq(Elevator.capacityRemaining(e), 10, 'all seats free');
  });

  suite.test('40.3 Floor range is 1-15', function () {
    var range = Floor.create(15, 1);
    assertEq(range.min, 1, 'min floor');
    assertEq(range.max, 15, 'max floor');
    assert(range.isValid(1) && range.isValid(15) && range.isValid(8), 'valid floors 1,8,15');
    assertEq(range.name(4), 'F4', 'floor naming');
  });

  suite.test('40.4 Invalid floor is rejected', function () {
    var range = Floor.create(15, 1);
    assert(!range.isValid(0), 'floor 0 invalid');
    assert(!range.isValid(16), 'floor 16 invalid');
    assert(!range.isValid(2.5), 'non-integer invalid');
    assertThrows(function () { Floor.requireValid(range, 0); }, 'Invalid floor', 'throws on 0');
  });

  suite.test('40.5 Same origin/destination is rejected', function () {
    var range = Floor.create(15, 1);
    var v = Request.validate(range, 10, 5, 5, 1);
    assert(!v.ok, 'same floor rejected');
    assert(v.error.indexOf('same') !== -1, 'error clarifies');
  });

  suite.test('40.6 Passenger count 1 is valid', function () {
    var range = Floor.create(15, 1);
    assert(Request.validate(range, 10, 3, 9, 1).ok, 'single passenger accepted');
  });

  suite.test('40.7 Passenger count 10 is valid', function () {
    var range = Floor.create(15, 1);
    assert(Request.validate(range, 10, 3, 9, 10).ok, 'full-car booking accepted');
  });

  suite.test('40.8 Passenger count 11 is rejected', function () {
    var range = Floor.create(15, 1);
    var v = Request.validate(range, 10, 3, 9, 11);
    assert(!v.ok, '11 passengers rejected');
    assert(v.error.indexOf('capacity') !== -1, 'error mentions capacity');
    assert(!Request.validate(range, 10, 3, 9, 0).ok, 'zero passengers rejected');
    assert(!Request.validate(range, 10, 3, 9, -1).ok, 'negative rejected');
  });

  suite.test('40.9 Occupancy cannot exceed capacity', function () {
    var e = Elevator.create(0, 10, 1);
    Elevator.boardPassengers(e, 6);
    assertEq(e.occupancy, 6, 'six aboard');
    assertThrows(function () { Elevator.boardPassengers(e, 5); }, 'exceed capacity',
      'boarding past capacity throws');
  });

  suite.test('40.10 Elevator state transitions are valid', function () {
    var e = Elevator.create(0, 10, 1);
    var ES = Domain.ElevatorState;
    assertEq(e.state, ES.IDLE, 'starts IDLE');
    assert(Domain.isValidElevatorState(ES.MOVING_UP), 'MOVING_UP valid');
    assert(Domain.isValidElevatorState(ES.DOOR_OPEN), 'DOOR_OPEN valid');
    assert(Domain.isValidElevatorState(ES.DOOR_CLOSING), 'DOOR_CLOSING valid');
    assert(Domain.isValidElevatorState(ES.MAINTENANCE), 'MAINTENANCE valid');
    assert(Domain.isValidElevatorState(ES.OUT_OF_SERVICE), 'OUT_OF_SERVICE valid');
    var fake = 'NONSENSE';
    assert(!Domain.isValidElevatorState(fake), 'unknown state invalid');
  });

  suite.test('40.11 Maintenance state is represented correctly', function () {
    var e = Elevator.create(0, 10, 1);
    assertEq(e.maintenanceStatus, Domain.MaintenanceStatus.ACTIVE, 'starts ACTIVE');
    assert(Elevator.isAvailable(e), 'ACTIVE elevator available');
    e.maintenanceStatus = Domain.MaintenanceStatus.MAINTENANCE;
    assert(!Elevator.isAvailable(e), 'MAINTENANCE elevator unavailable');
    e.maintenanceStatus = Domain.MaintenanceStatus.MAINTENANCE_PENDING;
    assert(!Elevator.isAvailable(e), 'PENDING elevator unavailable to new work');
  });

  suite.test('40.12 Elevator IDs are unique', function () {
    var seen = {};
    for (var i = 0; i < 6; i += 1) {
      var e = Elevator.create(i, 10, 1);
      assert(!seen[e.id], 'id ' + i + ' unique');
      seen[e.id] = true;
    }
    assertEqArr(['E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
      [0, 1, 2, 3, 4, 5].map(function (i) { return Elevator.create(i, 10, 1).name; }),
      'six unique names');
  });

  module.exports = { suites: { domain: suite } };
}(typeof window !== 'undefined' ? window : globalThis));