/* Smart Lift - Phase 2 engine (pure logic, no DOM I/O).
 *
 * Multi-passenger model. Implements the Phase-2 requirements on top of
 * Phase-1 lift mechanics (Spec/phase1-simulation.md):
 *   - Building of N floors, M lifts, each in its own shaft.
 *   - Any number of PASSENGERS; each has a current floor, an optional
 *     boarded lift, and an optional destination.
 *   - Two-step boarding: 1) board any idle lift present at your floor,
 *     2) after boarding, select a destination.
 *   - All lifts can be occupied at the same time; any idle lift at a
 *     passenger's floor can be boarded (not just the dispatched one).
 *   - Dispatch: prefer idle lift, then closest; busy lifts judged by time
 *     to finish queued work + travel to the request.
 *   - A tick advances every moving lift exactly one floor; passengers are
 *     unboarded only when the lift arrives at their destination floor.
 *
 * State shape (as produced by create()):
 *   building = {
 *     numFloors: number,
 *     lifts: [ { id, floor, direction, queue, busy, passengers: [id] } ],
 *     passengers: { id: { id, floor, boardedLiftId, destination } },
 *     nextPassengerId: number
 *   }
 */
(function (global) {
  'use strict';

  var DIR_IDLE = 'IDLE';
  var DIR_UP = 'UP';
  var DIR_DOWN = 'DOWN';

  function create(config) {
    config = config || {};
    var numFloors = config.numFloors || 6;
    var numLifts = config.numLifts || 2;

    var lifts = [];
    for (var i = 0; i < numLifts; i += 1) {
      lifts.push({
        id: i,
        floor: 1,
        direction: DIR_IDLE,
        queue: [],
        busy: false,
        passengers: [],
        maintenance: false
      });
    }

    return {
      numFloors: numFloors,
      lifts: lifts,
      passengers: {},
      nextPassengerId: 0
    };
  }

  function isValidFloor(building, floor) {
    return typeof floor === 'number' &&
      floor >= 1 &&
      floor <= building.numFloors &&
      Math.floor(floor) === floor;
  }

  function getPassenger(building, passengerId) {
    return building.passengers[passengerId] || null;
  }

  /* Add a new passenger standing on `floor`, not boarded. */
  function addPassenger(building, floor) {
    if (!isValidFloor(building, floor)) {
      return { ok: false, error: 'Invalid floor: ' + floor };
    }
    var id = building.nextPassengerId;
    building.nextPassengerId += 1;
    building.passengers[id] = {
      id: id,
      floor: floor,
      boardedLiftId: null,
      destination: null
    };
    return { ok: true, passengerId: id };
  }

  /* Estimated ticks for a lift to finish all queued work and then arrive at
   * `floor`, travelling one floor per tick. Used only to compare busy lifts. */
  function busyScore(lift, floor) {
    var t = 0;
    var current = lift.floor;
    var targets = lift.queue.slice();
    targets.push(floor);
    for (var i = 0; i < targets.length; i += 1) {
      t += Math.abs(current - targets[i]);
      current = targets[i];
    }
    return t;
  }

  /* Mark a lift as under maintenance (excluded from dispatch + boarding).
   * A lift that is busy - moving, queued, or carrying passengers - cannot
   * be taken out of service. */
  function setMaintenance(building, liftId, flag) {
    var lift = building.lifts[liftId];
    if (!lift) {
      return { ok: false, error: 'Invalid lift: ' + liftId };
    }
    flag = !!flag;
    if (flag) {
      if (lift.direction !== DIR_IDLE) {
        return { ok: false, error: 'Cannot maintain a moving lift' };
      }
      if (lift.queue.length > 0) {
        return { ok: false, error: 'Cannot maintain a lift with queued requests' };
      }
      if (lift.passengers.length > 0) {
        return { ok: false, error: 'Cannot maintain a lift with passengers aboard' };
      }
    }
    lift.maintenance = flag;
    return { ok: true, liftId: liftId, maintenance: flag };
  }

  /* Pick the most suitable lift per FR-4 and append the request to its queue.
   * Lifts under maintenance are never candidates. */
  function dispatch(building, floor) {
    var available = building.lifts.filter(function (lift) {
      return lift.maintenance !== true;
    });
    if (available.length === 0) return null;

    var candidates = available.map(function (lift) {
      if (lift.queue.length === 0) {
        return { lift: lift, idle: true, score: Math.abs(lift.floor - floor) };
      }
      return { lift: lift, idle: false, score: busyScore(lift, floor) };
    });

    candidates.sort(function (a, b) {
      if (a.idle !== b.idle) return a.idle ? -1 : 1;
      if (a.score !== b.score) return a.score - b.score;
      return a.lift.id - b.lift.id;
    });
    var best = candidates[0].lift;
    best.queue.push(floor);
    return best;
  }

  /* FR-1: A passenger calls a lift to their current floor (or to `floor`
   * when given, moving the passenger there first). Returns the dispatched lift. */
  function call(building, passengerId, floor) {
    var pass = getPassenger(building, passengerId);
    if (!pass) {
      return { ok: false, error: 'Unknown passenger: ' + passengerId };
    }
    if (pass.boardedLiftId !== null) {
      return { ok: false, error: 'Already boarded in a lift' };
    }
    if (floor === undefined) floor = pass.floor;
    if (!isValidFloor(building, floor)) {
      return { ok: false, error: 'Invalid floor: ' + floor };
    }
    pass.floor = floor;
    var lift = dispatch(building, floor);
    if (!lift) {
      return { ok: false, error: 'No lift available (all lifts under maintenance)' };
    }
    return { ok: true, liftId: lift.id, floor: floor };
  }

  /* FR-2 (step 1): board an idle lift present at the passenger's floor.
   * Any lift qualifies - it does not need to be the one dispatched to them. */
  function board(building, passengerId, liftId) {
    var pass = getPassenger(building, passengerId);
    if (!pass) {
      return { ok: false, error: 'Unknown passenger: ' + passengerId };
    }
    if (pass.boardedLiftId !== null) {
      return { ok: false, error: 'Already boarded in a lift' };
    }
    var lift = building.lifts[liftId];
    if (!lift) {
      return { ok: false, error: 'Invalid lift: ' + liftId };
    }
    if (lift.maintenance) {
      return { ok: false, error: 'Lift is under maintenance' };
    }
    if (lift.floor !== pass.floor) {
      return { ok: false, error: 'Lift not at your floor' };
    }
    if (lift.direction !== DIR_IDLE) {
      return { ok: false, error: 'Lift is not idle' };
    }
    pass.boardedLiftId = liftId;
    lift.passengers.push(passengerId);
    return { ok: true, liftId: liftId };
  }

  /* FR-3 (step 2): a boarded passenger selects their destination. */
  function selectDestination(building, passengerId, floor) {
    var pass = getPassenger(building, passengerId);
    if (!pass) {
      return { ok: false, error: 'Unknown passenger: ' + passengerId };
    }
    if (pass.boardedLiftId === null) {
      return { ok: false, error: 'Not boarded in a lift' };
    }
    if (!isValidFloor(building, floor)) {
      return { ok: false, error: 'Invalid floor: ' + floor };
    }
    var lift = building.lifts[pass.boardedLiftId];
    if (floor === lift.floor) {
      return { ok: false, error: 'Already at floor ' + floor };
    }
    pass.destination = floor;
    lift.queue.push(floor);
    return { ok: true, liftId: lift.id, floor: floor };
  }

  /* Backward-compatible: dispatch a lift to a floor without a passenger. */
  function request(building, floor) {
    if (!isValidFloor(building, floor)) {
      return { ok: false, error: 'Invalid floor: ' + floor };
    }
    var lift = dispatch(building, floor);
    if (!lift) {
      return { ok: false, error: 'No lift available (all lifts under maintenance)' };
    }
    return { ok: true, liftId: lift.id, floor: floor };
  }

  /* Unboard every passenger on `lift` whose destination equals `floor`. */
  function unboardAt(building, lift, floor) {
    var events = [];
    var remaining = [];
    for (var i = 0; i < lift.passengers.length; i += 1) {
      var pid = lift.passengers[i];
      var pass = getPassenger(building, pid);
      if (pass && pass.destination === floor) {
        pass.boardedLiftId = null;
        pass.destination = null;
        pass.floor = floor;
        events.push({
          type: 'unboarded', liftId: lift.id, passengerId: pid, floor: floor
        });
      } else {
        remaining.push(pid);
      }
    }
    lift.passengers = remaining;
    return events;
  }

  /* Advance the whole building by one tick. Returns a list of events. */
  function tick(building) {
    var events = [];
    var lifts = building.lifts;

    for (var i = 0; i < lifts.length; i += 1) {
      var lift = lifts[i];

      // Start next queued request if we are idle and something is waiting.
      if (lift.direction === DIR_IDLE && lift.queue.length > 0) {
        var target = lift.queue[0];
        if (target === lift.floor) {
          lift.queue.shift();
          events.push({ type: 'served', liftId: lift.id, floor: target });
          events = events.concat(unboardAt(building, lift, target));
        } else {
          lift.direction = target > lift.floor ? DIR_UP : DIR_DOWN;
          lift.busy = true;
          events.push({
            type: 'started',
            liftId: lift.id,
            from: lift.floor,
            to: target,
            direction: lift.direction
          });
        }
      }

      // Move one floor (1 tick per floor).
      if (lift.direction === DIR_UP) {
        var fromUp = lift.floor;
        lift.floor += 1;
        events.push({
          type: 'moved', liftId: lift.id, from: fromUp, to: lift.floor, direction: DIR_UP
        });
        if (lift.floor === lift.queue[0]) {
          lift.queue.shift();
          lift.direction = DIR_IDLE;
          lift.busy = false;
          events.push({ type: 'arrived', liftId: lift.id, floor: lift.floor });
          events = events.concat(unboardAt(building, lift, lift.floor));
        }
      } else if (lift.direction === DIR_DOWN) {
        var fromDown = lift.floor;
        lift.floor -= 1;
        events.push({
          type: 'moved', liftId: lift.id, from: fromDown, to: lift.floor, direction: DIR_DOWN
        });
        if (lift.floor === lift.queue[0]) {
          lift.queue.shift();
          lift.direction = DIR_IDLE;
          lift.busy = false;
          events.push({ type: 'arrived', liftId: lift.id, floor: lift.floor });
          events = events.concat(unboardAt(building, lift, lift.floor));
        }
      }
    }

    return events;
  }

  var Engine = {
    DIR_IDLE: DIR_IDLE,
    DIR_UP: DIR_UP,
    DIR_DOWN: DIR_DOWN,
    create: create,
    isValidFloor: isValidFloor,
    addPassenger: addPassenger,
    setMaintenance: setMaintenance,
    call: call,
    board: board,
    selectDestination: selectDestination,
    request: request,
    tick: tick
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.Engine = Engine;
}(typeof window !== 'undefined' ? window : globalThis));