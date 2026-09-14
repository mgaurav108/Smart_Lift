/* Smart Lift - Phase 3 UI wiring (real-time, single interactive user).
 * Flow: you stand at a floor -> call a lift -> the most suitable of the 4
 * lifts travels to you in real time -> board (any idle lift at your floor)
 * -> pick a destination -> ride -> exit -> call again.
 * Lifts start parked across the building so every lift responds to calls.
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

  var engine = SmartLift.Engine;
  var building = engine.create({ numFloors: NUM_FLOORS, numLifts: NUM_LIFTS });

  // Spread the lifts so dispatch naturally uses all of them (not just A).
  building.lifts.forEach(function (lift, i) { lift.floor = PARK_FLOORS[i]; });

  // The single interactive passenger.
  var YOU = engine.addPassenger(building, PARK_FLOORS[0]).passengerId;

  var buildingEl = document.getElementById('building');
  var floorNumbersEl = document.getElementById('floor-numbers');
  var buttonsEl = document.getElementById('floor-buttons');
  var messageEl = document.getElementById('message');
  var statusEl = document.getElementById('lift-status');
  var logListEl = document.getElementById('log-list');
  var userStateEl = document.getElementById('user-state');

  var liftEls = [];
  var liftNameEls = [];
  var liftFloorEls = [];
  var messageTimer = null;

  buildingEl.style.setProperty('--floor-h', FLOOR_H + 'px');
  floorNumbersEl.style.setProperty('--floor-h', FLOOR_H + 'px');

  function yourPassenger() {
    return building.passengers[YOU];
  }

  /* ---------------- DOM construction ---------------- */

  function buildFloorNumbers() {
    for (var f = NUM_FLOORS; f >= 1; f -= 1) {
      var num = document.createElement('div');
      num.className = 'floor-number';
      num.textContent = f;
      floorNumbersEl.appendChild(num);
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
      label.innerHTML = '<span class="lift-name"></span><span class="lift-floor"></span>';

      lift.appendChild(label);
      shaft.appendChild(lift);
      buildingEl.appendChild(shaft);

      liftEls[i] = lift;
      liftNameEls[i] = label.querySelector('.lift-name');
      liftFloorEls[i] = label.querySelector('.lift-floor');
    }
  }

  /* ---------------- Control panel rendering ---------------- */

  function renderControlPanel() {
    buttonsEl.innerHTML = '';
    var you = yourPassenger();
    if (!you) return;

    if (you.boardedLiftId !== null) {
      renderDestinationMode(you);
    } else {
      renderCallMode(you);
    }
  }

  function renderCallMode(you) {
    // Step 1a: call a lift - you are at `you.floor`, call from any floor.
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'You are at floor ' + you.floor +
      '. Call a lift (you walk there and wait for it to arrive):';
    buttonsEl.appendChild(hint);

    for (var f = NUM_FLOORS; f >= 1; f -= 1) {
      var btn = document.createElement('button');
      btn.className = 'floor-btn call-btn';
      btn.type = 'button';
      btn.textContent = 'Call at floor ' + f;
      btn.addEventListener('click', (function (floor) {
        return function () { callLift(floor); };
      })(f));
      buttonsEl.appendChild(btn);
    }

    // Step 1b: board any idle lift already present at the passenger's floor.
    renderBoardButtons(you);
  }

  function renderDestinationMode(you) {
    var lift = building.lifts[you.boardedLiftId];
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'You are in Lift ' + LIFT_NAMES[lift.id] +
      '. Select your destination floor:';
    buttonsEl.appendChild(hint);

    for (var f = NUM_FLOORS; f >= 1; f -= 1) {
      var btn = document.createElement('button');
      btn.className = 'floor-btn destination-btn';
      btn.type = 'button';
      btn.textContent = 'Floor ' + f;
      btn.addEventListener('click', (function (floor) {
        return function () { selectDest(floor); };
      })(f));
      buttonsEl.appendChild(btn);
    }
  }

  function renderBoardButtons(you) {
    building.lifts.forEach(function (lift) {
      if (lift.maintenance) return;
      if (lift.floor === you.floor && lift.direction === engine.DIR_IDLE) {
        var btn = document.createElement('button');
        btn.className = 'board-btn';
        btn.type = 'button';
        btn.textContent = 'Board Lift ' + LIFT_NAMES[lift.id] +
          ' (arrived/parked)';
        btn.addEventListener('click', (function (id) {
          return function () { boardLift(id); };
        })(lift.id));
        buttonsEl.appendChild(btn);
      }
    });
  }

  /* ---------------- Actions ---------------- */

  function callLift(floor) {
    var res = engine.call(building, YOU, floor);
    if (!res.ok) {
      showMessage(res.error, true);
      return;
    }
    var lift = building.lifts[res.liftId];
    if (lift.floor === floor) {
      showMessage('Lift ' + LIFT_NAMES[res.liftId] +
        ' is already at floor ' + floor + ' - board it.', false);
    } else {
      showMessage('Lift ' + LIFT_NAMES[res.liftId] +
        ' is coming to floor ' + floor + '...', false);
    }
    render();
  }

  function boardLift(liftId) {
    var res = engine.board(building, YOU, liftId);
    if (!res.ok) {
      showMessage(res.error, true);
      return;
    }
    showMessage('You boarded Lift ' + LIFT_NAMES[liftId] +
      '. Now choose a destination.', false);
    render();
  }

  function selectDest(floor) {
    var res = engine.selectDestination(building, YOU, floor);
    if (!res.ok) {
      showMessage(res.error, true);
      return;
    }
    showMessage('Lift ' + LIFT_NAMES[res.liftId] + ' heading to floor ' + floor + '.', false);
    render();
  }

  function showMessage(text, isError) {
    messageEl.textContent = text;
    messageEl.className = 'message ' + (isError ? 'error' : 'info');
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(function () {
      messageEl.textContent = '';
      messageEl.className = 'message';
    }, 4000);
  }

  /* ---------------- Rendering ---------------- */

  function render() {
    building.lifts.forEach(function (lift) {
      var el = liftEls[lift.id];
      el.style.transform = 'translateY(' + (-(lift.floor - 1) * FLOOR_H) + 'px)';

      if (lift.maintenance) {
        el.classList.add('servicing');
        liftNameEls[lift.id].textContent = LIFT_NAMES[lift.id] + ' SERVICE';
      } else {
        el.classList.remove('servicing');
        var arrow = lift.direction === 'UP' ? '\u25B2' :
                    lift.direction === 'DOWN' ? '\u25BC' : '\u2022';
        liftNameEls[lift.id].textContent = LIFT_NAMES[lift.id] + ' ' + arrow +
          ' x' + lift.passengers.length;
      }
      liftFloorEls[lift.id].textContent = 'Floor ' + lift.floor;
    });
    renderStatus();
    renderUserState();
    renderControlPanel();
  }

  function renderUserState() {
    var you = yourPassenger();
    if (!you) return;
    if (you.boardedLiftId !== null) {
      userStateEl.innerHTML = '<b>You are:</b> inside Lift ' +
        LIFT_NAMES[you.boardedLiftId] + ' passing floor ' +
        building.lifts[you.boardedLiftId].floor + ' &mdash; pick a destination.';
    } else {
      userStateEl.innerHTML = '<b>You are:</b> at floor ' + you.floor +
        ' (on the platform) &mdash; call a lift or board one that has arrived.';
    }
  }

  function renderStatus() {
    statusEl.textContent = '';
    building.lifts.forEach(function (lift) {
      var line = document.createElement('div');
      line.className = 'status-line' + (lift.maintenance ? ' servicing' : '');

      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = LIFT_COLORS[lift.id];

      var text = document.createElement('span');
      var aboard = lift.passengers.map(function (pid) {
        return 'You' + (pid === YOU ? ' (you)' : '');
      }).join(', ');
      if (lift.maintenance) {
        text.textContent = 'Lift ' + LIFT_NAMES[lift.id] + ' at floor ' +
          lift.floor + ' - UNDER MAINTENANCE';
      } else {
        text.innerHTML =
          '<b>Lift ' + LIFT_NAMES[lift.id] + '</b> &mdash; floor ' + lift.floor +
          ' &middot; ' + lift.direction +
          (lift.passengers.length ? ' &middot; aboard: ' + aboard : '') +
          (lift.queue.length ? ' &middot; queued: ' + lift.queue.join(', ') : '');
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'maint-btn';
      btn.textContent = lift.maintenance ? 'Restore' : 'Service';
      btn.addEventListener('click', (function (id) {
        return function () { toggleService(id); };
      })(lift.id));

      line.appendChild(dot);
      line.appendChild(text);
      line.appendChild(btn);
      statusEl.appendChild(line);
    });
  }

  function toggleService(liftId) {
    var lift = building.lifts[liftId];
    var res = engine.setMaintenance(building, liftId, !lift.maintenance);
    if (!res.ok) {
      showMessage(res.error, true);
      return;
    }
    showMessage(res.maintenance
      ? 'Lift ' + LIFT_NAMES[liftId] +
        ' is under maintenance - it will not be dispatched or boarded.'
      : 'Lift ' + LIFT_NAMES[liftId] + ' is back in service.', false);
    render();
  }

  function logEvent(ev) {
    var cls = 'log-' + ev.type;
    var line = document.createElement('div');
    line.className = 'log-line ' + cls;
    line.textContent = describeEvent(ev);
    logListEl.appendChild(line);
    logListEl.scrollTop = logListEl.scrollHeight;
  }

  function describeEvent(ev) {
    var name = LIFT_NAMES[ev.liftId];
    switch (ev.type) {
      case 'started':
        return 'Lift ' + name + ' STARTED going ' + ev.direction.toLowerCase() +
               ' from floor ' + ev.from + ' to ' + ev.to + '.';
      case 'moved':
        return 'Lift ' + name + ' moved ' + (ev.direction === 'UP' ? 'up' : 'down') +
               ' to floor ' + ev.to + '.';
      case 'arrived':
        return 'Lift ' + name + ' ARRIVED at floor ' + ev.floor + ' - doors are open.';
      case 'served':
        return 'Lift ' + name + ' completed the call at floor ' + ev.floor + '.';
      case 'unboarded':
        return 'You EXITED Lift ' + name + ' at floor ' + ev.floor + '.';
      default:
        return JSON.stringify(ev);
    }
  }

  /* ---------------- Main loop ---------------- */

  setInterval(function () {
    var events = engine.tick(building);
    if (events.length === 0) return;
    events.forEach(logEvent);
    render();
  }, TICK_MS);

  /* ---------------- Init ---------------- */

  buildFloorNumbers();
  buildShafts();
  render();
})();