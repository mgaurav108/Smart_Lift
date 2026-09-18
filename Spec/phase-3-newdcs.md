# New DCS — 6-Lift / 15-Floor Destination Control Simulation

**Specification Version:** 1.0
**Status:** Proposed
**Purpose:** Introduce a new, independent destination-control elevator simulation without modifying or breaking the existing elevator simulation.

---

# 1. Objective

The existing project contains a functioning elevator simulation with:

* 6 floors
* 4 elevators
* Elevator capacity of 4 persons
* Existing routing/dispatching behaviour
* Spec-driven development approach

The purpose of this change is to create a **new independent simulation** called **New DCS** with:

* 15 floors
* 6 elevators
* Maximum capacity of 10 persons per elevator
* Destination Control System (DCS)
* Intelligent elevator assignment
* Elevator maintenance/unavailability support
* Real-time elevator state visualization
* Destination-based passenger requests
* Comprehensive automated testing
* No functional or structural regression to the existing simulation

The new implementation MUST be isolated under:

```text
new_dcs/
```

The existing simulation MUST continue to work exactly as it does today.

---

# 2. Fundamental Non-Goals

The following MUST NOT happen as part of this change:

1. Do not modify the existing elevator simulation behaviour.
2. Do not change existing production/source files unless absolutely required for build/test infrastructure.
3. Do not rename or move existing modules.
4. Do not replace the existing routing algorithm.
5. Do not share mutable runtime state between the existing simulation and New DCS.
6. Do not introduce configuration changes that alter the existing simulation.
7. Do not make New DCS dependent on the existing simulation's runtime state.
8. Do not copy the existing implementation blindly and modify values only.

New DCS should be treated as a **new bounded module/system**.

---

# 3. Mandatory First Step — Understand Existing System

Before implementing New DCS, the implementation agent MUST inspect and understand the existing project.

The agent MUST identify:

### 3.1 Project structure

Document:

* application entry point
* modules/packages
* domain models
* elevator representation
* floor representation
* passenger/request representation
* routing algorithm
* scheduling logic
* simulation clock
* UI/frontend
* state management
* configuration
* test structure
* build system
* dependency management

### 3.2 Existing behaviour

Identify:

* how a passenger request is created
* how elevator assignment occurs
* how elevator movement is simulated
* how stops are calculated
* how capacity is handled
* how elevator state is represented
* how the simulation advances
* how tests validate behaviour

### 3.3 Existing tests

Run the complete existing test suite before making any changes.

Record the baseline:

```text
Existing tests:
Passed:
Failed:
Skipped:
```

This baseline MUST be preserved.

### 3.4 Existing architecture report

Before writing New DCS implementation, produce:

```text
new_dcs/docs/existing-system-analysis.md
```

The document should explain the existing system sufficiently for another engineer to understand the current architecture without changing it.

---

# 4. New DCS Directory Boundary

All New DCS-specific implementation should live under:

```text
new_dcs/
```

Recommended structure:

```text
new_dcs/
├── docs/
│   ├── existing-system-analysis.md
│   ├── architecture.md
│   ├── dispatch-algorithm.md
│   └── test-strategy.md
│
├── domain/
│   ├── Elevator
│   ├── Floor
│   ├── Passenger
│   ├── DestinationRequest
│   ├── ElevatorState
│   └── MaintenanceState
│
├── dispatch/
│   ├── DispatchEngine
│   ├── ElevatorScorer
│   ├── ETAEstimator
│   ├── CandidateSelector
│   └── DestinationGrouping
│
├── simulation/
│   ├── SimulationEngine
│   ├── SimulationClock
│   └── SimulationState
│
├── maintenance/
│   └── MaintenanceManager
│
├── ui/
│   └── ...
│
└── tests/
    ├── unit/
    ├── integration/
    ├── scenario/
    └── regression/
```

The exact directory structure may be adapted to the existing project's technology and conventions.

However, the **logical separation MUST remain**.

---

# 5. New DCS System Configuration

New DCS MUST use the following defaults:

```text
Number of floors        = 15
Number of elevators     = 6
Elevator capacity       = 10 persons
Ground floor            = 1
Top floor               = 15
```

