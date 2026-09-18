/* Smart Lift - New DCS maintenance: MaintenanceManager.
 * Spec/phase-3-newdcs.md §7 (policy), §30 (UI controls), §46 (tests M1-M7).
 *
 * Policy (§7):
 *  - Idle, empty elevator   -> immediately MAINTENANCE.
 *  - Moving / loaded        -> MAINTENANCE_PENDING: keeps serving passengers
 *    already aboard, unloads them at their destinations, and only then
 *    becomes MAINTENANCE. Assigned (not-yet-boarded) requests are
 *    reassigned instantly so nobody is stranded.
 *  - restore() -> ACTIVE and eligible again; queued requests are reconsidered.
 */
(function (global) {
  'use strict';

  var Domain = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Domain);
  var Elevator = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/elevator.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Elevator);

  var MS = Domain.MaintenanceStatus;
  var ES = Domain.ElevatorState;

  function create(config, dispatchEngine) {
    var maintTicks = config.elevators.maintenanceDurationTicks;

    function canFinishInService(elevator) {
      return elevator.occupancy === 0 &&
        elevator.assignedRequestIds.length === 0 &&
        Elevator.isAvailable(elevator);
    }

    /* Take an elevator out of service (M1/M2). Returns {ok} or {ok:false,
     * error, pending:true}. */
    function setMaintenance(state, elevatorId) {
      var elevator = state.elevators[elevatorId];
      if (!elevator) return { ok: false, error: 'Unknown elevator: ' + elevatorId };
      if (elevator.maintenanceStatus === MS.MAINTENANCE) {
        return { ok: false, error: elevator.name + ' is already under maintenance' };
      }
      if (elevator.maintenanceStatus === MS.MAINTENANCE_PENDING) {
        return { ok: false, error: elevator.name + ' maintenance is already pending' };
      }

      if (canFinishInService(elevator)) {
        enterMaintenance(state, elevator);
        return { ok: true, pending: false, elevatorId: elevatorId };
      }

      /* Controlled transition: finish serving aboard passengers, reassign
       * waiting passengers, then go to MAINTENANCE. */
      elevator.maintenanceStatus = MS.MAINTENANCE_PENDING;
      elevator.maintenancePendingSince = state.clock.now();
      dispatchEngine.reassignFromElevator(state, elevator);
      return { ok: true, pending: true, elevatorId: elevatorId };
    }

    function enterMaintenance(state, elevator) {
      elevator.maintenanceStatus = MS.MAINTENANCE;
      elevator.state = ES.MAINTENANCE;
      elevator.direction = Domain.Direction.NONE;
      elevator.doorState = Domain.DoorState.CLOSED;
      elevator.estimatedAvailabilityTime = state.clock.now() + maintTicks;
      Elevator.clearRoute(elevator);
    }

    /* Restore an elevator to service (M3). Queued requests are reconsidered
     * immediately (M7) so they can be assigned to the restored lift. */
    function restore(state, elevatorId) {
      var elevator = state.elevators[elevatorId];
      if (!elevator) return { ok: false, error: 'Unknown elevator: ' + elevatorId };

      elevator.maintenanceStatus = MS.ACTIVE;
      if (elevator.state === ES.MAINTENANCE || elevator.state === ES.OUT_OF_SERVICE) {
        elevator.state = ES.IDLE;
      }
      elevator.direction = Domain.Direction.NONE;
      elevator.doorState = Domain.DoorState.CLOSED;
      elevator.estimatedAvailabilityTime = null;
      elevator.maintenancePendingSince = null;
      Elevator.clearRoute(elevator);

      dispatchEngine.reconsiderQueue(state);
      return { ok: true, elevatorId: elevatorId, restored: true };
    }

    /* Advance MAINTENANCE_PENDING -> MAINTENANCE once the car has delivered
     * its aboard passengers and is idle. Called once per tick. */
    function tick(state) {
      state.elevators.forEach(function (elevator) {
        if (elevator.maintenanceStatus !== MS.MAINTENANCE_PENDING) return;
        if (elevator.occupancy === 0 &&
            elevator.state !== ES.MOVING_UP &&
            elevator.state !== ES.MOVING_DOWN) {
          enterMaintenance(state, elevator);
        }
      });
    }

    return {
      setMaintenance: setMaintenance,
      restore: restore,
      tick: tick,
      enterMaintenance: enterMaintenance
    };
  }

  var MaintenanceManager = {
    create: create,
    MS: MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MaintenanceManager;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.MaintenanceManager = MaintenanceManager;
}(typeof window !== 'undefined' ? window : globalThis));