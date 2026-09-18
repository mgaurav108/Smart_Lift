# Smart Lift — new_dcs Architecture

Derived from `Spec/phase-3-newdcs.md` (Phases 2–6: domain, simulation, dispatch,
route optimization, maintenance). Everything under `new_dcs/` is isolated from
the existing `simulation/` tree; the two never import each other.

## Layout

```text
new_dcs/
├── config/default-config.js     # every tunable (floors, lifts, capacity, weights)
├── domain/                      # pure value models, no engine logic
│   ├── state.js                 # ElevatorState / DoorState / MaintenanceStatus / Direction enums
│   ├── floor.js                 # FloorRange + person-friendly names
│   ├── request.js               # DestinationRequest + lifecycle + validation
│   ├── passenger.js             # passenger identity
│   └── elevator.js              # elevator model incl. capacity reservation
├── simulation/
│   ├── clock.js                 # deterministic tick counter
│   ├── state.js                 # SimulationState: OWNER of all mutable state
│   └── engine.js                # SimulationEngine: tick(), request(), maintenance controls
├── dispatch/
│   ├── eta.js                   # RoutePlanner + ETAEstimator (insertion search)
│   ├── grouping.js              # HIGH/LOW destination compatibility
│   ├── scorer.js                # weighted candidate scoring + explanation detail
│   ├── strategy.js              # DispatchStrategy (WeightedDCSStrategy, eligibility, tie-break)
│   └── engine.js                # DispatchEngine: assign / queue / reconsider / reassign
├── maintenance/
│   └── manager.js               # MaintenanceManager (idle -> pending -> MAINTENANCE)
├── docs/                        # this analysis
└── tests/
    ├── helpers/test-suite.js    # shared TestSuite + asserts
    ├── run-tests.js             # Node headless runner
    ├── unit/                    # §40–§44, §48–§49
    └── integration/             # §31, §34, §35, §45–§48, §52, §62, M1–M7
```

## Dependency rules

- Dependencies only flow one way: `config <- domain <- simulation <- dispatch`,
  with `maintenance <- dispatch`. Nothing imports `engine` from below.
- Every module is an ES5 IIFE with a dual environment: it attaches to
  `global.SmartLift.NewDCS.*` in a browser and, under Node (`typeof require ===
  'function' && module.exports`), exports via CommonJS. Engines/modules expose a
  `create()` factory; nothing holds module-level mutable state.

## State ownership (§62)

`SimulationState.create(config)` owns:

- the `elevators[]` array,
- the `requests{}` map (requestId -> DestinationRequest),
- the `queuedRequestIds[]` FIFO,
- the request / passenger ID counters.

There is no global mutable state. Two engines produced from the same
configuration are fully independent (test 52.2 proves this), and a single
engine is deterministic (§52, test 52.1).

## Core objects

### Elevator (`domain/elevator.js`)

```text
id, name (E1..), currentFloor, direction, capacity, occupancy,
assignedPassengerCount, state, doorState, targetFloors[] (ordered stops),
assignedRequestIds[], aboardRequestIds[], maintenanceStatus,
estimatedAvailabilityTime, maintenancePendingSince
```

Capacity is passenger-based (§33) and reservation-correct (§32):

```text
capacityRemaining = capacity - occupancy - assignedPassengerCount
```

`assignedPassengerCount` reserves seats for requests already assigned but not
yet boarded, so independently-fitting requests can never over-book a lift.

### DestinationRequest (`domain/request.js`)

Lifecycle statuses: CREATED, VALIDATED, QUEUED, ASSIGNED, PASSENGER_WAITING,
PICKED_UP, IN_TRANSIT, DELIVERED, CANCELLED, REASSIGNED,
WAITING_FOR_CAPACITY, WAITING_FOR_AVAILABLE_ELEVATOR. Terminal states are
DELIVERED and CANCELLED. Requests carry `waitingTime` (sim ticks while not yet
picked up), `reassignedCount`, `estimatedWaitTime`, `estimatedTravelTime`, an
`assignmentScore`, and an `assignmentExplanation` (human-readable score
breakdown, §29/§57).

## Simulation clock (`simulation/clock.js`, engine)

`clock.tick()` returns a monotonically increasing tick count, starting at 1.
**1 tick = 1 simulated second** (§25). `tick()` on the engine:

1. lets `MaintenanceManager` resolve PENDING → MAINTENANCE transitions,
2. advances every elevator (skipping MAINTENANCE / OUT_OF_SERVICE),
3. reconsiders the FIFO request queue,
4. accrues waiting time for un-picked-up requests.

`request()` validates (§10), creates a DestinationRequest, and dispatches
immediately. If the assigned car currently has its doors open at the origin it
boards the passenger immediately; otherwise boarding happens when the car's
doors open at the origin stop (automatic, destination-control style).

## Movement model

- IDLE with a target: if the first target is the current floor, doors open;
  otherwise the car transitions to MOVING_UP / MOVING_DOWN.
- MOVING: `currentFloor` changes by exactly 1 per tick (`floorsPerTick: 1`),
  clamped to `floorRange`; on arrival `targetFloors.shift()` and doors open.
- DOOR_OPEN lasts `doorOpenTicks` (2), then DOOR_CLOSING for
  `doorCloseTicks` (1), then IDLE. During the first open tick all passengers
  whose origin is the floor are boarded and every aboard passenger whose
  destination is the floor is delivered (deliver first, then board).

Golden timing for a single F1→F15 ride: pickup at t=1, doors stay open through
t=2–3, close at t=4, depart, arrive/drop at t=19 (pinned by test 26.1).

## Dispatch pipeline (`dispatch/engine.js`)

`assign()` per §11:

1. `evaluate(state, request)` — WeightedDCSStrategy.
2. Eligibility (§12): ACTIVE, not OUT_OF_SERVICE, `canFit(passengerCount)`.
3. For each eligible elevator, insert (origin, dest) into the committed route
   and compute the candidate (ETA, added stops, distance, reversals…).
4. Score every candidate; pick the minimum; break ties deterministically (§19).
5. Commit: `targetFloors` = winner route, reserve seats, stamp the request;
   return the assignment (id, name, ETA, travel estimate, route, score,
   explanation).

No eligible elevator → FIFO queue with a reason (`capacity` vs
`availability`). The queue is reconsidered every tick and on `restore()`
(§31: automatically).

## Maintenance (`maintenance/manager.js`, §7)

- Idle & empty → immediate MAINTENANCE (60 s by default).
- Busy/loaded → MAINTENANCE_PENDING: assigned-but-not-boarded requests are
  reassigned instantly (§35), aboard passengers are delivered to their
  destinations, then the car becomes MAINTENANCE.
- `restore()` → ACTIVE + IDLE and queues are reconsidered immediately.

## Testing

Run the new-DCS suite:

```text
node new_dcs/tests/run-tests.js
```

Run the full regression (all three suites):

```text
node scripts/regression.js
```

See `docs/test-strategy.md` for the mapping of tests to spec sections.