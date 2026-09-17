# Phase 1 - Floor Selection + Lift Movement (Simulation)

> Sub-spec derived from user stories 2 and 3 of `Spec/smart-lift.md`.
> Implementation target: a self-contained HTML/CSS/JS simulation with **4 lifts**.
>
> **Status note:** this is the **Phase 1 baseline** (git tag `phase_1`).
> Phase 2 replaces the in-car destination flow with Destination Control
> System (DCS) - see `Spec/phase2-dcs.md` and `simulation/dcs/`. Phase 1
> remains untouched as the reference baseline.

## 1. Goals

Simulate a building with 6 floors and 4 lifts. A user can:
1. **Call** a lift to their current floor by clicking a call button.
2. **Board** the arriving lift.
3. **Select a destination** floor inside the lift.

The simulation must mirror the real-world rules a lift controller follows (one lift per shaft, a lift serves one request at a time, invalid selections are rejected).

## 2. Building & Lift Model

| Concept | Rule |
|---|---|
| Floors | 6 floors numbered **1 (ground) to 6 (top)**. |
| Lifts | **4 lifts** (`A`, `B`, `C`, and `D`), each in its own shaft. |
| Initial state | All 4 lifts start at floor **1**, idle, doors closed. |
| One request at a time | Each lift carries a single active request; new requests are queued. |
| Movement | A lift moves one floor at a time; duration per floor = `1` tick. |
| Direction | `UP`, `DOWN`, or `IDLE`. |
| User state | User has a **current floor** (where they are standing) and may be **boarded** in a lift. |

## 3. Functional Requirements

### FR-1: Call a lift
- [ ] The page shows a control panel with **call buttons** for each floor (1-6).
- [ ] Clicking a call button dispatches the most suitable idle lift to the user's floor.
- [ ] Only one lift can be called at a time per floor.

### FR-2: Board a lift
- [ ] When a lift arrives at the user's floor, a **"Board" button** appears for that lift.
- [ ] Clicking "Board" puts the user inside that lift (user state becomes `boarded` in that lift).
- [ ] The user can only board a lift that is at their current floor and idle.

### FR-3: Select destination
- [ ] Once boarded, the control panel switches to **destination mode** showing floor buttons (1-6).
- [ ] Clicking a destination button dispatches the boarded lift to that floor.
- [ ] The user cannot select the same floor they are already on (error message shown).

### FR-4: Dispatch (choosing which lift)
- [ ] The engine must pick the **most suitable** lift for a new call request:
  1. An **idle** lift is always preferred over a busy one.
  2. If multiple are idle: pick the one **closest** to the requested floor.
  3. If multiple are busy: pick the one that will complete its active request **soonest**.
  4. If neither can be determined, pick lift A as a fallback.
- [ ] The chosen lift is queued to travel to the requested floor.

### FR-5: Movement
- [ ] A lift with a queued request moves toward it **one floor at a time**.
- [ ] If the destination == current floor, the lift does not move and the request completes immediately.
- [ ] While moving, the lift's direction must be `UP` or `DOWN` (never `IDLE`).
- [ ] On reaching the destination the lift stops, the request is completed, and it returns to `IDLE`.

### FR-6: Direction-aware serving (simple pick-up rule)
- [ ] When a busy lift finishes its current request, it picks up its next queued request. (Full "along-the-way" pickup with multi-stop runs is deferred to Phase 2.)

### FR-7: Invalid input handling
- [ ] A request for a floor outside 1-6 is an **error** and is ignored (no movement).
- [ ] An error message is shown to the user when input is invalid.
- [ ] Attempting to board a non-arrived lift or select same-floor destination shows an error.

### FR-8: Visualisation
- [ ] The building renders 6 floors and 4 lift shafts.
- [ ] Each lift is drawn inside its shaft at a vertical position matching its current floor.
- [ ] The lift moves up/down visually as floors change.
- [ ] Each lift shows its current floor number and current state (IDLE / UP / DOWN).
- [ ] The UI clearly indicates: user's current floor, which lift is boarded, and available actions.

## 4. Out of scope (future phases)
- User authentication (story 1).
- Emergency stop & alerts (story 4).
- Fault detection & maintenance history (story 5).
- Multi-destination runs / pickup along the way (Phase 2).
- Doors, sounds, weight sensors.

## 5. Acceptance Criteria (Phase 1b)

### AC-1: Initial state
1. Page loads with all 4 lifts at floor 1, state `IDLE`, each in its own shaft.
2. User is at floor 1, not boarded in any lift.
3. Call buttons are visible for all floors.