Elevators should be uniquely identified:

```text
E1
E2
E3
E4
E5
E6
```

Floors:

```text
F1 ... F15
```

---

# 6. Elevator State Model

Each elevator MUST maintain at least:

```text
id
currentFloor
direction
occupancy
capacity
state
doorState
assignedRequests
targetFloors
maintenanceStatus
estimatedAvailabilityTime
```

### Elevator states

At minimum:

```text
IDLE
MOVING_UP
MOVING_DOWN
DOOR_OPEN
DOOR_CLOSING
MAINTENANCE
OUT_OF_SERVICE
```

The implementation may use a richer state machine.

---

# 7. Maintenance Requirement

The system MUST support taking any elevator out of service.

Example:

```text
E3 → MAINTENANCE
```

When an elevator is under maintenance:

* it MUST NOT receive new requests
* it MUST NOT be considered during dispatch scoring
* UI MUST clearly indicate its status
* existing requests assigned to that elevator MUST be handled according to the defined maintenance policy
* remaining operational elevators MUST continue serving passengers

Recommended policy:

### If maintenance starts while elevator is idle

Immediately:

```text
E3 = MAINTENANCE
```

No new requests are assigned.

### If maintenance starts while elevator is moving

The system should support a controlled transition:

```text
ACTIVE
   ↓
MAINTENANCE_PENDING
   ↓
complete safe current movement
   ↓
MAINTENANCE
```

The exact behaviour should be deterministic in simulation.

### If maintenance starts with passengers onboard

The system MUST NOT strand passengers.

The preferred simulation behaviour is:

1. complete the current safe trip
2. unload passengers at the next appropriate stop
3. mark elevator unavailable
4. reassign outstanding requests if applicable

---

# 8. Destination Control System

New DCS MUST use **destination-based passenger requests**.

The passenger should NOT simply press:

```text
UP
DOWN
```

and then select the destination inside the elevator.

Instead, the passenger enters/selects:

```text
Current Floor: F3
Destination: F12
```

The system then determines:

```text
Recommended Elevator: E4
```

The UI MUST communicate this assignment clearly.

Example:

```text
You are at Floor 3

Where would you like to go?

[ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ]
[ 6 ] [ 7 ] [ 8 ] [ 9 ] [10 ]
[11 ] [12 ] [13 ] [14 ] [15 ]

--------------------------------

Destination: Floor 12

Assigned Elevator: E4

Estimated arrival: 8 seconds
```

---

# 9. Passenger Request Model

Each request MUST contain:

```text
requestId
originFloor
destinationFloor
requestTime
passengerCount
status
assignedElevator
estimatedWaitTime
estimatedTravelTime
```

Passenger count MUST be supported because capacity is 10.

Example:

```text
Request:
origin = F2
destination = F13
passengers = 4
```

---

# 10. Invalid Requests

The system MUST reject:

```text
origin == destination
origin < 1
origin > 15
destination < 1
destination > 15
passengerCount <= 0
passengerCount > 10
```

The UI should display an appropriate validation message.

---

# 11. Dispatching Architecture

The dispatch system MUST be centralized logically around a:

```text
DispatchEngine
```

The flow should be:

```text
Passenger Request
        |
        v
Request Validation
        |
        v
Candidate Elevator Selection
        |
        v
ETA Calculation
        |
        v
Destination Compatibility Analysis
        |
        v
Capacity Analysis
        |
        v
Dispatch Scoring
        |
        v
Best Eligible Elevator
        |
        v
Assignment
```

---

# 12. Elevator Eligibility

An elevator is eligible only if all applicable conditions are satisfied.

An elevator MUST NOT be selected if:

```text
maintenanceStatus = MAINTENANCE
OR
state = OUT_OF_SERVICE
OR
capacityRemaining < requestedPassengerCount
```

Additional configurable constraints may be introduced.

---

# 13. Dispatch Algorithm

The new system should implement a **deterministic multi-factor dispatch algorithm inspired by modern destination-control / elevator-group-control principles**.

The goal is not simply:

