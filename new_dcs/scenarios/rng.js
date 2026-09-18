/* Smart Lift - New DCS scenarios: seeded PRNG.
 * Deterministic pseudorandom source (mulberry32) so every scenario replays
 * exactly (Spec/phase-3-newdcs.md §38, §51, §67 determinism). Same seed ->
 * same sequence on every platform.
 */
(function (global) {
  'use strict';

  /* mulberry32 - tiny, fast, seedable. Returns a function producing floats
   * in [0,1). Integer seed; string seeds are hashed deterministically. */
  function mulberry32(seed) {
    if (typeof seed === 'string') {
      var h = 2166136261 >>> 0;
      for (var i = 0; i < seed.length; i += 1) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      seed = h >>> 0;
    }
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Convenience: integer in [min, max] inclusive from a rng() float. */
  function intBetween(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  var Rng = { mulberry32: mulberry32, intBetween: intBetween };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Rng;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Rng = Rng;
}(typeof window !== 'undefined' ? window : globalThis));