### AC-2: Call and board flow
1. User at floor 1 clicks "Call" → a lift is dispatched to floor 1.
2. Lift arrives at floor 1 → "Board" button appears for that lift.
3. User clicks "Board" → user is now inside the lift, UI switches to destination mode.
4. User clicks floor 4 → lift moves from floor 1 to floor 4.
5. Lift arrives at floor 4 → user is automatically unboarded, UI switches back to call mode.

### AC-3: Idle-lift dispatch
1. Given all lifts at floor 1 and user calls from floor 4, exactly one lift moves to floor 4.
2. Given lift A at floor 1, lift B at floor 4, lift C at floor 2, lift D at floor 5 (all idle) and user calls from floor 6,
   lift **D** is chosen (closest idle lift: 1 floor away).

### AC-4: Movement semantics
1. A dispatched lift increases/decreases its floor one at a time toward the target.
2. A lift never skips floors.
3. While moving, direction is `UP`/`DOWN`; when stopped, direction is `IDLE`.

### AC-5: Busy-lift dispatch
1. Given all lifts idle at floor 1, user calls from floor 6 (lift A dispatched to 6),
   then calls from floor 2 while A is still moving: the request is queued against the
   **more suitable** lift per FR-4.

### AC-6: Reaching destination
1. Given a boarded lift at floor 2 moving to floor 4, after 2 ticks it reaches floor 4,
   becomes `IDLE`, user is unboarded, and UI returns to call mode.

### AC-7: Same-floor destination
1. Given a user boarded in a lift at floor 3, selecting floor 3 as destination shows an error.

### AC-8: Invalid input
1. A request for floor 0 or floor 7 is rejected: no lift moves, and an error message is displayed.

## 6. Test strategy
- A runnable **test page** (`tests/run-tests.html`) loads the engine file and runs
  assertions for every acceptance criterion above. Tests must pass before Phase 1 is signed off.

## 7. Definition of Done
- All acceptance criteria pass.
- Simulation is viewable by opening `simulation/index.html` in a browser.
- `Steps_Followed.md` updated with the details of this phase.

---

# Phase 2/3 - Real-time interactive simulation (single user)

> Revised direction (per user feedback): the engine stays multi-passenger, but
> the live simulation is driven by a **single interactive user** replaying
> real-world behaviour: call a lift at any floor -> the lift travels to you
> in real time -> board -> choose destination -> ride -> exit -> call again.

## 1. Goals

- One interactive user ("you") who stands at some floor at any moment.
- Call a lift at **any floor**: the most suitable of the 4 lifts travels
  there in real time, one floor per tick.
- Board any lift present at your floor (idle), then pick a destination.
- On arrival you exit automatically, then you may call again from there.
- All 4 lifts are genuinely operational: they are parked at different floors
  on startup so different calls dispatch different lifts (A, B, C and D).

## 2. Model & flow

| Concept | Rule |
|---|---|
| Passenger | The simulation creates one passenger ("you"); `call`, `board`, `selectDestination` are driven per passenger. |
| Park positions | UI starts lifts at `[A:1, B:2, C:5, D:6]` so idle-tie dispatch picks different lifts for different floors. |
| Two-step flow | (1) **Board** any idle lift at your floor; (2) **select destination**. |
| Unboarding | Automatic when the lift reaches your chosen destination. |
| Single occupancy | One person can only be inside one lift at a time (a boarded passenger cannot call/board another lift). |

## 3. Acceptance Criteria (simulation behaviour)

- AC-16: With the UI's park positions, calls from floors 1..6 dispatch
  A, B, C and D (not always A).
- AC-17: Calling a floor moves that lift toward you one floor per tick;
  the UI animates movement and shows an arrived/boardable state.
- AC-18: You can board any idle lift at your floor, then choose any
  destination floor; same-floor destination is rejected.
- AC-19: After arrival you exit automatically and can call again from the
  arrival floor.
- AC-20: The panel clearly shows your floor, your lift (when boarded),
  and available actions; all 4 lifts remain independently operational.

## 4. Test strategy
- Engine acceptance tests in `simulation/tests/tests.js` remain (they exercise
  the multi-passenger engine the UI drives). The dispatch test matrix already
  proves that different park positions dispatch different lifts.

## 5. Maintenance (User Story 5 groundwork)

- A lift can be flagged **under maintenance**; it is then excluded from
  dispatch and cannot be boarded.
- A busy lift (moving, queued, or carrying passengers) cannot be taken out of
  service.
- If all lifts are under maintenance, call/request are rejected with an error.
- UI: each lift status row has a **Service / Restore** toggle; a maintenance
  lift is shown greyed out with a dashed border.

### AC-21 (maintenance)
- A maintenance lift is never dispatched or boardable; it can be restored and
  used again; all-down raises an error.