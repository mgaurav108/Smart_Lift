# Existing System Analysis — Smart Lift Simulation

**Purpose:** Phase-1 discovery deliverable for the New DCS effort
(`Spec/phase-3-newdcs.md`, §3). This document explains the *current* project
architecture so another engineer can understand it without changing anything.

**Baseline (recorded before any New DCS work):**

```text
Existing tests:
  Phase 1 engine (simulation/js/engine.js): Passed: 32  Failed: 0  Skipped: 0
  Phase 2 DCS engine (simulation/dcs/js/engine.js): Passed: 15  Failed: 0  Skipped: 0
```

This baseline MUST be preserved exactly by the New DCS work
(`Spec/phase-3-newdcs.md` §3.3, §50).

---

## 1. Project overview

Pure **HTML/CSS/JavaScript** simulation project. No build system, no runtime
dependencies, no package manifest, no backend. It lives in a single git repo
and is driven by **spec-first development**: prose specifications in `Spec/`
(one per feature phase) are implemented and validated by acceptance tests.

It currently contains **two independent simulations**:

| Path | What it is |
| --- | --- |
| `simulation/` | Phase 1 "classic" lift control (dispatch + in-car destination). |
| `simulation/dcs/` | Phase 2 Destination Control System (destination-before-boarding + group allocation). |

Both share the same code conventions but are separate modules with separate
state and separate test runners.

---

## 2. Module conventions (shared by both simulations)

All code is **ES5** (var, function, IIFE), strict mode, no imports/requires at
the source level. Two source files exist per simulation:

- `js/engine.js` — **pure logic** (no DOM). Defines and mutates a `building`
  state object and exposes an `Engine` API.
- `js/ui.js` — **DOM wiring**. Builds the scene, wires controls, and drives a
  `setInterval` loop that calls `engine.tick(building)`.

Engines are dual-environment:

```js
if (typeof module !== 'undefined' && module.exports) { module.exports = Engine; }
global.SmartLift = global.SmartLift || {};
global.SmartLift.DCS = Engine;   // or global.SmartLift.Engine
```

So the same file runs in the browser (window.SmartLift) and in Node (used as a
headless test runner). No unit-test framework is used — a tiny hand-rolled
`TestSuite` object collects named test functions and reports pass/fail.

---

## 3. Application entry points

- Phase 1: `simulation/index.html` (loads `js/engine.js`, `js/ui.js`, CSS).
- Phase 2: `simulation/dcs/index.html` (loads `simulation/dcs/js/*`).
- Tests: `tests/run-tests.html` (browser) or a `node -e` one-liner (headless).

---

## 4. Domain models

| Concept | Representation |
| --- | --- |
| Floor | Plain integer `1..numFloors`. `isValidFloor()` rejects non-integers, 0, negative, and out-of-range values. |
| Elevator (Phase 1) | `{ id, floor, direction, queue:[floor], busy:bool, passengers:[pid], maintenance:bool }`. |
| Elevator (Phase 2 / DCS) | `{ id, floor, direction, stops:[floor], assigned:[pid], passengers:[pid], doorsOpen:count, maintenance:bool }`. |
| Passenger | `{ id, floor, destination, boardedLiftId }` (P1) / `{ id, floor, destination, assignedLiftId, aboardLiftId, noShows }` (DCS). One object per passenger; passengers are referenced by numeric `pid`. |
| Floor numbers | Derived from `building.numFloors`; there is no separate Floor class. |

Direction is one of `IDLE`, `UP`, `DOWN` (constants `DIR_*`).

---

## 5. State management

Each simulation owns one mutable `building` object created by `create(config)`:

```js
// Phase 1 shape
building = {
  numFloors, lifts: [ {id, floor, direction, queue, busy, passengers, maintenance} ],
  passengers: { pid: {...} }, nextPassengerId
}

// Phase 2 / DCS shape
building = {
  numFloors, capacity, doorTicks,
  lifts: [ {id, floor, direction, stops, assigned, passengers, doorsOpen, maintenance} ],
  passengers: { pid: {...} }, nextPassengerId
}
```

