/* Smart Lift - New DCS dispatch: DispatchEngine.
 * Centralized, strategic dispatch per Spec/phase-3-newdcs.md §11 (flow),
 * §31 (queueing), §34-35 (lifecycle + reassignment).
 *
 * assign() runs Request Validation -> Candidate Selection -> ETA ->
 * Destination Compatibility -> Capacity -> Scoring -> Best Eligible Elevator
 * -> Assignment, all through the active DispatchStrategy.
 */
(function (global) {
  'use strict';

  var Strategy = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./strategy.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Strategy);
  var Route = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./eta.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Route);
  var Request = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/request.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Request);

  var NearestStrategy = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./nearest.js').NearestEligibleStrategy
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Nearest &&
      global.SmartLift.NewDCS.Nearest.NearestEligibleStrategy);

  var RS = Request.RequestStatus;

  function create(config) {
    var strategy = pickStrategy(config);

    function pickStrategy(cfg) {
      var kind = cfg.dispatch.strategy || 'weighted-dcs';
      if (kind === 'weighted-dcs') return Strategy.WeightedDCSStrategy;
      if (kind === 'nearest') return NearestStrategy;
      throw new Error('Unknown dispatch strategy: ' + kind);
    }

    /* Travel time from pickup (after boarding) to destination along the
     * candidate route, including intermediate dwells but not the pickup. */
    function travelFromOrigin(route, originFloor, config) {
      var idx = -1;
      for (var i = 0; i < route.length; i += 1) {
        if (route[i] === originFloor) { idx = i; break; }
      }
      if (idx === -1) return null;
      return Route.routeTime(originFloor, route.slice(idx), config) -
        (config.elevators.doorOpenTicks + config.elevators.doorCloseTicks);
    }

    function queueRequest(state, request, reason) {
      request.status = reason === 'capacity' ? RS.WAITING_FOR_CAPACITY :
        (reason === 'availability' ? RS.WAITING_FOR_AVAILABLE_ELEVATOR : RS.QUEUED);
      request.assignedElevatorId = null;
      if (state.queuedRequestIds.indexOf(request.requestId) === -1) {
        state.queuedRequestIds.push(request.requestId);
      }
    }

    function dequeue(state, requestId) {
      var i = state.queuedRequestIds.indexOf(requestId);
      if (i !== -1) state.queuedRequestIds.splice(i, 1);
    }

    function commitAssignment(state, request, evaluation) {
      var winner = evaluation.winner;
      var elevator = state.elevators[winner.elevatorId];
      elevator.targetFloors = winner.detail.route.slice();
      elevator.assignedRequestIds.push(request.requestId);
      elevator.assignedPassengerCount += request.passengerCount;

      request.assignedElevatorId = elevator.id;
      request.status = RS.ASSIGNED;
      request.estimatedWaitTime = winner.detail.eta;
      request.estimatedTravelTime = travelFromOrigin(winner.detail.route,
        request.originFloor, state.config);
      request.assignmentScore = winner.score;
      request.assignmentExplanation = winner.explanation.slice();

      return {
        requestId: request.requestId,
        elevatorId: elevator.id,
        elevatorName: elevator.name,
        eta: winner.detail.eta,
        estimatedTravelTime: request.estimatedTravelTime,
        route: winner.detail.route.slice(),
        score: winner.score,
        explanation: winner.explanation.slice()
      };
    }

    /* Assign a validated request now. Returns { ok, assignment? } or
     * { ok:false, queued:true, reason } when no elevator is eligible. */
    function assign(state, request) {
      var evaluation = strategy.evaluate(state, request);
      if (!evaluation.winner) {
        var anyActive = state.elevators.some(function (e) { return e.maintenanceStatus === 'ACTIVE'; });
        queueRequest(state, request, anyActive ? 'capacity' : 'availability');
        return {
          ok: false,
          queued: true,
          reason: anyActive ? 'capacity' : 'availability',
          explanation: evaluation.candidates.length
            ? 'No eligible elevator can fit ' + request.passengerCount + ' passengers.'
            : 'No elevator currently available. Request queued.' // §31
        };
      }
      return { ok: true, assignment: commitAssignment(state, request, evaluation) };
    }

    /* Reconsider the FIFO queue. Called every tick and whenever a lift is
     * restored / frees capacity, so queued requests are automatically
     * re-evaluated (§31: "automatically reconsidered"). */
    function reconsiderQueue(state) {
      var results = [];
      var queue = state.queuedRequestIds.slice();
      queue.forEach(function (rid) {
        var req = state.requests[rid];
        if (!req || req.assignedElevatorId !== null) return;
        var res = assign(state, req);
        if (res.ok) {
          dequeue(state, rid);
          results.push(res.assignment);
        }
      });
      return results;
    }

    /* Force-reassign every not-yet-boarded request off `elevatorId` (used
     * when the elevator is taken out of service). Aboard requests are NOT
     * touched - they get delivered during the pending transition (§7). */
    function reassignFromElevator(state, elevator) {
      var released = [];
      elevator.assignedRequestIds.slice().forEach(function (rid) {
        var req = state.requests[rid];
        if (!req) return;
        req.assignedElevatorId = null;
        req.reassignedCount += 1;
        req.status = RS.REASSIGNED;
        elevator.assignedPassengerCount = Math.max(0,
          elevator.assignedPassengerCount - req.passengerCount);
        released.push(req.requestId);
      });
      elevator.assignedRequestIds = [];

      /* The pending elevator now serves only aboard passengers: rebuild its
       * route as the destinations of requests currently in the car. */
      var drops = [];
      elevator.aboardRequestIds.forEach(function (rid) {
        var req = state.requests[rid];
        if (req && req.destinationFloor) drops.push(req.destinationFloor);
      });
      elevator.targetFloors = drops.filter(function (f, i, a) { return a.indexOf(f) === i; });

      released.forEach(function (rid) {
        var req = state.requests[rid];
        if (req && state.queuedRequestIds.indexOf(rid) === -1) {
          state.queuedRequestIds.push(rid);
        }
      });
      return released;
    }

    return {
      strategy: strategy,
      assign: assign,
      reconsiderQueue: reconsiderQueue,
      reassignFromElevator: reassignFromElevator
    };
  }

  var DispatchEngine = {
    create: create
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DispatchEngine;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.DispatchEngine = DispatchEngine;
}(typeof window !== 'undefined' ? window : globalThis));