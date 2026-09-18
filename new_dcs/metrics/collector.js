/* Smart Lift - New DCS metrics: MetricsCollector.
 * Spec/phase-3-newdcs.md §36 (metrics) and §58 (performance observability).
 *
 * A pure observer: it never mutates the engine. observe() is called once per
 * tick (after tick()) and records deltas; snapshot() derives the §36 report
 * set:
 *   - passenger: avg/max/p95 wait, avg/max journey, completed, pending,
 *     long waits (>= longWaitThresholdSeconds)
 *   - elevator: utilization, avg/max occupancy, distance, stops, direction
 *     changes, maintenance service time
 *   - system: total, served, pending, reassigned, avg utilization, throughput
 *
 * Deterministic: identical engine + tick script produce identical snapshots.
 */
(function (global) {
  'use strict';

  var Config = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../config/default-config.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Config);
  var Domain = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/state.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Domain);
  var Request = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/request.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Request);

  var ES = Domain.ElevatorState;
  var RS = Request.RequestStatus;

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    var idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
    return sorted[idx];
  }

  function median(values) { return percentile(values, 0.5); }

  function create(engine) {
    var state = engine.state;
    var config = state.config;
    var threshold = config.dispatch.longWaitThresholdSeconds;

    /* Per-elevator rolling observations. */
    var elev = state.elevators.map(function (e) {
      return {
        prevFloor: e.currentFloor,
        prevState: e.state,
        busyTicks: 0,
        occSum: 0,
        occObs: 0,
        maxOccupancy: e.occupancy,
        distance: 0,
        stops: 0,
        dirChanges: 0,
        lastDelta: 0,
        serviceTicks: 0,
        prevMaintenanceStatus: e.maintenanceStatus
      };
    });

    var tickCount = 0;

    function busy(elevator) {
      return elevator.occupancy > 0 ||
        elevator.targetFloors.length > 0 ||
        elevator.state === ES.DOOR_OPEN ||
        elevator.state === ES.DOOR_CLOSING ||
        elevator.state === ES.MOVING_UP ||
        elevator.state === ES.MOVING_DOWN;
    }

    /* Record one tick's worth of observations. Call AFTER engine.tick(). */
    function observe(now) {
      tickCount += 1;
      if (typeof now !== 'number') now = state.clock.now();

      state.elevators.forEach(function (e, i) {
        var m = elev[i];

        if (busy(e)) m.busyTicks += 1;

        if (e.state !== ES.OUT_OF_SERVICE && e.state !== ES.MAINTENANCE) {
          var delta = e.currentFloor - m.prevFloor;
          if (delta !== 0) {
            m.distance += Math.abs(delta);
            if (m.lastDelta !== 0 && delta !== m.lastDelta) m.dirChanges += 1;
            m.lastDelta = delta;
          }
          m.occSum += e.occupancy;
          m.occObs += 1;
          if (e.occupancy > m.maxOccupancy) m.maxOccupancy = e.occupancy;
        }

        if (m.prevState !== ES.DOOR_OPEN && e.state === ES.DOOR_OPEN) m.stops += 1;

        if (e.maintenanceStatus === 'MAINTENANCE' || e.state === ES.MAINTENANCE) {
          m.serviceTicks += 1;
        }

        m.prevFloor = e.currentFloor;
        m.prevState = e.state;
        m.prevMaintenanceStatus = e.maintenanceStatus;
      });
    }

    function waitOf(req, now) {
      if (req.pickedUpAt !== null) return req.pickedUpAt - req.requestTime;
      if (req.deliveredAt !== null && req.pickedUpAt === null) return req.deliveredAt - req.requestTime;
      return now - req.requestTime;
    }

    function snapshot() {
      var now = state.clock.now();
      var reqs = Object.keys(state.requests).map(function (k) { return state.requests[k]; });

      var waits = []; var journeys = [];
      var totalCompleted = 0; var pending = 0; var longWaits = 0;
      var reassigned = 0;
      var maxWait = 0; var maxJourney = 0;
      var journeySum = 0; var deliveredWithJourney = 0;

      reqs.forEach(function (req) {
        if (req.status === RS.DELIVERED) totalCompleted += 1;

        var w = waitOf(req, now);
        maxWait = Math.max(maxWait, w);
        waits.push(w);
        if (w >= threshold) longWaits += 1;

        if (req.status === RS.DELIVERED && req.pickedUpAt !== null) {
          var j = req.deliveredAt - req.pickedUpAt;
          maxJourney = Math.max(maxJourney, j);
          journeySum += j;
          journeys.push(j);
          deliveredWithJourney += 1;
        }

        if (req.reassignedCount > 0 || req.status === RS.REASSIGNED) reassigned += 1;
      });

pending = reqs.filter(function (r) {
  return !Request.isTerminal(r.status);
}).length;

      waits.sort(function (a, b) { return a - b; });
      journeys.sort(function (a, b) { return a - b; });

      var elevSnap = elev.map(function (m, i) {
        var e = state.elevators[i];
        var utilization = tickCount ? m.busyTicks / tickCount : 0;
        var avgOccupancy = m.occObs ? m.occSum / m.occObs : 0;
        return {
          name: e.name,
          utilization: utilization,
          avgOccupancy: avgOccupancy,
          maxOccupancy: m.maxOccupancy,
          distance: m.distance,
          stops: m.stops,
          directionChanges: m.dirChanges,
          serviceTicks: m.serviceTicks
        };
      });

      var avgUtilization = 0;
      if (elevSnap.length) {
        var utilSum = 0;
        elevSnap.forEach(function (e) { utilSum += e.utilization; });
        avgUtilization = utilSum / elevSnap.length;
      }

      return {
        elapsed: now,
        ticks: tickCount,
        passengers: {
          avgWait: waits.length ? waits.reduce(function (a, b) { return a + b; }, 0) / waits.length : null,
          maxWait: maxWait,
          p50Wait: percentile(waits, 0.5),
          p95Wait: percentile(waits, 0.95),
          p99Wait: percentile(waits, 0.99),
          longWaits: longWaits,
          longWaitThreshold: threshold,
          avgJourney: deliveredWithJourney ? journeySum / deliveredWithJourney : null,
          maxJourney: maxJourney,
          p95Journey: percentile(journeys, 0.95),
          totalCompleted: totalCompleted,
          pending: pending
        },
        elevators: elevSnap,
        system: {
          total: reqs.length,
          served: totalCompleted,
          pending: pending,
          reassigned: reassigned,
          avgUtilization: avgUtilization,
          throughput: now > 0 ? totalCompleted / now : 0,
          medianWait: median(waits)
        }
      };
    }

    return { observe: observe, snapshot: snapshot };
  }

  var MetricsCollector = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetricsCollector;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.MetricsCollector = MetricsCollector;
}(typeof window !== 'undefined' ? window : globalThis));