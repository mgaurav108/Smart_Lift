# Steps Followed - Smart Lift Project

> Working log of every phase, decision, and change made while building the Smart Lift system using **spec-driven development** (SDD).
>
> **Process conventions we follow:**
> 1. **Spec first** - every phase starts by writing/refining a spec and concrete acceptance criteria in `Spec/`.
> 2. **Implement to spec** - code is written only to satisfy the acceptance criteria.
> 3. **Test against criteria** - we verify using runnable tests/examples before calling a phase done.
> 4. **Log it** - every completed step is recorded here.
> 5. **One phase at a time** - never rush ahead of the spec.

---

## Phase 0: Project setup & conventions

### Step 0.1 - Explore existing project
- [x] Found existing files:
  - `Spec/smart-lift.md` - high-level product spec (5 user stories).
  - `src/Main.java` - IntelliJ starter file (unused for now; keeping it).
  - `opencode.json`, `.idea/`, `.ollamassist/` - environment/config files.

### Step 0.2 - Decide tech stack & scope
- [x] Chose **Pure HTML/CSS/JS** for the simulation (no build tools, easy to run and iterate).
- [x] Phase 1 scope = **Floor Selection + Lift Movement** (user stories 2 and 3) with **2 lifts**.
- [x] Authentication (story 1), Emergency Stop (story 4), Fault Detection (story 5) are deferred to later phases.

### Step 0.3 - Create this tracking document
- [x] Created `Steps_Followed.md` to log all changes.

---

## Phase 1: Floor selection + lift movement simulation

Status: COMPLETE

### Planned steps
1. Write Phase-1 sub-spec + acceptance criteria in `Spec/phase1-simulation.md`.
2. Scaffold `simulation/` structure.
3. Implement pure lift engine logic (dispatch + movement state machine).
4. Implement UI + up/down animation.
5. Add a test runner to verify the engine against acceptance criteria.
6. Run tests + manually verify the page.
7. Log the phase as complete.

### Step 1.1 - Phase-1 sub-spec (`Spec/phase1-simulation.md`)
- Wrote a detailed sub-spec derived from user stories 2 & 3 of the main spec.
- Decisions recorded in the spec:
  - 6 floors (1 = ground), 2 lifts (A, B), each in its own shaft, both start at floor 1.
  - One active request per lift; FIFO queue.
  - Dispatch rule (FR-2): idle lift > busy lift; closest idle wins; busy lifts judged by time-to-finish + travel.
  - 1 tick = movement of exactly 1 floor.
  - Defined 7 acceptance criteria (AC-1..AC-7) + a DoD.

### Step 1.2 - Scaffold `simulation/` structure
- Created:
  - `simulation/index.html` - main page.
  - `simulation/css/style.css` - styling + CSS-transition animation.
  - `simulation/js/engine.js` - pure engine (no DOM), works in browser AND node.
  - `simulation/js/ui.js` - DOM wiring, tick loop, animation, event log.
  - `simulation/tests/run-tests.html` - in-browser acceptance test runner.
  - `simulation/tests/tests.js` - test definitions.

### Step 1.3 - Implement engine (`simulation/js/engine.js`)
- `create({ numFloors, numLifts })` -> building state.
- `request(building, floor)` -> dispatch + enqueue; rejects invalid floors (`ok:false`).
- `tick(building)` -> advances every moving lift one floor; returns machine-readable events (`started`, `moved`, `arrived`, `served`).
- `isValidFloor`, direction constants exported.
- Score function for busy lifts: ticks-to-finish existing queue + travel to the new request.
- Module pattern: works in browser (`window.SmartLift`) and CommonJS (`module.exports`).

### Step 1.4 - Implement UI + animation
- `index.html` + `style.css`: floor-number strip, 2 shafts, lift boxes, control panel (6 floor buttons), lift status readout, engine event log.
- `ui.js`: builds DOM from config, drives `engine.tick` on a 700 ms interval, animates lifts via CSS `transform: translateY` transitions (exactly one floor per tick).

