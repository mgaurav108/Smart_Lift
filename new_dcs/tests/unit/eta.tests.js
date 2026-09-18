/* Smart Lift - New DCS unit tests: ETA / route planning (Spec §42).
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;
  var assertEqArr = TestSuite.assertEqArr;

  var Config = require('../../config/default-config.js');
  var Domain = require('../../domain/state.js');
  var Elevator = require('../../domain/elevator.js');
  var Route = require('../../dispatch/eta.js');

  var suite = new TestSuite.Suite();

  var cfg = Config.create({
    elevators: { doorOpenTicks: 2, doorCloseTicks: 1 } // dwell cycle = 3
  });
  function elec(floor, state) {
    var e = Elevator.create(0, 10, floor);
    if (state === 'up') { e.state = Domain.ElevatorState.MOVING_UP; e.direction = Domain.Direction.UP; }
    if (state === 'down') { e.state = Domain.ElevatorState.MOVING_DOWN; e.direction = Domain.Direction.DOWN; }
    return e;
  }
  function insert(e, o, d) {
    return Route.bestInsertion(e, o, d, cfg);
  }

  suite.test('42.1 Idle elevator directly below origin', function () {
    // E at 3, request 5->9: eta = |3-5| = 2
    var e = elec(3, 'idle');
    var c = insert(e, 5, 9);
    assert(c, 'candidate exists');
    assertEq(c.eta, 2, 'eta 2 (2 floors up)');
  });

  suite.test('42.2 Idle elevator directly above origin', function () {
    // E at 8, request 5->9: eta = |8-5| = 3
    var e = elec(8, 'idle');
    var c = insert(e, 5, 9);
    assertEq(c.eta, 3, 'eta 3 (3 floors down)');
  });

  suite.test('42.3 Moving elevator toward origin (en route pickup is free)', function () {
    // E moving UP at 3 committed to [6,10]; request 5->9 sits en route.
    var e = elec(3, 'up');
    e.targetFloors = [6, 10];
    var c = insert(e, 5, 9);
    assert(c, 'candidate exists');
    assertEq(c.reversals, 0, 'no reversal for en-route pickup');
    assertEq(c.eta, 2, 'eta = 3->5');
    assertEqArr(c.route, [5, 6, 9, 10], 'pickup slots in before committed stop');
  });

  suite.test('42.4 Moving elevator away from origin', function () {
    // E moving UP at 3 committed to [6]; request 2->8 is behind the car.
    var e = elec(3, 'up');
    e.targetFloors = [6];
    var c = insert(e, 2, 8);
    assert(c, 'candidate still generated (reversal)');
    // Route [6,2,8] continues to the committed stop 6, comes back down to 2,
    // then back up to 8: two flips (up->down, down->up).
    assert(c.reversals >= 1, 'picking up behind the car forces backtracking (got ' + c.reversals + ')');
    assert(c.reversals === 2, 'exactly two reversals for a full backtrack');
    assert(c.eta > 1, 'eta reflects the backtrack');
  });

  suite.test('42.5 Elevator with existing stops', function () {
    // E idle at 1, existing stops [6,10,14]; request 8->13 merges in.
    var e = elec(1, 'idle');
    e.targetFloors = [6, 10, 14];
    var c = insert(e, 8, 13);
    assert(c, 'candidate exists');
    // eta 1->6 (5) + dwell(3) + 6->8 (2) = 10
    assertEq(c.eta, 10, 'eta counts travel + dwell before pickup');
    assertEq(c.reversals, 0, 'request compatible with upward tour');
  });

  suite.test('42.6 Elevator with multiple stops still deterministic', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [3, 6, 9, 12, 15];
    var c = insert(e, 7, 14);
    assert(c, 'candidate exists');
    // eta = 1->3 (2) + dwell(3) + 3->6 (3) + dwell(3) + 6->7 (1) = 12
    assertEq(c.eta, 12, 'eta computed across stops');
    assertEqArr(c.route, [3, 6, 7, 9, 12, 14, 15], 'request woven into existing tour');
  });

  suite.test('42.7 Elevator requiring direction reversal', function () {
    // E idle at 10, existing stops [5] (committed to go down); request 12->15.
    var e = elec(10, 'idle');
    e.targetFloors = [5];
    var c = insert(e, 12, 15);
    assert(c, 'candidate exists');
    assert(c.reversals >= 1, 'serving 12 after committing to 5 needs a reversal');
  });

  suite.test('42.8 Elevator with compatible destination', function () {
    // Same upward corridor: E at 2, existing [6,10], request 4->8 stays UP.
    var e = elec(2, 'idle');
    e.targetFloors = [6, 10];
    var c = insert(e, 4, 8);
    assertEq(c.reversals, 0, 'compatible destination: zero reversals');
    assertEqArr(c.route, [4, 6, 8, 10], 'leaves committed stops in order');
  });

  suite.test('42.9 Elevator with incompatible route', function () {
    // E committed UP at 2 toward [6]; request 9->3 would drag the car back down.
    var e = elec(2, 'idle');
    e.targetFloors = [6];
    var c = insert(e, 9, 3);
    assert(c, 'candidate exists');
    assert(c.reversals >= 1, 'incompatible route at least one reversal');
  });

  suite.test('42.10 ETA remains deterministic', function () {
    var e = elec(3, 'idle');
    e.targetFloors = [6, 10, 14];
    var first = insert(e, 8, 13);
    var second = insert(e, 8, 13);
    assertEq(first.eta, second.eta, 'same input, same ETA');
    assertEqArr(first.route, second.route, 'same route');
  });

  module.exports = { suites: { eta: suite } };
}(typeof window !== 'undefined' ? window : globalThis));