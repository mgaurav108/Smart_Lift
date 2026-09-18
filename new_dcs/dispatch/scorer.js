/* Smart Lift - New DCS dispatch: ElevatorScorer.
 * Spec/phase-3-newdcs.md §14 (candidate scoring), §43 (scoring tests).
 *
 * Score = W_wait*ETA + W_stops*AdditionalStops + W_distance*TravelDistance
 *       + W_load*LoadPenalty + W_direction*DirectionPenalty
 *       + W_occupancy*OccupancyPenalty + W_imbalance*ImbalancePenalty
 *       + StarvationPenalty (additive, §20)
 *
 * Lower is better. Every term is exposed for explainability (§29, §57).
 */
(function (global) {
  'use strict';

  function score(elevator, request, candidate, context) {
    var cfg = context.config;
    var w = cfg.dispatch.weights;

    var existing = elevator.targetFloors;
    var baseRoute = existing.slice();

    var addedStops = Math.max(0, candidate.route.length - baseRoute.length);
    var addedDistance = routeDistance(cur(elevator), candidate.route) -
      routeDistance(cur(elevator), baseRoute);
    if (addedDistance < 0) addedDistance = 0;

    var projectedOccupancy = elevator.occupancy + request.passengerCount;
    var occupancyFrac = projectedOccupancy / elevator.capacity;
    var loadFrac = request.passengerCount / elevator.capacity;
    var avgOccupancyFrac = context.avgOccupancyFrac || 0;
    var imbalance = Math.abs(occupancyFrac - avgOccupancyFrac);

    var existingReversals = reversals(cur(elevator), baseRoute);
    var directionPenalty = candidate.reversals > existingReversals ? 1 : 0;

    var waitSeconds = request.waitingTime / cfg.time.ticksPerSecond;
    var starvationPenalty = Math.max(0, waitSeconds - cfg.dispatch.longWaitThresholdSeconds) *
      cfg.dispatch.starvationWeight;

    var waitTerm = w.waitTime * candidate.eta;
    var stopsTerm = w.additionalStops * addedStops;
    var distanceTerm = w.distance * addedDistance;
    var loadTerm = w.load * loadFrac;
    var dirTerm = w.direction * directionPenalty;
    var occTerm = w.occupancy * occupancyFrac;
    var imbTerm = w.imbalance * imbalance;

    var baseScore = waitTerm + stopsTerm + distanceTerm + loadTerm + dirTerm + occTerm + imbTerm;
    var totalScore = baseScore + starvationPenalty;

    return {
      elevatorId: elevator.id,
      elevatorName: elevator.name,
      score: totalScore,
      baseScore: baseScore,
      starvationPenalty: starvationPenalty,
      terms: {
        wait: waitTerm,
        additionalStops: stopsTerm,
        distance: distanceTerm,
        load: loadTerm,
        direction: dirTerm,
        occupancy: occTerm,
        imbalance: imbTerm
      },
      detail: {
        eta: candidate.eta,
        addedStops: addedStops,
        addedDistance: addedDistance,
        occupancy: elevator.occupancy,
        projectedOccupancy: projectedOccupancy,
        capacity: elevator.capacity,
        occupancyFrac: occupancyFrac,
        loadFrac: loadFrac,
        imbalance: imbalance,
        directionPenalty: directionPenalty,
        reversals: candidate.reversals,
        route: candidate.route.slice(),
        compatibility: context.compatibility || 'HIGH',
        status: elevator.maintenanceStatus
      }
    };
  }

  function cur(elevator) { return elevator.currentFloor; }
  function routeDistance(start, route) {
    var d = 0, prev = start;
    for (var i = 0; i < route.length; i += 1) { d += Math.abs(prev - route[i]); prev = route[i]; }
    return d;
  }
  function reversals(start, route) {
    var c = 0, dir = 0, prev = start;
    for (var i = 0; i < route.length; i += 1) {
      var d = route[i] > prev ? 1 : (route[i] < prev ? -1 : 0);
      if (d !== 0) { if (dir !== 0 && d !== dir) c += 1; dir = d; }
      prev = route[i];
    }
    return c;
  }

  var ElevatorScorer = {
    score: score,
    /* Internal helpers exposed for unit tests (§43): changing any input must
     * move the score in the expected direction. */
    _addedStops: function (cand, base) { return Math.max(0, cand.route.length - base.length); },
    _addedDistance: function (elevator, cand, base) {
      return Math.max(0, routeDistance(cur(elevator), cand.route) -
        routeDistance(cur(elevator), base));
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ElevatorScorer;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.ElevatorScorer = ElevatorScorer;
}(typeof window !== 'undefined' ? window : globalThis));