/* Smart Lift - New DCS: default configuration.
 * All tunables live here (Spec/phase-3-newdcs.md §5, §14, §21, §59).
 * Never hard-code 15 floors / 6 lifts / capacity 10 in the domain or
 * simulation code - always read from config so scenarios can override.
 */
(function (global) {
  'use strict';

  var DEFAULT_CONFIG = {
    building: {
      floors: 15,
      groundFloor: 1,
      topFloor: 15
    },

    elevators: {
      count: 6,
      capacity: 10,
      startFloor: 1,
      /* Optional initial spread. When null, every elevator starts on
       * `startFloor`. Golden scenarios override this explicitly. */
      initialFloors: null,
      doorOpenTicks: 2,
      doorCloseTicks: 1,
      floorsPerTick: 1,
      maintenanceDurationTicks: 60
    },

    dispatch: {
      strategy: 'weighted-dcs',
      /* Score = W_wait*ETA + W_stops*additionalStops + W_distance*travel +
       *         W_load*loadPenalty + W_direction*directionPenalty +
       *         W_occupancy*occupancyPenalty + W_imbalance*imbalancePenalty
       * (Spec §14). Lower is better. */
      weights: {
        waitTime: 10.0,
        additionalStops: 8.0,
        distance: 2.0,
        load: 5.0,
        direction: 4.0,
        occupancy: 3.0,
        imbalance: 2.0
      },
      /* Starvation protection (Spec §20/§21). A request whose wait exceeds
       * the threshold accrues an extra (wait - threshold) * starvationWeight
       * so it becomes progressively harder to ignore. */
      longWaitThresholdSeconds: 30,
      starvationWeight: 2.0,
      /* Deterministic tie tolerance: candidates whose score differs by less
       * than this are considered equal and resolved by the §19 tie-break. */
      tieTolerance: 0.0001,
      /* Winner selection policy.
       * - 'best'   : §14/§19 - lowest weighted score wins (spec default).
       * - 'varied' : demo/UX policy - group taps for the same destination
       *              onto ONE lift until it is full (10 taps to F12 => one
       *              lift), keep different destinations on different lifts,
       *              and break remaining ties with a DETERMINISTIC
       *              pseudo-random draw (seeded) so consecutive taps do not
       *              march through the elevators in id order. Reproducible
       *              for a given seed + request id. */
      selection: 'best',
      variationSeed: 1
    },

    time: {
      /* 1 tick = 1 simulated second (Spec §25). Used to map the wait-time
       * threshold from seconds to ticks and to state ETA in seconds. */
      ticksPerSecond: 1
    }
  };

  function merge(base, overrides) {
    overrides = overrides || {};
    var out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = base[k];
    });
    Object.keys(overrides).forEach(function (k) {
      var bv = base[k], ov = overrides[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) &&
          ov && typeof ov === 'object' && !Array.isArray(ov)) {
        out[k] = merge(bv, ov);
      } else {
        out[k] = ov;
      }
    });
    return out;
  }

  var Config = {
    create: function (overrides) {
      return merge(DEFAULT_CONFIG, overrides || {});
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Config;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Config = Config;
}(typeof window !== 'undefined' ? window : globalThis));