> "Choose the nearest elevator."

Instead, the algorithm must consider the **incremental cost of assigning the request to each candidate elevator**.

This is important because an elevator that is physically closest may already have several stops and therefore may not actually be the fastest option.

---

# 14. Candidate Scoring

For every eligible elevator, calculate:

```text
Score =
    W_wait       * EstimatedWaitingTime
  + W_stops      * AdditionalStops
  + W_distance   * TravelDistance
  + W_load       * LoadPenalty
  + W_direction  * DirectionPenalty
  + W_occupancy  * OccupancyPenalty
  + W_imbalance  * LoadBalancingPenalty
```

Lower score is better.

Weights MUST be configurable.

Example initial configuration:

```text
W_wait       = 10.0
W_stops      = 8.0
W_distance   = 2.0
W_load       = 5.0
W_direction  = 4.0
W_occupancy  = 3.0
W_imbalance  = 2.0
```

These are initial simulation values, not hard-coded truths. They should be configurable and tuned using simulation results.

---

# 15. ETA Calculation

ETA MUST NOT be calculated merely as:

```text
abs(currentFloor - originFloor)
```

It must consider:

* current elevator floor
* direction
* existing destination stops
* current occupancy
* pending requests
* doors/open-close time
* requested destination
* other assigned passengers
* whether the elevator can serve the new request efficiently

Example:

```text
E1:
current floor = 3
direction = UP
existing stops = [6, 10, 14]

New request:
origin = 8
destination = 13
```

The algorithm should estimate the additional time required to incorporate:

```text
F8 → F13
```

rather than treating E1 as simply 5 floors away.

---

# 16. Destination Grouping

The system SHOULD group compatible destinations where beneficial.

Example:

```text
Passenger A:
F1 → F10

Passenger B:
F1 → F10

Passenger C:
F1 → F11
```

The dispatch engine should recognize that one elevator can efficiently serve these passengers.

Similarly:

```text
Passenger A:
F1 → F8

Passenger B:
F1 → F12
```

may be compatible in the same upward trip.

However, grouping MUST NOT cause excessive waiting for already-assigned passengers.

---

# 17. Incremental Cost Principle

When evaluating an elevator, calculate:

```text
Cost(existing route + new request)
-
Cost(existing route)
```

rather than simply:

```text
distance to passenger
```

This allows the system to understand the actual impact of inserting a new passenger into an elevator's route.

---

# 18. Route Planning

Each elevator should maintain an ordered set of destination stops.

The route planner should consider:

* direction
* existing stops
* new origin
* passenger destination
* compatible destination grouping
* route completion time

The system MUST avoid unnecessary direction reversals.

For example:

```text
Current floor: 5
Direction: UP
Stops: 7, 9, 12
```

A new request:

```text
Origin: 8
Destination: 11
```

should preferably be integrated into the current upward journey rather than creating a premature reversal.

---

# 19. Tie Breaking

If two elevators have equivalent scores within a configurable tolerance, tie-break deterministically using:

1. lower ETA
2. fewer expected stops
3. lower occupancy
4. fewer assigned passengers
5. lower elevator ID

This ensures reproducible simulation results.

---

# 20. Preventing Starvation

A request MUST NOT remain indefinitely unserved because the algorithm continually chooses other requests.

Each request should track:

```text
waitingTime
```

The dispatch score should incorporate a starvation-prevention factor.

For example:

```text
StarvationPenalty =
    max(0, waitingTime - threshold)
    * starvationWeight
```

As waiting time increases, the request becomes progressively harder to ignore.

---

# 21. Long-Wait Protection

Define:

```text
LONG_WAIT_THRESHOLD
```

Example:

```text
LONG_WAIT_THRESHOLD = 30 seconds
```

If a request exceeds this threshold, the dispatch engine MUST increase its priority.

The threshold MUST be configurable.

The system should expose:

```text
average waiting time
maximum waiting time
95th percentile waiting time
long-wait request count
```

---

# 22. Load Balancing

The dispatch system should avoid repeatedly assigning every request to the same elevator when another elevator can provide comparable service.

The controller should therefore consider:

