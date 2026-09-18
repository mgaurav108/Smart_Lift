/* Smart Lift - New DCS domain: Passenger.
 * Passengers are lightweight identities owned by a DestinationRequest
 * (§9, §33: capacity is measured in passengers, not requests).
 */
(function (global) {
  'use strict';

  function createPassenger(id, requestId, originFloor, destinationFloor) {
    return {
      passengerId: id,
      requestId: requestId,
      originFloor: originFloor,
      destinationFloor: destinationFloor,
      currentFloor: originFloor,
      status: 'WAITING'          // WAITING | ABOARD | DELIVERED
    };
  }

  var Passenger = {
    create: createPassenger
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Passenger;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Passenger = Passenger;
}(typeof window !== 'undefined' ? window : globalThis));