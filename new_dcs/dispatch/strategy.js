/* Smart Lift - New DCS dispatch: DispatchStrategy + WeightedDCSStrategy.
 * Spec/phase-3-newdcs.md §61 (strategy pattern), §4 (basic dispatch),
 * §12 (eligibility), §19 (tie-breaking), §20 (starvation), §29/§57
 * (explainability).
 *
 * A strategy is a pure, stateless function of (state, request). This keeps
 * the simulation deterministic and lets different strategies (nearest,
 * weighted DCS, traffic-aware, future RL) be benchmarked on identical data
 * (§37, §64) without touching the domain model.
 */
(function (global) {
  'use strict';

  var Elevator = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/elevator.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Elevator);
  var Route = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./eta.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Route);
  var Grouping = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./grouping.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Grouping);
  var ElevatorScorer = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./scorer.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.ElevatorScorer);
  var Domain = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Domain);

  /* §12 Eligibility. An elevator is usable only if it is ACTIVE, not
   * OUT_OF_SERVICE, and has spare capacity for the passenger count. */
  function isEligible(elevator, passengerCount) {
    if (!Elevator.isAvailable(elevator)) return false;
    if (elevator.state === Domain.ElevatorState.OUT_OF_SERVICE) return false;
    return Elevator.canFit(elevator, passengerCount);
  }

  function eligibleElevators(state, passengerCount) {
    return state.elevators.filter(function (e) { return isEligible(e, passengerCount); });
  }

  /* Average occupancy fraction over the eligible fleet, used for the
   * load-balancing term (§22). */
  function avgOccupancyFraction(eligibles) {
    if (!eligibles.length) return 0;
    var sum = 0;
    eligibles.forEach(function (e) { sum += e.occupancy / e.capacity; });
    return sum / eligibles.length;
  }

  function withinTolerance(a, b, tol) {
    return Math.abs(a - b) <= tol;
  }

  /* Pick the winner from scored candidates using §19 deterministic tie-break:
   * lower ETA -> fewer expected stops -> lower occupancy -> fewer assigned
   * passengers -> lower elevator ID. */
  function tieBreakWinner(candidates, tol) {
    var best = candidates[0];
    for (var i = 1; i < candidates.length; i += 1) {
      var c = candidates[i];
      if (c.score < best.score - tol ||
          (withinTolerance(c.score, best.score, tol) && betterThan(c, best, tol))) {
        best = c;
      }
    }
    return best;
  }

  /* §19 deterministic tie-break: lower ETA -> fewer expected stops -> lower
   * occupancy -> fewer assigned passengers -> lower elevator ID. Score objects
   * carry their route/ETA under `detail`. */
  function betterThan(a, b, tol) {
    var elA = a.elevator, elB = b.elevator;
    var candA = a.detail, candB = b.detail;
    if (candA.eta !== candB.eta) return candA.eta < candB.eta;
    if (candA.route.length !== candB.route.length) return candA.route.length < candB.route.length;
    if (elA.occupancy !== elB.occupancy) return elA.occupancy < elB.occupancy;
    if (elA.assignedRequestIds.length !== elB.assignedRequestIds.length) {
      return elA.assignedRequestIds.length < elB.assignedRequestIds.length;
    }
    return elA.id < elB.id;
  }

  /* Deterministic pseudo-random float in [0,1) derived from a seed and the
   * request id (FNV-1a + xorshift finalizer). No Math.random: the "varied"
   * policy must still replay identically (Spec §25/§51/§67 determinism). */
  function seededFloat(seed, requestId) {
    var str = String(seed) + '|' + String(requestId);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  }

  /* 'varied' selection (config: dispatch.selection = 'varied').
   * 1. Group: a lift already committed to this destination keeps taking
   *    requests for it until it is full - 10 taps to F12 => ONE lift.
   * 2. Otherwise prefer the least-committed elevator so a single lift does
   *    not absorb destinations across the whole building.
   * 3. Among equally good candidates, pick one with a seeded pseudo-random
   *    draw so consecutive taps do not march through E1, E2, E3, ...
   * Fully deterministic for a given seed + request id. */
  function variedWinner(candidates, cfg, request) {
    var dest = request.destinationFloor;
    var already = candidates.filter(function (c) {
      return c.elevator.targetFloors.indexOf(dest) !== -1;
    });
    var pool = already.length ? already : candidates;

    var leastCommitted = Infinity;
    pool.forEach(function (c) {
      var n = c.elevator.assignedRequestIds.length;
      if (n < leastCommitted) leastCommitted = n;
    });
    var underloaded = pool.filter(function (c) {
      return c.elevator.assignedRequestIds.length === leastCommitted;
    });
    var bestScore = Infinity;
    underloaded.forEach(function (c) { if (c.baseScore < bestScore) bestScore = c.baseScore; });
    var tol = cfg.dispatch.tieTolerance;
    var best = underloaded.filter(function (c) { return c.baseScore <= bestScore + tol; });
    if (best.length === 1) return best[0];
    var r = seededFloat(cfg.dispatch.variationSeed, request.requestId);
    return best[Math.floor(r * best.length)];
  }

  var WeightedDCSStrategy = {
    name: 'weighted-dcs',
    isEligible: isEligible,
    eligibleElevators: eligibleElevators,

    /* Evaluate a request against the whole eligible fleet. Returns
     * { winner, candidates } where each candidate carries its score breakdown
     * and an explanation. winner is null when no elevator is eligible
     * (request stays queued - §31). */
    evaluate: function (state, request) {
      var cfg = state.config;
      var eligibles = eligibleElevators(state, request.passengerCount);
      var avgOcc = avgOccupancyFraction(eligibles);
      var candidates = [];

      eligibles.forEach(function (elevator) {
        var cand = Route.bestInsertion(elevator, request.originFloor,
          request.destinationFloor, cfg);
        if (!cand) return;
        var compatibility = Grouping.compatibilityLevel(elevator, request.originFloor,
          request.destinationFloor, cfg);
        var score = ElevatorScorer.score(elevator, request, cand, {
          config: cfg,
          avgOccupancyFrac: avgOcc,
          compatibility: compatibility
        });
        /* Live elevator ref needed by the tie-break (§19); explanation
         * consumers read `detail` only. */
        score.elevator = elevator;
        candidates.push(score);
      });

      candidates.sort(function (a, b) {
        if (a.baseScore !== b.baseScore) return a.baseScore - b.baseScore;
        return a.elevatorId - b.elevatorId;
      });

      var winner = null;
      var varied = false;
      if (candidates.length) {
        if (cfg.dispatch.selection === 'varied') {
          winner = variedWinner(candidates, cfg, request);
          varied = true;
        } else {
          winner = tieBreakWinner(candidates, cfg.dispatch.tieTolerance);
        }
      }

      if (winner) {
        winner.explanation = buildExplanation(winner);
        if (varied) {
          winner.explanation.push('Selected by load balance: ' +
            winner.elevator.assignedRequestIds.length +
            ' request(s) already committed');
        }
      }
      return { winner: winner, candidates: candidates };
    }
  };

  /* §29/§57 explanation, one line per factor. */
  function buildExplanation(score) {
    var d = score.detail;
    return [
      'ETA: ' + d.eta + ' sec',
      'Additional stops: ' + d.addedStops,
      'Occupancy: ' + d.occupancy + '/' + d.capacity,
      'Direction: ' + (d.directionPenalty ? 'reversal' : 'compatible'),
      'Destination compatibility: ' + d.compatibility,
      'Maintenance: ' + (score.detail.status === 'ACTIVE' ? 'AVAILABLE' : 'UNAVAILABLE'),
      'Final score: ' + score.score.toFixed(2)
    ];
  }

  var Strategy = {
    WeightedDCSStrategy: WeightedDCSStrategy,
    isEligible: isEligible,
    eligibleElevators: eligibleElevators
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Strategy;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Strategy = Strategy;
}(typeof window !== 'undefined' ? window : globalThis));