/* Smart Lift - New DCS domain: Elevator.
 * Spec/phase-3-newdcs.md §6 (state model), §32-33 (capacity), §12 (eligibility).
 */
(function (global) {
  'use strict';

  var Domain = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Domain);

  function create(id, capacity, startFloor) {
    return {
      id: id,

      /* On-net identity: E1-based string, e.g. id 0 -> 'E1'. */
      name: 'E' + (id + 1),

      currentFloor: startFloor || 1,
      direction: Domain.Direction.NONE,
      capacity: capacity,

      /* Occupancy is the number of passengers aboard (sum of passenger
       * counts of aboard requests), NOT the number of requests (§33). */
      occupancy: 0,

      /* Seats already committed to assigned (not-yet-boardable) requests,
       * so that eligibility can never over-book the elevator. */
      assignedPassengerCount: 0,

      state: Domain.ElevatorState.IDLE,
      doorState: Domain.DoorState.CLOSED,

      /* Ordered list of floors to visit next (origins + destinations). */
      targetFloors: [],

      /* Requests assigned to this elevator: { id, originFloor, destFloor,
       * passengerCount, status } - same objects as in state.requests, kept
       * for O(1) partition into assigned vs aboard. */
      assignedRequestIds: [],
      aboardRequestIds: [],

      maintenanceStatus: Domain.MaintenanceStatus.ACTIVE,
      estimatedAvailabilityTime: null,
      maintenancePendingSince: null
    };
  }

  function isAvailable(elevator) {
    return elevator.maintenanceStatus === Domain.MaintenanceStatus.ACTIVE &&
      elevator.state !== Domain.ElevatorState.OUT_OF_SERVICE;
  }

  /* Seats used = aboard passengers + passengers reserved by assigned
   * requests. Eligibility is judged against this so a lift can never be
   * over-booked by independently-fitting requests (§32-33). */
  function capacityRemaining(elevator) {
    return elevator.capacity - elevator.occupancy - elevator.assignedPassengerCount;
  }

  function canFit(elevator, passengerCount) {
    return capacityRemaining(elevator) >= passengerCount;
  }

  function routeWorkload(elevator) {
    return elevator.targetFloors.length + elevator.assignedRequestIds.length;
  }

  /* Board `passengerCount` more passengers onto the elevator. Throws if this
   * would exceed capacity - the dispatcher must never ask for that. */
  function boardPassengers(elevator, passengerCount) {
    if (!canFit(elevator, passengerCount)) {
      throw new Error('Elevator ' + elevator.name + ' would exceed capacity (' +
        elevator.occupancy + '/' + elevator.capacity + ' + ' + passengerCount + ')');
    }
    elevator.occupancy += passengerCount;
  }

  function unboardPassengers(elevator, passengerCount) {
    elevator.occupancy = Math.max(0, elevator.occupancy - passengerCount);
  }

  /* Clear a fully-in-route elevator: drop all remaining stops. Used when an
   * elevator is taken out of service after passengers have been delivered. */
  function clearRoute(elevator) {
    elevator.targetFloors = [];
  }

  var Elevator = {
    create: create,
    isAvailable: isAvailable,
    capacityRemaining: capacityRemaining,
    canFit: canFit,
    routeWorkload: routeWorkload,
    boardPassengers: boardPassengers,
    unboardPassengers: unboardPassengers,
    clearRoute: clearRoute
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Elevator;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Elevator = Elevator;
}(typeof window !== 'undefined' ? window : globalThis));