/* Smart Lift - Phase 2 DCS UI wiring.
 * Flow: kiosk -> register destination -> controller assigns a car
 * ("Take Lift C") -> car arrives, doors open -> BOARD the assigned car ->
 * ride to destination -> unboard. Multiple passengers can register and
 * travel at once so grouping across cars is visible.
 * Lifts start parked at [A:1, B:2, C:5, D:6] like Phase 1.
 */
(function () {
  'use strict';

  var FLOOR_H = 80;
  var TICK_MS = 700;
  var NUM_FLOORS = 6;
  var NUM_LIFTS = 4;
  var LIFT_NAMES = ['A', 'B', 'C', 'D'];
  var LIFT_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea'];
  var PARK_FLOORS = [1, 2, 5, 6];

  var engine = SmartLift.DCS;
  var building = engine.create({ numFloors: NUM_FLOORS, numLifts: NUM_LIFTS, capacity: 4 });
  building.lifts.forEach(function (lift, i) { lift.floor = PARK_FLOORS[i]; });

  var passengers = []; // UI passengers: { id, name }
  var activeIdx = 0;
  var nextNameIdx = 2;
  var simRunning = false;
  var selectedIdxs = [0]; // multi-select for batch destination registration

  var buildingEl = document.getElementById('building');
  var floorNumbersEl = document.getElementById('floor-numbers');
  var passengerColEl = document.getElementById('passengers');
  var passSelectEl = document.getElementById('passenger-select');
  var chipsEl = document.getElementById('passenger-chips');
  var addPassBtnEl = document.getElementById('add-passenger');
  var kioskStateEl = document.getElementById('kiosk-state');
  var kioskEl = document.getElementById('kiosk');
  var messageEl = document.getElementById('message');
  var statusEl = document.getElementById('lift-status');
  var logListEl = document.getElementById('log-list');

  var liftEls = [];
  var liftNameEls = [];
  var liftFloorEls = [];
  var liftStopsEls = [];
  var liftAvatarsEls = [];
  var passengerFloorEls = [];
  var messageTimer = null;
  var PASSENGER_COLORS = ['#111827', '#b45309', '#0f766e', '#be123c', '#4338ca', '#a21caf'];

  buildingEl.style.setProperty('--floor-h', FLOOR_H + 'px');
  floorNumbersEl.style.setProperty('--floor-h', FLOOR_H + 'px');

  /* ---------------- passenger helpers ---------------- */

  function addUiPassenger(floor, name) {
    var res = engine.addPassenger(building, floor);
    if (!res.ok) { showMessage(res.error, true); return; }
    passengers.push({ id: res.passengerId, name: name });
  }

  function activePassenger() {
    return building.passengers[passengers[activeIdx].id];
  }

  function passName(pid) {
    for (var i = 0; i < passengers.length; i += 1) {
      if (passengers[i].id === pid) return passengers[i].name;
    }
    return 'P' + pid;
  }

  /* ---------------- DOM construction ---------------- */

  function buildFloorNumbers() {
    for (var f = NUM_FLOORS; f >= 1; f -= 1) {
      var num = document.createElement('div');
      num.className = 'floor-number';
      num.textContent = f;
      floorNumbersEl.appendChild(num);

      var cell = document.createElement('div');
      cell.className = 'passenger-floor';
      cell.id = 'passenger-floor-' + f;
      passengerColEl.appendChild(cell);
      passengerFloorEls[f] = cell;
    }
  }

  function buildShafts() {
    for (var i = 0; i < NUM_LIFTS; i += 1) {
      var shaft = document.createElement('div');
      shaft.className = 'shaft';
      shaft.style.height = (NUM_FLOORS * FLOOR_H) + 'px';
      shaft.setAttribute('aria-label', 'Lift shaft ' + LIFT_NAMES[i]);

      var lift = document.createElement('div');
      lift.className = 'lift';
      lift.id = 'lift-' + i;
      lift.style.backgroundColor = LIFT_COLORS[i];
      lift.style.transition = 'transform ' + TICK_MS + 'ms linear';

      var label = document.createElement('div');
      label.className = 'lift-label';
      label.innerHTML = '<span class="lift-name"></span>' +
        '<span class="lift-floor"></span><span class="lift-stops"></span>' +
        '<span class="lift-avatars"></span>';

      lift.appendChild(label);
      shaft.appendChild(lift);
      buildingEl.appendChild(shaft);

      liftEls[i] = lift;
      liftNameEls[i] = label.querySelector('.lift-name');
      liftFloorEls[i] = label.querySelector('.lift-floor');
      liftStopsEls[i] = label.querySelector('.lift-stops');
      liftAvatarsEls[i] = label.querySelector('.lift-avatars');
    }
  }

  /* ---------------- Kiosk panel ---------------- */

  function renderPassengerSelect() {
    passSelectEl.innerHTML = '';
    passengers.forEach(function (p, i) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.name;
      if (i === activeIdx) opt.selected = true;
      passSelectEl.appendChild(opt);
    });
  }

  function statusGlyph(pass) {
    if (pass.aboardLiftId !== null) return 'aboard Lift ' + LIFT_NAMES[pass.aboardLiftId];
    if (pass.assignedLiftId !== null) return 'assigned to Lift ' + LIFT_NAMES[pass.assignedLiftId];
    return 'free';
  }

  function isSelected(i) {
    return selectedIdxs.indexOf(i) !== -1;
  }

  function renderPassengerChips() {
    chipsEl.innerHTML = '';
    passengers.forEach(function (p, i) {
      var pass = building.passengers[p.id];
      if (!pass) return;
      var chip = document.createElement('button');
      chip.type = 'button';
      var cls = 'pchip' + (isSelected(i) ? ' selected' : '') + (i === activeIdx ? ' active' : '');
      chip.className = cls;
      chip.style.color = PASSENGER_COLORS[i % PASSENGER_COLORS.length];
      var tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = isSelected(i) ? '\u2611' : '\u2610';
      chip.appendChild(tick);
      var av = avatarSpan(p.id, true);
      if (av) chip.appendChild(av);
      var nameEl = document.createElement('span');
      nameEl.textContent = p.name + ' (' + statusGlyph(pass) + ')';
      chip.appendChild(nameEl);
      chip.addEventListener('click', function () {
        var j = selectedIdxs.indexOf(i);
        if (j === -1) selectedIdxs.push(i); else selectedIdxs.splice(j, 1);
        activeIdx = i;
        render();
      });
      chipsEl.appendChild(chip);
    });
  }

  function renderKioskState(you) {
    if (you.aboardLiftId !== null) {
      var lift = building.lifts[you.aboardLiftId];
      var next = lift.stops[0] !== undefined ? 'next stop: floor ' + lift.stops[0] : 'heading to your floor';
      kioskStateEl.innerHTML = '<b>' + passengers[activeIdx].name + ':</b> inside Lift ' +
        LIFT_NAMES[lift.id] + ' at floor ' + lift.floor + ' &mdash; ' + next +
        '. Destination: floor ' + you.destination + '.';
      return;
    }
    if (you.assignedLiftId !== null) {
      var aLift = building.lifts[you.assignedLiftId];
      var waiting = aLift.floor === you.floor && aLift.doorsOpen > 0
        ? ' &mdash; <b>doors are open, board now!</b>'
        : '- waiting for it to arrive...';
      kioskStateEl.innerHTML = '<b>' + passengers[activeIdx].name + ':</b> at floor ' + you.floor +
        ' &mdash; assigned to <b>Lift ' + LIFT_NAMES[you.assignedLiftId] + '</b>' + waiting +
        '.<ul><li>Pickup ETA: ~' + assignedEta(you) + ' ticks (' +
        Math.round(assignedEta(you) * TICK_MS / 1000) + 's)</li>' +
        '<li>Car stops: ' + (aLift.stops.length ? aLift.stops.join(', ') : '-') + '</li></ul>';
      return;
    }
    kioskStateEl.innerHTML = '<b>' + passengers[activeIdx].name + ':</b> at floor ' + you.floor +
      ' (kiosk) &mdash; choose a destination to get your car assignment.';
  }

  function assignedEta(you) {
    var lift = building.lifts[you.assignedLiftId];
    var t = 0, prev = lift.floor;
    for (var i = 0; i < lift.stops.length; i += 1) {
      if (lift.stops[i] === you.floor) break;
      t += Math.abs(prev - lift.stops[i]);
      prev = lift.stops[i];
    }
    return t;
  }

  function renderKiosk(you) {
    kioskEl.innerHTML = '';

    if (you.aboardLiftId !== null) {
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Riding Lift ' + LIFT_NAMES[you.aboardLiftId] + ' - nothing to do until it stops at floor ' + you.destination + '.';
      kioskEl.appendChild(hint);
      return;
    }

    if (you.assignedLiftId !== null) {
      var lift = building.lifts[you.assignedLiftId];
      if (lift.floor === you.floor && lift.doorsOpen > 0) {
        var b = document.createElement('button');
        b.className = 'board-btn';
        b.type = 'button';
        b.textContent = 'Board Lift ' + LIFT_NAMES[you.assignedLiftId] + ' (doors open)';
        b.addEventListener('click', function () { boardActive(); });
        kioskEl.appendChild(b);
      } else {
        var h = document.createElement('p');
        h.className = 'hint';
        h.textContent = 'No action yet - you are assigned. Wait for Lift ' +
          LIFT_NAMES[you.assignedLiftId] + ' (board button appears when it arrives).';
        kioskEl.appendChild(h);
      }
      return;
    }

    // Free passenger: kiosk - pick a destination.
    var batch = selectedIdxs.length;
    if (batch > 1) {
      var note = document.createElement('p');
      note.className = 'hint';
      note.textContent = batch + ' passengers selected - a destination registers them all.';
      kioskEl.appendChild(note);
    }
    var row = document.createElement('div');
    row.className = 'floor-select-row';
    var lab = document.createElement('span');
    lab.textContent = 'I am at floor';
    var sel = document.createElement('select');
    for (var f = 1; f <= NUM_FLOORS; f += 1) {
      var opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      if (f === you.floor) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function () {
      var floor = parseInt(sel.value, 10);
      selectedIdxs.slice().forEach(function (i) {
        var pass = building.passengers[passengers[i].id];
        if (pass && pass.aboardLiftId === null && pass.assignedLiftId === null) {
          pass.floor = floor;
        }
      });
      showMessage('Selected passengers are now on floor ' + floor + '.', false);
      render();
    });
    row.appendChild(lab);
    row.appendChild(sel);
    kioskEl.appendChild(row);

    var grid = document.createElement('div');
    grid.className = 'floor-grid';
    for (var d = NUM_FLOORS; d >= 1; d -= 1) {
      var btn = document.createElement('button');
      btn.className = 'dest-btn';
      btn.type = 'button';
      btn.textContent = 'Floor ' + d;
      var allOn = selectedIdxs.every(function (i) {
        var pass = building.passengers[passengers[i].id];
        return pass && (pass.aboardLiftId !== null || pass.assignedLiftId !== null || pass.floor === d);
      });
      btn.disabled = allOn;
      btn.addEventListener('click', (function (floor) {
        return function () { registerDest(floor); };
      })(d));
      grid.appendChild(btn);
    }
    kioskEl.appendChild(grid);
  }

  /* ---------------- Passenger markers ---------------- */

  function avatarSpan(pid, small) {
    var pass = building.passengers[pid];
    if (!pass) return null;
    var idx = 0;
    for (var i = 0; i < passengers.length; i += 1) {
      if (passengers[i].id === pid) { idx = i; break; }
    }
    var span = document.createElement('span');
    span.className = 'avatar' + (small ? '' : (pass.assignedLiftId !== null ? ' assigned' : ''));
    span.style.backgroundColor = PASSENGER_COLORS[idx % PASSENGER_COLORS.length];
    span.textContent = passengers[idx].name.charAt(0).toUpperCase();
    var title = passName(pid);
    if (pass.assignedLiftId !== null) title += ' - assigned to Lift ' + LIFT_NAMES[pass.assignedLiftId];
    span.title = title;
    return span;
  }

  function renderPassengers() {
    for (var f = 1; f <= NUM_FLOORS; f += 1) {
      passengerFloorEls[f].textContent = '';
    }
    passengers.forEach(function (p) {
      var pass = building.passengers[p.id];
      if (!pass) return;
      var floor = pass.floor;
      if (pass.aboardLiftId !== null) {
        floor = building.lifts[pass.aboardLiftId].floor;
      }
      var cell = passengerFloorEls[floor];
      var av = avatarSpan(p.id, false);
      if (av) cell.appendChild(av);
    });
    building.lifts.forEach(function (lift) {
      liftAvatarsEls[lift.id].textContent = '';
      lift.passengers.forEach(function (pid) {
        var av = avatarSpan(pid, true);
        if (av) liftAvatarsEls[lift.id].appendChild(av);
      });
    });
  }

  /* ---------------- Actions ---------------- */

  function registerDest(floor) {
    var done = 0, failed = '', skipped = 0;
    selectedIdxs.slice().forEach(function (i) {
      var you = building.passengers[passengers[i].id];
      if (you.aboardLiftId !== null || you.assignedLiftId !== null) { skipped += 1; return; }
      if (you.floor === floor) { skipped += 1; return; }
      var res = engine.registerDestination(building, you.id, floor);
      if (!res.ok) { failed = res.error; return; }
      logEvent(res.event);
      done += 1;
    });
    if (done > 0) {
      showMessage(done + ' passenger' + (done === 1 ? '' : 's') + ' assigned. Pickup ETAs:', false);
    } else if (failed) {
      showMessage(failed, true);
    } else if (skipped > 0) {
      showMessage('Nothing to register - selected passengers are already assigned/aboard or already on floor ' + floor + '.', true);
    }
    render();
  }

  function boardActive() {
    var you = activePassenger();
    var res = engine.board(building, you.id, you.assignedLiftId);
    if (!res.ok) { showMessage(res.error, true); return; }
    logEvent(res.event);
    showMessage(passengers[activeIdx].name + ' boarded Lift ' + LIFT_NAMES[res.liftId] + '.', false);
    render();
  }

  function showMessage(text, isError) {
    messageEl.innerHTML = text;
    messageEl.className = 'message ' + (isError ? 'error' : 'info');
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(function () {
      messageEl.innerHTML = '';
      messageEl.className = 'message';
    }, 4000);
  }

  /* ---------------- Rendering ---------------- */

  function render() {
    building.lifts.forEach(function (lift) {
      var el = liftEls[lift.id];
      el.style.transform = 'translateY(' + (-(lift.floor - 1) * FLOOR_H) + 'px)';
      var arrived = lift.doorsOpen > 0;
      el.classList.toggle('arrived', arrived);

      if (lift.maintenance) {
        el.classList.add('servicing');
        liftNameEls[lift.id].textContent = LIFT_NAMES[lift.id] + ' SERVICE';
      } else {
        el.classList.remove('servicing');
        var arrow = lift.direction === 'UP' ? '\u25B2' :
                    lift.direction === 'DOWN' ? '\u25BC' : '\u2022';
        var door = arrived ? ' \u26D7' : '';
        liftNameEls[lift.id].textContent = LIFT_NAMES[lift.id] + ' ' + arrow +
          ' x' + lift.passengers.length + door;
      }
      liftFloorEls[lift.id].textContent = 'Floor ' + lift.floor;
      liftStopsEls[lift.id].textContent = lift.stops.length
        ? 'stops: ' + lift.stops.join(', ')
        : '';
    });
    renderStatus();
    renderPassengers();
    renderPassengerSelect();
    renderPassengerChips();
    renderKioskState(activePassenger());
    renderKiosk(activePassenger());
  }

  function renderStatus() {
    statusEl.textContent = '';
    var servicing = building.lifts.filter(function (l) { return l.maintenance; }).length;
    if (servicing > 0) {
      var summary = document.createElement('div');
      summary.className = 'status-summary';
      summary.textContent = (NUM_LIFTS - servicing) + ' of ' + NUM_LIFTS +
        ' lifts operating - remaining lifts are covering all traffic.';
      statusEl.appendChild(summary);
    }
    building.lifts.forEach(function (lift) {
      var line = document.createElement('div');
      line.className = 'status-line' + (lift.maintenance ? ' servicing' : '');

      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = LIFT_COLORS[lift.id];

      var text = document.createElement('span');
      if (lift.maintenance) {
        text.textContent = 'Lift ' + LIFT_NAMES[lift.id] + ' at floor ' +
          lift.floor + ' - UNDER MAINTENANCE';
      } else {
        var bur = lift.stops.join(', ');
        text.innerHTML =
          '<b>Lift ' + LIFT_NAMES[lift.id] + '</b> &mdash; floor ' + lift.floor +
          ' &middot; ' + lift.direction +
          (lift.doorsOpen > 0 ? ' &middot; <b>doors open</b>' : '') +
          ' &middot; load ' + (lift.passengers.length + lift.assigned.length) + '/' + building.capacity +
          ' &middot; waiting ' + lift.assigned.length +
          ' &middot; aboard ' + lift.passengers.length +
          (bur ? ' &middot; stops: ' + bur : '');
      }

      var wrap = document.createElement('div');
      wrap.className = 'btn-wrap';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'maint-btn';
      btn.textContent = lift.maintenance ? 'Restore' : 'Service';
      btn.addEventListener('click', (function (id) {
        return function () { toggleService(id); };
      })(lift.id));

      line.appendChild(dot);
      line.appendChild(text);
      wrap.appendChild(btn);
      line.appendChild(wrap);
      statusEl.appendChild(line);
    });
  }

  function toggleService(liftId) {
    var lift = building.lifts[liftId];
    var res = engine.setMaintenance(building, liftId, !lift.maintenance);
    if (!res.ok) { showMessage(res.error, true); return; }
    showMessage(res.maintenance
      ? 'Lift ' + LIFT_NAMES[liftId] + ' is under maintenance - it will not be assigned or boarded.'
      : 'Lift ' + LIFT_NAMES[liftId] + ' is back in service.', false);
    render();
  }

  function logEvent(ev) {
    if (!ev) return;
    var line = document.createElement('div');
    line.className = 'log-line log-' + ev.type;
    line.textContent = describeEvent(ev);
    logListEl.appendChild(line);
    logListEl.scrollTop = logListEl.scrollHeight;
  }

  function describeEvent(ev) {
    var name = LIFT_NAMES[ev.liftId];
    switch (ev.type) {
      case 'assigned':
        return passName(ev.passengerId) + ' ASSIGNED to Lift ' + name +
          ' (from ' + ev.pickupFloor + ' to ' + ev.destFloor +
          ', pickup ETA ~' + ev.eta + '). Stops: ' + ev.stops.join(', ');
      case 'started':
        return 'Lift ' + name + ' STARTED ' + ev.direction.toLowerCase() +
          ' from floor ' + ev.from + ' to ' + ev.to + '.';
      case 'moved':
        return 'Lift ' + name + ' moved ' + (ev.direction === 'UP' ? 'up' : 'down') +
          ' to floor ' + ev.to + '.';
      case 'arrived':
        return 'Lift ' + name + ' ARRIVED at floor ' + ev.floor + ' - doors open.';
      case 'boarded':
        return passName(ev.passengerId) + ' BOARDED Lift ' + name + ' at floor ' + ev.floor + '.';
      case 'unboarded':
        return passName(ev.passengerId) + ' EXITED Lift ' + name + ' at floor ' + ev.floor + '.';
      case 'doorsClosed':
        return 'Lift ' + name + ' doors closed at floor ' + ev.floor + '.';
      case 'no_show':
        return passName(ev.passengerId) + ': NO-SHOW - doors closed at floor ' + ev.floor +
          ' without boarding. Re-register to travel.';
      default:
        return JSON.stringify(ev);
    }
  }

  /* ---------------- Main loop ---------------- */

  setInterval(function () {
    if (!simRunning) return;
    var events = engine.tick(building);
    if (events.length === 0) return;
    // Auto-board assigned passengers the moment their lift arrives (doors open),
    // so a DCS trip is register -> ride without manual-timing no-shows.
    events.forEach(function (ev) {
      if (ev.type !== 'arrived') return;
      var lift = building.lifts[ev.liftId];
      lift.assigned.slice().forEach(function (pid) {
        var pass = building.passengers[pid];
        if (pass && pass.floor === ev.floor && pass.assignedLiftId === ev.liftId) {
          var r = engine.board(building, pid, ev.liftId);
          if (r.ok) logEvent(r.event);
        }
      });
    });
    events.forEach(logEvent);
    render();
  }, TICK_MS);

  /* ---------------- Init ---------------- */

  addUiPassenger(PARK_FLOORS[0], 'You');
  activeIdx = 0;

  addPassBtnEl.addEventListener('click', function () {
    var floor = activePassenger().floor;
    addUiPassenger(floor, 'Passenger ' + nextNameIdx);
    nextNameIdx += 1;
    activeIdx = passengers.length - 1;
    if (selectedIdxs.indexOf(activeIdx) === -1) selectedIdxs.push(activeIdx);
    renderPassengerSelect();
    render();
  });

  var startBtnEl = document.getElementById('start-sim');
  startBtnEl.addEventListener('click', function () {
    simRunning = true;
    startBtnEl.textContent = 'Running...';
    startBtnEl.disabled = true;
  });

  passSelectEl.addEventListener('change', function () {
    activeIdx = parseInt(passSelectEl.value, 10);
    render();
  });
  buildFloorNumbers();
  buildShafts();
  render();
})();