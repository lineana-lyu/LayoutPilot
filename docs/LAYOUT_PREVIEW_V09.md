# Layout Preview v0.9

## Goal

LayoutPilot must let the engineer inspect a proposed placement before any PCB primitive is mutated.

The v0.9 workflow is:

```
Constraint Evaluation
→ deterministic Local Geometry Planner
→ immutable LayoutPlan
→ transient Ghost Preview
→ user Accept / Reject
→ physical preflight
→ apply the exact accepted coordinates
→ read-back + DRC
→ rollback / Undo
```

## Authority boundary

The LLM does not output PCB coordinates.

- AI: semantic role inference.
- deterministic topology: electrical ownership candidates.
- human: explicit Owner confirmation when topology cannot prove a unique owner.
- Constraint Policy: semantic placement intent such as `near(owner)`.
- Local Geometry Planner: concrete legal coordinates.
- Physical Preflight: whether those exact coordinates are still safe to apply.

## LayoutPlan artifact

A LayoutPlan is serializable and immutable. It records:

- Semantic Snapshot ID and semantic fingerprint;
- physical board fingerprint;
- Constraint ID;
- subject / owner;
- current and proposed coordinates;
- current and proposed measured BBoxes;
- power/GND pad anchors;
- movement distance and loop-geometry proxy;
- execution blockers known at preview time;
- status: preview / accepted / rejected / applied / superseded.

Any Owner change or Semantic Snapshot replacement invalidates the active LayoutPlan.

Physical changes are detected through a dedicated physical fingerprint that includes component positions, rotations, measured BBoxes, pad geometry/routing evidence, board outline and component keepouts.

## Ghost Preview

Ghost Preview is transient UI state, not a PCB edit.

The EasyEDA canvas receives indicator markers only:

- target component outline;
- original-to-target movement line;
- target centre marker.

Blue means the item currently has no known execution blocker. Amber means the geometry can be previewed but the current PCB state blocks Apply, for example because the subject is already routed.

Closing Preview removes the markers.

## Preview vs execution

Planning has two distinct gates:

1. **Preview geometry** — board outline, measured BBox, keepout, collision and electrical pad anchors must be sufficient to calculate a legal candidate.
2. **Execution** — additionally requires unlocked/unrouted subject, a clean DRC baseline and a fresh physical context.

This permits a routed design to demonstrate a hypothetical placement without weakening the rule that routed components are never moved automatically.

## Same-plan guarantee

Apply never chooses a new coordinate.

Before mutation LayoutPilot:

1. validates that Semantic Snapshot and physical fingerprint still match the accepted LayoutPlan;
2. re-runs the strict execution planner;
3. requires the newly computed legal candidate to be equivalent to the frozen LayoutPlan coordinate;
4. cancels if the candidate changed.

The engineer therefore applies exactly the placement they reviewed.

## v0.9 MVP scope

v0.9 intentionally previews one local placement item per LayoutPlan. The artifact and planner support multiple items internally, but one-to-one Preview → Apply keeps the first production-like demo auditable and rollback-safe.

A future multi-component release can add a group transaction with group rollback semantics.

## Transferable editor patterns

The implementation adapts ideas rather than dependencies:

- **tldraw**: an interaction has a clear history/commit boundary; transient interaction state is not equivalent to a committed edit.
- **Excalidraw**: preview/transient scene state is distinct from history-capturing document changes.

LayoutPilot maps these ideas onto PCB safety:

```
transient Ghost Preview ≠ PCB mutation
Accept LayoutPlan ≠ PCB mutation
Apply accepted LayoutPlan = explicit mutation boundary
```

No external editor framework is bundled into the extension.


## v0.9.5 canonical staleness fingerprint

LayoutPlan acceptance performs a fresh semantic + physical consistency check before changing plan status. The physical hash must represent PCB state, not incidental serialization order. Closed board and keepout rings are therefore normalized to an orientation- and start-vertex-independent canonical sequence before hashing. Component and pad ordering is also deterministic.

This preserves the safety property that a true PCB edit invalidates the plan while preventing false invalidation when the EDA runtime returns geometrically identical polygons with a different traversal order.

## v0.9.4 bounded local occupancy search

The original MVP generated only four candidate directions at one pad-to-pad distance. That was safe but incomplete: a dense real PCB could have a legal nearby placement that simply did not lie on one of those four rays.

v0.9.4 changes candidate enumeration without weakening validation:

```
confirmed Owner power pad
→ bounded local occupancy grid
→ existing board / keepout / measured-BBox hard gates
→ power + ground loop proxy scoring
→ deterministic best candidate
```

The pattern is adapted from KiCad's autoplacer architecture, which separates a placement matrix / free-cell test from cost evaluation. LayoutPilot intentionally does **not** copy KiCad code or perform full-board autoplacement: it searches only a bounded neighborhood appropriate to the semantic `near(owner)` constraint, then reuses the existing physical validator unchanged.

The search step is derived from the configured clearance and clamped to 10–25 mil. The local radius is derived from subject / owner physical scale and clamped to 200–500 mil. When no candidate survives, the planner reports counts for component collision, board boundary, NO_COMPONENTS keepout and invalid geometry. This makes the next engineering decision evidence-based instead of encouraging clearance or geometry rules to be loosened blindly.

## Curved board boundary safety

Real EasyEDA projects may store BOARD_OUTLINE as fragmented polylines, mixed lines/arcs, rounded rectangles, circles or Bézier-bearing paths.

LayoutPilot v0.9.3 normalizes these sources into one contour pipeline:

```
EasyEDA outline primitives
→ exact command parsing
→ adaptive curve flattening
→ endpoint clustering
→ degree-2 contour graph
→ outer / hole classification
→ conservative placement checks
```

Curve flattening uses a bounded 0.05 mil approximation tolerance. The tolerance is not discarded after rendering: BoardRegion carries it as physical uncertainty, LayoutPlan physical fingerprints include it, and component BBoxes are inflated by that amount during board-boundary checks. This ensures approximation cannot silently make a candidate placement less conservative.

Unsupported or ambiguous topology remains fail-closed.
