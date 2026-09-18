# Smart Lift — new_dcs Test Strategy

How the `new_dcs/` engine is tested, and how each suite maps to
`Spec/phase-3-newdcs.md`. All tests are plain ES5 JavaScript (per the project
convention) run headlessly on Node.

## Running

```text
node new_dcs/tests/run-tests.js     # new-DCS suite only (70 tests)
node scripts/regression.js          # full regression:
                                    #   Phase 1 base 32/32
                                    #   Phase 2 DCS 15/15
                                    #   Phase 3 new DCS 70/70
```

Test files load their dependencies with CommonJS so the Node runner works
without a browser. The harness (`tests/helpers/test-suite.js`) mirrors the
existing `simulation/` TestSuite contract (`.test(name, fn)`, `.run()`, and
`assert` / `assertEq` / `assertEqArr` / `assertThrows`).

## Unit suites (pure functions)

| File | Spec | Focus |
|------|------|-------|
| `unit/domain.tests.js` | §40 | Elevator init, capacity 10, floor range 1–15, validation rejects invalid floors / origin==dest / count>capacity / non-integers, occupancy bound, legal state transitions, maintenance representation, unique IDs |
| `unit/eligibility.tests.js` | §41 | Active eligible; MAINTENANCE and OUT_OF_SERVICE ineligible; full lift ineligible; sufficient remaining capacity eligible; restored re-eligible; no eligible → queued |
| `unit/eta.tests.js` | §42 | Idle below/above origin; moving toward (en-route free) vs away (backtrack reversals); existing stops; multiple stops; reversal cases; compatible vs incompatible destination; determinism |
| `unit/scoring.tests.js` | §43 | ETA term dominates; already-on-route request adds zero stops; direction penalty monotone; occupancy term; workload imbalance term; maintenance never wins; per-term exposure via detail |
| `unit/routing.tests.js` | §48/§49 | Insertion preserves committed order & position; all original stops kept; no duplicate stops; ETA accounting; optimal (fewest-reversal) insertion; HIGH/LOW grouping levels; profile compatibility |

## Integration suites (live SimulationEngine)

| File | Spec | Focus |
|------|------|-------|
| `integration/dispatch.tests.js` | §31/§45/§47/§48/§35 | Grouped sharing on one car; full-car and reservation semantics; fleet saturation queues (never over-book); FIFO queue; waiting-time accrual + starvation penalty; restore frees queue; re-assignment off a pending car |
| `integration/simulation.tests.js` | §26/§34/§52/§62 | Golden timing to the tick; door dwell 2+1; one floor per tick; lifecycle status sequence; ordered multi-drop; deterministic event traces; instance isolation; floor bounds; occupancy ≤ capacity |
| `integration/maintenance.tests.js` | §46 (M1–M7) | Idle→immediate MAINTENANCE; busy→pending→reassign→deliver→MAINTENANCE; restore→IDLE+eligible; serviced lift never dispatched even when closest; duplicate/invalid transitions rejected; service duration + reuse after restore; restore reconsiders queue |

## Behavioral lessons encoded in the tests

- **Full tick budget, no early exit:** boarding happens the moment doors open,
  so a test that stops ticking at the first event can race a status change
  (e.g. 35.1 asserts the re-assignment before the next door-open tick
  converts ASSIGNED into PICKED_UP).
- **Lifecycle timing:** doors open at t=1 for a car parked at the origin; a
  single F1→F15 ride finishes at t=19 = 1 (open) + 2 (dwell) + 1 (close) +
  idle-resume tick + 14 (floors). Pinned in 26.1.
- **Reservation vs occupancy:** an elevator with 9 seats reserved can still
  take a 1-person request but not a 2-person one (47.2) — capacity semantics
  are tested as a state invariant during live simulation (47.3).
- **Real transitions, not stubs:** maintenance M2 builds a genuinely moving,
  loaded car with a second (still-waiting) assignment so both halves of the
  §7 policy are exercised.

## Regression policy

The new-DCS tree must never change behavior of the existing simulations: the
spec mandates a non-regression gate (§66 Phase 10). `scripts/regression.js`
runs the base (32), DCS (15) and new-DCS (70) suites and fails the build if
any of them regress. The three suites are fully isolated (separate globals,
separate modules), so running them in one process is safe.