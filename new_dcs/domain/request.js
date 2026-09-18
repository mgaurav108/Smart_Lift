/* Smart Lift - New DCS domain: DestinationRequest and its lifecycle.
 * Spec/phase-3-newdcs.md §9 (request model), §10 (invalid requests),
 * §34 (request lifecycle).
 */
(function (global) {
  'use strict';

  var RequestStatus = {
    CREATED: 'CREATED',
    VALIDATED: 'VALIDATED',
    QUEUED: 'QUEUED',
    ASSIGNED: 'ASSIGNED',
    PASSENGER_WAITING: 'PASSENGER_WAITING',
    PICKED_UP: 'PICKED_UP',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    REASSIGNED: 'REASSIGNED',
    WAITING_FOR_CAPACITY: 'WAITING_FOR_CAPACITY',
    WAITING_FOR_AVAILABLE_ELEVATOR: 'WAITING_FOR_AVAILABLE_ELEVATOR'
  };

  function isTerminal(status) {
    return status === RequestStatus.DELIVERED ||
      status === RequestStatus.CANCELLED;
  }

  function isValidStatus(s) {
    return Object.keys(RequestStatus).some(function (k) { return RequestStatus[k] === s; });
  }

  /* Validate a raw request triple per §10. Returns {ok} or {ok:false,error}.
   * `capacity` bounds the passenger count; `range` is a FloorRange. */
  function validate(range, capacity, originFloor, destinationFloor, passengerCount) {
    if (!range || !range.isValid) return { ok: false, error: 'missing floor range' };
    if (typeof originFloor !== 'number' || !range.isValid(originFloor)) {
      return { ok: false, error: 'Invalid origin floor: ' + originFloor };
    }
    if (typeof destinationFloor !== 'number' || !range.isValid(destinationFloor)) {
      return { ok: false, error: 'Invalid destination floor: ' + destinationFloor };
    }
    if (originFloor === destinationFloor) {
      return { ok: false, error: 'Origin and destination are the same floor (F' + originFloor + ')' };
    }
    if (typeof passengerCount !== 'number' || Math.floor(passengerCount) !== passengerCount) {
      return { ok: false, error: 'Passenger count must be an integer' };
    }
    if (passengerCount <= 0) {
      return { ok: false, error: 'Passenger count must be at least 1' };
    }
    if (passengerCount > capacity) {
      return { ok: false, error: 'Passenger count ' + passengerCount + ' exceeds elevator capacity ' + capacity };
    }
    return { ok: true };
  }

  /* Create a new DestinationRequest. `seed` ({ range, capacity, nextId }) is
   * used for validation and ID allocation; validation happens here so a
   * request can only ever exist in a VALIDATED-compatible state. */
  function create(seed, originFloor, destinationFloor, passengerCount, requestTime) {
    var v = validate(seed.range, seed.capacity, originFloor, destinationFloor, passengerCount);
    if (!v.ok) throw new Error(v.error);

    var id = seed.nextId();
    var request = {
      requestId: id,
      originFloor: originFloor,
      destinationFloor: destinationFloor,
      requestTime: requestTime || 0,
      passengerCount: passengerCount,
      passengers: [],            // individual passenger ids (1 per passenger)
      status: RequestStatus.CREATED,
      assignedElevatorId: null,
      estimatedWaitTime: null,
      estimatedTravelTime: null,
      waitingTime: 0,            // sim ticks elapsed while not picked up
      reassignedCount: 0,
      deliveredAt: null,
      pickedUpAt: null
    };
    for (var i = 0; i < passengerCount; i += 1) {
      request.passengers.push(seed.nextPassengerId());
    }
    return request;
  }

  var Request = {
    RequestStatus: RequestStatus,
    validate: validate,
    create: create,
    isValidStatus: isValidStatus,
    isTerminal: isTerminal
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Request;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Request = Request;
}(typeof window !== 'undefined' ? window : globalThis));