```text
current occupancy
number of assigned passengers
estimated route workload
```

This is a secondary consideration.

Waiting time and service quality MUST remain more important than simplistic equal distribution.

---

# 23. Traffic Awareness

The architecture should support traffic patterns:

```text
NORMAL
UP_PEAK
DOWN_PEAK
INTER_FLOOR
RANDOM
```

The first implementation does not need machine learning.

However, the dispatch engine should expose a strategy interface such as:

```text
DispatchStrategy
```

so that future implementations can include:

```text
HeuristicDispatchStrategy
TrafficAwareDispatchStrategy
RLDispatchStrategy
```

Recent elevator-control research increasingly explores traffic-aware deep reinforcement learning and hybrid RL approaches, so this separation provides a useful future extension without unnecessarily introducing ML into the first deterministic implementation.

---

# 24. Reinforcement Learning — Explicit Scope

Do NOT introduce reinforcement learning merely to make the system appear "AI powered."

The first implementation MUST have:

* deterministic behaviour
* explainable assignment
* reproducible tests
* predictable performance
* inspectable scoring

The architecture MAY provide an extension point for an RL-based strategy later.

A future implementation could compare:

```text
Rule-based EGCS
vs
Traffic-aware D3QN
vs
Hybrid imitation learning + PPO
```

without changing the simulation domain model.

---

# 25. Simulation Engine

The simulation MUST be deterministic when supplied with the same:

```text
random seed
initial state
passenger request sequence
configuration
```

The simulation should maintain a simulation clock.

Example:

```text
T=0
T=1
T=2
...
```

Elevator movement should progress through simulation time rather than relying entirely on real wall-clock timing.

---

# 26. Simulation Controls

The UI should provide:

```text
Start
Pause
Resume
Reset
Step
```

Optional:

```text
Simulation Speed
1x
2x
5x
10x
```

---

# 27. Building Visualization

The simulation UI should display all 15 floors.

Example conceptual representation:

```text
F15 ─── E1   E2   E3   E4   E5   E6
F14
F13
F12
F11
F10
F9
F8
F7
F6
F5
F4
F3
F2
F1 ─── Lobby
```

Each elevator should visibly indicate:

```text
Elevator ID
Current Floor
Direction
Occupancy
Capacity
Status
Assigned destination
```

---

# 28. Passenger Interaction

The user selects:

```text
Current floor
Destination floor
Number of passengers
```

Then presses:

```text
REQUEST ELEVATOR
```

The system displays:

```text
Request ID: R102

From: Floor 4
To: Floor 13
Passengers: 3

Assigned Elevator: E5
Estimated Arrival: 6 sec
Estimated Journey: 15 sec
```

---

# 29. Assignment Explanation

For transparency, the system SHOULD provide an optional explanation.

Example:

```text
E5 selected because:

ETA: 6 sec
Current occupancy: 4/10
Additional stops: 1
Direction: UP
Destination compatibility: HIGH
Maintenance: AVAILABLE
```

This is particularly valuable for validating the routing algorithm.

---

# 30. Maintenance UI

The simulation should provide controls such as:

```text
E1 [Available]
E2 [Available]
E3 [Maintenance]
E4 [Available]
E5 [Available]
E6 [Available]
```

User should be able to:

```text
Set Maintenance
Restore Elevator
```

The assignment engine must immediately respect the state.

---

# 31. Multiple Elevator Failures

The system MUST support:

```text
1 elevator unavailable
2 elevators unavailable
3 elevators unavailable
```

The simulation should continue operating if at least one elevator remains available.

If no elevator can currently serve a request:

```text
No elevator currently available.

Request queued.
```

The request must remain pending and be automatically reconsidered when an elevator becomes available.

---

# 32. Capacity Handling

Each elevator has:

```text
capacity = 10
```

If:

```text
current occupancy = 8
new request = 3
```

that elevator MUST NOT be assigned.

The system should consider the number of passengers associated with a request, not simply request count.

---

# 33. Capacity and Destination Grouping

The system should distinguish:

```text
10 passengers
```

from:

```text
10 requests
```

