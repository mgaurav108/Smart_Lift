/* Smart Lift - New DCS dispatch: NearestEligibleStrategy.
 * Spec/phase-3-newdcs.md §37 (comparison mode) and §62 (alternative
 * strategies). This strategy reuses the shared Eligibility / RoutePlanner /
 * Grouping building blocks and only swaps the selection rule: it always
 * assigns the ELIGIBLE elevator with the lowest pickup ETA (ties broken by
 * elevator ID, matching §19's deterministic fallback).
 *
 * It produces the same { winner, candidates } contract as the weighted
 * strategy, so DispatchEngine.committAssignment works unchanged - the only
 * difference is the score equals the raw pickup ETA and the explanation text.
 */
(function (global) {
  'use strict';

  var Strategy = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./strategy.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Strategy);
  var Route = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./eta.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Route);

  function buildExplanation(score) {
    var d = score.detail;
    return [
      'Nearest eligible elevator by pickup ETA',
      'Pickup ETA: ' + d.eta + ' sec',
      'Route stops: ' + d.route.join(' -> '),
      'Direction: ' + (d.reversals ? 'reversal required' : 'compatible'),
      'Final score: ' + score.score.toFixed(2)
    ];
  }

  var NearestEligibleStrategy = {
    name: 'nearest',
    isEligible: Strategy.isEligible,
    eligibleElevators: Strategy.eligibleElevators,

    evaluate: function (state, request) {
      var cfg = state.config;
      var eligibles = Strategy.eligibleElevators(state, request.passengerCount);
      var candidates = [];

      eligibles.forEach(function (elevator) {
        var cand = Route.bestInsertion(elevator, request.originFloor,
          request.destinationFloor, cfg);
        if (!cand) return;
        candidates.push({
          elevator: elevator,
          elevatorId: elevator.id,
          detail: cand,
          score: cand.eta,
          baseScore: cand.eta
        });
      });

      candidates.sort(function (a, b) {
        if (a.score !== b.score) return a.score - b.score;
        return a.elevatorId - b.elevatorId;
      });

      var winner = candidates.length ? candidates[0] : null;
      if (winner) {
        winner.explanation = buildExplanation(winner);
      }
      return { winner: winner, candidates: candidates };
    }
  };

  var Nearest = { NearestEligibleStrategy: NearestEligibleStrategy };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Nearest;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Nearest = Nearest;
}(typeof window !== 'undefined' ? window : globalThis));