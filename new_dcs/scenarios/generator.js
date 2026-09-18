/* Smart Lift - New DCS scenarios: deterministic scenario generator.
 * Spec/phase-3-newdcs.md §38 (scenario generator) and §39 (test strategy).
 *
 * Every generator returns a ScenarioPlan:
 *   {
 *     id, name, kind,
 *     events: [{ t, origin, destination, passengers, starvationProbe? }],
 *     script: [{ t, action: 'maintenance'|'restore', elevatorId }]
 *   }
 * events are sorted by `t`; all times are tick times (relative to run start).
 * Same seed -> byte-identical plan, so scenario tests qualify as regression
 * cases under §51/§67.
 */
(function (global) {
  'use strict';

  var Config = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../config/default-config.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Config);
  var Rng = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./rng.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Rng);

  var rng32 = Rng.mulberry32;
  var between = Rng.intBetween;

  function floorsOf(config) {
    var b = (config && config.building) || {};
    return { min: b.groundFloor || 1, max: b.topFloor || b.floors || 15 };
  }

  function withConfig(config) {
    return Config.create(config || {});
  }

  function push(events, t, origin, destination, passengers, probe) {
    events.push({
      t: t,
      origin: origin,
      destination: destination,
      passengers: passengers,
      starvationProbe: !!probe
    });
  }

  function destOther(rng, range, origin) {
    var d = origin;
    while (d === origin) d = between(rng, range.min, range.max);
    return d;
  }

  function sortPlan(plan) {
    plan.events.sort(function (a, b) { return a.t - b.t; });
    plan.script.sort(function (a, b) { return a.t - b.t; });
    return plan;
  }

  function plan(id, name, kind, events, script) {
    return { id: id, name: name, kind: kind, events: events, script: script || [] };
  }

  /* ---------- generators ---------- */

  /* A - Random: uniform origins/destinations/times. */
  function randomPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var ev = [];
    for (var i = 0; i < count; i += 1) {
      var o = between(rng, range.min, range.max);
      push(ev, between(rng, 1, Math.max(1, Math.floor(timeSpan(config) * 0.9))),
        o, destOther(rng, range, o), between(rng, 1, 4));
    }
    return sortPlan(plan('A', 'Random', 'random', ev));
  }

  /* B - Up Peak: many F1 -> upper floor trips. */
  function upPeakPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var ev = [];
    for (var i = 0; i < count; i += 1) {
      push(ev, between(rng, 1, timeSpan(config)),
        range.min, between(rng, range.min + 1, range.max), between(rng, 1, 3));
    }
    return sortPlan(plan('B', 'Up Peak', 'up-peak', ev));
  }

  /* C - Down Peak: many upper floor -> F1 trips. */
  function downPeakPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var ev = [];
    for (var i = 0; i < count; i += 1) {
      push(ev, between(rng, 1, timeSpan(config)),
        between(rng, range.min + 1, range.max), range.min, between(rng, 1, 3));
    }
    return sortPlan(plan('C', 'Down Peak', 'down-peak', ev));
  }

  /* D - Inter-floor: internal trips between upper floors (no F1). */
  function interfloorPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    if (range.max - range.min < 2) throw new Error('Inter-floor needs at least 3 floors');
    var ev = [];
    for (var i = 0; i < count; i += 1) {
      var o = between(rng, range.min + 1, range.max);
      var inner = { min: range.min + 1, max: range.max };
      push(ev, between(rng, 1, timeSpan(config)), o, destOther(rng, inner, o), between(rng, 1, 3));
    }
    return sortPlan(plan('D', 'Inter-floor', 'inter-floor', ev));
  }

  /* E - Heavy Load: large passenger groups. */
  function heavyLoadPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var cap = config && config.elevators && config.elevators.capacity || 10;
    var ev = [];
    for (var i = 0; i < count; i += 1) {
      var c = Math.floor(count * 0.35);
      var pass = between(rng, Math.max(1, cap - 5), cap);
      var o = between(rng, range.min, range.max);
      var when = i < c
        ? between(rng, 1, timeSpan(config))
        : between(rng, Math.round(timeSpan(config) * 0.3), timeSpan(config));
      push(ev, when, o, destOther(rng, range, o), pass);
    }
    return sortPlan(plan('E', 'Heavy Load', 'heavy-load', ev));
  }

  /* F - Elevator Failure: traffic plus one scheduled maintenance. */
  function failurePlan(seed, count, config) {
    var p = randomPlan(seed, count, config);
    var rng = rng32(seed + 1);
    var span = timeSpan(config);
    p.script.push({
      t: between(rng, Math.max(2, Math.round(span * 0.2)), Math.round(span * 0.6)),
      action: 'maintenance', elevatorId: 0
    });
    p.kind = 'elevator-failure';
    p.id = 'F'; p.name = 'Elevator Failure';
    return sortPlan(p);
  }

  /* G - Multiple Failures: traffic plus two staggered maintenance events. */
  function multiFailurePlan(seed, count, config) {
    var p = randomPlan(seed, count, config);
    var rng = rng32(seed + 2);
    var span = timeSpan(config);
    p.script.push({
      t: between(rng, 2, Math.round(span * 0.4)),
      action: 'maintenance', elevatorId: 0
    });
    p.script.push({
      t: between(rng, Math.round(span * 0.3), Math.round(span * 0.6)),
      action: 'maintenance', elevatorId: 1
    });
    p.kind = 'multi-failure';
    p.id = 'G'; p.name = 'Multiple Failures';
    return sortPlan(p);
  }

  /* H - Burst Traffic: many requests inside a short window. */
  function burstPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var ev = [];
    var burstStart = 10;
    var burstLen = Math.max(1, Math.round(timeSpan(config) * 0.1));
    for (var i = 0; i < count; i += 1) {
      var o = between(rng, range.min, range.max);
      push(ev, between(rng, burstStart, burstStart + burstLen),
        o, destOther(rng, range, o), between(rng, 1, 4));
    }
    return sortPlan(plan('H', 'Burst Traffic', 'burst', ev));
  }

  /* I - Long-Wait Stress: flood normal traffic, then park a far request that
   * must not starve (its origin is deliberately awkward under load). */
  function longWaitPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var ev = [];
    for (var i = 0; i < count; i += 1) {
      var o = between(rng, range.min, range.max);
      push(ev, between(rng, 1, Math.round(timeSpan(config) * 0.6)),
        o, destOther(rng, range, o), between(rng, 1, 4));
    }
    var far = range.max; // the awkward floor
    push(ev, Math.round(timeSpan(config) * 0.5), far, range.min, 1, true);
    return sortPlan(plan('I', 'Long-Wait Stress', 'long-wait', ev));
  }

  /* J - Mixed Traffic: up-peak + down-peak + inter-floor + random. */
  function mixedPlan(seed, count, config) {
    var rng = rng32(seed);
    var range = floorsOf(config);
    var ev = [];
    var quarters = Math.floor(count / 4);
    var part = 0;
    while (part < 4) {
      var n = part === 3 ? count - quarterTotal(quarters, 3) : quarters;
      for (var i = 0; i < n; i += 1) {
        var t = between(rng, 1, timeSpan(config));
        var o; var d;
        if (part === 0) { o = range.min; d = between(rng, range.min + 1, range.max); }
        else if (part === 1) { o = between(rng, range.min + 1, range.max); d = range.min; }
        else if (part === 2) {
          var inner = { min: range.min + 1, max: range.max };
          o = between(rng, inner.min, inner.max);
          d = destOther(rng, inner, o);
        } else {
          o = between(rng, range.min, range.max);
          d = destOther(rng, range, o);
        }
        push(ev, t, o, d, between(rng, 1, 4));
      }
      part += 1;
    }
    return sortPlan(plan('J', 'Mixed Traffic', 'mixed', ev));
  }

  function quarterTotal(quarters, upTo) {
    var s = 0;
    for (var i = 0; i < upTo; i += 1) s += quarters;
    return s;
  }

  function timeSpan(config) {
    var c = config || {};
    return c.scenario && c.scenario.horizonTicks || 600;
  }

  /* ---------- registry ---------- */

  var GENERATORS = {
    A: randomPlan, B: upPeakPlan, C: downPeakPlan, D: interfloorPlan,
    E: heavyLoadPlan, F: failurePlan, G: multiFailurePlan, H: burstPlan,
    I: longWaitPlan, J: mixedPlan
  };

  function generate(id, seed, count, config) {
    seed = seed === undefined ? 42 : seed;
    count = count || 120;
    config = withConfig(config);
    return GENERATORS[id](seed, count, config);
  }

  function list(config) {
    var cfg = withConfig(config);
    return Object.keys(GENERATORS).map(function (id) {
      return GENERATORS[id](101, 60, cfg).id;
    });
  }

  var Generator = { generate: generate, list: list, GENERATORS: GENERATORS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Generator;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.ScenarioGenerator = Generator;
}(typeof window !== 'undefined' ? window : globalThis));