Capacity is measured in passengers.

Example:

```text
E1 occupancy = 8

Request A = 1 passenger
Request B = 2 passengers
```

E1 may accept A but not B if both are evaluated independently at the same point in time.

---

# 34. Request Lifecycle

Every request MUST follow a defined lifecycle:

```text
CREATED
   ↓
VALIDATED
   ↓
QUEUED
   ↓
ASSIGNED
   ↓
PASSENGER_WAITING
   ↓
PICKED_UP
   ↓
IN_TRANSIT
   ↓
DELIVERED
```

Possible alternate states:

```text
CANCELLED
REASSIGNED
WAITING_FOR_CAPACITY
WAITING_FOR_AVAILABLE_ELEVATOR
```

---

# 35. Reassignment

A request may need reassignment when:

* elevator enters maintenance
* elevator becomes unavailable
* capacity changes
* system detects assignment is no longer valid

Reassignment MUST NOT create duplicate passenger journeys.

The request should have a single authoritative state.

---

# 36. Metrics

The simulation MUST collect at least:

### Passenger metrics

```text
Average Waiting Time
Maximum Waiting Time
95th Percentile Waiting Time
Average Journey Time
Maximum Journey Time
Total Completed Requests
Total Pending Requests
Long-Wait Requests
```

### Elevator metrics

```text
Utilization per elevator
Average occupancy
Maximum occupancy
Total distance travelled
Number of stops
Number of direction changes
Maintenance duration
```

### System metrics

```text
Total requests
Requests served
Requests pending
Requests reassigned
Average system utilization
Throughput
```

---

# 37. Algorithm Comparison Mode

The architecture SHOULD allow comparing different dispatch strategies.

For example:

```text
Nearest Elevator
Basic Collective Control
Weighted Heuristic DCS
Traffic-Aware DCS
Future RL Strategy
```

The simulation should be able to execute the same request dataset against different strategies.

This will make the project much more valuable as an engineering/AI project because the routing algorithm can be evaluated empirically rather than merely demonstrated.

---

# 38. Scenario Generator

Implement a deterministic scenario generator capable of producing:

### Scenario A — Random

Random origin/destination pairs.

### Scenario B — Up Peak

Many passengers:

```text
F1 → upper floors
```

### Scenario C — Down Peak

Many passengers:

```text
upper floors → F1
```

### Scenario D — Inter-floor

Requests distributed between:

```text
F2 → F8
F4 → F12
F10 → F3
...
```

### Scenario E — Heavy Load

Large passenger groups.

### Scenario F — Elevator Failure

One elevator unavailable.

### Scenario G — Multiple Failures

Two or more unavailable.

### Scenario H — Burst Traffic

Many requests arriving within a short simulation interval.

### Scenario I — Long-Wait Stress

Construct requests designed to test starvation prevention.

### Scenario J — Mixed Traffic

Combination of:

```text
up-peak
down-peak
inter-floor
random
```

---

# 39. Comprehensive Test Strategy

Testing MUST happen at four levels:

```text
Unit
Integration
Scenario
Regression
```

---

# 40. Unit Tests — Domain

Test:

1. Elevator initializes at correct floor.
2. Elevator capacity is 10.
3. Floor range is 1–15.
4. Invalid floor is rejected.
5. Same origin/destination is rejected.
6. Passenger count 1 is valid.
7. Passenger count 10 is valid.
8. Passenger count 11 is rejected.
9. Occupancy cannot exceed capacity.
10. Elevator state transitions are valid.
11. Maintenance state is represented correctly.
12. Elevator IDs are unique.

---

# 41. Unit Tests — Eligibility

Test:

1. Available elevator is eligible.
2. Maintenance elevator is ineligible.
3. Out-of-service elevator is ineligible.
4. Full elevator is ineligible.
5. Elevator with sufficient remaining capacity is eligible.
6. Restored elevator becomes eligible.
7. No eligible elevator produces a queued request.

---

# 42. Unit Tests — ETA

Test:

