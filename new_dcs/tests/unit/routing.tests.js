/* Smart Lift - New DCS unit tests: route optimization (Spec §49) and
 * destination grouping (Spec §48).
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
  var Grouping = require('../../dispatch/grouping.js');

  var suite = new TestSuite.Suite();

  var cfg = Config.create({});

  function elec(floor, state) {
    var e = Elevator.create(0, 10, floor);
    if (state === 'up') e.state = Domain.ElevatorState.MOVING_UP;
    if (state === 'down') e.state = Domain.ElevatorState.MOVING_DOWN;
    return e;
  }

  suite.test('49.1 Inserting new stops does not reorder committed stops', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [6, 10];
    var c = Route.bestInsertion(e, 4, 8, cfg);
    assertEqArr(c.route, [4, 6, 8, 10], 'committed 6 then 10 preserved in order');
  });

  suite.test('49.2 Stop is inserted at the correct position', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [3, 6, 9, 12];
    var c = Route.bestInsertion(e, 5, 7, cfg);
    assertEqArr(c.route, [3, 5, 6, 7, 9, 12], 'origin between 3/6, dest between 6/9');
  });

  suite.test('49.3 Original committed stops are all preserved', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [2, 4, 8, 11, 14];
    var before = e.targetFloors.slice();
    var c = Route.bestInsertion(e, 6, 10, cfg);
    before.forEach(function (f) {
      assert(c.route.indexOf(f) !== -1, 'committed stop ' + f + ' still served');
    });
  });

  suite.test('49.4 No duplicate stops are created', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [6, 10];
    // origin 6 already committed: route must not contain 6 twice.
    var c = Route.bestInsertion(e, 6, 12, cfg);
    var seen = {};
    c.route.forEach(function (f) {
      assert(!seen[f], 'floor ' + f + ' appears once');
      seen[f] = true;
    });
  });

  suite.test('49.5 ETA is accounted per candidate', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [3, 5, 8];
    var c = Route.bestInsertion(e, 7, 9, cfg);
    assertEqArr(c.route, [3, 5, 7, 8, 9], 'sorted upward tour');
    // eta 1->3 (2) + dwell(3) + 3->5 (2) + dwell(3) + 5->7 (2) = 12
    assertEq(c.eta, 12, 'ETA counts travel and prior dwell (doors shut before pickup stop)');
  });

  suite.test('49.6 Optimal insertion selected among candidates', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [4, 8, 12];
    var c = Route.bestInsertion(e, 6, 7, cfg);
    // Fewest reversals first: upward weave is the optimal answer.
    assertEq(c.reversals, 0, 'zero-reversal insertion chosen');
    assertEq(c.eta, 3 + 3 + 2, 'eta of optimal insertion: 1->4, dwell, 4->6');
    assertEqArr(c.route, [4, 6, 7, 8, 12], 'optimal route weaves 6,7 between 4 and 8');
  });

  suite.test('48.1 Same-direction sharing is HIGH compatibility', function () {
    var e = elec(1, 'idle');
    e.targetFloors = [1, 10]; // F1->F10 already committed
    // A second passenger at F1 going to F11 slots into the same upward trip.
    var c = Grouping.compatibilityLevel(e, 1, 11, cfg);
    assertEq(c, Grouping.HIGH, 'F1->F11 pairs with F1->F10 on one car');
  });

  suite.test('48.2 Opposite-direction demand is LOW compatibility', function () {
    var e = elec(8, 'down');
    e.targetFloors = [4]; // committed downward run
    var c = Grouping.compatibilityLevel(e, 2, 6, cfg);
    assertEq(c, Grouping.LOW, 'picking up below the descending car needs a reversal');
  });

  suite.test('48.3 areCompatible profile check (F1->F10 + F1->F11)', function () {
    var up10 = { direction: 'UP', origin: 1, destination: 10 };
    var up11 = { direction: 'UP', origin: 1, destination: 11 };
    assert(Grouping.areCompatible(up10, up11, cfg), 'same direction shares car');
    var dn4 = { direction: 'DOWN', origin: 12, destination: 4 };
    assert(!Grouping.areCompatible(up10, dn4, cfg), 'opposite directions kept apart');
  });

  module.exports = { suites: { routing: suite } };
}(typeof window !== 'undefined' ? window : globalThis));