### Step 1.5 - Test runner (`simulation/tests/`)
- `tests.js` maps each check to an AC in the spec; `run-tests.html` renders pass/fail.
- Engine is also runnable headlessly from Node (tests: `node` script in this repo's workflow).

### Step 1.6 - Verification
- [x] All acceptance tests pass (10/10).
- [x] `node --check` passes on engine.js / ui.js / tests.js.
- [x] Simulation viewable by opening `simulation/index.html`.

### Bug found by SDD (test exposed a spec error)
- AC-2.2 originally claimed: "A at floor 1, B at floor 4, request floor 2 -> B chosen (closest)".
- The engine correctly chose **A** (distance 1 vs B's 2), failing the test.
- The **spec was wrong**, not the code. Fixed the spec to: request floor 5, B chosen (distance 1 vs A's 4). Test updated to match. This is exactly the value of writing tests against acceptance criteria first.

### Files changed in Phase 1
- Created: `Spec/phase1-simulation.md`, `simulation/index.html`, `simulation/css/style.css`, `simulation/js/engine.js`, `simulation/js/ui.js`, `simulation/tests/run-tests.html`, `simulation/tests/tests.js`, `Steps_Followed.md`.

---

## Phase 1a: Expand from 2 lifts to 4 lifts

Status: COMPLETE

### Planned steps
1. Update Phase-1 sub-spec to reflect 4 lifts (A, B, C, D).
2. Update UI constants for 4 lifts (names, colors, count).
3. Update tests to cover 4-lift dispatch scenarios.
4. Run verification - syntax check + tests.

### Step 1a.1 - Update spec (`Spec/phase1-simulation.md`)
- Changed lift count from 2 to 4 (A, B, C, D).
- Updated AC-1: all 4 lifts start at floor 1, idle.
- Updated AC-2: dispatch test with 4 lifts at different positions, closest idle wins.
- Updated AC-4: busy dispatch with multiple lifts.
- Updated FR-6 visualization: 4 lift shafts.

### Step 1a.2 - Update UI (`simulation/js/ui.js`)
- `NUM_LIFTS`: 2 → 4.
- `LIFT_NAMES`: ['A', 'B'] → ['A', 'B', 'C', 'D'].
- `LIFT_COLORS`: added orange (#ea580c) for C, purple (#9333ea) for D.

### Step 1a.3 - Update tests (`simulation/tests/tests.js`)
- AC-1: test 4 lifts at floor 1.
- AC-2.1: test dispatch with 4 idle lifts.
- AC-2.2: test closest idle with 4 lifts at different positions.
- AC-3/5/6/7: updated to use 4-lift buildings.
- AC-4b: test all 4 lifts busy, soonest-finishing wins.
- Fixed Node.js compatibility: `window.TestSuite` → `globalThis.TestSuite`.

### Step 1a.4 - Bug found by SDD (test exposed a spec error)
- AC-4b originally assumed 2 lifts, but with 4 lifts, idle lifts C and D were available.
- The test was wrong (not the code). Fixed test to dispatch to all 4 lifts first, then test busy dispatch.

### Verification
- [x] All acceptance tests pass (10/10).
- [x] `node --check` passes on all JS files.
- [x] Simulation viewable by opening `simulation/index.html`.

### Files changed in Phase 1a
- Modified: `Spec/phase1-simulation.md`, `simulation/js/ui.js`, `simulation/index.html`, `simulation/tests/tests.js`, `Steps_Followed.md`.

---

## Phase 1b: Two-step flow (call + board + destination)

Status: COMPLETE

### Planned steps
1. Update spec to define two-step flow (call lift, board, select destination).
2. Update engine to support user state and boarding.
3. Update UI for call mode, board button, and destination mode.
4. Update tests for new acceptance criteria.
5. Run verification - syntax check + tests.

### Step 1b.1 - Update spec (`Spec/phase1-simulation.md`)
- Renamed FR-1 to "Call a lift" (was "Floor selection").
- Added FR-2: Board a lift (appear when lift arrives at user's floor).
- Added FR-3: Select destination (after boarding).
- Added user state model: `user.floor`, `user.boardedLiftId`.
- Updated AC-1: user at floor 1, not boarded.
- Added AC-2: full call-board-destination flow.
- Added AC-7: same-floor destination error.
- Added AC-8: invalid input (renamed from AC-7).
- Total acceptance criteria: 8 (up from 7).

### Step 1b.2 - Update engine (`simulation/js/engine.js`)
- Added `user` object to building state: `{ floor, boardedLiftId }`.
- Added `call(building, floor)` - dispatch lift to user's floor.
- Added `board(building, liftId)` - board an idle lift at user's floor.
- Added `selectDestination(building, floor)` - set destination after boarding.
- Added `unboarded` event when lift arrives at destination.
- Kept `request()` for backward compatibility with existing tests.

### Step 1b.3 - Update UI (`simulation/js/ui.js`, `style.css`, `index.html`)
- Added user-state display showing current floor and boarded status.
- Call mode: floor buttons dispatch lifts (blue).
- Board button: appears when idle lift arrives at user's floor (green).
- Destination mode: floor buttons set destination (yellow).
- Added styles for `.user-state`, `.call-btn`, `.destination-btn`, `.board-btn`.

### Step 1b.4 - Update tests (`simulation/tests/tests.js`)
- AC-1: test 4 lifts + user state.
- AC-2: full call-board-destination flow.
- AC-3: dispatch with 4 lifts.
- AC-4: movement semantics.
- AC-5: busy dispatch with 4 lifts.
- AC-6: arrival + auto-unboard.
- AC-7: same-floor destination error.
- AC-8: invalid input.
- Boarding validation tests (3 tests).
- FIFO test.
- Total: 14 tests (up from 10).

### Verification
- [x] All acceptance tests pass (14/14).
- [x] `node --check` passes on all JS files.
- [x] Simulation viewable by opening `simulation/index.html`.

### Files changed in Phase 1b
- Modified: `Spec/phase1-simulation.md`, `simulation/js/engine.js`, `simulation/js/ui.js`, `simulation/css/style.css`, `simulation/index.html`, `simulation/tests/tests.js`, `Steps_Followed.md`.

---

## Phase 2: Multi-passenger boarding (any lift, any time, any floor)

Status: COMPLETE

### Requirement (from user)
- Phase 1 allowed only one user to board one lift.
- Want: all 4 lifts boardable at any time; board from anywhere (any floor);
  two-step process (1: boarding, 2: destination).

### Step 2.1 - Update spec (`Spec/phase1-simulation.md`)
- Added Phase 2 block: multi-passenger model, AC-9..AC-15.

### Step 2.2 - Refactor engine (`simulation/js/engine.js`)
- Removed single `user` object; added `passengers` registry + `nextPassengerId`.
- Lifts track `passengers` (ids aboard).
- Added `addPassenger(building, floor)`.
- `call(building, passengerId[, floor])` dispatches a lift to a passenger's floor.
- `board(building, passengerId, liftId)` - any idle lift at the passenger's floor.
- `selectDestination(building, passengerId, floor)` - pushes to lift queue.
- `tick` unboards passengers only at their destination floor (`unboarded`
  events now carry `passengerId`). Kept `request()` for dispatch-level tests.

### Step 2.3 - Rewrite tests (`simulation/tests/tests.js`)
- 26 tests covering: multi-passenger state, two-step flow, all 4 lifts boarded
  and travelling simultaneously, multiple passengers in one lift,
  boarding from any floor, boarding any idle lift (not only the dispatched one),
  dispatch rules, movement up/down, FIFO, unboarding only at destination,
  and per-passenger input validation.

### Step 2.4 - Update UI (`simulation/js/ui.js`, `index.html`, `css/style.css`)
- Passenger manager: list passengers, switch the controlled one ("Drive"),
  add more passengers.
- Call mode -> board buttons (one per boardable idle lift) -> destination mode.
- Lift labels show passenger count; status shows aboard + destinations;
  log shows passenger ids on unboard.

### Verification
- [x] All acceptance tests pass (26/26) via Node.
- [x] `node --check` passes on engine.js / ui.js / tests.js.
- [x] Simulation viewable by opening `simulation/index.html`.

### Files changed in Phase 2
- Modified: `Spec/phase1-simulation.md`, `simulation/js/engine.js`,
  `simulation/js/ui.js`, `simulation/index.html`, `simulation/css/style.css`,
  `simulation/tests/run-tests.html`, `simulation/tests/tests.js`,
  `Steps_Followed.md`.

---

## Phase 3: Real-time interactive simulation (single user)

Status: COMPLETE

### User feedback driving this phase
- "Only lift A is operational" - caused by all 4 lifts parking at floor 1,
  so every call tied and dispatch always picked A (id 0). B, C, D never moved.
- "Not allowing to board other lift if one is onboarded" - the passenger
  manager multi-passenger UI was over-complex; a single person can only be in
  one lift at a time.
- Desired behaviour: "I should be able to call lift at any floor and the lift
  should come, then I should be able to decide where I need to go."

### Step 3.1 - Root-cause analysis
- Verified in Node: with all lifts idle at floor 1, calls from floors 2-6 all
  returned lift 0 (A) because of the distance tie + lowest-id tie-break.
- Fix: park lifts at different floors in the UI so dispatch naturally
  distributes work across A, B, C, D.

### Step 3.2 - Rebuild UI (`simulation/js/ui.js`, `index.html`, `css/style.css`)
- Single interactive passenger (no add/drive passenger manager).
- Lifts parked at `[A:1, B:2, C:5, D:6]` on start.
- Call mode: "Call at floor N" for every floor (you stand there, nearest lift
  travels to you); board buttons for every idle lift present at your floor.
- Destination mode after boarding; auto-exit on arrival; re-call from there.
- Status readout + event log updated for the single-user flow.

### Step 3.3 - Spec + log
- `Spec/phase1-simulation.md`: replaced the multi-passenger spec with
  `Phase 2/3 - Real-time interactive simulation (single user)` (AC-16..AC-20).
  Engine stays multi-passenger (tests still cover it).

### Verification
- [x] Engine acceptance tests still pass (26/26) via Node.
- [x] `node --check` passes on engine.js / ui.js / tests.js.
- [x] Simulation viewable by opening `simulation/index.html`.

### Files changed in Phase 3
- Modified: `Spec/phase1-simulation.md`, `simulation/js/ui.js`,
  `simulation/index.html`, `simulation/css/style.css`, `Steps_Followed.md`.

---

## Phase 3a: Lift maintenance (exclude a lift from service)

Status: COMPLETE

### Requirement (from user question: "What if one of the lift is under maintenance?")
- Support lifts being **under maintenance**: not dispatched, not boardable,
  visibly flagged; restorable.

### Step 3a.1 - Engine (`simulation/js/engine.js`)
- Lift state gains `maintenance: false`.
- `setMaintenance(building, liftId, flag)`: rejects taking a moving / queued /
  passenger-carrying lift out of service; restores it when `flag === false`.
- `dispatch` skips maintenance lifts; if none remain, `call`/`request` fail
  with "No lift available (all lifts under maintenance)".
- `board` rejects a maintenance lift.

### Step 3a.2 - Tests (`simulation/tests/tests.js`)
- 5 new maintenance tests:
  - maintenance lift is not dispatched (B chosen instead of marked A);
  - all lifts down -> call rejected;
  - cannot board a maintenance lift;
  - cannot take a busy/queued/moving lift out of service;
  - a restored lift is dispatched again.

### Step 3a.3 - UI (`simulation/js/ui.js`, `css/style.css`)
- Every lift status row has a **Service / Restore** toggle.
- Maintenance lifts are greyed out + dashed border, labelled "SERVICE",
  excluded from board buttons.

### Step 3a.4 - Spec
- `Spec/phase1-simulation.md`: added "Maintenance" section + AC-21.

### Verification
- [x] All acceptance tests pass (32/32) via Node.
- [x] `node --check` passes on engine.js / ui.js / tests.js.

### Files changed in Phase 3a
- Modified: `simulation/js/engine.js`, `simulation/js/ui.js`,
  `simulation/css/style.css`, `simulation/tests/tests.js`,
  `Spec/phase1-simulation.md`, `Steps_Followed.md`.

---

## Phase 3b: Repo housekeeping (git/GitHub)

Status: COMPLETE

### Step 3b.1 - Initial commit + push
- [x] This log moved from the repo root into `Spec/Steps_Followed.md`.
- [x] Initial commit `18ed80d` (16 files, Phases 0-3a).
- [x] Pushed to **origin** = `https://github.com/mgaurav108/Smart_Lift.git`.
- [x] Verified: all engine acceptance tests pass (32/32) before committing.

### Step 3b.2 - Remove IntelliJ noise
- [x] `src/Main.java` (unused IDE starter file) deleted.
- [x] `.idea/` and `Smart_Lift.iml` removed from tracking and added to
  `.gitignore` (kept locally so IntelliJ still works).

### Step 3b.3 - Baseline tag
- [x] Created annotated tag **`phase_1`** at HEAD (pre-DCS baseline) and
  pushed it. `git checkout phase_1` restores this exact state.

### Verification
- [x] `git status` clean; `origin/master` up to date.
- [x] 13 tracked files in the repo.

### Files changed in Phase 3b
- Modified: `.gitignore`, `Spec/Steps_Followed.md`.
- Deleted from repo: `src/Main.java`, `.idea/*`, `Smart_Lift.iml`.

---

## Phase 2 (DCS): Destination Control System

Status: COMPLETE (engine + tests + UI)

> Baseline = Phase 1 (tag `phase_1`). DCS keeps the 6-floor / 4-lift model
> but moves destination entry BEFORE boarding and adds a group controller.

### Planned steps
1. Write `Spec/phase2-dcs.md` - DCS concept, FRs, AC-D1..AC-D10.
2. Scaffold `simulation/dcs/` (engine, UI, tests, runner).
3. Implement DCS engine: kiosk `registerDestination`, grouping allocator,
   ordered stops per lift, doors/no-show, capacity, maintenance.
4. Write acceptance tests (AC-D1..D10).
5. Build the kiosk UI (ticket "Take Lift C", boarding, grouped stops).
6. Verify - Node tests + syntax check.
7. Update docs (`smart-lift.md` story 6, phase1 baseline note, this log).

### Step 2.1 - Spec (`Spec/phase2-dcs.md`)
- Documented DCS vs Phase 1 (destination first, assigned car, grouping).
- Passenger lifecycle: unassigned -> assigned -> aboard -> done / no-show.
- Grouping allocator ranked by: extra direction reversals, added travel
  time, extra stops, total stops, id. Prevents a car zigzagging across
  town and splits opposite-direction traffic onto different cars.
- Acceptance criteria AC-D1..AC-D10 (incl. capacity + maintenance).

### Step 2.2 - Scaffold + engine (`simulation/dcs/js/engine.js`)
- New pure engine `SmartLift.DCS` (no DOM; Node + browser).
- `registerDestination(building, passengerId, destFloor)` -> assigned lift,
  pickup ETA, planned stops.
- `board()` restricted to the assigned lift while doors are open.
- Lifts carry an ordered `stops` plan; doors open `doorTicks` on each stop;
  unboarding auto at destination; no-shows unassigned on doors close.
- Capacity-limited; maintenance excludes a lift from assignment/boarding.

### Step 2.3 - Tests (`simulation/dcs/tests/tests.js`)
- 11 tests mapping to AC-D1..D10 (plus a grouped multi-stop journey).
- Design decisions found while testing:
  - "Reversal penalty" kept trips efficient (opposite trips split cars).
  - All-maintenance case moved to a fresh building: a lift with planned
    stops correctly refuses to enter maintenance.
  - Consecutive same-floor pickups collapse to ONE stop (`[1,1,4,5]` -> `[1,4,5]`).

### Step 2.4 - UI (`simulation/dcs/index.html`, `js/ui.js`, `css/style.css`)
- DCS kiosk panel: destination buttons BEFORE boarding -> live ticket
  (assigned car, pickup ETA, car stops); Board button appears when the
  assigned car's doors open.
- Multiple passengers: add passengers, switch who you control - grouping
  across cars is visible; lift labels show stops; doors show open state.
- Park positions [A:1, B:2, C:5, D:6] (same as Phase 1).

### Verification
- [x] DCS acceptance tests pass (11/11) via Node.
- [x] `node --check` passes on engine.js / ui.js / tests.js.
- [x] Phase 1 tests still green (32/32) - baseline untouched.
- [x] Simulation viewable by opening `simulation/dcs/index.html`.

### Files changed in Phase 2
- Created: `Spec/phase2-dcs.md`, `simulation/dcs/index.html`,
  `simulation/dcs/css/style.css`, `simulation/dcs/js/engine.js`,
  `simulation/dcs/js/ui.js`, `simulation/dcs/tests/tests.js`,
  `simulation/dcs/tests/run-tests.html`.
- Modified: `Spec/smart-lift.md` (User Story 6), `Spec/phase1-simulation.md`
  (baseline note), `Spec/Steps_Followed.md`.

---

## Next steps (ideas, not yet scheduled)
- DCS-2: predicted wait/ride times display; reassignment while waiting.
- DCS-3: real traffic profiling / peak patterns; door + acceleration curves.
- Phase 2: multi-destination runs + pickup along the way; doors; direction indicators.
- Phase 3: user authentication (story 1).
- Phase 4: emergency stop + alerts (story 4).
- Phase 5: fault detection + maintenance history (story 5).

---

## Glossary
- **SDD**: Spec-Driven Development - write the spec and acceptance criteria first, then implement to satisfy them.
- **Controller / engine**: pure JS logic that decides lift behaviour (no DOM).
- **UI / rendering**: code that draws the simulation and handles user clicks.