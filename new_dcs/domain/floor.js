/* Smart Lift - New DCS domain: floor range and floor validation.
 * Spec/phase-3-newdcs.md §5 (F1..F15), §10 (invalid requests), §40.3-4.
 */
(function (global) {
  'use strict';

  function createFloorRange(numFloors, groundFloor) {
    numFloors = numFloors || 15;
    groundFloor = groundFloor || 1;
    var topFloor = groundFloor + numFloors - 1;
    return {
      groundFloor: groundFloor,
      topFloor: topFloor,
      numFloors: numFloors,
      min: groundFloor,
      max: topFloor,
      isValid: function (floor) {
        return typeof floor === 'number' &&
          Math.floor(floor) === floor &&
          floor >= groundFloor &&
          floor <= topFloor;
      },
      name: function (floor) {
        return isValidOrThrow(this, floor) ? 'F' + floor : null;
      }
    };
  }

  function isValidOrThrow(range, floor) {
    if (range.isValid(floor)) return true;
    throw new Error('Invalid floor: ' + floor + ' (valid range F' + range.min + '..F' + range.max + ')');
  }

  var Floor = {
    create: createFloorRange,
    isValid: function (range, floor) { return range.isValid(floor); },
    requireValid: isValidOrThrow,
    requireDistinct: function (range, a, b) {
      if (a === b) throw new Error('origin and destination must differ (both F' + a + ')');
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Floor;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Floor = Floor;
}(typeof window !== 'undefined' ? window : globalThis));