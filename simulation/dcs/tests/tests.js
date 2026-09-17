/* Smart Lift - Phase 2 DCS acceptance tests (Spec/phase2-dcs.md).
 * Covers: kiosk registration, grouping allocator, assigned-car boarding,
 * tour/unboarding, no-show, capacity, maintenance, validation (AC-D1..D10).
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

  function assertEqArr(actual, expected, msg) {
    assertEq(JSON.stringify(actual), JSON.stringify(expected), msg || 'array mismatch');
  }

  function make(opts) {
    var b = E.create({ numFloors: 6, numLifts: (opts && opts.lifts ? opts.lifts.length : 4) });
    if (opts && opts.capacity) b.capacity = opts.capacity;
    if (opts && opts.doorTicks) b.doorTicks = opts.doorTicks;
    var floors = (opts && opts.lifts) || [1, 1, 1, 1];
    floors.forEach(function (f, i) { b.lifts[i].floor = f; });
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

  /* ---------- AC-D1: initial state ---------- */
  TestSuite.test('AC-D1: 4 lifts idle with stops/doors/capacity fields, no passengers', function () {
    var b = E.create({ numFloors: 6, numLifts: 4 });
    assertEq(b.lifts.length, 4, 'four lifts');
    b.lifts.forEach(function (lift, i) {
      assertEq(lift.floor, 1, 'lift ' + i + ' at 1');
      assertEq(lift.direction, E.DIR_IDLE, 'lift ' + i + ' idle');
      assertEqArr(lift.stops, [], 'lift ' + i + ' empty stops');
      assertEq(lift.doorsOpen, 0, 'lift ' + i + ' doors closed');
      assertEq(lift.maintenance, false, 'lift ' + i + ' in service');
    });
    assertEq(b.capacity, 4, 'default capacity');
    assertEq(b.doorTicks, 4, 'default door dwell');
    assertEq(Object.keys(b.passengers).length, 0, 'no passengers');
  });

  /* ---------- AC-D2: registration assigns a lift ---------- */
  TestSuite.test('AC-D2: register 1->4 (all lifts at 1) assigns A, stops [1,4], ETA 0', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p = addP(b, 1);
    var r = E.registerDestination(b, p, 4);
    assert(r.ok, 'register accepted: ' + r.error);
    assertEq(r.liftId, 0, 'lift A (id 0) assigned');
    assertEq(r.pickupEta, 0, 'pickup ETA 0 (A already at floor 1)');
    assertEqArr(r.stops, [1, 4], 'assigned stops');
    assertEqArr(b.lifts[0].stops, [1, 4], 'lift A stop list');
    assertEq(b.lifts[0].assigned.join(','), String(p), 'passenger waiting on A');
    assertEq(b.passengers[p].assignedLiftId, 0, 'passenger assignedLiftId');
    assertEq(b.passengers[p].destination, 4, 'passenger destination recorded');
  });

  /* ---------- AC-D3: same-direction grouping ---------- */
  TestSuite.test('AC-D3: 1->4 then 1->5 group onto ONE car; board together, unboard at 4 and 5', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p0 = addP(b, 1);
    var p1 = addP(b, 1);

    var r0 = E.registerDestination(b, p0, 4);
    var r1 = E.registerDestination(b, p1, 5);
    assert(r0.ok && r1.ok, 'both registrations accepted');
    assertEq(r1.liftId, 0, 'second passenger grouped onto lift A');
    assertEq(b.lifts[0].stops.join(','), '1,4,5', 'one car, ordered stops 1->4->5');

    // Doors open at floor 1: both board the assigned car.
    E.tick(b);
    assert(E.board(b, p0, 0).ok, 'p0 boards A');
    assert(E.board(b, p1, 0).ok, 'p1 boards A');

    var unboarded = [];
    tickUntil(b, 14, function (evts) {
      evts.forEach(function (ev) {
        if (ev.type === 'unboarded') unboarded.push(ev.passengerId + '@' + ev.floor);
      });
      return unboarded.length === 2;
    });
    assertEq(unboarded.join(','), p0 + '@4,' + p1 + '@5', 'each unboards at own destination');
    assertEq(b.passengers[p0].floor, 4, 'p0 at 4');
    assertEq(b.passengers[p1].floor, 5, 'p1 at 5');
    assertEq(b.passengers[p0].aboardLiftId, null, 'p0 exited');
    assertEq(b.passengers[p1].aboardLiftId, null, 'p1 exited');
  });

  /* ---------- AC-D4: opposite-direction traffic splits across cars ---------- */
  TestSuite.test('AC-D4: p0 1->6 on A; p1 2->1 goes to B (no zigzag on A)', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p0 = addP(b, 1);
    var r0 = E.registerDestination(b, p0, 6);
    assertEq(r0.liftId, 0, 'p0 assigned A');

    var p1 = addP(b, 2);
    var r1 = E.registerDestination(b, p1, 1);
    assert(r1.ok, 'p1 registered: ' + r1.error);
    assertEq(r1.liftId, 1, 'p1 assigned B, opposite direction kept off A');
  });

  /* ---------- AC-D5: only the assigned lift, only when doors open ---------- */
  TestSuite.test('AC-D5: cannot board a different lift; assigned lift needs open doors', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p = addP(b, 1);
    E.registerDestination(b, p, 4); // assigned A

    var wrong = E.board(b, p, 1);
    assert(!wrong.ok, 'boarding B rejected');
    assert(wrong.error.indexOf('assigned to lift A') !== -1, 'error names assigned lift');

    var closed = E.board(b, p, 0);
    assert(!closed.ok, 'boarding A before doors open rejected');
    assert(closed.error.indexOf('doors are not open') !== -1, 'error mentions doors');

    E.tick(b); // A arrives at floor 1, doors open
    var ok = E.board(b, p, 0);
    assert(ok.ok, 'boarding assigned A with doors open accepted');
    assertEq(ok.liftId, 0, 'boarded A');
    assertEq(b.passengers[p].aboardLiftId, 0, 'passenger aboard A');
    assertEq(b.lifts[0].passengers.join(','), String(p), 'A carries the passenger');
  });

  /* ---------- AC-D6: tour execution + unboarding ---------- */
  TestSuite.test('AC-D6: full ride 1->4: arrives, unboards, lift idles empty', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p = addP(b, 1);
    E.registerDestination(b, p, 4);
    E.tick(b); // doors open at 1
    E.board(b, p, 0);

    tickUntil(b, 12, function (evts) {
      return evts.some(function (e) { return e.type === 'unboarded' && e.passengerId === p; });
    });
    assertEq(b.passengers[p].floor, 4, 'passenger at floor 4');
    assertEq(b.passengers[p].aboardLiftId, null, 'passenger unboarded');
    assertEq(b.passengers[p].assignedLiftId, null, 'passenger free again');
    assertEq(b.passengers[p].destination, null, 'destination cleared');

    tickUntil(b, 6, function () { return b.lifts[0].stops.length === 0 && b.lifts[0].doorsOpen === 0; });
    assertEq(b.lifts[0].floor, 4, 'A rests at 4');
    assertEq(b.lifts[0].direction, E.DIR_IDLE, 'A idle');
    assertEqArr(b.lifts[0].stops, [], 'A stops empty');
    assert(b.lifts[0].passengers.length === 0, 'A empty');
  });

  /* ---------- AC-D7: no-show ---------- */
  TestSuite.test('AC-D7: doors close without boarding -> no_show, passenger can re-register', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p = addP(b, 1);
    E.registerDestination(b, p, 4);

    tickUntil(b, 6, function (evts) {
      return evts.some(function (e) { return e.type === 'no_show' && e.passengerId === p; });
    });
    assertEq(b.passengers[p].assignedLiftId, null, 'assignment cancelled');
    assertEq(b.passengers[p].destination, null, 'no destination left');
    assertEq(b.passengers[p].noShows, 1, 'no-show counted');
    assertEq(b.lifts[0].assigned.length, 0, 'seat freed on A');

    var again = E.registerDestination(b, p, 3);
    assert(again.ok, 'passenger can re-register: ' + again.error);
  });

  /* ---------- AC-D8: capacity ---------- */
  TestSuite.test('AC-D8: lift at capacity is never assigned more; next passenger goes to B', function () {
    var b = make({ lifts: [1, 1, 1, 1], capacity: 4 });
    for (var i = 0; i < 4; i += 1) {
      var r = E.registerDestination(b, addP(b, 1), 2);
      assert(r.ok, 'register ' + i);
      assertEq(r.liftId, 0, 'all grouped onto A');
    }
    assertEq(b.lifts[0].assigned.length, 4, 'A at capacity (4 waiting)');

    var p5 = addP(b, 1);
    var r5 = E.registerDestination(b, p5, 2);
    assert(r5.ok, '5th register accepted: ' + r5.error);
    assertEq(r5.liftId, 1, 'overflow passenger assigned to B');
  });

  /* ---------- AC-D9: maintenance ---------- */
  TestSuite.test('AC-D9: maintenance lift excluded from assignment and boarding', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    assert(E.setMaintenance(b, 0, true).ok, 'A into maintenance');

    var p = addP(b, 1);
    var r = E.registerDestination(b, p, 4);
    assert(r.ok, 'register with 3 lifts available');
    assertEq(r.liftId, 1, 'maintenance A skipped, B assigned');

    var p2 = addP(b, 1);
    var r2 = E.registerDestination(b, p2, 3);
    assertEq(r2.liftId, 1, 'B still assigned');

    var mb = E.board(b, p2, 0);
    assert(!mb.ok, 'cannot board maintenance A');
    assert(mb.error.indexOf('maintenance') !== -1, 'error mentions maintenance');

    var fresh = make({ lifts: [1, 1, 1, 1] });
    [0, 1, 2, 3].forEach(function (id) {
      assert(E.setMaintenance(fresh, id, true).ok, 'maintain lift ' + id);
    });
    var freshDown = E.registerDestination(fresh, addP(fresh, 1), 5);
    assert(!freshDown.ok, 'fresh all-maintenance building also fails');
  });

  /* ---------- AC-D9b: failover - other lifts keep serving ---------- */
  TestSuite.test('AC-D9b: lifts keep serving while one is under maintenance (full journeys)', function () {
    var b = make({ lifts: [1, 2, 5, 6] });
    assert(E.setMaintenance(b, 0, true).ok, 'A into maintenance');

    var p0 = addP(b, 3);
    var r0 = E.registerDestination(b, p0, 6);
    assert(r0.ok, 'p0 assigned with A down: ' + r0.error);
    assert(r0.liftId !== 0, 'maintenance A never assigned');

    var p1 = addP(b, 3);
    var r1 = E.registerDestination(b, p1, 2);
    assert(r1.ok, 'p1 assigned with A down: ' + r1.error);
    assert(r1.liftId !== 0, 'maintenance A never assigned');

    // Advance the sim (auto-board on arrival) until both journeys complete.
    var aboard = 0;
    for (var t = 0; t < 40; t += 1) {
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'arrived') {
          var lift = b.lifts[ev.liftId];
          lift.assigned.slice().forEach(function (pid) {
            var pass = b.passengers[pid];
            if (pass && pass.floor === ev.floor && E.board(b, pid, ev.liftId).ok) {
              aboard += 1;
            }
          });
        }
      });
    }

    assertEq(b.passengers[p0].floor, 6, 'p0 reached 6 while A serviced');
    assertEq(b.passengers[p0].aboardLiftId, null, 'p0 exited');
    assertEq(b.passengers[p1].floor, 2, 'p1 reached 2 while A serviced');
    assertEq(b.passengers[p1].aboardLiftId, null, 'p1 exited');
    assertEq(b.lifts[0].maintenance, true, 'A still under maintenance');
    assertEqArr(b.lifts[0].stops, [], 'maintenance A stays parked and empty');
  });

  /* ---------- AC-D9c: maintenance guard on waiting (assigned) passengers ---------- */
  TestSuite.test('AC-D9c: a lift with passengers waiting to board cannot be serviced', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p = addP(b, 1);
    E.registerDestination(b, p, 4); // assigned to A, pickup stop 1 pending

    var mm = E.setMaintenance(b, 0, true);
    assert(!mm.ok, 'A cannot go to maintenance while pickup pending');
    assert(mm.error.indexOf('stops planned') !== -1, 'error explains why');

    // Let the pickup stop be served: doors open, passenger boards.
    E.tick(b);
    assert(E.board(b, p, 0).ok, 'p boards A');
    E.tick(b); // doors still open (dwell), drop stop 4 remains

    var md = E.setMaintenance(b, 0, true);
    assert(!md.ok, 'A cannot go to maintenance while its tour is pending');
    assert(md.error.indexOf('stops planned') !== -1 || md.error.indexOf('passengers') !== -1,
      'error explains why');
  });

  /* ---------- AC-D10: validation ---------- */
  TestSuite.test('AC-D10: invalid registrations and boards are rejected', function () {
    var b = make({ lifts: [1, 1, 1, 1] });
    var p = addP(b, 1);

    var sameFloor = E.registerDestination(b, p, 1);
    assert(!sameFloor.ok, 'same-floor destination rejected');
    assert(sameFloor.error.indexOf('Already at floor') !== -1, 'error message');

    var unknownFloor = E.registerDestination(b, p, 7);
    assert(!unknownFloor.ok, 'floor 7 rejected');
    assert(!E.registerDestination(b, p, 0).ok, 'floor 0 rejected');
    assert(!E.registerDestination(b, p, 2.5).ok, 'floor 2.5 rejected');

    assert(!E.registerDestination(b, 999, 3).ok, 'unknown passenger rejected');

    var p2 = addP(b, 1);
    assert(E.registerDestination(b, p2, 4).ok, 'p2 assigned to A');
    var againR = E.registerDestination(b, p2, 5);
    assert(!againR.ok, 're-register while assigned rejected');
    assert(againR.error.indexOf('Already assigned') !== -1, 'error message');

    var notAssigned = addP(b, 2);
    var nb = E.board(b, notAssigned, 0);
    assert(!nb.ok, 'board without assignment rejected');
    assert(nb.error.indexOf('not assigned') !== -1, 'error message');
  });

  TestSuite.test('AC-D10b: complete journey leaves engine consistent (grouped multi-stop run)', function () {
    var b = make({ lifts: [1, 2, 5, 6] }); // Phase 1 park layout
    var p1 = addP(b, 3);
    var p2 = addP(b, 3);
    var p3 = addP(b, 5);

    var r1 = E.registerDestination(b, p1, 6);
    var r2 = E.registerDestination(b, p2, 1);
    var r3 = E.registerDestination(b, p3, 1);

    assert(r1.ok, 'p1 registered: ' + r1.error);
    assert(r2.ok, 'p2 registered: ' + r2.error);
    assert(r3.ok, 'p3 registered: ' + r3.error);

    // p1 (up 3->6) and p2 (down 3->1) must NOT share a car: opposite directions.
    assert(r1.liftId !== r2.liftId, 'opposite trips split across cars');

    // Give every passenger time to ride their full journey (board on arrival).
    var moved = 0;
    for (var t = 0; t < 40; t += 1) {
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'arrived') {
          // Open doors at a pickup/drop stop - board assigned passengers present.
          b.lifts[ev.liftId].assigned.slice().forEach(function (pid) {
            var pass = b.passengers[pid];
            if (pass.floor === ev.floor) E.board(b, pid, ev.liftId);
          });
        }
        if (ev.type === 'moved') moved += 1;
      });
    }
    assertEq(b.passengers[p1].floor, 6, 'p1 rode to 6');
    assertEq(b.passengers[p2].floor, 1, 'p2 rode to 1');
    assertEq(b.passengers[p3].floor, 1, 'p3 rode to 1');
    b.lifts.forEach(function (lift, i) {
      assertEq(lift.stops.length, 0, 'lift ' + i + ' stops drained');
      assertEq(lift.passengers.length, 0, 'lift ' + i + ' empty');
    });
  });

  TestSuite.test('AC-D11: 3 passengers on floor 5 (->1) all board and ride to floor 1', function () {
    var b = make({ lifts: [1, 2, 5, 6] }); // Lift C (id 2) parks at floor 5
    var p0 = addP(b, 5);
    var p1 = addP(b, 5);
    var p2 = addP(b, 5);

    var r0 = E.registerDestination(b, p0, 1);
    var r1 = E.registerDestination(b, p1, 1);
    var r2 = E.registerDestination(b, p2, 1);
    assert(r0.ok, 'p0 registered: ' + r0.error);
    assert(r1.ok, 'p1 registered: ' + r1.error);
    assert(r2.ok, 'p2 registered: ' + r2.error);
    assertEq(r0.liftId, 2, 'p0 assigned lift C');
    assertEq(r1.liftId, 2, 'p1 grouped onto C');
    assertEq(r2.liftId, 2, 'p2 grouped onto C');

    E.tick(b); // C is already at 5: doors open
    assert(b.lifts[2].doorsOpen > 0, 'C doors open at floor 5');
    [p0, p1, p2].forEach(function (pid) {
      var ok = E.board(b, pid, 2);
      assert(ok.ok, 'passenger ' + pid + ' boards before doors close: ' + ok.error);
    });

    var unboarded = [];
    tickUntil(b, 16, function (evts) {
      evts.forEach(function (ev) {
        if (ev.type === 'unboarded') unboarded.push(ev.passengerId + '@' + ev.floor);
      });
      return unboarded.length === 3;
    });
    assertEq(unboarded.join(','), p0 + '@1,' + p1 + '@1,' + p2 + '@1', 'all three reach floor 1');
    assertEq(b.passengers[p0].floor, 1, 'p0 at 1');
    assertEq(b.passengers[p1].floor, 1, 'p1 at 1');
    assertEq(b.passengers[p2].floor, 1, 'p2 at 1');
    [p0, p1, p2].forEach(function (pid) {
      assertEq(b.passengers[pid].aboardLiftId, null, 'p' + pid + ' exited');
      assertEq(b.passengers[pid].assignedLiftId, null, 'p' + pid + ' free');
    });
  });

  TestSuite.test('AC-D11: random traffic never makes a lift leave floors 1..6', function () {
    var b = make({ lifts: [1, 2, 5, 6], capacity: 6 });
    var pids = [];
    function randFloor(excl) {
      var f;
      do { f = 1 + Math.floor(Math.random() * 6); } while (f === excl);
      return f;
    }

    for (var t = 0; t < 250; t += 1) {
      // Occasionally register a new random passenger.
      if (Math.random() < 0.3) {
        var pid = addP(b, randFloor(-1));
        pids.push(pid);
        var r = E.registerDestination(b, pid, randFloor(b.passengers[pid].floor));
        if (r.ok) {
          var aLift = b.lifts[r.liftId];
          assert(aLift.floor >= 1 && aLift.floor <= 6, 'assigned lift in bounds');
        }
      }
      // Auto-board on arrival so seats free up; otherwise ignore.
      E.tick(b).forEach(function (ev) {
        if (ev.type === 'arrived') {
          var lift = b.lifts[ev.liftId];
          if (!lift) return;
          lift.assigned.slice().forEach(function (pid) {
            var pass = b.passengers[pid];
            if (pass && pass.floor === ev.floor) E.board(b, pid, ev.liftId);
          });
        }
      });

      // Invariant: floors and all planned stops stay in [1, numFloors].
      b.lifts.forEach(function (lift, i) {
        assert(lift.floor >= 1 && lift.floor <= 6,
          'lift ' + i + ' left the building: floor=' + lift.floor);
        lift.stops.forEach(function (s) {
          assert(s >= 1 && s <= 6, 'lift ' + i + ' has out-of-range stop ' + s);
        });
      });
    }
  });

  var target = typeof window !== 'undefined' ? window : globalThis;
  target.TestSuite = TestSuite;
  target.E = SmartLift.DCS;
  // Re-export engine aliases as E for tests that reference them after load.
  target.SmartLift = target.SmartLift || {};
  target.SmartLift.create = SmartLift.DCS;
})();