The engine mutates this object **in place** (no immutability, no events library).
`tick()` returns a list of event objects (`moved`, `arrived`, `boarded`,
`unboarded`, `assigned`, `no_show`, `doorsClosed`, ...) that the UI consumes for
logging and animation. There is **no global mutable state** outside the building;
each `create()` call yields an independent instance, which is what the tests use.

---

## 6. Configuration

Configuration is passed to `create(config)` and has defaults:

| Option | Phase 1 | Phase 2 / DCS |
| --- | --- | --- |
| `numFloors` | `6` | `6` |
| `numLifts` | `2` | `4` |
| `capacity` | n/a | `4` |
| `doorTicks` | n/a | `4` |

There is no config file; UI code hard-codes `NUM_FLOORS: 6`, `NUM_LIFTS: 4`,
and park positions `[A:1, B:2, C:5, D:6]`, then calls `engine.create(...)`.

---

## 7. Existing behaviour — Phase 1 (classic control)

Passenger flow: **call → board an idle lift → select destination inside**.

1. **Request creation** — `call(building, passengerId[, floor])` sets the
   passenger's floor and dispatches a lift.
2. **Assignment/dispatch** — `dispatch()` (engine.js:125) filters out
   maintenance lifts, then prefers an **idle** lift (nearest floor wins); busy
   lifts are scored by `busyScore()` = total travel to serve their queue plus
   the new floor. Tie-break: lowest lift id. If all lifts are under
   maintenance, `call()`/`request()` return an error.
3. **Movement** — `tick()` advances each moving lift exactly one floor per
   tick. When a lift is idle with queued work it starts moving toward `queue[0]`.
4. **Stops** — each queued floor is a stop; on arrival the lift becomes idle
   and any passenger whose `destination` equals the floor is unboarded.
5. **Capacity** — not modelled in Phase 1 (any number of passengers board).
6. **Maintenance** — `setMaintenance()` refuses to service a lift that is
   moving, queued, or carrying passengers; a maintenance lift is never
   dispatched and cannot be boarded; restoring it re-enables dispatch.

---

## 8. Existing behaviour — Phase 2 / DCS (destination control)

Passenger flow: **kiosk destination → assigned car → board that car → ride → exit**.

1. **Request creation** — `addPassenger(building, floor)` creates the
   passenger; `registerDestination(building, passengerId, destFloor)` is the
   DCS kiosk action.
2. **Assignment** — `allocate()` (dcs engine:131) is the **group controller**.
   For every non-maintenance lift with spare capacity it enumerates all
   insertion positions for (pickup, drop) into the lift's ordered `stops`
   list, collapses consecutive duplicates, then ranks candidates by:
   1. fewest extra direction reversals,
   2. lowest pickup ETA,
   3. least added travel time,
   4. fewest added stops / total stops,
   5. lowest lift id.

   Requested pickup+drop are committed to the winner's `stops`; the passenger
   goes on `assigned`.
3. **Capacity** — `capacity = passengers (aboard) + assigned (waiting)`.
   A lift at capacity is not a candidate; requests overflow to other lifts.
4. **Boarding** — `board()` is restricted to the **assigned lift only** and
   only while its doors are open at the passenger's floor.
5. **Doors/no-shows** — doors stay open `doorTicks` ticks per stop. On door
   close, anyone still waiting becomes a `no_show`, is unassigned, and may
   re-register (seat freed).
6. **Movement/stops** — `tick()` moves one floor per tick; at each stop it
   opens doors, unboards matching destinations, and continues until `stops`
   is empty.
7. **Maintenance** — same exclusion as Phase 1 plus the passenger-waiting
   guard; remaining lifts keep serving (verified by AC-D9b failover test).

---

## 9. Simulation clock

- Both UIs run `setInterval(..., 700ms)`; each callback calls `engine.tick(building)`
  and re-renders. There is **no simulation-time clock** — time *is* the tick
  counter, and wall-clock (700ms/tick) is visual pacing only.
- Phase 1 UI only advances when `simRunning` is true (Start button).
- CSS `translateY` animation is synchronized to `TICK_MS` so one tick equals a
  full floor slide.

