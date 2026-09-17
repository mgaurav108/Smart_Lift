# Phase 2 - Destination Control System (DCS) Simulation

> Sub-spec for the DCS ("Destination Dispatch") upgrade of the Smart Lift
> project. **Baseline:** Phase 1 (tag `phase_1`, see `Spec/phase1-simulation.md`).
> The DCS sim lives in `simulation/dcs/` and reuses the Phase 1 building/lift
> model (6 floors, 4 lifts, 1 floor per tick, maintenance).

## 1. Concept

A Destination Control System asks the passenger for their **destination
before boarding**, at a lobby kiosk. A **group controller** then assigns the
passenger to a specific lift ("Take Lift C") and **batches passengers with
compatible trips** into the same car to minimise stops and travel time.

Compared to Phase 1 (call a lift -> board -> *then* pick a destination inside
the car):

| Phase 1 | Phase 2 (DCS) |
|---|---|
| Destination chosen inside the car, after boarding | Destination entered at the kiosk, **before** boarding |
| Any idle lift at a floor can be boarded | Only the **assigned** lift can be boarded |
| One active request per lift (FIFO queue) | Each lift carries an **ordered stop list** mixing pickups and drop-offs |
| Dispatch minimises pickup distance | Assignment minimises **added travel time + stops for the whole group** |
| Single interactive user | Multiple passengers register at kiosks concurrently (grouping visible) |

## 2. Building & Lift Model

| Concept | Rule |
|---|---|
| Floors | 6 floors, 1 (ground) to 6 (top). |
| Lifts | 4 lifts (`A`, `B`, `C`, `D`), one per shaft. |
| Movement | One floor per tick; direction `UP` / `DOWN` / `IDLE`. |
| Stop list | Every lift has an ordered `stops` plan: each entry is a pickup or a drop-off floor. |
| Doors | On reaching a stop the lift opens its doors for `DOOR_TICKS` ticks, only then moves on. |
| Capacity | `capacity` = max number of passengers (aboard + waiting) a lift may be assigned. |
| Maintenance | Lifts under maintenance are excluded from assignment and boarding (Phase 1 rule). |

### Passenger lifecycle

1. **unassigned** — standing at a kiosk on `floor`. 
2. **assigned** — registered a destination; the controller picked `liftId`
   and added pickup + drop-off to that lift's stop list. Waiting to board.
3. **aboard** — boarded the assigned lift; travels to destination.
4. **done** — auto-unboards when the lift stops at the destination → `unassigned` again.
5. **no-show** — assigned lift's doors closed before the passenger boarded →
   assignment cancelled → `unassigned` again (may re-register).

## 3. Functional Requirements

### FR-D1: Register a destination (kiosk)
- The passenger is at some floor `pf` and selects a destination `df != pf`.
- The controller returns the **assigned lift**, the **pickup ETA** (ticks until
  the lift reaches their floor) and the lift's **planned stops**.
Basic rule (identical to Phase 1): the lift must not be under maintenance.

### FR-D2: Grouping allocator
- For every candidate lift, score the cost of inserting `pf` (pickup) and
  `df` (drop-off) into its stop list **with pickup ordered before drop-off**.
- Added cost = (ticks to execute the new stop list) - (ticks for the old one)
  computed from the lift's current floor.
- Pick the lift with the **lowest extra direction reversals**, then the
  **lowest pickup ETA** (a closer/available lift takes the passenger sooner),
  then the **smallest added cost**; tie-break by fewer extra stops, then fewer
  total stops, then lowest lift id.
- A side effect of this scoring: passengers in the same direction with close
  destinations naturally group into one car; opposite-direction trips split
  across cars (avoids a car chasing requests in both directions), and a
  passenger standing at a floor an idle lift already serves is picked up by
  that lift instead of one driving across the building.

### FR-D3: Capacity & maintenance guards
- A lift at `capacity` (aboard + assigned) is not a candidate.
- A maintenance lift is never a candidate and can never be boarded.
- If no lift can take the request, registration fails with an error.

### FR-D4: Board the assigned lift
- The passenger may board **only** the assigned lift, **only** when it is at
  their floor with **doors open**.
