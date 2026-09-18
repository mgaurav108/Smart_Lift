/* Smart Lift - New DCS scenarios: deterministic scenario runner.
 * Spec/phase-3-newdcs.md §38 (scenario testing), §39 (test strategy),
 * §51 (golden scenarios), §57/§58 (observability).
 *
 * run(plan, opts) replays a ScenarioPlan against a fresh engine:
 *   - maintenance script events fire at the START of their tick,
 *   - request events fire just before tick advances (so the submitted
 *     request is dispatched in that same tick),
 *   - tick() advances, then metrics.observe() records the tick.
 *
 * The full event log + metrics make it trivially deterministic: replaying the
 * same plan + options reproduces the same trace, which the acceptance tests
 * rely on (§67).
 */
(function (global) {
  'use strict';

  var SimulationEngine = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../simulation/engine.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.SimulationEngine);
  var MetricsCollector = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../metrics/collector.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.MetricsCollector);

  function defaultMaxTicks(plan) {
    var last = 0;
    (plan.events || []).forEach(function (e) { if (e.t > last) last = e.t; });
    (plan.script || []).forEach(function (e) { if (e.t > last) last = e.t; });
    return last + 480; // horizon margin so late trips can finish
  }

  function applyEvent(event, engine, log) {
    if (event.action === 'maintenance') {
      var mr = engine.setMaintenance(event.elevatorId);
      log.push({ t: event.t, type: 'maintenance', elevatorId: event.elevatorId,
        ok: mr.ok, pending: !!mr.pending });
    } else if (event.action === 'restore') {
      var rr = engine.restore(event.elevatorId);
      log.push({ t: event.t, type: 'restore', elevatorId: event.elevatorId, ok: rr.ok });
    }
  }

  function run(plan, opts) {
    opts = opts || {};
    var engine = SimulationEngine.create(opts.config || {});
    var metrics = MetricsCollector.create(engine);

    var log = [];
    var maxTicks = opts.maxTicks || defaultMaxTicks(plan);
    var nextScriptId = 0; var nextEventId = 0;

    for (var t = 1; t <= maxTicks; t += 1) {
      while (nextScriptId < (plan.script || []).length && plan.script[nextScriptId].t === t) {
        applyEvent(plan.script[nextScriptId], engine, log);
        nextScriptId += 1;
      }
      while (nextEventId < plan.events.length && plan.events[nextEventId].t === t) {
        var ev = plan.events[nextEventId];
        var res = engine.request(ev.origin, ev.destination, ev.passengers);
        log.push({
          t: t, type: 'request', requestId: res.requestId, origin: ev.origin,
          destination: ev.destination, passengers: ev.passengers,
          ok: res.ok, assignedElevatorId: res.assignment && res.assignment.elevatorId,
          eta: res.assignment && res.assignment.eta,
          queued: !!res.queued, starvationProbe: !!ev.starvationProbe
        });
        nextEventId += 1;
      }

      var tickEvents = engine.tick();
      tickEvents.forEach(function (te) {
        log.push({ t: t, type: te.type, elevatorId: te.elevatorId,
          floor: te.floor, requestId: te.requestId, passengers: te.passengers });
      });

      metrics.observe(t);
      if (opts.onTick) opts.onTick({ t: t, engine: engine, metrics: metrics });
    }

    return {
      engine: engine,
      metrics: metrics,
      plan: plan,
      log: log,
      ticks: maxTicks
    };
  }

  var Scenarios = { run: run };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Scenarios;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.Scenarios = Scenarios;
}(typeof window !== 'undefined' ? window : globalThis));