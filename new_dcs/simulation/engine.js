/* Smart Lift - New DCS simulation: SimulationEngine.
 * Spec/phase-3-newdcs.md §25 (simulation engine + determinism), §26
 * (controls), §34-35 (lifecycle + reassignment), §62 (state ownership).
 *
 * Owns the SimulationState, the clock, and the dispatch + maintenance
 * managers. tick() advances every elevator one floor per tick, opens/closes
 * doors, boards waiting passengers at origin stops, delivers at destination
 * stops, lets the maintenance manager resolve pending transitions, and
 * reconsiders the FIFO request queue.
 */
(function (global) {
  'use strict';

  var Config = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../config/default-config.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Config);
  var SimulationClock = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./clock.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.SimulationClock);
  var SimulationState = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.SimulationState);
  var DispatchEngine = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../dispatch/engine.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.DispatchEngine);
  var MaintenanceManager = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../maintenance/manager.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.MaintenanceManager);
  var Request = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/request.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Request);
  var Domain = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Domain);

  var RS = Request.RequestStatus;
  var ES = Domain.ElevatorState;
  var MS = Domain.MaintenanceStatus;
  var DS = Domain.DoorState;
  var DIR = Domain.Direction;

  function create(userConfig) {
    var config = Config.create(userConfig);
    var state = SimulationState.create(config);
    var clock = SimulationClock.create();
    state.clock = clock;

    var dispatchEngine = DispatchEngine.create(config);
    var maintenanceManager = MaintenanceManager.create(config, dispatchEngine);

    var result = {
      state: state,
      dispatchEngine: dispatchEngine,
      maintenanceManager: maintenanceManager,
      events: [],

      /* §9/§34: submit a destination-based request. Validates (§10), builds
       * the DestinationRequest, then dispatches immediately. */
      request: function (originFloor, destinationFloor, passengerCount) {
        var range = state.floorRange;
        var v = Request.validate(range, config.elevators.capacity,
          originFloor, destinationFloor, passengerCount);
        if (!v.ok) return { ok: false, error: v.error };

        var req = Request.create(
          { range: range, capacity: config.elevators.capacity,
            nextId: function () { return state.nextRequestId(); },
            nextPassengerId: function () { return state.nextPassengerId(); } },
          originFloor, destinationFloor, passengerCount, clock.now());

        req.status = RS.VALIDATED;
        state.requests[req.requestId] = req;

        var res = dispatchEngine.assign(state, req);
        res.requestId = req.requestId;
        res.status = req.status;

        if (res.ok) {
          /* If the assigned car already has its doors open at the origin,
           * board immediately instead of making the passenger wait a cycle. */
          var ev = state.elevators[res.assignment.elevatorId];
          if (ev.state === ES.DOOR_OPEN && ev.currentFloor === originFloor) {
            boardWaitingAt(state, ev, originFloor, clock.now(), result.events);
          }
        }
        return res;
      },

      /* §26: advance the whole simulation exactly one tick. Deterministic. */
      tick: function () {
        var t = clock.tick();
        var events = (result.events = []);

        maintenanceManager.tick(state);

        state.elevators.forEach(function (elevator) {
          if (elevator.state === ES.MAINTENANCE || elevator.state === ES.OUT_OF_SERVICE) return;
          stepElevator(state, elevator, t, events, config);
        });

        dispatchEngine.reconsiderQueue(state);
        accrueWaitingTimes(state);

        return events;
      },

      /* §26: Reset - rebuild all state from the same configuration. */
      reset: function () {
        return create(userConfig);
      },

      setMaintenance: function (elevatorId) {
        return maintenanceManager.setMaintenance(state, elevatorId);
      },
      restore: function (elevatorId) {
        return maintenanceManager.restore(state, elevatorId);
      }
    };
    return result;
  }

  /* ---------- per-tick elevator logic ---------- */

  function stepElevator(state, elevator, t, events, config) {
    if (elevator.state === ES.DOOR_OPEN) {
      if (elevator.doorOpenRemaining === undefined) elevator.doorOpenRemaining = config.elevators.doorOpenTicks;
      elevator.doorOpenRemaining -= 1;
      if (elevator.doorOpenRemaining <= 0) {
        elevator.state = ES.DOOR_CLOSING;
        elevator.doorState = DS.CLOSING;
        elevator.doorCloseRemaining = config.elevators.doorCloseTicks;
      }
      return;
    }

    if (elevator.state === ES.DOOR_CLOSING) {
      elevator.doorCloseRemaining -= 1;
      if (elevator.doorCloseRemaining <= 0) {
        elevator.state = ES.IDLE;
        elevator.doorState = DS.CLOSED;
        if (elevator.targetFloors.length === 0) elevator.direction = DIR.NONE;
      }
      return;
    }

    if (elevator.state === ES.IDLE) {
      if (elevator.targetFloors.length > 0) {
        var next = elevator.targetFloors[0];
        if (next === elevator.currentFloor) {
          elevator.targetFloors.shift();
          openDoors(state, elevator, t, events);
        } else {
          elevator.direction = next > elevator.currentFloor ? DIR.UP : DIR.DOWN;
          elevator.state = next > elevator.currentFloor ? ES.MOVING_UP : ES.MOVING_DOWN;
        }
      } else {
        elevator.direction = DIR.NONE;
      }
      return;
    }

    if (elevator.state === ES.MOVING_UP) {
      if (elevator.currentFloor < state.floorRange.max) elevator.currentFloor += 1;
      if (reachedTarget(elevator)) arriveAtTarget(state, elevator, t, events);
      return;
    }
    if (elevator.state === ES.MOVING_DOWN) {
      if (elevator.currentFloor > state.floorRange.min) elevator.currentFloor -= 1;
      if (reachedTarget(elevator)) arriveAtTarget(state, elevator, t, events);
      return;
    }
  }

  function reachedTarget(elevator) {
    return elevator.targetFloors.length > 0 && elevator.targetFloors[0] === elevator.currentFloor;
  }

  function arriveAtTarget(state, elevator, t, events) {
    elevator.targetFloors.shift();
    openDoors(state, elevator, t, events);
  }

  function openDoors(state, elevator, t, events) {
    elevator.state = ES.DOOR_OPEN;
    elevator.doorState = DS.OPEN;
    elevator.direction = DIR.NONE;
    elevator.doorOpenRemaining = state.config.elevators.doorOpenTicks;
    events.push({ type: 'doors_opened', time: t, elevatorId: elevator.id,
      floor: elevator.currentFloor });
    deliverAt(state, elevator, t, events);
    boardWaitingAt(state, elevator, elevator.currentFloor, t, events);
  }

  /* Unload anyone aboard whose destination is this floor (the drop stop). */
  function deliverAt(state, elevator, t, events) {
    var remaining = [];
    elevator.aboardRequestIds.forEach(function (rid) {
      var req = state.requests[rid];
      if (req && req.destinationFloor === elevator.currentFloor) {
        req.status = RS.DELIVERED;
        req.deliveredAt = t;
        elevator.occupancy = Math.max(0, elevator.occupancy - req.passengerCount);
        events.push({ type: 'delivered', time: t, requestId: req.requestId,
          elevatorId: elevator.id, floor: elevator.currentFloor });
      } else if (req) {
        remaining.push(rid);
      }
    });
    elevator.aboardRequestIds = remaining;
  }

  /* Board passengers whose origin is this floor and who are assigned to this
   * car. Automatic boarding at the origin stop (destination control). */
  function boardWaitingAt(state, elevator, floor, t, events) {
    var assigned = elevator.assignedRequestIds.slice();
    assigned.forEach(function (rid) {
      var req = state.requests[rid];
      if (!req || req.assignedElevatorId !== elevator.id || req.originFloor !== floor) return;

      if (elevator.occupancy + req.passengerCount > elevator.capacity) {
        // Belt-and-braces: reservation semantics should prevent this.
        req.assignedElevatorId = null;
        req.status = RS.WAITING_FOR_CAPACITY;
        elevator.assignedPassengerCount = Math.max(0, elevator.assignedPassengerCount - req.passengerCount);
        var i = elevator.assignedRequestIds.indexOf(rid);
        if (i !== -1) elevator.assignedRequestIds.splice(i, 1);
        if (state.queuedRequestIds.indexOf(rid) === -1) state.queuedRequestIds.push(rid);
        return;
      }

      req.status = RS.PICKED_UP;
      req.pickedUpAt = t;
      elevator.occupancy += req.passengerCount;
      elevator.assignedPassengerCount = Math.max(0, elevator.assignedPassengerCount - req.passengerCount);
      var j = elevator.assignedRequestIds.indexOf(rid);
      if (j !== -1) elevator.assignedRequestIds.splice(j, 1);
      elevator.aboardRequestIds.push(rid);
      events.push({ type: 'picked_up', time: t, requestId: rid,
        elevatorId: elevator.id, floor: floor, passengers: req.passengerCount });
    });
  }

  /* Requests not yet picked up accrue waiting time, feeding starvation. */
  function accrueWaitingTimes(state) {
    Object.keys(state.requests).forEach(function (rid) {
      var req = state.requests[rid];
      if (Request.isTerminal(req.status)) return;
      if (req.status === RS.PICKED_UP || req.status === RS.IN_TRANSIT) return;
      req.waitingTime += 1;
    });
  }

  var SimulationEngine = {
    DIR_IDLE: DIR.NONE,
    create: create
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationEngine;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.SimulationEngine = SimulationEngine;
}(typeof window !== 'undefined' ? window : globalThis));