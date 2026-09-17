/* Smart Lift - Phase 2 DCS engine (pure logic, no DOM I/O).
 *
 * Destination Control System on top of the Phase 1 building/lift model:
 *   - 6 floors, 4 lifts, one floor per tick, directions UP/DOWN/IDLE.
 *   - Passengers register their DESTINATION at a kiosk BEFORE boarding.
 *   - A group controller assigns a specific lift ("Take Lift C") and
 *     batches compatible trips (same direction, close destinations) so
 *     one car serves several passengers with few stops.
 *   - Each lift carries an ordered stops list (pickups + drop-offs), opens
 *     its doors for DOOR_TICKS on every stop, and is capacity-limited.
 *   - Only the assigned lift can be boarded, and only while doors are open.
 *   - No-shows are unassigned when the doors close (may re-register).
 *
 * State shape (from create()):
 *   building = {
 *     numFloors, doorTicks, capacity,
 *     lifts: [ { id, floor, direction, stops:[], assigned:[pid], passengers:[pid],
 *                doorsOpen, maintenance } ],
 *     passengers: { id: { id, floor, destination, assignedLiftId, aboardLiftId, noShows } },
 *     nextPassengerId
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
    var numLifts = config.numLifts || 4;
    var capacity = config.capacity || 4;
    var doorTicks = config.doorTicks || 4;

    var lifts = [];
    for (var i = 0; i < numLifts; i += 1) {
      lifts.push({
        id: i,
        floor: 1,
        direction: DIR_IDLE,
        stops: [],
        assigned: [],   // waiting to board
        passengers: [], // aboard
        doorsOpen: 0,
        maintenance: false
      });
    }

    return {
      numFloors: numFloors,
      capacity: capacity,
      doorTicks: doorTicks,
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

  /* Time in ticks to execute `stops` starting from current `floor` (a lift),
   * counting drops... but not door dwell (kept simple; relative costs). */
  function tourTime(currentFloor, stops) {
    var t = 0;
    var prev = currentFloor;
    for (var i = 0; i < stops.length; i += 1) {
      t += Math.abs(prev - stops[i]);
      prev = stops[i];
    }
    return t;
  }

  /* Number of direction changes while executing `stops` from `currentFloor`.
   * Taking off counts as 0 changes; every reversal after that adds 1. */
  function planChanges(currentFloor, stops) {
    var changes = 0;
    var dir = 0;
    var prev = currentFloor;
    for (var i = 0; i < stops.length; i += 1) {
      var d = stops[i] > prev ? 1 : stops[i] < prev ? -1 : 0;
      if (d !== 0) {
        if (dir !== 0 && d !== dir) changes += 1;
        dir = d;
      }
      prev = stops[i];
    }
    return changes;
  }

  /* Collapse consecutive duplicates, e.g. [1,1,4,5] -> [1,4,5]: several
   * passengers picked up at the same floor need only one stop. */
  function collapse(stops) {
    var out = [];
    for (var i = 0; i < stops.length; i += 1) {
      if (out.length === 0 || out[out.length - 1] !== stops[i]) out.push(stops[i]);
    }
    return out;
  }

  /* Ticks for `liftFloor` to reach `passengerFloor` along `plan`. */
  function pickupEta(liftFloor, plan, passengerFloor) {
    var t = 0;
    var prev = liftFloor;
    for (var i = 0; i < plan.length; i += 1) {
      t += Math.abs(prev - plan[i]);
      if (plan[i] === passengerFloor) break;
      prev = plan[i];
    }
    return t;
  }

