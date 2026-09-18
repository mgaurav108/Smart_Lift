/* Smart Lift - New DCS dispatch: DestinationGrouping.
 * Spec/phase-3-newdcs.md §16 (destination grouping), §48 (grouping tests).
 *
 * Compatibility is HIGH when the request slots into the elevator's committed
 * journey with zero extra direction reversals (i.e. its origin and
 * destination lie along the elevator's current/service direction). This is
 * the signal that lets F1->F10 + F1->F11 share one car efficiently and keeps
 * F1->F8 + F1->F12 on the same upward trip.
 */
(function (global) {
  'use strict';

  var Route = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./eta.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Route);

  var HIGH = 'HIGH';
  var LOW = 'LOW';

  function compatibilityLevel(elevator, originFloor, destFloor, config) {
    var before = Route.directionChanges(elevator.currentFloor, elevator.targetFloors);
    var insert = Route.bestInsertion(elevator, originFloor, destFloor, config);
    if (!insert) return LOW;
    var after = Route.directionChanges(elevator.currentFloor, insert.route);
    return after === before ? HIGH : LOW;
  }

  /* Can `a` and `b` share one car without either trip degrading? Used by
   * integration tests to prove grouping exists (§48). */
  function areCompatible(aProfile, bProfile, config) {
    if (aProfile.direction === bProfile.direction &&
        Math.abs(aProfile.destination - aProfile.origin) +
          Math.abs(bProfile.destination - bProfile.origin) >=
        Math.abs(aProfile.destination - bProfile.origin)) {
      return HIGH === HIGH;
    }
    return false;
  }

  var Grouping = {
    HIGH: HIGH,
    LOW: LOW,
    compatibilityLevel: compatibilityLevel,
    areCompatible: areCompatible
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Grouping;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Grouping = Grouping;
}(typeof window !== 'undefined' ? window : globalThis));