The New DCS spec (§25) requires a proper simulation clock and tick-based time;
this is a deliberate upgrade, not an existing feature.

---

## 10. UI / frontend

- `index.html` provides placeholders; `ui.js` builds the shafts/floors DOM
  programmatically (`buildShafts()`, `buildFloorNumbers()`).
- Each lift is a colored block whose `translateY` is recomputed from
  `(lift.floor - 1) * --floor-h`.
- Phase 2 adds a **kiosk panel**: destination grid, live ticket (assigned car,
  pickup ETA, car stops), passenger chips with multi-select, message area,
  per-lift **Service/Restore** buttons, an event log, and a passenger-column
  visualization.

---

## 11. Test structure

Both simulations use the same pattern:

- `tests/tests.js` — self-contained tests using a `TestSuite` harness with
  `assert`/`assertEq`/`assertEqArr`.
- `tests/run-tests.html` — browser runner that loads engine + tests and prints
  PASS/FAIL per case.
- Headless execution (Node):

```text
# Phase 1
node -e "require('./js/engine.js'); require('./tests/tests.js'); var r=TestSuite.run(); console.log(r.pass, r.fail)"

# Phase 2 / DCS
node -e "require('./js/engine.js'); require('./tests/tests.js'); var r=TestSuite.run(); console.log(r.pass, r.fail)"
   (run from simulation/dcs/)
```

Phase 1 suite: 32 tests — dispatch, boarding, multi-passenger runs, maintenance,
validation. Phase 2 suite: 15 tests (AC-D1..D11) — registration, grouping,
boarding rules, tours, no-shows, capacity, maintenance/failover, randomized
bounds invariants.

---

## 12. Build system & dependency management

- **None.** No package.json, no bundler, no transpiler, no lockfile.
- Syntax checks only: `node --check <file>`.
- The only "tooling" is Node's `require` used to load engines headlessly, and
  browsers loading `<script>` tags.
- Git is the only project tooling: tags (`phase_1`) and conventional-ish commit
  messages (`feat:`, `docs:`, `chore:`).

---

## 13. Key files and responsibilities

| Path | Role |
| --- | --- |
| `Spec/smart-lift.md` | Product spec (6 user stories). |
| `Spec/phase1-simulation.md` | Phase 1 baseline spec (FRs + AC-1..AC-8, AC-21). |
| `Spec/phase2-dcs.md` | Phase 2 DCS spec (AC-D1..D11). |
| `Spec/Steps_Followed.md` | Chronological development log. |
| `simulation/js/engine.js` | Phase 1 pure engine (334 lines). |
| `simulation/js/ui.js` | Phase 1 DOM + tick loop (343 lines). |
| `simulation/tests/tests.js` | Phase 1 acceptance tests (32). |
| `simulation/dcs/js/engine.js` | Phase 2 DCS pure engine (411 lines). |
| `simulation/dcs/js/ui.js` | Phase 2 kiosk UI + tick loop (555 lines). |
| `simulation/dcs/tests/tests.js` | Phase 2 acceptance tests (15). |
| `simulation*/tests/run-tests.html` | In-browser test runners. |
| `simulation*/index.html`, `css/style.css` | Pages and styling. |

---

## 14. Observations relevant to New DCS

1. **Reusable idioms:** dual-env IIFE modules, mutable building-state object,
   `tick()` returning events, hand-rolled test harness, event-stream driven UI.
   New DCS should follow these conventions to stay consistent.
2. **Gaps New DCS must fill** (per spec):
   - No simulation *clock* / speed control; ticks are wall-clock paced.
   - No passenger **count** per request (Phase 2 treats requests as 1 person).
   - No starvation / long-wait protection, no load balancing, no metrics.
   - Single hard-coded strategy (no strategy pattern, no algorithm comparison).
   - No scenario generator, no replay/seed determinism.
   - No queued-and-reconsidered requests (all-maintenance = hard error today).
3. **Non-goal compliance:** New DCS lives entirely in a new `new_dcs/` tree;
   nothing under `simulation/` or `Spec/` (other than `phase-3-newdcs.md`) will
   be modified.