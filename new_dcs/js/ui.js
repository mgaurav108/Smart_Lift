/* Smart Lift - new_dcs browser UI (Spec §26-30, §56-57).
 * Pure view: owns no dispatch logic. It drives SimulationEngine +
 * MetricsCollector (the tested core, §13 single source of truth) and renders
 * whatever they expose, so the page cannot drift from the tested engine.
 *
 * DOM contract (mirrored by the §56 fake DOM): createElement, createTextNode,
 * appendChild, textContent, className, classList.{add,remove,contains},
 * style.<property> (plain object), setAttribute, getAttribute,
 * addEventListener, value, appendChild(option). No innerHTML, no
 * querySelector, no dataset, no insertBefore, no forEach on NodeList.
 */
(function (global) {
  'use strict';

  function resolve(mod, ns) {
    return (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
      ? require(mod)
      : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS[ns]);
  }

  var SimulationEngine = resolve('../simulation/engine.js', 'SimulationEngine');
  var MetricsCollector = resolve('../metrics/collector.js', 'MetricsCollector');

  var LIFT_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#db2777'];

  function create(cfg, opts) {
    opts = opts || {};
    var doc = opts.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('UI.create requires a document (pass opts.doc in tests)');

    var engine = SimulationEngine.create(cfg);
    var metrics = MetricsCollector.create(engine);
    var state = engine.state;
    var cfg2 = state.config;
    var floors = cfg2.building.floors;
    var elevCount = cfg2.elevators.count;
    var floorH = (opts.floorH || 44);
    var tickMs = (opts.tickMs || 700);

    function need(id) {
      var e = doc.getElementById(id);
      if (!e) throw new Error('UI.create: missing #' + id + ' in the document');
      return e;
    }
    var floorNumbersEl = need('floor-numbers');
    var buildingEl = need('building');
    var statusListEl = need('status-list');
    var pendingListEl = need('pending-list');
    var assignmentEl = need('assignment');
    var messageEl = need('message');
    var metricsEl = need('metrics');
    var logListEl = need('log-list');
    var originSel = doc.getElementById('kiosk-origin');
    var originLabelEl = doc.getElementById('kiosk-origin-label');
    var destPanelEl = doc.getElementById('kiosk-dest-panel');
    var paxEl = doc.getElementById('kiosk-pax');
    var requestBtn = doc.getElementById('request-btn');
    var startBtn = need('start-btn');
    var pauseBtn = need('pause-btn');
    var resumeBtn = need('resume-btn');
    var stepBtn = need('step-btn');
    var resetBtn = need('reset-btn');
    var speedSel = doc.getElementById('speed-select');

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function liftColor(i) { return LIFT_COLORS[i % LIFT_COLORS.length]; }
    function fmt(v) { return v === null || v === undefined ? '-' : Math.round(v * 10) / 10; }
    function fmtInt(v) { return v === null || v === undefined ? '-' : String(v); }

    var liftEls = [];   // inner lift block per elevator
    var liftLabelEls = []; // label inside lift
    var shaftEls = [];  // shaft per elevator

    /* ---------- static building ---------- */
    function addFloorOption(sel, f) {
      var opt = doc.createElement('option');
      opt.value = String(f);
      opt.textContent = 'F' + f;
      sel.appendChild(opt);
    }
    function populateFloorSelects() {
      if (originSel) {
        for (var f = 1; f <= floors; f += 1) {
          addFloorOption(originSel, f);
        }
      }
    }
    function syncOriginLabel() {
      if (originSel && originLabelEl) {
        originLabelEl.textContent = 'F' + (parseInt(originSel.value, 10) || 1);
      }
    }
    function selectDest(f) {
      selectedDest = f;
      if (destPanelEl) {
        var btns = destPanelEl.children;
        var n = (btns && btns.length) || 0;
        for (var i = 0; i < n; i += 1) {
          var on = parseInt(btns[i].getAttribute('data-floor'), 10) === f;
          btns[i].className = on ? 'floor-btn active' : 'floor-btn';
        }
      }
    }
    function buildDestPanel() {
      if (!destPanelEl) return;
      destPanelEl.textContent = '';
      for (var f = 1; f <= floors; f += 1) {
        var btn = el('button', 'floor-btn', 'F' + f);
        btn.type = 'button';
        btn.setAttribute('data-floor', String(f));
        btn.addEventListener('click', (function (floor) {
          return function () { pressDestination(floor); };
        }(f)));
        destBtnEls[f] = btn;
        destPanelEl.appendChild(btn);
      }
    }
    /* One tap = one request: pick the destination and dispatch a 1-person
     * journey from the currently selected floor (§8/§28). */
    function pressDestination(f) {
      selectDest(f);
      return submitRequest();
    }
    function buildFloorNumbers() {
      for (var f = floors; f >= 1; f -= 1) {
        var row = el('div', 'floor-label', 'F' + f);
        row.setAttribute('data-floor', String(f));
        row.style.top = ((floors - f) * floorH) + 'px';
        floorNumbersEl.appendChild(row);
      }
    }
    function buildShafts() {
      for (var i = 0; i < elevCount; i += 1) {
        var shaft = el('div', 'shaft');
        shaft.setAttribute('data-elevator', String(i));
        var lift = el('div', 'lift');
        lift.style.backgroundColor = liftColor(i);
        var label = el('div', 'lift-label');
        lift.appendChild(label);
        shaft.appendChild(lift);
        buildingEl.appendChild(shaft);
        shaftEls[i] = shaft;
        liftEls[i] = lift;
        liftLabelEls[i] = label;
      }
    }

    function dirArrow(state) {
      if (state === 'MOVING_UP') return '\u25B2';
      if (state === 'MOVING_DOWN') return '\u25BC';
      if (state === 'DOOR_OPEN') return '\u25A3';
      if (state === 'DOOR_CLOSING') return '\u25A4';
      if (state === 'MAINTENANCE') return '\u2699';
      return '';
    }

    /* ---------- render ---------- */
    function renderLifts() {
      engine.state.elevators.forEach(function (e, i) {
        var top = (floors - e.currentFloor) * floorH;
        liftEls[i].style.top = top + 'px';
        liftEls[i].className = (e.maintenanceStatus === 'MAINTENANCE' ? 'lift servicing' : 'lift') +
          (i === lastAssignedId ? ' assigned' : '');
        liftLabelEls[i].textContent =
          e.name + ' ' + dirArrow(e.state) + ' ' + e.occupancy + '/' + e.capacity +
          (e.targetFloors.length ? ' stops: ' + e.targetFloors.join(',') : '');
      });
    }

    function renderStatus() {
      statusListEl.textContent = '';
      engine.state.elevators.forEach(function (e, i) {
        var line = el('div', 'status-line' +
          (e.maintenanceStatus === 'MAINTENANCE' ? ' servicing' : ''));
        var text = el('span', 'status-text');
        if (e.maintenanceStatus === 'MAINTENANCE') {
          text.textContent = e.name + ' at F' + e.currentFloor + ' - UNDER MAINTENANCE';
        } else {
          var stops = e.targetFloors.length ? ' stops: ' + e.targetFloors.join(',') : '';
          text.textContent = e.name + ' F' + e.currentFloor + ' ' + e.state +
            ' load ' + e.occupancy + '/' + e.capacity +
            ' assigned ' + e.assignedRequestIds.length + stops;
        }
        line.appendChild(text);
        var btn = el('button', 'maint-btn',
          e.maintenanceStatus === 'MAINTENANCE' ? 'Restore' : 'Service');
        btn.setAttribute('data-elevator', String(i));
        btn.addEventListener('click', (function (id) {
          return function () { toggleService(id); };
        }(i)));
        line.appendChild(btn);
        statusListEl.appendChild(line);
      });
    }

    function renderPending() {
      pendingListEl.textContent = '';
      var queued = engine.state.queuedRequestIds.map(function (id) {
        return engine.state.requests[id];
      }).filter(Boolean);
      if (!queued.length) {
        pendingListEl.appendChild(el('div', 'muted', 'No pending requests.'));
        return;
      }
      queued.forEach(function (r) {
        pendingListEl.appendChild(el('div', 'pending-line',
          r.requestId + ' F' + r.originFloor + ' \u2192 F' + r.destinationFloor +
          ' (' + r.passengerCount + ' pax) waiting ' + r.waitingTime + 's'));
      });
    }

    function renderAssignment(res) {
      assignmentEl.textContent = '';
      if (res && res.ok) {
        var badge = el('div', 'assign-badge');
        badge.appendChild(el('span', 'assign-badge-label', 'Your lift'));
        badge.appendChild(el('span', 'assign-badge-name', res.assignment.elevatorName));
        assignmentEl.appendChild(badge);
        assignmentEl.appendChild(el('div', 'assign-head',
          'Request ' + res.requestId + ' assigned to ' + res.assignment.elevatorName));
        assignmentEl.appendChild(el('div', 'assign-line',
          'From F' + engine.state.requests[res.requestId].originFloor +
          ' to F' + engine.state.requests[res.requestId].destinationFloor +
          ' - ' + engine.state.requests[res.requestId].passengerCount + ' pax'));
        assignmentEl.appendChild(el('div', 'assign-line',
          'Pickup ETA: ' + fmt(res.assignment.eta) +
          '  Journey: ' + fmt(res.assignment.estimatedTravelTime)));
        res.assignment.explanation.forEach(function (ln) {
          assignmentEl.appendChild(el('div', 'assign-explain', ln));
        });
      } else if (res && !res.ok) {
        assignmentEl.appendChild(el('div', 'assign-err', res.error || 'Request queued.'));
        var exp = res.explanation;
        if (exp) {
          assignmentEl.appendChild(el('div', 'assign-explain',
            typeof exp === 'string' ? exp : exp.join(' ')));
        }
      }
    }

    function renderMetrics() {
      metricsEl.textContent = '';
      var m = metrics.snapshot();
      if (!m.elapsed) {
        metricsEl.appendChild(el('div', 'muted', 'No metrics yet - run the simulation.'));
        return;
      }
      var p = m.passengers;
      var sys = m.system;
      var grid = el('div', 'metric-grid');
      metricsEl.appendChild(grid);
      addMetric(grid, 'Served', String(p.totalCompleted));
      addMetric(grid, 'Pending', String(p.pending));
      addMetric(grid, 'Avg wait', fmt(p.avgWait) + 's');
      addMetric(grid, 'p95 wait', fmt(p.p95Wait) + 's');
      addMetric(grid, 'Max wait', fmt(p.maxWait) + 's');
      addMetric(grid, 'Long waits', String(p.longWaits));
      addMetric(grid, 'Avg journey', fmt(p.avgJourney) + 's');
      addMetric(grid, 'Throughput', (sys.throughput || 0).toFixed(2) + '/s');
      addMetric(grid, 'Elapsed', fmt(m.elapsed) + 's');
      m.elevators.forEach(function (ev) {
        metricsEl.appendChild(el('div', 'elev-metric',
          ev.name + ' util ' + Math.round(ev.utilization * 100) + '%' +
          ' avg occ ' + fmt(ev.avgOccupancy) + ' max ' + ev.maxOccupancy +
          ' dist ' + ev.distance + ' stops ' + ev.stops +
          ' dirs ' + ev.directionChanges));
      });
    }

    function addMetric(grid, label, value) {
      var cell = el('div', 'metric');
      cell.appendChild(el('div', 'metric-label', label));
      cell.appendChild(el('div', 'metric-value', value));
      grid.appendChild(cell);
    }

    function render() {
      renderLifts();
      renderStatus();
      renderPending();
      renderMetrics();
    }

    /* ---------- actions ---------- */
    var running = false;
    var speed = 1;
    var timer = null;
    var lastResult = null;
    var selectedDest = null;
    var lastAssignedId = null;
    var destBtnEls = [];
    var api;

    function showMessage(text, isError) {
      messageEl.textContent = text;
      messageEl.className = isError ? 'message error' : 'message';
    }

    function submitRequest() {
      var origin = parseInt(originSel ? originSel.value : '1', 10) || 1;
      var dest = selectedDest;
      var pax = parseInt(paxEl ? paxEl.value : '1', 10) || 1;
      if (!dest || isNaN(dest)) { showMessage('Choose a destination floor.', true); return null; }
      var res = engine.request(origin, dest, pax);
      lastResult = res;
      renderAssignment(res);
      if (res.ok) {
        lastAssignedId = res.assignment.elevatorId;
        var btn = destBtnEls[dest];
        if (btn) {
          btn.textContent = 'F' + dest;
          btn.appendChild(el('span', 'floor-badge', res.assignment.elevatorName));
        }
        showMessage('Assigned to ' + res.assignment.elevatorName +
          ' - ETA ' + fmt(res.assignment.eta) + 's');
      } else {
        showMessage(res.error || 'Request queued.', !res.ok);
      }
      render();
      return res;
    }

    function setOrigin(f) {
      if (originSel) originSel.value = String(f);
      syncOriginLabel();
    }
    function setDest(f) {
      selectDest(f);
      return selectedDest;
    }

    function toggleService(id) {
      var res;
      if (engine.state.elevators[id].maintenanceStatus === 'MAINTENANCE') {
        res = engine.restore(id);
      } else {
        res = engine.setMaintenance(id);
      }
      if (res && !res.ok) { showMessage(res.error, true); }
      render();
      return res;
    }

    function stepOnce() {
      var events = engine.tick();
      metrics.observe(engine.state.clock.now());
      events.forEach(function (ev) {
        logLine(ev);
      });
      render();
    }
    function logLine(ev) {
      logListEl.appendChild(el('li', 'log-line',
        't' + ev.time + ' ' + ev.type +
        (ev.elevatorName ? ' ' + ev.elevatorName : '') +
        (ev.floor ? ' F' + ev.floor : '') +
        (ev.requestId ? ' #' + ev.requestId : '') +
        (ev.passengers !== undefined ? ' ' + ev.passengers + ' pax' : '')));
      while (logListEl.children.length > 100) {
        logListEl.removeChild(logListEl.firstChild);
      }
    }

    function setSpeed(v) {
      speed = v || 1;
      if (timer) {
        stop();
        start();
      }
    }
    function start() {
      if (timer) return;
      running = true;
      timer = setInterval(function () {
        if (running) stepOnce();
      }, Math.round(tickMs / speed));
    }
    function stop() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
    }
    function pause() { running = false; }
    function resume() { running = true; }
    function step() { if (!timer) stepOnce(); }
    function reset() {
      stop();
      logListEl.textContent = '';
      assignmentEl.textContent = '';
      engine = SimulationEngine.create(cfg);
      metrics = MetricsCollector.create(engine);
      api.engine = engine;
      api.metrics = metrics;
      selectedDest = null;
      lastAssignedId = null;
      for (var f = 1; f <= floors; f += 1) {
        if (destBtnEls[f]) destBtnEls[f].textContent = 'F' + f;
      }
      selectDest(null);
      render();
      showMessage('Reset.', false);
    }

    /* ---------- DOM wiring ---------- */
    buildFloorNumbers();
    buildShafts();
    populateFloorSelects();
    buildDestPanel();
    syncOriginLabel();
    if (originSel) originSel.addEventListener('change', syncOriginLabel);
    if (requestBtn) requestBtn.addEventListener('click', submitRequest);
    if (startBtn) startBtn.addEventListener('click', start);
    if (pauseBtn) pauseBtn.addEventListener('click', pause);
    if (resumeBtn) resumeBtn.addEventListener('click', resume);
    if (stepBtn) stepBtn.addEventListener('click', step);
    if (resetBtn) resetBtn.addEventListener('click', reset);
    if (speedSel) speedSel.addEventListener('change', function () {
      setSpeed(parseInt(speedSel.value, 10) || 1);
    });

    render();

    api = {
      engine: engine, metrics: metrics,
      request: submitRequest, pressDestination: pressDestination,
      setOrigin: setOrigin, setDest: setDest,
      step: step, start: start, pause: pause, resume: resume, reset: reset,
      setSpeed: setSpeed, toggleService: toggleService,
      render: render, lastResult: function () { return lastResult; },
      isRunning: function () { return running; },
      isTicking: function () { return !!timer; },
      dispose: function () { stop(); }
    };
    return api;
  }

  var UI = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.UI = UI;
}(typeof window !== 'undefined' ? window : globalThis));