1. Idle elevator directly below origin.
2. Idle elevator directly above origin.
3. Elevator moving toward origin.
4. Elevator moving away from origin.
5. Elevator with existing stops.
6. Elevator with multiple stops.
7. Elevator requiring direction reversal.
8. Elevator with compatible destination.
9. Elevator with incompatible route.
10. ETA remains deterministic.

---

# 43. Unit Tests — Dispatch Scoring

For each candidate elevator verify:

```text
wait time
distance
direction
occupancy
additional stops
destination compatibility
workload
```

Test that changing each variable changes the score appropriately.

Also verify that:

```text
maintenance elevator can never win
```

even if it is physically closest.

---

# 44. Unit Tests — Tie Breaking

Create equal-score candidates.

Verify deterministic ordering:

```text
ETA
→ stops
→ occupancy
→ workload
→ elevator ID
```

---

# 45. Unit Tests — Starvation

Create a request that waits while new requests continuously arrive.

Verify:

```text
waiting request eventually receives priority
```

The test MUST guarantee termination.

---

# 46. Maintenance Tests

### Test M1

Take idle E3 out of service.

Expected:

```text
E3 receives zero new assignments.
```

### Test M2

Take E3 out of service while moving.

Expected:

```text
E3 completes defined safe transition.
```

### Test M3

Restore E3.

Expected:

```text
E3 becomes eligible for new requests.
```

### Test M4

Take two elevators out.

Expected:

```text
remaining four continue serving requests.
```

### Test M5

Take five elevators out.

Expected:

```text
one elevator serves requests.
```

### Test M6

Take all six out.

Expected:

```text
new requests remain queued.
```

### Test M7

Restore one elevator.

Expected:

```text
queued requests are reconsidered.
```

---

# 47. Capacity Tests

Test:

```text
1 passenger
5 passengers
9 passengers
10 passengers
11 passengers
```

Verify correct behaviour.

Also test:

```text
E1 = 9/10
Request = 1
```

Expected:

```text
eligible
```

and:

```text
E1 = 9/10
Request = 2
```

Expected:

```text
ineligible
```

---

# 48. Destination Grouping Tests

Test:

```text
F1 → F10
F1 → F10
F1 → F11
```

Verify compatible passengers can share an elevator.

Test incompatible routes:

```text
F1 → F10
F1 → F2
```

and ensure grouping does not create an unreasonable route.

---

# 49. Routing Tests

Test:

```text
E1 at F1
Request F1 → F15
```

Expected:

```text
E1 route = F1 → F15
```

Test:

```text
E1 at F5
Request F5 → F12
```

Test:

```text
E1 at F8
Request F3 → F12
```

Test multiple simultaneous requests.

Test route insertion.

Test direction reversal.

Test duplicate destinations.

---

# 50. Regression Test — Existing System

The original project MUST be tested before and after New DCS implementation.

Required invariant:

```text
Existing tests BEFORE New DCS
==
Existing tests AFTER New DCS
```

No existing behaviour may change.

---

# 51. Golden Scenario Tests

Create fixed scenarios with deterministic expected results.

Example:

```text
Initial:
E1 = F1
E2 = F5
E3 = F8
E4 = F10
E5 = F12
E6 = F15

Request:
F7 → F14
```

Store the expected assignment.

Then verify the implementation consistently produces the expected result.

Golden tests should be used for important routing cases.

---

# 52. Property-Based Tests

Where supported, add property tests such as:

### Property 1

No passenger may be transported outside:

```text
F1...F15
```

### Property 2

No elevator may exceed:

```text
10 passengers
```

### Property 3

Maintenance elevators receive:

```text
0 new assignments
```

### Property 4

Every completed request satisfies:

```text
actual destination == requested destination
```

### Property 5

Every passenger belongs to exactly one elevator journey at any moment.

### Property 6

No request is simultaneously:

```text
ASSIGNED
AND
QUEUED
```

### Property 7

Same input + same seed = same output.

---

# 53. Concurrency / Burst Tests

Generate:

```text
100 requests
```

over a short simulation period.

Verify:

* no duplicate request IDs
* no lost requests
* no capacity violation
* no invalid elevator assignments
* no deadlocks
* no infinite queues
* deterministic results with same seed

