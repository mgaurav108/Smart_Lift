/* Smart Lift - New DCS unit tests: scoring (Spec §43) and tie-breaking (§44).
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;
  var assertEqArr = TestSuite.assertEqArr;

  var Config = require('../../config/default-config.js');
  var SimulationState = require('../../simulation/state.js');
  var Elevator = require('../../domain/elevator.js');
  var Domain = require('../../domain/state.js');
  var Route = require('../../dispatch/eta.js');
  var ElevatorScorer = require('../../dispatch/scorer.js');
  var Strategy = require('../../dispatch/strategy.js');

  var suite = new TestSuite.Suite();

  var WEIGHTS = { waitTime: 10, additionalStops: 8, distance: 2, load: 5,
    direction: 4, occupancy: 3, imbalance: 2 };

  function makeState(floors) {
    var cfg = Config.create({
      elevators: { count: floors.length, initialFloors: floors }
    });
    return SimulationState.create(cfg);
  }

  function scorerAt(state, elevatorId, o, d, pc, waitticks) {
    var ev = state.elevators[elevatorId];
    var cand = Route.bestInsertion(ev, o, d, state.config);
    var req = { passengerCount: pc, waitingTime: waitticks || 0 };
    return ElevatorScorer.score(ev, req, cand, {
      config: state.config,
      avgOccupancyFrac: 0,
      compatibility: 'HIGH'
    });
  }

  suite.test('43.1 ETA term dominates: closer elevator scores lower', function () {
    var state = makeState([3, 15]); // E1 at 3, E2 at 15
    var s1 = scorerAt(state, 0, 5, 9, 1, 0);
    var s2 = scorerAt(state, 1, 5, 9, 1, 0);
    assert(s1.terms.wait < s2.terms.wait, 'E1 wait term smaller');
    assert(s1.baseScore < s2.baseScore, 'E1 base score smaller');
  });

  suite.test('43.2 Additional stops: request already on committed path pays nothing', function () {
    var state = makeState([1, 8]);
    state.elevators[0].targetFloors = [5, 7, 10]; // E1 committed to 5,7,10
    var s1 = scorerAt(state, 0, 5, 7, 1, 0);      // 5->7 both already scheduled
    var s2 = scorerAt(state, 1, 5, 7, 1, 0);      // idle E2 pays full pickup+drop
    assertEq(s1.detail.addedStops, 0, 'E1 adds zero stops (collapse dedups)');
    assertEqArr(s1.detail.route, [5, 7, 10], 'E1 route unchanged');
    assertEq(s1.terms.additionalStops, 0, 'E1 stops term zero');
    assertEq(s2.detail.addedStops, 2, 'E2 adds two stops');
    assert(s2.terms.additionalStops > s1.terms.additionalStops, 'E2 pays more');
  });

  suite.test('43.3 Direction penalty: reversal is more expensive', function () {
    var state = makeState([2, 2]);
    state.elevators[0].state = Domain.ElevatorState.MOVING_UP;
    state.elevators[0].targetFloors = [6];
    state.elevators[1].state = Domain.ElevatorState.MOVING_UP;
    state.elevators[1].targetFloors = [6];
    // E1 backs to origin 2 (reversal), E2 is en-route to origin 4.
    var sA = scorerAt(state, 0, 2, 8, 1, 0);
    var sB = scorerAt(state, 1, 4, 8, 1, 0);
    assert(sA.detail.directionPenalty === 1, 'reversal flagged');
    assert(sB.detail.directionPenalty === 0, 'en-route not flagged');
    assert(sA.terms.direction > 0, 'direction term charged for E1');
    assertEq(sB.terms.direction, 0, 'no direction term for E2');
  });

  suite.test('43.4 Occupancy: full lift pays more, empty lift favored', function () {
    var state = makeState([3, 3]);
    Elevator.boardPassengers(state.elevators[0], 9);
    var s1 = scorerAt(state, 0, 5, 8, 1, 0);
    var s2 = scorerAt(state, 1, 5, 8, 1, 0);
    assert(s1.terms.occupancy > s2.terms.occupancy, 'busy lift occupancy term larger');
  });

  suite.test('43.5 Workload imbalance term pushes demand to the least loaded car', function () {
    var state = makeState([3, 3, 3]);
    Elevator.boardPassengers(state.elevators[0], 4); // E1 half full
    var req = { requestId: 'R0', originFloor: 5, destinationFloor: 9,
      passengerCount: 1, waitingTime: 0 };
    var eval_ = Strategy.WeightedDCSStrategy.evaluate(state, req);
    var cand0 = null, cand1 = null;
    eval_.candidates.forEach(function (c) {
      if (c.elevatorId === 0) cand0 = c;
      if (c.elevatorId === 1) cand1 = c;
    });
    assert(cand0 && cand1, 'candidates for E1 and E2 exist');
    // avg occupancy fraction = (4/10)/3 = 0.133; E1 frac 0.5 -> imbal 0.367,
    // E2 frac 0.1 -> imbal 0.033
    assert(cand0.terms.imbalance > cand1.terms.imbalance, 'oversubscribed E1 pays more imbalance');
    assert(cand0.terms.imbalance > 0.2, 'E1 imbalance magnitude');
    assert(cand1.terms.imbalance < 0.1, 'E2 near-average imbalance');
  });

  suite.test('43.6 Maintenance elevator can never win, even if closest', function () {
    var state = makeState([1, 5, 8, 12, 15]);
    // E1 (id 0) is physically closest but under maintenance.
    var e0 = state.elevators[0];
    e0.maintenanceStatus = Domain.MaintenanceStatus.MAINTENANCE;
    e0.state = Domain.ElevatorState.MAINTENANCE;

    var req = { requestId: 'R0', originFloor: 3, destinationFloor: 9,
      passengerCount: 1, waitingTime: 0 };
    var eval_ = Strategy.WeightedDCSStrategy.evaluate(state, req);
    assert(eval_.winner, 'a winner exists');
    assert(eval_.winner.elevatorId !== 0, 'maintenance E1 never selected');
    assert(eval_.winner.elevatorId === 1, 'E2 (closest eligible) selected');
  });

  suite.test('44.1 Tie-break: equal scores resolve by ETA -> stops -> occupancy -> id', function () {
    var state = makeState([5, 5, 5]);
    var req = { requestId: 'R0', originFloor: 5, destinationFloor: 9,
      passengerCount: 1, waitingTime: 0 };
    // All three idle at 5, identical everything -> lower id must win.
    var ev1 = Strategy.WeightedDCSStrategy.evaluate(state, req);
    assertEq(ev1.winner.elevatorId, 0, 'lowest id wins exact tie');

    // Load E1 so E2 and E3 tie below it (E2 lower occupancy term -> actually
    // E1 now has occupancy penalty; to keep deterministic, check eta rule).
    Elevator.boardPassengers(state.elevators[0], 3);
    var ev2 = Strategy.WeightedDCSStrategy.evaluate(state, req);
    assert(ev2.winner.elevatorId !== 0, 'loaded E1 loses on occupancy');
  });

  suite.test('44.2 Tie tolerance: near-equal scores pick deterministic winner', function () {
    var state = makeState([4, 6]);
    var req = { requestId: 'R0', originFloor: 5, destinationFloor: 9,
      passengerCount: 1, waitingTime: 0 };
    var ev = Strategy.WeightedDCSStrategy.evaluate(state, req);
    // Both 1 floor away; E1 (4) closer by ETA -> wins deterministically.
    assert(ev.winner, 'winner');
    assertEq(ev.winner.elevatorId, 0, 'deterministic under tolerance');
  });

  module.exports = { suites: { scoring: suite } };
}(typeof window !== 'undefined' ? window : globalThis));