/* Grouping allocator (FR-D2). Returns best lift + the chosen stop list +
   * pickup ETA or null. Candidates are ranked by:
   *   1. extra direction reversals (a lift shouldn't zigzag across town),
   *   2. pickup ETA (a closer lift takes the passenger sooner),
   *   3. added travel time (ticks),
   *   4. fewer extra stops, fewer total stops, then lowest id.
   * Mid-run: new stops may only be inserted AFTER the lift's committed target
   * (its first stop), so the car never needs to reverse mid-leg. */
  function allocate(building, passengerFloor, destFloor) {
    var best = null;
    building.lifts.forEach(function (lift) {
      if (lift.maintenance) return;
      var load = lift.passengers.length + lift.assigned.length;
      if (load >= building.capacity) return;

      var oldChanges = planChanges(lift.floor, lift.stops);
      var oldTime = tourTime(lift.floor, lift.stops);
      var oldStops = lift.stops.length;

      var startPos = lift.direction === DIR_IDLE ? 0 : 1;
      for (var i = startPos; i <= lift.stops.length; i += 1) {
        for (var j = i; j <= lift.stops.length + 1; j += 1) {
          var s = lift.stops.slice();
          s.splice(j, 0, destFloor);
          s.splice(i, 0, passengerFloor);
          var plan = collapse(s);
          var extraReversals = planChanges(lift.floor, plan) - oldChanges;
          var added = tourTime(lift.floor, plan) - oldTime;
          var addedStops = plan.length - oldStops;
          var eta = pickupEta(lift.floor, plan, passengerFloor);
          var better =
            best === null ||
            extraReversals < best.extraReversals ||
            (extraReversals === best.extraReversals && eta < best.eta) ||
            (extraReversals === best.extraReversals && eta === best.eta && added < best.addedCost) ||
            (extraReversals === best.extraReversals && eta === best.eta && added === best.addedCost &&
             (addedStops < best.addedStops ||
              (addedStops === best.addedStops &&
               (plan.length < best.stops.length ||
                (plan.length === best.stops.length && lift.id < best.lift.id)))));

          if (better) {
            best = {
              lift: lift,
              stopsPlan: plan,
              addedCost: added,
              addedStops: addedStops,
              extraReversals: extraReversals,
              eta: eta,
              stops: plan
            };
          }
        }
      }
    });
    if (!best) return null;
    return best;
  }

  /* Add a new passenger standing on `floor`, not boarded, unassigned. */
  function addPassenger(building, floor) {
    if (!isValidFloor(building, floor)) {
      return { ok: false, error: 'Invalid floor: ' + floor };
    }
    var id = building.nextPassengerId;
    building.nextPassengerId += 1;
    building.passengers[id] = {
      id: id,
      floor: floor,
      destination: null,
      assignedLiftId: null,
      aboardLiftId: null,
      noShows: 0
    };
    return { ok: true, passengerId: id };
  }

  /* Mark a lift under maintenance (excluded from assignment + boarding).
   * A lift that is moving, queued (stops), carrying passengers aboard, or with
   * passengers still waiting to board (assigned) cannot be taken out of
   * service - doing so would strand them. */
  function setMaintenance(building, liftId, flag) {
    var lift = building.lifts[liftId];
    if (!lift) return { ok: false, error: 'Invalid lift: ' + liftId };
    flag = !!flag;
    if (flag) {
      if (lift.direction !== DIR_IDLE) return { ok: false, error: 'Cannot maintain a moving lift' };
      if (lift.stops.length > 0) return { ok: false, error: 'Cannot maintain a lift with stops planned' };
      if (lift.passengers.length > 0) return { ok: false, error: 'Cannot maintain a lift with passengers aboard' };
      if (lift.assigned.length > 0) return { ok: false, error: 'Cannot maintain a lift with passengers waiting to board' };
    }
    lift.maintenance = flag;
    return { ok: true, liftId: liftId, maintenance: flag };
  }

  /* FR-D1/F R-D2: passenger registers a destination at the kiosk. */
  function registerDestination(building, passengerId, destFloor) {
    var pass = getPassenger(building, passengerId);
    if (!pass) return { ok: false, error: 'Unknown passenger: ' + passengerId };
    if (pass.aboardLiftId !== null) return { ok: false, error: 'Already aboard a lift' };
    if (pass.assignedLiftId !== null) {
      return { ok: false, error: 'Already assigned to lift ' + liftName(pass.assignedLiftId) + ' - wait or no-show first' };
    }
    if (!isValidFloor(building, destFloor)) return { ok: false, error: 'Invalid floor: ' + destFloor };
    if (destFloor === pass.floor) return { ok: false, error: 'Already at floor ' + destFloor };

    var best = allocate(building, pass.floor, destFloor);
    if (!best) {
      var anyOperating = building.lifts.some(function (l) { return !l.maintenance; });
      return {
        ok: false,
        error: anyOperating
          ? 'No lift available (all operating lifts at capacity)'
          : 'No lift available (all lifts under maintenance)'
      };
    }

    var lift = best.lift;
    lift.stops = best.stopsPlan;
    lift.assigned.push(passengerId);
    var eta = best.eta;

    pass.destination = destFloor;
    pass.assignedLiftId = lift.id;

    var ev = {
      type: 'assigned',
      passengerId: passengerId,
      liftId: lift.id,
      pickupFloor: pass.floor,
      destFloor: destFloor,
      eta: eta,
      stops: lift.stops.slice()
    };

    return { ok: true, liftId: lift.id, pickupEta: eta, stops: lift.stops.slice(), event: ev };
  }

  function liftName(id) {
    return ['A', 'B', 'C', 'D'][id] || 'Lift ' + id;
  }

  /* FR-D4: board the ASSIGNED lift while doors are open at your floor. */
  function board(building, passengerId, liftId) {
    var pass = getPassenger(building, passengerId);
    if (!pass) return { ok: false, error: 'Unknown passenger: ' + passengerId };
    if (pass.aboardLiftId !== null) return { ok: false, error: 'Already aboard a lift' };
    var lift = building.lifts[liftId];
    if (!lift) return { ok: false, error: 'Invalid lift: ' + liftId };
    if (lift.maintenance) return { ok: false, error: 'Lift is under maintenance' };
    if (pass.assignedLiftId !== liftId) {
      return {
        ok: false,
        error: pass.assignedLiftId === null
          ? 'You are not assigned to lift ' + liftName(liftId)
          : 'You are assigned to lift ' + liftName(pass.assignedLiftId) + ', not ' + liftName(liftId)
      };
    }
    if (lift.floor !== pass.floor) return { ok: false, error: 'Lift ' + liftName(liftId) + ' is not at your floor yet' };
    if (lift.doorsOpen <= 0) return { ok: false, error: 'Lift ' + liftName(liftId) + ' doors are not open' };

    pass.aboardLiftId = liftId;
    pass.assignedLiftId = null;
    lift.passengers.push(passengerId);
    var idx = lift.assigned.indexOf(passengerId);
    if (idx !== -1) lift.assigned.splice(idx, 1);
    return {
      ok: true,
      liftId: liftId,
      event: { type: 'boarded', passengerId: passengerId, liftId: liftId, floor: lift.floor }
    };
  }

  /* Unboard passengers on `lift` whose destination equals `floor`. */
  function unboardAt(building, lift, floor) {
    var events = [];
    var remaining = [];
    lift.passengers.forEach(function (pid) {
      var pass = getPassenger(building, pid);
      if (pass && pass.destination === floor) {
        pass.aboardLiftId = null;
        pass.destination = null;
        pass.floor = floor;
        events.push({ type: 'unboarded', passengerId: pid, liftId: lift.id, floor: floor });
      } else {
        remaining.push(pid);
      }
    });
    lift.passengers = remaining;
    return events;
  }

  /* Close doors: unassign anyone still waiting at this floor (no-show). */
  function noShowAt(building, lift, floor) {
    var events = [];
    var remaining = [];
    lift.assigned.forEach(function (pid) {
      var pass = getPassenger(building, pid);
      if (pass && pass.floor === floor) {
        pass.assignedLiftId = null;
        pass.destination = null;
        pass.noShows += 1;
        events.push({ type: 'no_show', passengerId: pid, liftId: lift.id, floor: floor });
      } else {
        remaining.push(pid);
      }
    });
    lift.assigned = remaining;
    return events;
  }

  /* Advance the whole building by one tick. Returns events. */
  function tick(building) {
    var events = [];

    building.lifts.forEach(function (lift) {
      if (lift.maintenance) return;

      // 1) Doors are open: unboard arrivals, tick the window, then close.
      if (lift.doorsOpen > 0) {
        events = events.concat(unboardAt(building, lift, lift.floor));
        lift.doorsOpen -= 1;
        if (lift.doorsOpen === 0) {
          events = events.concat(noShowAt(building, lift, lift.floor));
          events.push({ type: 'doorsClosed', liftId: lift.id, floor: lift.floor });
        }
        return; // doors dwell consumes the whole tick
      }

      // 2) Idle with work waiting: start (or serve instantly if stop is here).
      if (lift.direction === DIR_IDLE && lift.stops.length > 0) {
        if (lift.stops[0] === lift.floor) {
          lift.stops.shift();
          lift.doorsOpen = building.doorTicks;
          events.push({ type: 'arrived', liftId: lift.id, floor: lift.floor });
          events = events.concat(unboardAt(building, lift, lift.floor));
        } else {
          lift.direction = lift.stops[0] > lift.floor ? DIR_UP : DIR_DOWN;
          events.push({
            type: 'started',
            liftId: lift.id,
            from: lift.floor,
            to: lift.stops[0],
            direction: lift.direction
          });
        }
      }

      // 3) Movement: one floor per tick while assigned a target.
      // The dir check guards against an impossible plan (e.g. driving UP
      // toward a stop that sits below): the lift must never leave 1..N.
      var next = lift.stops[0];
      if (lift.direction === DIR_UP && next !== undefined && next > lift.floor) {
        lift.floor += 1;
        events.push({ type: 'moved', liftId: lift.id, from: lift.floor - 1, to: lift.floor, direction: DIR_UP });
        if (lift.floor === next) {
          lift.stops.shift();
          lift.direction = DIR_IDLE;
          lift.doorsOpen = building.doorTicks;
          events.push({ type: 'arrived', liftId: lift.id, floor: lift.floor });
          events = events.concat(unboardAt(building, lift, lift.floor));
        }
      } else if (lift.direction === DIR_DOWN && next !== undefined && next < lift.floor) {
        lift.floor -= 1;
        events.push({ type: 'moved', liftId: lift.id, from: lift.floor + 1, to: lift.floor, direction: DIR_DOWN });
        if (lift.floor === next) {
          lift.stops.shift();
          lift.direction = DIR_IDLE;
          lift.doorsOpen = building.doorTicks;
          events.push({ type: 'arrived', liftId: lift.id, floor: lift.floor });
          events = events.concat(unboardAt(building, lift, lift.floor));
        }
      }
    });

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
    registerDestination: registerDestination,
    board: board,
    tick: tick
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.DCS = Engine;
}(typeof window !== 'undefined' ? window : globalThis));