---

# 54. Stress Test

Run:

```text
1000+
```

requests through the simulation.

Measure:

```text
average wait
95th percentile wait
maximum wait
throughput
elevator utilization
```

The simulation MUST remain stable.

---

# 55. Failure Recovery Tests

Simulate:

```text
E1 maintenance
E2 maintenance
E3 overloaded
```

while traffic is active.

Verify that:

```text
E4/E5/E6
```

continue operating.

Then restore:

```text
E1
```

and verify that it is gradually incorporated into dispatching.

---

# 56. UI Tests

Verify:

1. All 15 floors visible.
2. All 6 elevators visible.
3. Elevator current floor updates.
4. Elevator direction updates.
5. Occupancy updates.
6. Maintenance status visible.
7. Destination can be selected.
8. Invalid destination rejected.
9. Assigned elevator displayed.
10. ETA displayed.
11. Pending requests visible.
12. Simulation pause works.
13. Simulation reset works.
14. Maintenance toggle works.
15. Elevator restoration works.

---

# 57. Explainability Tests

For every assignment:

```text
Assigned elevator MUST have an explainable score.
```

Example:

```text
E4 selected

ETA                = 5 sec
Additional stops   = 1
Occupancy          = 4/10
Direction          = UP
Destination match  = HIGH
Maintenance        = NO

Final score        = 71.4
```

The exact UI presentation may differ, but the underlying explanation should be available for debugging/tests.

---

# 58. Performance Requirements

The dispatch engine should calculate assignment for all six elevators within:

```text
< 100 ms
```

under normal simulation conditions.

For stress testing, measure:

```text
p50 dispatch time
p95 dispatch time
p99 dispatch time
```

Do not optimize prematurely.

Correctness and deterministic behaviour have priority over micro-optimization.

---

# 59. Configuration

Avoid hard-coding:

```text
6 elevators
15 floors
10 capacity
weights
thresholds
movement speed
door timing
```

Use configuration.

Example:

```yaml
building:
  floors: 15

elevators:
  count: 6
  capacity: 10

dispatch:
  strategy: weighted-dcs

  weights:
    waitTime: 10
    additionalStops: 8
    distance: 2
    load: 5
    direction: 4
    occupancy: 3
    imbalance: 2

  longWaitThresholdSeconds: 30
```

The actual configuration mechanism MUST follow the existing project's technology conventions.

---

# 60. Architectural Principles

The implementation MUST follow:

### Separation of concerns

```text
UI
 ↓
Application/Simulation
 ↓
Dispatch
 ↓
Domain
```

The UI must not contain dispatch logic.

The dispatch engine must not depend on UI components.

---

# 61. Strategy Pattern

Dispatch should be abstracted.

Conceptually:

```text
DispatchStrategy
       |
       +-- WeightedDCSStrategy
       |
       +-- SimpleNearestStrategy
       |
       +-- FutureTrafficAwareStrategy
       |
       +-- FutureRLStrategy
```

This allows algorithm experiments without rewriting the simulation.

---

# 62. No Hidden Global State

New DCS MUST avoid global mutable state.

Simulation state should be owned by:

```text
SimulationEngine
```

and passed explicitly where appropriate.

This is important for:

* testing
* deterministic replay
* parallel simulations
* algorithm comparison

---

# 63. Replay Capability

The system SHOULD support recording:

```text
random seed
configuration
request sequence
maintenance events
```

so that a scenario can be replayed.

Example:

```text
Scenario ID: SC-1029
Seed: 12345
```

A developer should be able to reproduce a routing decision exactly.

---

# 64. Algorithm Benchmarking

Create a benchmark mode:

```text
Scenario
    |
    +--> Strategy A
    |
    +--> Strategy B
    |
    +--> Strategy C
```

Compare:

```text
Average Waiting Time
95th Percentile Waiting Time
Maximum Waiting Time
Average Journey Time
Long Wait %
Throughput
Energy proxy
Elevator utilization
```

This should become an important capability of the project.

---

# 65. Definition of Done

New DCS is considered complete only when:

### Architecture