- Boarding any other lift, or the assigned lift before it arrives, is rejected.

### FR-D5: Tour execution (tick)
- Idle lift with stops: starts moving toward `stops[0]` one floor per tick.
- On reaching a stop the lift shifts it off, opens its doors for
  `DOOR_TICKS` ticks, and unboards any aboard passenger whose destination
  equals that floor.
- After the doors close it moves to the next stop (if any) and finally idles.

### FR-D6: No-show & re-registration
- When a lift's doors close, any passenger still assigned (waiting) at that
  floor is unassigned (`no_show`), freeing a seat.
- An unassigned passenger can register again at any time.

### FR-D7: Validation
- Destination == current floor → error `Already at floor N`.
- Unknown passenger, unknown floor (outside 1-6), boarding without being
  assigned, or registering while already assigned → error.

## 4. UI (simulation/dcs/)

- **Kiosk panel**: for the active passenger — current floor selector,
  destination buttons, live ticket ("Take Lift **C** · pickup ETA ~3 ticks ·
  stops: 1, 4, 5"), Board button when the assigned lift's doors open.
- **Auto-board**: when an assigned lift arrives with doors open, every
  passenger assigned from that floor boards immediately — register a
  destination and the passenger rides without manual-timing clicks.
- **Multiple passengers**: "+ Add passenger" creates a new one; a selector
  switches which passenger the panel controls, so grouping across passengers
  is visible.
- **Lift readout**: floor, direction, next stops, assigned/waiting count,
  aboard count, doors state, capacity, maintenance toggle.
- Right column: **tickets** for all assigned passengers; event log.

## 5. Acceptance Criteria

- **AC-D1** Initial state: 4 lifts with `stops`, `doorsOpen`, `capacity` fields;
  no passengers; all lifts idle.
- **AC-D2** Registration: passenger at floor 1 → destination 4 (all lifts
  parked at 1) → assigned lift A (id 0); A's stops become `[1, 4]` order;
  pickup ETA 0; passenger state `assigned`.
- **AC-D3** Same-direction grouping: passenger 1→4 then person at 1→5
  (all lifts idle at 1) → **both assigned to lift A**; A stops `[1, 4, 5]`;
  both board at floor 1 and unboard at 4 and 5 respectively (one car, two stops).
- **AC-D4** Opposite-direction split: p0 (1→6) on A; then p1 (2→1) is assigned
  to **lift B** (fewer stops), not A.
- **AC-D5** Assigned-car boarding: a passenger assigned to A cannot board B;
  boarding the assigned lift is rejected before doors open, accepted while its
  doors are open at their floor.
- **AC-D6** Tour + unboard: p at 1→4 on A; after ticks A stops at 4, doors open,
  p unboards; p at floor 4 `unassigned`; A eventually idle with empty stops.
- **AC-D7** No-show: assigned lift's doors close without the passenger boarding
  → `no_show` event; passenger unassigned and can re-register.
- **AC-D8** Capacity: a lift at capacity is never assigned more; a fuller-day
  scenario picks the lift with remaining space.
- **AC-D9** Maintenance: maintenance lift is never assigned and never boardable;
  all-maintenance → registration error.
- **AC-D10** Validation: same-floor destination, floors 0/7/2.5, boarding
  without assignment, re-register while assigned → all rejected.

## 6. Test strategy
- `simulation/dcs/tests/tests.js` maps each check to an AC above; runs in
  `tests/run-tests.html` and headlessly via Node.

## 7. Definition of Done
- All acceptance criteria pass (engine + tests).
- `simulation/dcs/index.html` opens and drives a full register → take-car →
  board → ride → exit flow with visible grouping.
- Docs updated: `Spec/smart-lift.md` (DCS user story), `Spec/phase1-simulation.md`
  (baseline pointer), `Spec/Steps_Followed.md` (Phase 2 log).

## 8. Out of scope (later phases)
- Predicted wait/ride time display accuracy; reassignment after boarding.
- Landing-car calls (a.k.a. in-car destination buttons — intentionally removed
  in DCS).
- Door opening speeds, acceleration curves, real traffic profiling.