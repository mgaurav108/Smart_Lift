/* Smart Lift - New DCS domain: elevator states and maintenance statuses.
 * Spec/phase-3-newdcs.md §6 (elevator states) and §7 (maintenance policy).
 */
(function (global) {
  'use strict';

  var ElevatorState = {
    IDLE: 'IDLE',
    MOVING_UP: 'MOVING_UP',
    MOVING_DOWN: 'MOVING_DOWN',
    DOOR_OPEN: 'DOOR_OPEN',
    DOOR_CLOSING: 'DOOR_CLOSING',
    MAINTENANCE: 'MAINTENANCE',
    OUT_OF_SERVICE: 'OUT_OF_SERVICE'
  };

  var DoorState = {
    OPEN: 'OPEN',
    OPENING: 'OPENING',
    CLOSED: 'CLOSED',
    CLOSING: 'CLOSING'
  };

  /* Spec §7: ACTIVE -> MAINTENANCE_PENDING -> (safe stop) -> MAINTENANCE. */
  var MaintenanceStatus = {
    ACTIVE: 'ACTIVE',
    MAINTENANCE_PENDING: 'MAINTENANCE_PENDING',
    MAINTENANCE: 'MAINTENANCE'
  };

  var Direction = {
    NONE: 'NONE',
    UP: 'UP',
    DOWN: 'DOWN'
  };

  function isValidElevatorState(s) {
    return s === ElevatorState.IDLE ||
      s === ElevatorState.MOVING_UP ||
      s === ElevatorState.MOVING_DOWN ||
      s === ElevatorState.DOOR_OPEN ||
      s === ElevatorState.DOOR_CLOSING ||
      s === ElevatorState.MAINTENANCE ||
      s === ElevatorState.OUT_OF_SERVICE;
  }

  function isValidDoorState(s) {
    return s === DoorState.OPEN ||
      s === DoorState.OPENING ||
      s === DoorState.CLOSED ||
      s === DoorState.CLOSING;
  }

  function isValidMaintenanceStatus(s) {
    return s === MaintenanceStatus.ACTIVE ||
      s === MaintenanceStatus.MAINTENANCE_PENDING ||
      s === MaintenanceStatus.MAINTENANCE;
  }

  var Domain = {
    ElevatorState: ElevatorState,
    DoorState: DoorState,
    MaintenanceStatus: MaintenanceStatus,
    Direction: Direction,
    isValidElevatorState: isValidElevatorState,
    isValidDoorState: isValidDoorState,
    isValidMaintenanceStatus: isValidMaintenanceStatus
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Domain;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Domain = Domain;
}(typeof window !== 'undefined' ? window : globalThis));