/* Smart Lift - Phase 2 acceptance tests.
 * Covers the multi-passenger model: any of the 4 lifts can be boarded at any
 * time, from any floor, with a two-step process (1: board, 2: destination).
 * Load via tests/run-tests.html, or headlessly with Node.
 */
(function () {
  'use strict';

  var TestSuite = {
    cases: [],
    test: function (name, fn) {
      this.cases.push({ name: name, fn: fn });
    },
    run: function () {
      var pass = 0, fail = 0, output = [];
      this.cases.forEach(function (c) {
        try {
          c.fn();
          pass += 1;
          output.push('PASS: ' + c.name);
        } catch (e) {
          fail += 1;
          output.push('FAIL: ' + c.name + ' -> ' + e.message);
        }
      });
      return { pass: pass, fail: fail, output: output };
    }
  };

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }

  function assertEq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || 'assertEq') + ' (expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(actual) + ')');
    }
  }

  function makeBuilding(liftFloors) {
    var b = E.create({ numFloors: 6, numLifts: liftFloors.length });
    liftFloors.forEach(function (f, i) { b.lifts[i].floor = f; });
    return b;
  }

  function addP(b, floor) {
    var r = E.addPassenger(b, floor);
    if (!r.ok) throw new Error('addPassenger failed: ' + r.error);
    return r.passengerId;
  }

  function tickUntil(b, maxTicks, condition) {
    for (var i = 0; i < maxTicks; i += 1) {
      var events = E.tick(b);
      if (condition(events)) return events;
    }
    return [];
  }

  /* ---------- Initial state ---------- */
  TestSuite.test('initial: 4 lifts idle at floor 1, no passengers yet', function () {
    var b = E.create({ numFloors: 6, numLifts: 4 });
    assertEq(b.lifts.length, 4, 'four lifts');
    b.lifts.forEach(function (lift, i) {
      assertEq(lift.floor, 1, 'lift ' + i + ' at floor 1');
      assertEq(lift.direction, E.DIR_IDLE, 'lift ' + i + ' idle');
      assertEq(lift.queue.length, 0, 'lift ' + i + ' empty queue');
      assertEq(lift.passengers.length, 0, 'lift ' + i + ' empty passenger list');
    });
    assertEq(Object.keys(b.passengers).length, 0, 'no passengers');
    assertEq(b.nextPassengerId, 0, 'next passenger id starts at 0');
  });

  /* ---------- Passenger management ---------- */
  TestSuite.test('addPassenger: passengers are created at their floor, ids increment', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p1 = addP(b, 1);
    var p2 = addP(b, 5);
    assertEq(p1, 0, 'first passenger id 0');
    assertEq(p2, 1, 'second passenger id 1');
    assertEq(b.passengers[p1].floor, 1, 'p0 at floor 1');
    assertEq(b.passengers[p2].floor, 5, 'p1 at floor 5');
    assertEq(b.passengers[p1].boardedLiftId, null, 'p0 not boarded');
    assertEq(b.passengers[p2].destination, null, 'p1 no destination');
  });

  TestSuite.test('addPassenger: floors 0, 7 and 2.5 are rejected', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    [0, 7, 2.5].forEach(function (f) {
      var r = E.addPassenger(b, f);
      assert(!r.ok, 'addPassenger ' + f + ' rejected: ' + r.error);
    });
    assertEq(Object.keys(b.passengers).length, 0, 'no passengers created');
  });

  /* ---------- Two-step boarding: 1) board, 2) destination ---------- */
  TestSuite.test('two-step flow: call, board (step 1), destination (step 2), unboard at arrival', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);

    var callRes = E.call(b, p);
    assert(callRes.ok, 'call accepted');
    assertEq(callRes.liftId, 0, 'lift A dispatched (tie)');

    E.tick(b);
    assertEq(b.lifts[0].queue.length, 0, 'call served (lift already at floor)');
    assertEq(b.lifts[0].direction, E.DIR_IDLE, 'lift A idle');

    var boardRes = E.board(b, p, 0);
    assert(boardRes.ok, 'board accepted');
    assertEq(b.user, undefined, 'no single-user object anymore');
    assertEq(b.passengers[p].boardedLiftId, 0, 'passenger boarded in lift A');
    assertEq(b.lifts[0].passengers.length, 1, 'lift A carries one passenger');

    var destRes = E.selectDestination(b, p, 4);
    assert(destRes.ok, 'destination accepted');
    assertEq(b.lifts[0].queue.length, 1, 'lift A has queued destination');
    assertEq(b.passengers[p].destination, 4, 'passenger destination recorded');

    tickUntil(b, 10, function (evts) {
      return evts.some(function (e) { return e.type === 'unboarded' && e.passengerId === p; });
    });
    assertEq(b.lifts[0].floor, 4, 'lift A at floor 4');
    assertEq(b.lifts[0].direction, E.DIR_IDLE, 'lift A idle');
    assertEq(b.lifts[0].passengers.length, 0, 'lift A empty');
    assertEq(b.passengers[p].boardedLiftId, null, 'passenger unboarded');
    assertEq(b.passengers[p].destination, null, 'destination cleared');
    assertEq(b.passengers[p].floor, 4, 'passenger now on floor 4');
  });

  /* ---------- Core requirement: all 4 lifts boarded at any time ---------- */
  TestSuite.test('all 4 lifts can be boarded simultaneously (one passenger each)', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var pids = [addP(b, 1), addP(b, 1), addP(b, 1), addP(b, 1)];

    for (var i = 0; i < 4; i += 1) {
      var r = E.board(b, pids[i], i);
      assert(r.ok, 'passenger ' + pids[i] + ' boards lift ' + i + ': ' + r.error);
    }
    b.lifts.forEach(function (lift, i) {
      assertEq(lift.passengers.length, 1, 'lift ' + i + ' has 1 passenger');
      assertEq(lift.passengers[0], pids[i], 'lift ' + i + ' carries p' + pids[i]);
      assertEq(lift.direction, E.DIR_IDLE, 'lift ' + i + ' still idle');
    });
    pids.forEach(function (pid, i) {
      assertEq(b.passengers[pid].boardedLiftId, i, 'p' + pid + ' boarded in lift ' + i);
    });
  });

  TestSuite.test('all 4 boarded lifts travel simultaneously and unboard at their destinations', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var pids = [0, 1, 2, 3].map(function () { return addP(b, 1); });
    var dests = [2, 3, 4, 5];
    for (var i = 0; i < 4; i += 1) {
      E.board(b, pids[i], i);
      E.selectDestination(b, pids[i], dests[i]);
    }

    var firstTick = E.tick(b);
    var movingIds = firstTick.filter(function (e) { return e.type === 'moved'; })
      .map(function (e) { return e.liftId; }).sort();
    assertEq(movingIds.join(','), '0,1,2,3', 'all 4 lifts move in the same tick');

    tickUntil(b, 12, function (evts) {
      return evts.filter(function (e) { return e.type === 'unboarded'; }).length === 4;
    });
    pids.forEach(function (pid, i) {
      assertEq(b.passengers[pid].floor, dests[i], 'p' + pid + ' reached floor ' + dests[i]);
      assertEq(b.passengers[pid].boardedLiftId, null, 'p' + pid + ' unboarded');
    });
    b.lifts.forEach(function (lift) {
      assertEq(lift.direction, E.DIR_IDLE, 'lift ' + lift.id + ' idle at rest');
      assertEq(lift.queue.length, 0, 'lift ' + lift.id + ' queue drained');
      assertEq(lift.passengers.length, 0, 'lift ' + lift.id + ' empty');
    });
  });

  /* ---------- Multiple passengers sharing one lift ---------- */
  TestSuite.test('one lift can carry two passengers to different destinations (multi-stop run)', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p0 = addP(b, 1);
    var p1 = addP(b, 1);

    E.board(b, p0, 0);
    E.board(b, p1, 0);
    E.selectDestination(b, p0, 3);
    E.selectDestination(b, p1, 5);
    assertEq(b.lifts[0].queue.join(','), '3,5', 'lift A queues both destinations');
    assertEq(b.lifts[0].passengers.length, 2, 'lift A carries both passengers');

    var arrived = [];
    var unboarded = [];
    for (var i = 0; i < 10; i += 1) {
      E.tick(b).forEach(function (e) {
        if (e.type === 'arrived' && e.liftId === 0) arrived.push(e.floor);
        if (e.type === 'unboarded') unboarded.push(e.passengerId + '@' + e.floor);
      });
    }
    assertEq(arrived.join(','), '3,5', 'stops at 3 then 5 in order');
    assertEq(b.passengers[p0].floor, 3, 'p0 at floor 3');
    assertEq(b.passengers[p1].floor, 5, 'p1 at floor 5');
    assertEq(b.passengers[p0].boardedLiftId, null, 'p0 unboarded');
    assertEq(b.passengers[p1].boardedLiftId, null, 'p1 unboarded');
    assertEq(unboarded.join(','), '0@3,1@5', 'unboarded only at own destinations');
    assertEq(b.lifts[0].floor, 5, 'lift A rests at floor 5');
    assertEq(b.lifts[0].passengers.length, 0, 'lift A empty');
  });

  /* ---------- Board from any floor ---------- */
  TestSuite.test('board from the top floor (5), then ride down', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 5);
    E.call(b, p);
    tickUntil(b, 10, function (evts) {
      return evts.some(function (e) { return e.type === 'arrived' && e.liftId === 0; });
    });
    assertEq(b.lifts[0].floor, 5, 'dispatched lift reaches floor 5');
    assertEq(b.passengers[p].boardedLiftId, null, 'passenger still waiting');

    assert(E.board(b, p, 0).ok, 'board accepted at floor 5');
    assert(E.selectDestination(b, p, 1).ok, 'destination 1 accepted');
    tickUntil(b, 10, function (evts) {
      return evts.some(function (e) { return e.type === 'unboarded' && e.passengerId === p; });
    });
    assertEq(b.passengers[p].floor, 1, 'passenger reached ground floor');
    assertEq(b.lifts[0].floor, 1, 'lift A rests at floor 1');
    assertEq(b.lifts[0].direction, E.DIR_IDLE, 'lift A idle');
  });

  /* ---------- Board any idle lift, not just the dispatched one ---------- */
  TestSuite.test('passenger can board ANY idle lift at their floor (not the dispatched one)', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    E.call(b, p); /* dispatches lift A to floor 1 */

    var r = E.board(b, p, 1); /* board lift B instead */
    assert(r.ok, 'boarding lift B accepted: ' + r.error);
    assertEq(b.passengers[p].boardedLiftId, 1, 'passenger is in lift B');
    assertEq(b.lifts[1].passengers[0], p, 'lift B carries the passenger');
    assertEq(b.lifts[0].queue[0], 1, 'dispatched call on A still queued');
    assert(E.selectDestination(b, p, 3).ok, 'destination chosen after boarding lift B');
  });

  /* ---------- Dispatch rules (unchanged from Phase 1, new per-passenger API) ---------- */
  TestSuite.test('dispatch: A@1 B@4 C@2 D@5, call from 6 -> closest idle D chosen', function () {
    var b = makeBuilding([1, 4, 2, 5]);
    var p = addP(b, 6);
    var r = E.call(b, p);
    assert(r.ok, 'call accepted');
    assertEq(r.liftId, 3, 'closest idle lift D wins');
  });

  TestSuite.test('dispatch: idle lift preferred over busy lift', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p0 = addP(b, 6);
    E.call(b, p0);
    E.tick(b); /* lift A begins moving to 6 */
    var p1 = addP(b, 2);
    var r = E.call(b, p1);
    assert(r.ok, 'call accepted');
    assertEq(r.liftId, 1, 'idle lift B preferred over busy A');
  });

  TestSuite.test('dispatch: all busy -> lift finishing soonest gets the request', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    E.request(b, 6);
    E.request(b, 3);
    E.request(b, 2);
    E.request(b, 5);
    var r = E.request(b, 4);
    assert(r.ok, 'request accepted');
    assertEq(r.liftId, 1, 'soonest-finishing busy lift B wins');
  });

  TestSuite.test('park layout [1,2,5,6]: calls from every floor dispatch A, B, C and D (not just A)', function () {
    var park = [1, 2, 5, 6];
    var b = E.create({ numFloors: 6, numLifts: 4 });
    park.forEach(function (f, i) { b.lifts[i].floor = f; });
    var used = {};
    for (var floor = 1; floor <= 6; floor += 1) {
      var p = E.addPassenger(b, floor).passengerId;
      var r = E.call(b, p, floor);
      assert(r.ok, 'call from floor ' + floor + ' accepted');
      used['ABCD'[r.liftId]] = true;
    }
    assert(used.A, 'lift A dispatched');
    assert(used.B, 'lift B dispatched');
    assert(used.C, 'lift C dispatched');
    assert(used.D, 'lift D dispatched');
  });

  /* ---------- Movement semantics ---------- */
  TestSuite.test('movement UP: one floor per tick, no skips, idle at rest', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    E.request(b, 5);
    var visited = [];
    var badDir = [];
    for (var i = 0; i < 8; i += 1) {
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'moved' && ev.liftId === 0) {
          visited.push(ev.to);
          if (ev.direction !== E.DIR_UP) badDir.push('not UP at floor ' + ev.to);
        }
      });
    }
    assertEq(visited.join(','), '2,3,4,5', 'one floor per tick, no skips');
    assertEq(badDir.length, 0, 'direction UP while moving');
    assertEq(b.lifts[0].direction, E.DIR_IDLE, 'idle after arrival');
    assertEq(b.lifts[0].queue.length, 0, 'queue drained');
  });

  TestSuite.test('movement DOWN: one floor per tick downward, idle at rest', function () {
    var b = makeBuilding([6, 6, 6, 6]);
    var p = addP(b, 6);
    E.board(b, p, 0);
    E.selectDestination(b, p, 1);
    var visited = [];
    var badDir = [];
    for (var i = 0; i < 8; i += 1) {
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'moved' && ev.liftId === 0) {
          visited.push(ev.to);
          if (ev.direction !== E.DIR_DOWN) badDir.push('not DOWN at floor ' + ev.to);
        }
      });
    }
    assertEq(visited.join(','), '5,4,3,2,1', 'down one floor per tick');
    assertEq(badDir.length, 0, 'direction DOWN while moving');
    assertEq(b.lifts[0].floor, 1, 'lift A at floor 1');
    assertEq(b.lifts[0].direction, E.DIR_IDLE, 'lift A idle');
    assertEq(b.passengers[p].boardedLiftId, null, 'passenger unboarded at destination');
  });

  /* ---------- Queues ---------- */
  TestSuite.test('FIFO: one lift serves queued requests in order', function () {
    var b = makeBuilding([1]);
    E.request(b, 3);
    E.request(b, 5);
    assertEq(b.lifts[0].queue.join(','), '3,5', 'both requests queued on the only lift');
    var arrived = [];
    for (var i = 0; i < 20; i += 1) {
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'arrived' && ev.liftId === 0) arrived.push(ev.floor);
      });
    }
    assertEq(arrived.join(','), '3,5', 'destinations served in FIFO order');
    assertEq(b.lifts[0].queue.length, 0, 'queue drained');
  });

  /* ---------- Unboarding correctness ---------- */
  TestSuite.test('passenger is unboarded only at their destination, exactly once', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    E.board(b, p, 0);
    E.selectDestination(b, p, 3);
    var unboarded = [];
    for (var i = 0; i < 6; i += 1) {
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'unboarded') unboarded.push(ev.passengerId + '@' + ev.floor);
      });
    }
    assertEq(unboarded.join(','), '0@3', 'unboarded exactly once at floor 3');
    assertEq(b.passengers[p].floor, 3, 'passenger at floor 3');
  });

  /* ---------- Invalid inputs ---------- */
  TestSuite.test('invalid: call for an unknown passenger is rejected', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var r = E.call(b, 999);
    assert(!r.ok, 'unknown passenger rejected');
  });

  TestSuite.test('invalid: boarded passenger cannot call a lift', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    E.board(b, p, 0);
    var r = E.call(b, p);
    assert(!r.ok, 'call while boarded rejected');
  });

  TestSuite.test('invalid: board with unknown passenger or unknown lift is rejected', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    assert(!E.board(b, 999, 0).ok, 'unknown passenger rejected');
    assert(!E.board(b, p, 99).ok, 'unknown lift rejected');
  });

  TestSuite.test('invalid: a passenger cannot board twice', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    E.board(b, p, 0);
    var r = E.board(b, p, 1);
    assert(!r.ok, 'second board rejected');
    assertEq(b.passengers[p].boardedLiftId, 0, 'still in first lift');
  });

  TestSuite.test('invalid: cannot board a lift at a different floor', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 3);
    var r = E.board(b, p, 0);
    assert(!r.ok, 'board at wrong floor rejected');
  });

  TestSuite.test('invalid: cannot board a moving lift', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    E.request(b, 6);
    E.tick(b);
    var p = addP(b, 1);
    var r = E.board(b, p, 0);
    assert(!r.ok, 'board moving lift rejected');
  });

  TestSuite.test('invalid: destination requires being boarded', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    var r = E.selectDestination(b, p, 3);
    assert(!r.ok, 'destination without boarding rejected');
  });

  TestSuite.test('invalid: same-floor destination is rejected', function () {
    var b = makeBuilding([3, 3, 3, 3]);
    var p = addP(b, 3);
    E.board(b, p, 0);
    var r = E.selectDestination(b, p, 3);
    assert(!r.ok, 'same-floor destination rejected');
    assert(r.error.indexOf('Already at floor') !== -1, 'error message shown');
  });

  TestSuite.test('invalid: destination floors 0, 7 and 2.5 are rejected', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var p = addP(b, 1);
    E.board(b, p, 0);
    [0, 7, 2.5].forEach(function (f) {
      var r = E.selectDestination(b, p, f);
      assert(!r.ok, 'destination ' + f + ' rejected: ' + r.error);
    });
    assertEq(b.lifts[0].queue.length, 0, 'nothing queued');
  });

  TestSuite.test('invalid: request for floors 0, 7 and 2.5 is ignored', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    [0, 7, 2.5].forEach(function (f) {
      var r = E.request(b, f);
      assert(!r.ok, 'request ' + f + ' rejected: ' + r.error);
    });
    E.tick(b);
    b.lifts.forEach(function (lift) {
      assertEq(lift.floor, 1, 'lift stays at floor 1');
      assertEq(lift.queue.length, 0, 'no queued work');
    });
  });

  /* ---------- Maintenance ---------- */
  TestSuite.test('maintenance: a lift under maintenance is not dispatched', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    var m = E.setMaintenance(b, 0, true);
    assert(m.ok, 'can mark lift A under maintenance');
    assertEq(b.lifts[0].maintenance, true, 'lift A flagged');

    var p = addP(b, 5);
    var r = E.call(b, p);
    assert(r.ok, 'call still accepted with 3 lifts available');
    assertEq(r.liftId, 1, 'maintenance lift A skipped, B dispatched');
  });

  TestSuite.test('maintenance: call rejected when all lifts are under maintenance', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    [0, 1, 2, 3].forEach(function (id) {
      assert(E.setMaintenance(b, id, true).ok, 'maintain lift ' + id);
    });
    var p = addP(b, 1);
    var r = E.call(b, p);
    assert(!r.ok, 'call rejected when no lift is available');
    assert(r.error.indexOf('maintenance') !== -1, 'error mentions maintenance');
  });

  TestSuite.test('maintenance: cannot board a lift under maintenance', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    E.setMaintenance(b, 0, true);
    var p = addP(b, 1);
    var r = E.board(b, p, 0);
    assert(!r.ok, 'board rejected');
    assert(r.error.indexOf('maintenance') !== -1, 'error mentions maintenance');
    assertEq(b.passengers[p].boardedLiftId, null, 'passenger not boarded');
  });

  TestSuite.test('maintenance: cannot take a busy lift out of service', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    E.request(b, 5);
    var r1 = E.setMaintenance(b, 0, true);
    assert(!r1.ok, 'queued lift cannot go to maintenance');
    E.tick(b);
    var r2 = E.setMaintenance(b, 0, true);
    assert(!r2.ok, 'moving lift cannot go to maintenance');
  });

  TestSuite.test('maintenance: a lift can be restored to service and dispatched again', function () {
    var b = makeBuilding([1, 1, 1, 1]);
    E.setMaintenance(b, 0, true);
    var p = addP(b, 5);
    var r = E.call(b, p);
    assertEq(r.liftId, 1, 'A skipped while in maintenance');
    assert(E.setMaintenance(b, 0, false).ok, 'lift A restored');
    var p2 = addP(b, 5);
    var r2 = E.call(b, p2);
    assertEq(r2.liftId, 0, 'restored lift A dispatched again');
  });

  var target = typeof window !== 'undefined' ? window : globalThis;
  target.TestSuite = TestSuite;
  target.assert = assert;
  target.assertEq = assertEq;
  target.makeBuilding = makeBuilding;
  target.E = SmartLift.Engine;
})();