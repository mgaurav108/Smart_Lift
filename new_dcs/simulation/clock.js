/* Smart Lift - New DCS simulation: SimulationClock.
 * Deterministic tick-based clock (Spec/phase-3-newdcs.md §25).
 */
(function (global) {
  'use strict';

  function createClock() {
    var time = 0;
    return {
      now: function () { return time; },
      tick: function () { time += 1; return time; },
      reset: function () { time = 0; }
    };
  }

  var SimulationClock = {
    create: createClock
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationClock;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.SimulationClock = SimulationClock;
}(typeof window !== 'undefined' ? window : globalThis));