* Existing system has been analyzed.
* Existing system remains untouched functionally.
* New DCS is isolated under `new_dcs`.
* Architecture documentation exists.

### Functionality

* 15 floors implemented.
* 6 elevators implemented.
* Capacity = 10.
* Destination selection works.
* Automatic elevator assignment works.
* Maintenance mode works.
* Elevator restoration works.
* Requests can be queued.
* Requests can be reassigned.
* Multiple simultaneous requests work.

### Routing

* Multi-factor dispatch implemented.
* ETA calculation implemented.
* Destination compatibility implemented.
* Capacity considered.
* Direction considered.
* Existing stops considered.
* Starvation protection implemented.
* Deterministic tie-breaking implemented.

### Testing

* Unit tests pass.
* Integration tests pass.
* Scenario tests pass.
* Maintenance tests pass.
* Capacity tests pass.
* Stress tests pass.
* Regression tests pass.

### Observability

* Assignment explanation available.
* Simulation metrics available.
* Scenario replay available or documented as a future enhancement.

---

# 66. Required Implementation Sequence

The coding agent MUST follow this sequence.

## Phase 1 — Discovery

Do NOT write implementation code yet.

Inspect the existing project.

Produce:

```text
existing-system-analysis.md
```

Run existing tests.

---

## Phase 2 — New Domain

Create:

```text
new_dcs/domain
```

Implement:

* Elevator
* Floor
* Passenger
* Request
* ElevatorState
* MaintenanceState

Add unit tests.

---

## Phase 3 — Simulation

Implement:

```text
SimulationEngine
SimulationClock
SimulationState
```

Create 6 elevators and 15 floors.

Add tests.

---

## Phase 4 — Basic Dispatch

Implement:

```text
DispatchStrategy
WeightedDCSStrategy
```

Implement eligibility and scoring.

Add unit tests.

---

## Phase 5 — Route Optimization

Implement:

* ETA
* existing-stop awareness
* destination grouping
* incremental route cost
* direction awareness

Add routing tests.

---

## Phase 6 — Maintenance

Implement:

```text
MaintenanceManager
```

Add failure/recovery scenarios.

---

## Phase 7 — UI

Implement:

* 15-floor building
* 6 elevators
* destination selection
* assignment display
* ETA
* maintenance controls
* simulation controls

---

## Phase 8 — Metrics

Add:

* wait time
* journey time
* utilization
* throughput
* long waits
* elevator workload

---

## Phase 9 — Scenario Testing

Implement all defined scenarios.

---

## Phase 10 — Regression

Run the complete existing project test suite.

Run New DCS tests.

Confirm that existing functionality is unchanged.

---

# 67. Final Acceptance Scenario

The following scenario MUST work end-to-end.

Initial state:

```text
15 floors
6 elevators
10-person capacity
all elevators available
```

Generate:

```text
20 simultaneous passenger requests
```

Then:

```text
E2 → maintenance
E5 → maintenance
```

Generate another:

```text
50 requests
```

The system MUST:

1. Reject E2/E5 as candidates.
2. Continue operating using E1/E3/E4/E6.
3. Respect capacity.
4. Assign passengers based on destination-aware dispatch.
5. Queue requests if no suitable elevator is currently available.
6. Prevent starvation.
7. Reassign requests if required.
8. Restore E2.
9. Reintroduce E2 into dispatching.
10. Complete all feasible requests.
11. Never exceed elevator capacity.
12. Never assign a maintenance elevator.
13. Produce deterministic results when replayed with the same seed.

---

# 68. Engineering Principle

The implementation should optimize for:

```text
Correctness
    >
Explainability
    >
Determinism
    >
Testability
    >
Performance
```

The goal is not merely to create a bigger elevator animation.

The goal is to create a **small but realistic Elevator Group Control System** that can demonstrate:

```text
Domain modelling
        +
Simulation
        +
Optimization
        +
Destination Control
        +
Fault handling
        +
Algorithmic decision making
        +
Observability
        +
Comprehensive testing
```

This should remain a deterministic, explainable system initially while providing a clean architecture for future traffic prediction and reinforcement-learning experiments.
