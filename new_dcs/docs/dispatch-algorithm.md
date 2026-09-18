# Smart Lift — new_dcs Dispatch Algorithm

Implementation notes for `Spec/phase-3-newdcs.md` §11–§23 (candidate
selection, ETA, scoring, tie-breaking, starvation, grouping) and §48–§49.
The engine is deterministic and explainable by construction.

## Pipeline

```
request → validate (§10) → evaluate all eligible elevators
  → candidate routes (insert origin+dest)
  → score candidates (weighted sum + starvation)
  → pick minimum, tie-break lexicographically (§19)
  → commit assignment (route, seat reservation, estimates)
```

## Eligibility (§12)

```text
ACTIVE maintenance status  AND  state ≠ OUT_OF_SERVICE  AND  capacityRemaining ≥ passengerCount
```

`capacityRemaining = capacity - occupancy - assignedPassengerCount`
(`domain/elevator.js`). Reservation means a full bus (10 assigned) makes the
car ineligible even for a single passenger, while a car that has exactly one
seat left is still eligible for a 1-passenger request (test 47.2).

## Candidate route insertion (§18, `dispatch/eta.js`)

For an elevator with committed stops `targetFloors`, every ordered position of
`(origin, dest)` is generated with pickup-before-drop, then adjacent duplicate
floors are collapsed (so a request whose origin and dest are already scheduled
adds zero stops — test 43.2).

Mid-run cars (MOVING_UP / MOVING_DOWN) may not insert before the committed
first stop — previously assigned passengers are never reordered mid-leg —
with one exception: an **en-route** origin that lies strictly between the
current floor and the first committed stop is a forward pickup and is allowed
(tests 42.3). Inserting behind the car forces a live reversal, which the
scorer charges for and the grouping check classifies as LOW (tests 42.4).

Candidates are sorted deterministically by `(reversals, ETA, total time)`.

## ETA & travel time (§15)

```text
doorCycle = doorOpenTicks + doorCloseTicks          # 2 + 1 = 3
eta = Σ |floor_i₋₁ - floor_i|  +  doorCycle for every stop BEFORE the pickup
totalTime = Σ travel  +  doorCycle for every stop except the final one
reversals = number of direction flips after take-off
```

ETA includes the dwell at earlier stops — a car that must first serve F6 then
F8 to reach a pickup at F8 pays 3 s at F6 before opening at F8 (test 42.5).

## Scoring (§14, `dispatch/scorer.js`)

```text
score = W_wait·ETA
      + W_stops·addedStops
      + W_distance·addedTravelDistance
      + W_load·(passengerCount / capacity)
      + W_direction·directionPenalty          # 1 if reversals increased
      + W_occupancy·(projectedOccupancy / capacity)
      + W_imbalance·|projectedOccupancyFraction − fleetAverage|
      + starvationPenalty                       # additive, §20
```

Default weights (`config/default-config.js`):

| term          | weight |
|---------------|--------|
| waitTime      | 10     |
| additionalStops | 8    |
| distance      | 2      |
| load          | 5      |
| direction     | 4      |
| occupancy     | 3      |
| imbalance     | 2      |

Lower is better. Direction penalty is binary (0/1): whether serving the
request increases the number of route reversals. Occupancy uses the
**projected** occupancy (current + this request), and the imbalance term
compares against the mean occupancy fraction of the eligible fleet (test
43.5), so demand flows toward the least loaded cars.

## Starvation protection (§20)

A request whose wait exceeds `longWaitThresholdSeconds` (30) accrues an
additive `(wait − threshold) · starvationWeight` (2.0) on every evaluation, so
ignored requests become progressively more expensive to the whole fleet (test
45.1). Waiting time is measured in sim ticks and accrues only while the
request is not picked up (and not terminal).

## Tie-breaking (§19, `dispatch/strategy.js`)

Candidates with a score difference within `tieTolerance` (0.0001) are equal;
the deterministic winner chain is:

```text
lower ETA  →  fewer expected stops (route length)  →  lower occupancy
           →  fewer assigned passengers            →  lower elevator id
```

This guarantees a stable answer even when every car ties (tests 44.1/44.2).

## Destination grouping (§16, `dispatch/grouping.js`)

Compatibility is HIGH when inserting (origin, dest) does not increase the
route's direction-reversal count; otherwise LOW. The planning consequence is
that F1→F10 + F1→F11 share one upward car (tests 48.x) while demand that
forces a car to reverse mid-route is detected and treated as LOW.

## Explainability (§29/§57)

Every assignment carries `assignmentExplanation` — one line per factor:

```text
ETA: 0 sec | Additional stops: 2 | Occupancy: 0/10 |
Direction: compatible | Destination compatibility: HIGH |
Maintenance: AVAILABLE | Final score: 45.00
```

## Determinism (§52)

- No randomness; requests are processed FIFO; candidates and scores are sorted
  with explicit comparators everywhere.
- All scoring is a pure function of `(elevator, request, candidate, context)`.
- The engine owns no hidden state; identical inputs give identical event
  traces (test 52.1).