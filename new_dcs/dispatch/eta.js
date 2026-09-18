/* Smart Lift - New DCS dispatch: RoutePlanner + ETAEstimator.
 * Spec/phase-3-newdcs.md §15 (ETA), §17 (incremental cost), §18 (route
 * planning), §42 (ETA tests), §49 (routing tests).
 *
 * A candidate route is built by inserting (origin, dest) into an elevator's
 * committed targetFloors in every ordered position. Mid-run (MOVING_UP /
 * MOVING_DOWN) new stops may only be inserted AFTER the committed first stop
 * so previously assigned passengers are never reordered mid-leg. For an IDLE
 * elevator any position is allowed.
 */
(function (global) {
  'use strict';

  var Domain = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Domain);

  function collapse(stops) {
    var out = [];
    for (var i = 0; i < stops.length; i += 1) {
      if (out.length === 0 || out[out.length - 1] !== stops[i]) out.push(stops[i]);
    }
    return out;
  }

  /* Door cycle used in ETA: doors open + doors close per served stop. */
  function doorCycleTicks(config) {
    var e = config.elevators;
    return e.doorOpenTicks + e.doorCloseTicks;
  }

  /* Floors actually travelled from `start` along `route` (no dwell). */
  function routeDistance(start, route) {
    var d = 0, prev = start;
    for (var i = 0; i < route.length; i += 1) {
      d += Math.abs(prev - route[i]);
      prev = route[i];
    }
    return d;
  }

  /* Total time (ticks) to execute `route` from `start`, including per-stop
   * door dwell before reaching the final stop. */
  function routeTime(start, route, config) {
    var t = 0, prev = start;
    var dwell = doorCycleTicks(config);
    for (var i = 0; i < route.length; i += 1) {
      t += Math.abs(prev - route[i]);
      if (i < route.length - 1) t += dwell;
      prev = route[i];
    }
    return t;
  }

  /* Ticks for `start` to reach `pickupFloor` along `route` (doors OPEN there;
   * dwell on previous stops counts). */
  function etaToFloor(start, route, pickupFloor, config) {
    var t = 0, prev = start;
    var dwell = doorCycleTicks(config);
    for (var i = 0; i < route.length; i += 1) {
      t += Math.abs(prev - route[i]);
      if (route[i] === pickupFloor) return t;
      t += dwell;
      prev = route[i];
    }
    return t;
  }

  /* Number of direction reversals while executing `route` from `start`.
   * Taking off never counts; every flip after that adds 1. */
  function directionChanges(start, route) {
    var changes = 0, dir = 0, prev = start;
    for (var i = 0; i < route.length; i += 1) {
      var d = route[i] > prev ? 1 : (route[i] < prev ? -1 : 0);
      if (d !== 0) {
        if (dir !== 0 && d !== dir) changes += 1;
        dir = d;
      }
      prev = route[i];
    }
    return changes;
  }

  function isMidRun(elevator) {
    return elevator.state === Domain.ElevatorState.MOVING_UP ||
      elevator.state === Domain.ElevatorState.MOVING_DOWN;
  }

  /* The elevator's committed route before this request. */
  function existingRoute(elevator) {
    return elevator.targetFloors.slice();
  }

  /* Generate all candidate insertions of (origin, dest) into the elevator's
   * committed targetFloors, preserving pickup-before-destination. Returns
   * sorted candidates (fewest reversals, then lowest ETA, then lowest total
   * time) for deterministic scoring.
   *
   * Mid-run (MOVING_UP/MOVING_DOWN) new stops may only be inserted after the
   * committed first stop - EXCEPT an origin that sits between the current
   * floor and that first stop, which is a forward en-route pickup that
   * reorders nothing. Inserting behind the car would need a live reversal and
   * is left to the reversal penalty / other elevators. */
  function candidateRoutes(elevator, originFloor, destFloor, config) {
    var floors = elevator.targetFloors.slice();
    var midRun = isMidRun(elevator);
    var startPos = 0;
    if (midRun && floors.length > 0) {
      var first = floors[0];
      var enRoute = elevator.state === Domain.ElevatorState.MOVING_UP
        ? (elevator.currentFloor < originFloor && originFloor <= first)
        : (elevator.currentFloor > originFloor && originFloor >= first);
      if (!enRoute) startPos = 1;
    }
    var candidates = [];

    for (var i = startPos; i <= floors.length; i += 1) {
      for (var j = i; j <= floors.length + 1; j += 1) {
        var s = floors.slice();
        s.splice(j, 0, destFloor);
        s.splice(i, 0, originFloor);
        var plan = collapse(s);
        var reversals = directionChanges(elevator.currentFloor, plan);
        var eta = etaToFloor(elevator.currentFloor, plan, originFloor, config);
        var total = routeTime(elevator.currentFloor, plan, config);
        candidates.push({
          route: plan,
          eta: eta,
          totalTime: total,
          reversals: reversals
        });
      }
    }

    candidates.sort(function (a, b) {
      if (a.reversals !== b.reversals) return a.reversals - b.reversals;
      if (a.eta !== b.eta) return a.eta - b.eta;
      if (a.totalTime !== b.totalTime) return a.totalTime - b.totalTime;
      return 0;
    });
    return candidates;
  }

  /* Best candidate insertion for a request against one elevator (chosen by
   * the same lexicographic order used above). */
  function bestInsertion(elevator, originFloor, destFloor, config) {
    var cands = candidateRoutes(elevator, originFloor, destFloor, config);
    return cands.length ? cands[0] : null;
  }

  var Route = {
    collapse: collapse,
    routeDistance: routeDistance,
    routeTime: routeTime,
    etaToFloor: etaToFloor,
    directionChanges: directionChanges,
    existingRoute: existingRoute,
    candidateRoutes: candidateRoutes,
    bestInsertion: bestInsertion
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Route;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Route = Route;
}(typeof window !== 'undefined' ? window : globalThis));