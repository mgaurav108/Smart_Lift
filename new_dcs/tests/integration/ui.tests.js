/* Smart Lift - New DCS UI tests (Spec §56) using the fake DOM helper.
 * Verifies the Phase 7 view renders the full building, the destination
 * panel selects floors, assignments/ETA/messages render, maintenance
 * toggling works, and the simulation controls behave.
 */
(function (global) {
  'use strict';

  var TestSuite = require('../helpers/test-suite.js');
  var assert = TestSuite.assert;
  var assertEq = TestSuite.assertEq;

  var FakeDOM = require('../helpers/fake-dom.js');
  var Config = require('../../config/default-config.js');
  var UI = require('../../js/ui.js');

  var suite = new TestSuite.Suite();

  function makeUI() {
    var doc = FakeDOM.create();
    var ui = UI.create(Config.create({}), { doc: doc });
    return { doc: doc, ui: ui };
  }

  suite.test('56.1 All 15 floors visible', function () {
    var env = makeUI();
    assertEq(env.doc.getElementById('floor-numbers').children.length, 15, '15 floor labels');
    var texts = env.doc.getElementById('floor-numbers').children.map(function (r) {
      return r.textContent;
    });
    assertEq(texts[0], 'F15', 'top floor first');
    assertEq(texts[14], 'F1', 'ground floor last');
    env.ui.dispose();
  });

  suite.test('56.2 All 6 elevators visible + 6 status lines', function () {
    var env = makeUI();
    assertEq(env.doc.getElementById('building').children.length, 6, 'six shafts');
    assertEq(env.doc.getElementById('status-list').children.length, 6, 'six status lines');
    env.ui.dispose();
  });

  suite.test('56.3 Destination panel has 15 buttons and selection works', function () {
    var env = makeUI();
    var panel = env.doc.getElementById('kiosk-dest-panel');
    assertEq(panel.children.length, 15, '15 destination buttons');
    assertEq(panel.children[0].getAttribute('data-floor'), '1', 'button carries floor');
    env.ui.setDest(12);
    var active = panel.children.filter(function (b) {
      return b.className.indexOf('active') !== -1;
    });
    assertEq(active.length, 1, 'exactly one active button');
    assertEq(active[0].getAttribute('data-floor'), '12', 'F12 highlighted');
    env.ui.dispose();
  });

  suite.test('56.4 Assigned elevator + ETA + explanation rendered', function () {
    var env = makeUI();
    env.ui.setDest(12);
    var res = env.ui.request();
    assert(res && res.ok, 'request assigned');
    var text = env.doc.getElementById('assignment').textContent;
    assert(text.indexOf('assigned to') !== -1, 'assignment shown');
    assert(text.indexOf('ETA') !== -1, 'ETA displayed');
    assert(text.indexOf('Final score') !== -1, 'explanation available (§57)');
    assert(env.doc.getElementById('message').textContent.indexOf('Assigned') !== -1,
      'message confirms assignment');
    env.ui.dispose();
  });

  suite.test('56.4b Tapping a destination floor requests exactly one passenger', function () {
    var env = makeUI();
    var res = env.ui.pressDestination(9);
    assert(res && res.ok, 'the floor button itself dispatches a request');
    var req = env.ui.engine.state.requests[res.requestId];
    assertEq(req.originFloor, 1, 'origin is the current floor');
    assertEq(req.destinationFloor, 9, 'destination is the tapped floor');
    assertEq(req.passengerCount, 1, 'one person per tap');
    assert(env.doc.getElementById('assignment').textContent.indexOf('1 pax') !== -1,
      'assignment shows the single passenger');
    env.ui.dispose();
  });

  suite.test('56.5 Missing/invalid destination rejected', function () {
    var env = makeUI();
    env.ui.request(); // no destination chosen
    assertEq(env.doc.getElementById('message').className, 'message error',
      'error styling for missing destination');
    env.ui.setOrigin(5);
    env.ui.setDest(5); // same floor
    var res = env.ui.request();
    assert(!res.ok, 'same-floor request rejected');
    assert(env.doc.getElementById('message').className.indexOf('error') !== -1,
      'error message shown for invalid request');
    env.ui.dispose();
  });

  suite.test('56.6 Pending requests are visible', function () {
    var env = makeUI();
    for (var i = 0; i < 6; i += 1) env.ui.toggleService(i); // fleet down
    env.ui.setDest(9);
    var res = env.ui.request();
    assert(res && !res.ok, 'queued (no available elevator)');
    assert(env.doc.getElementById('pending-list').textContent.indexOf('F') !== -1,
      'pending list shows the queued request');
    env.ui.dispose();
  });

  suite.test('56.7 Elevator floor/direction/occupancy updates in status', function () {
    var env = makeUI();
    var before = env.doc.getElementById('status-list').children[0].textContent;
    assert(before.indexOf('F1') !== -1, 'starts at F1');
    env.ui.setDest(15);
    env.ui.request();
    for (var t = 0; t < 8; t += 1) env.ui.step();
    var line = env.doc.getElementById('status-list').children[0].textContent;
    assert(line.indexOf('F1 ') === -1, 'current floor advanced past F1');
    assert(line.indexOf('MOVING_UP') !== -1 || line.indexOf('DOOR_OPEN') !== -1 ||
      line.indexOf('DOOR_CLOSING') !== -1, 'direction/state visible');
    assert(line.indexOf('1/10') !== -1 || line.indexOf('0/10') !== -1,
      'occupancy visible');
    env.ui.dispose();
  });

  suite.test('56.8 Maintenance toggle + restoration works from UI', function () {
    var env = makeUI();
    env.ui.toggleService(0);
    var line = env.doc.getElementById('status-list').children[0];
    assert(line.textContent.indexOf('UNDER MAINTENANCE') !== -1, 'maintenance status visible');
    assert(line.children[1].textContent === 'Restore', 'restore button available');
    env.ui.toggleService(0);
    var restored = env.doc.getElementById('status-list').children[0];
    assert(restored.textContent.indexOf('IDLE') !== -1, 'restored elevator back to IDLE');
    assert(restored.children[1].textContent === 'Service', 'service button available again');
    var r = env.ui.request();
    env.ui.setOrigin(1);
    env.ui.setDest(8);
    r = env.ui.request();
    assert(r && r.ok && r.assignment.elevatorId === 0, 'restored lift serves requests');
    env.ui.dispose();
  });

  suite.test('56.9 Step advances the simulation; reset restores a clean state', function () {
    var env = makeUI();
    var clock0 = env.ui.engine.state.clock.now();
    env.ui.step();
    assertEq(env.ui.engine.state.clock.now(), clock0 + 1, 'one tick per step');
    env.ui.setDest(6);
    env.ui.request();
    env.ui.reset();
    assertEq(env.ui.engine.state.clock.now(), 0, 'clock reset');
    assertEq(env.doc.getElementById('log-list').children.length, 0, 'log cleared');
    assertEq(env.doc.getElementById('assignment').textContent, '', 'assignment cleared');
    env.ui.dispose();
  });

  suite.test('56.10 Start/pause/resume controls behave', function () {
    var env = makeUI();
    env.ui.start();
    assert(env.ui.isRunning() && env.ui.isTicking(), 'started and ticking');
    env.ui.pause();
    assert(!env.ui.isRunning(), 'pause stops advancing');
    env.ui.resume();
    assert(env.ui.isRunning(), 'resume continues');
    env.ui.dispose();
    assert(!env.ui.isTicking(), 'dispose clears the timer');
  });

  module.exports = { suites: { ui: suite } };
}(typeof window !== 'undefined' ? window : globalThis));