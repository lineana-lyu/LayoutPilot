# v0.7 Controlled Physical Execution

## Engineering position

LayoutPilot does **not** translate a semantic `near(Ux)` constraint into an arbitrary coordinate offset.

For a decoupling capacitor, the PCB objective is not distance to the IC body centre. The useful physical anchor is the relevant power pad and the return-current loop.

The v0.7 interview MVP therefore uses a deliberately conservative execution path:

```
Semantic Snapshot
+ Human Ownership Decision
        ↓
Constraint Evaluation
        ↓
near(Cx, Ux)
        ↓
Physical Context
        ↓
Pad-aware candidate placement
        ↓
Safety gates
        ↓
User confirmation
        ↓
Move
        ↓
Read-back verification
        ↓
Post-move DRC
        ↓
Commit command OR automatic rollback
```

## PCB-domain safety gates

A placement action is blocked when any of the following is true:

- the subject component is locked;
- subject and owner are on different component layers;
- the subject already has routed copper / connected primitives;
- routing state cannot be inspected;
- the capacitor has no pad on the shared power net;
- the capacitor has no ground pad;
- the owner has no pad on the shared power net;
- pad geometry is missing or invalid;
- EasyEDA cannot provide a valid measured BBox for the subject or a relevant obstacle;
- no collision-free candidate can be found from the measured component bounds;
- the board boundary cannot be parsed as one simple reliable outline;
- the candidate would leave the board boundary;
- a `NO_COMPONENTS` keepout cannot be parsed reliably or the candidate intersects it;
- the board fails DRC before the move.

These checks are fail-closed. Missing evidence does not become permission.

## Candidate placement

For a decoupling capacitor:

1. find subject and owner pads on the shared power and ground nets;
2. use each owner power pad as a candidate electrical anchor;
3. search first in the outward direction from the owner body, then orthogonal alternatives;
4. preserve the capacitor's current rotation;
5. translate the capacitor so its power pad is adjacent to the owner power pad;
6. maintain a conservative 20 mil clearance around the subject's measured component BBox in the MVP;
7. reject candidates that overlap another component's EasyEDA-measured BBox, leave the verified board outline, or intersect a parseable `NO_COMPONENTS` keepout;
8. rank remaining candidates by `power-pad distance + nearest ground-return distance`, with a small relocation penalty.

Pad geometry and component occupancy are deliberately separate concepts: pads define electrical anchors; `pcb_Primitive.getPrimitivesBBox()` defines the current runtime occupancy envelope used by the collision gate.

## Why routed components are blocked

Moving a component after routing can stretch or detach tracks, change current-return geometry, invalidate length/impedance assumptions, create copper clearance problems, or silently degrade a decoupling loop even when the geometric move looks reasonable.

v0.7 only moves an unrouted subject. Routed-board re-optimization is a separate feature and requires route-aware editing.

## DRC transaction boundary

Execution uses a transaction-like pattern:

```
precondition checks
→ baseline DRC must pass
→ save before-state
→ move
→ read coordinates back
→ post-move DRC
```

If post-move DRC fails:

```
restore before-state
→ read back
→ run DRC again
→ do not record a successful command
```

This is not a database transaction, but it provides the same product property: a failed action should not leave the design in a silently degraded state.

## Undo and optimistic concurrency

A successful move stores an auditable `PlacementCommandRecord` with the Semantic Snapshot ID, Constraint ID, component identity, before/after coordinates, timestamps, and command status.

Undo first checks whether the component is still at the command's recorded after-position. It then re-reads routing state, measured BBoxes, board outline, keepouts and DRC. If the component was routed after placement, automatic Undo is retired as `superseded`; if the historical target is no longer safe, Undo is blocked. A permitted Undo runs through the same placement transaction so a failed inverse DRC rolls back to the LayoutPilot target position. This is both an optimistic-concurrency guard and a guarded inverse transaction.

## Current physical limitations

This is a controlled execution PoC, not a production placement engine. Runtime BBox improves 2D occupancy fidelity, but the current planner does **not** yet prove manufacturer courtyard rules, 3D body/height collision, all mechanical-rule semantics, thermal constraints, high-speed return-path quality, via placement, differential-pair or length-matching preservation, full multi-component optimization, or routed-board re-placement.

For interview/demo use, the intended board is a clean, unrouted or partially unrouted test PCB with a valid DRC baseline.

## Test isolation

Synthetic fixtures exist only under `tests/`.

Production code has no test mode, no fixture injection, no hard-coded designators, no mock PCB branch, and no special-case `C14/U6` logic. The same production path consumes real EasyEDA PCB primitives at runtime.
