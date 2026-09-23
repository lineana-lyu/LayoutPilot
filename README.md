# LayoutPilot

> AI-assisted PCB layout planning for JLCEDA / EasyEDA Pro.

LayoutPilot is an experimental PCB layout copilot focused on **human-AI collaboration**, not one-click autonomous placement.

The product thesis is simple:

> Engineers should not place every component manually, but an opaque AI should not be allowed to invent electrical ownership or move PCB components without evidence, review, verification, and rollback.

## Current stage — v0.9.9 Stable Plan Fingerprint Scope

The current implementation closes a conservative end-to-end loop:

```
Read real PCB
  ↓
Circuit Graph / Structural Features
  ↓
Deterministic Ownership Relations
  ↓
AI Semantic Inference
  ↓
Immutable Semantic Snapshot
  ↓
Human confirmation for unresolved owner
  ↓
Constraint Policy
  ↓
Deterministic Local Geometry Planner
  ↓
Immutable LayoutPlan
  ↓
PCB Ghost Preview (no mutation)
  ↓
User Accept / Reject
  ↓
Strict physical preflight
  ↓
Apply the exact accepted coordinates
  ↓
Move one unrouted component
  ↓
Read-back verification + post-move DRC
  ↓
Commit or automatic rollback
  ↓
Undo with concurrent-edit protection
```

## Visual Workbench

The primary product workflow now runs in a persistent EasyEDA `sys_IFrame` workbench rather than a chain of modal dialogs. Workbench windows are version-bound and managed as a single extension-owned iframe instance so hot upgrades cannot reuse a stale window registration.

The workbench keeps four stages visible at once and uses a responsive three-pane decision layout on wide screens: task queue, component/topology evidence, and Constraint Plan.

- **Understand** — Semantic Snapshot, model, board fingerprint and AI analysis count;
- **Confirm** — rail-domain decoupling tasks and evidence-backed Host candidates;
- **Plan** — generated constraints and concise blocking reasons when the result is still zero;
- **Apply** — guarded placement and Undo state.

Owner confirmation happens directly in the workbench. The only dialogs intentionally retained in the main path are settings/errors and the final confirmation before a real PCB mutation.

### Native engineering workbench

v0.8.5 removes the dashboard/card-wall presentation in favor of a dense EasyEDA-style engineering inspector:

- thin workflow strip with only the current stage highlighted;
- native-density task list and property rows;
- Host candidates rendered as a table: Host / device / shared power Pad / distance / topology / actions;
- flat Constraint list instead of card tiles;
- Microsoft YaHei UI / Segoe UI typography, restrained borders and 120–160 ms state transitions;
- three real iframe size presets: compact / standard / wide. The EasyEDA iframe API does not expose arbitrary drag-resize, so LayoutPilot recreates the workbench transactionally at the selected size while preserving WorkflowState.

PCB selection capture is runtime-capability based: LayoutPilot prefers `getAllSelectedPrimitives_PrimitiveId`, falls back to `getAllSelectedPrimitives`, and only uses deprecated selection APIs when necessary.

### Canvas evidence review

Before confirming an Owner, a Host card can show the closest shared power-pad pair and its current straight-line distance in mil. The engineer can use **定位核对** to select the subject/Host on the real PCB canvas, zoom to them and mark the relevant pads. A compact Evidence Review Bar stays visible with **返回工作台** and **确认 Owner** actions, so the engineer never has to reopen LayoutPilot from the menu. Exiting review clears LayoutPilot markers and restores the engineer's previous PCB selection. Distance is review evidence only and never becomes an automatic Owner rule.

### Physical preflight boundary

A semantic Constraint marked `preview-eligible` means only that it can enter physical preflight. The workbench therefore labels it **可进入物理预检**, not **可执行**. Real movement is allowed only after the runtime path re-checks routing state, measured component BBoxes, board outline, keepouts, collision candidates and a clean DRC baseline.

Pad-distance evidence is loaded only for the currently selected task. Switching between tasks does not rebuild the full Circuit Graph / Semantic Context, which keeps the workbench responsive without caching potentially stale X/Y evidence.

### Curved board geometry

v0.9.3 extends BoardRegion from straight-segment topology to bounded curved geometry:

- EasyEDA `ARC` / `CARC`, cubic Bézier `C`, rounded/rotated `R`, and `CIRCLE` polygon sources are parsed;
- standalone `pcb_PrimitiveArc` BOARD_OUTLINE primitives feed the same contour reconstruction pipeline;
- curves are adaptively tessellated to a maximum 0.05 mil chord/sagitta-style approximation budget instead of a fixed segment count;
- the approximation budget is persisted on BoardRegion and included in the physical fingerprint;
- placement BBoxes are conservatively inflated by that budget before outer-boundary / hole checks, so approximation error can only make placement more conservative;
- endpoint clustering and topology-degree validation remain in force after tessellation.

The parser design was informed by EasyEDA's own open-source extension implementations, especially `easyeda/eext-export-design-report` and `easyeda/eext-kirouting-integration`, while LayoutPilot adds a stricter placement-safety error budget rather than copying fixed display tessellation.

### Board region geometry

v0.9.2 upgrades physical board parsing from a single-polygon assumption to a fail-closed board-region model:

- fragmented BOARD_OUTLINE polylines are parsed as path segments and reconstructed across primitives using an endpoint-topology graph;
- endpoint coordinates within 0.01 mil are clustered into the same topology vertex to tolerate harmless runtime serialization noise;
- largest compatible BOARD_OUTLINE contour = outer board boundary;
- fully contained non-intersecting contours = board holes / cutouts;
- every reconstructed contour vertex must have topology degree = 2; dangling endpoints, branches and touching contours remain fail-closed;
- disjoint outer contours, intersecting loops or nested ambiguous islands remain rejected;
- placement BBoxes must be inside the outer contour and outside every hole;
- board holes are included in the physical fingerprint, so changing a cutout invalidates a frozen LayoutPlan.

This fixes real EasyEDA projects that legitimately contain multiple BOARD_OUTLINE polylines without weakening physical safety.

## Local occupancy search

v0.9.4 replaces the previous four-direction / single-distance placement sampling with a bounded local occupancy-grid search around the confirmed Owner power pad. The safety model is unchanged: every generated coordinate still passes the same measured-BBox collision, board-region and NO_COMPONENTS keepout gates before it can enter a LayoutPlan.

The design adapts the mature separation used by KiCad's autoplacer: candidate-space enumeration is distinct from hard legality checks and placement-cost ranking. LayoutPilot keeps the search local because a decoupling `near(owner)` constraint should fail rather than drift arbitrarily across the board. Rejected candidates are counted by collision / board / keepout reason so a failed preview is diagnosable instead of collapsing into one generic message.

## Canonical physical fingerprint

v0.9.5 canonicalizes closed board / keepout polygon rings before hashing. Equivalent geometry now produces the same physical fingerprint regardless of which vertex the EasyEDA runtime returns first or whether a ring is enumerated clockwise or counter-clockwise. Real physical edits such as component movement still invalidate the fingerprint.

This follows the same normalization principle used by mature geometry engines such as GEOS / Shapely: geometry is converted to a stable canonical form before equality-style comparison or identity hashing. LayoutPlan acceptance therefore remains fail-closed without treating representation-order changes as PCB edits.

## Reviewable reference-plan workflow

v0.9.6 separates **accepting a recommendation** from **authorizing PCB mutation**. A LayoutPlan whose items are all execution-blocked (for example, an already-routed capacitor) is explicitly treated as a reference-only plan: the preview action becomes “保存参考方案”, the workbench reports that PCB mutation will not occur, and the Apply action remains disabled.

Canvas review is also geometry-driven. LayoutPilot now frames Ghost Preview with EasyEDA's explicit `zoomToRegion` API around current position, proposed position and available Owner bounds instead of preserving the user's previous zoom level. Evidence review uses the same explicit-region pattern rather than relying on `zoomToSelectedPrimitives`, whose internal selection BBox calculation can fail on real projects when a selected primitive has incomplete bounds.

The approach keeps existing safety gates unchanged: routing blockers still prevent Apply; the new work only makes the review path explicit and observable.

## Stable LayoutPlan fingerprint scope

v0.9.9 fixes a real multi-Owner review failure exposed after confirming a second decoupling Owner. Routing evidence is now hashed only for the subjects that actually exist in the frozen LayoutPlan. Generation and validation therefore use the same physical identity scope.

This preserves the intended safety property: a routing-state change on the actual planned subject invalidates the plan, while routing evidence that was collected for another candidate but did not enter the plan can no longer create a false stale-plan result.

The fix does not bypass stale-plan validation and does not weaken component geometry, board, keepout or routing safety checks.

## Inline Layout Diff Preview

v0.9.8 makes the workbench the primary place to review a placement recommendation. It adds a lightweight, read-only PCB diff scene instead of attempting to duplicate the EasyEDA editor.

The scene reuses existing board / component geometry and reads only inexpensive context primitives: board boundary, nearby measured component BBoxes, net-bearing line tracks and vias. Unchanged context is rendered in grayscale. The proposed component location is the only strongly colored geometry; Diff mode additionally shows the current outline and movement vector. The Owner remains grayscale because it is evidence context, not a modification.

Three views are available inside the workbench:

- **原始** — current component location with grayscale board context;
- **建议** — proposed component location as the only highlighted modification;
- **差异** — current + proposed positions plus movement direction.

The panel also exposes movement distance and the existing before → after loop-geometry proxy. It explicitly states that background routing is the current PCB and that the preview does not simulate rerouting, repouring or SI/PI results. A separate “在真实 PCB 中核对” action retains the existing EasyEDA Ghost Preview as a second-stage verification path.

The rendering architecture borrows the proven data → scene → renderer separation used by PCB visualization projects such as PcbDraw / tracespace, and the parallel primitive-collection pattern used by EasyEDA's open-source interactive HTML BOM extension. LayoutPilot uses native SVG and adds no rendering dependency.

## Review workflow freeze

v0.9.7 freezes the current AI scope and closes the review lifecycle exposed by real-board testing on the full ESP32-IOT-KIT project.

- **Explicit LayoutPlan state machine**: status changes are guarded transitions instead of arbitrary string replacement. This follows the event-driven transition discipline used by mature state-machine libraries such as XState: invalid transitions fail rather than silently mutating state.
- **Reference-plan archive**: an accepted reference-only LayoutPlan is retained as auditable history even when a later Owner decision invalidates the active plan. Historical plans are never re-enabled for Apply; they can only be reviewed when the current physical/Snapshot context still matches.
- **Before / after explanation**: every plan stores the baseline and proposed decoupling loop geometry proxy and surfaces the change in mil and percentage. The value is explicitly a geometry proxy, not an SI/PI metric.
- **Canvas-first review**: Evidence Review and Layout Preview are shorter bottom control bars. Current position, Owner and target use distinct canvas markers; the PCB remains the primary review surface.
- **Capability status instead of a linear wizard**: the header now reports understanding, Owner decisions, layout suggestions and execution safety independently, matching the real per-component pipeline.

No board-specific conditions, runtime test switches or safety bypasses were added.

## Layout Preview MVP

v0.9 introduces a real proposal-before-commit layer.

- Constraint answers **what placement relation is desired**.
- LayoutPlan answers **what exact legal coordinate is proposed**.
- Ghost Preview renders only EasyEDA indicator markers and never writes PCB primitive state.
- Accepting a LayoutPlan still does not modify the PCB.
- Apply revalidates physical state and must reproduce the exact accepted coordinate; if the legal candidate changed, execution is cancelled.

The first v0.9 MVP intentionally previews one local placement item at a time. This keeps Preview → Apply → Verify → Undo one-to-one and auditable while the underlying LayoutPlan model remains multi-item capable.

See `docs/LAYOUT_PREVIEW_V09.md`.

## AI authority boundary

AI is currently allowed to infer semantic roles such as a decoupling capacitor.

AI is **not** allowed to assign electrical ownership.

Ownership comes from deterministic PCB topology or an explicit human decision:

```
PCB facts → Ownership Resolver
AI context → Semantic role
Human decision → ExplicitOwnershipHint
```

Downstream Constraint Policy combines those evidence sources without changing their provenance.

## Why Semantic Snapshot exists

Constraint Preview and physical execution must consume the exact AI result the engineer reviewed.

One AI analysis therefore produces a serializable, immutable Semantic Snapshot with:

- board semantic fingerprint;
- normalized component context;
- inference result;
- validator result;
- provider/model identity;
- creation time.

If relevant PCB semantics change, the snapshot becomes stale. Physical X/Y movement alone does not invalidate semantic identity.

## Controlled physical execution

v0.9 still executes a deliberately narrow placement case:

- role is `decoupling-capacitor`;
- constraint is `near(owner)`;
- confidence is medium/high;
- owner has been explicitly confirmed by the user;
- component is unlocked;
- subject and owner are on the same component layer;
- subject has no existing routed primitives;
- pad geometry is available;
- EasyEDA runtime returns a measured component BBox for every relevant obstacle;
- a collision-free candidate exists under the measured-BBox safety model;
- a simple, verifiable board boundary is available;
- the candidate remains inside the board boundary;
- the candidate avoids parseable `NO_COMPONENTS` keepout regions;
- the PCB passes DRC before execution.

The target is anchored to the owner's **shared power pad**, not the IC body centre. Electrical anchoring uses pad geometry, while mechanical occupancy uses `pcb_Primitive.getPrimitivesBBox()` as the runtime authority. Legal candidates are ranked by a geometric proxy for the decoupling loop: power-pad distance plus the nearest GND return distance. This is a placement heuristic, not an SI/PI proof.

After moving one component, LayoutPilot reads coordinates back and runs DRC again. A post-move DRC failure triggers automatic rollback.

This is a controlled Placement PoC, **not** a production-grade autorouter or global placement optimizer.

## Architecture

```
EasyEDA Extension API
        ↓
Circuit Structure Layer
        ↓
Deterministic Ownership Layer
        ↓
Semantic Context
        ↓
AI Gateway + Validator
        ↓
Semantic Snapshot
        ↓
Human Decision Layer
        ↓
Constraint Evaluation
        ↓
Physical Context / Planner
        ↓
Placement Command
        ↓
Read-back + DRC + Undo
```

## Engineering principles

- deterministic electrical facts have priority over probabilistic AI output;
- missing evidence fails closed;
- preview and execution share the same Constraint Evaluation;
- no hard-coded component designators or board-specific exceptions;
- no test mode or synthetic fixture path in production;
- Ghost Preview is transient overlay state and never mutates PCB primitives;
- Apply consumes the exact accepted LayoutPlan rather than replanning silently;
- already-routed components are not moved in v0.7;
- failed execution should restore the before-state;
- Undo must not overwrite a newer manual edit;
- Undo is a guarded inverse transaction: routed/locked/stale targets are not mechanically restored.

## Test isolation

Synthetic fixtures are restricted to `tests/`.

Production code under `src/` consumes real EasyEDA primitives and has no test-only flags, fixture injection, or special-case component branches.

CI runs domain tests, gateway syntax validation, extension compilation, and package generation.

## Documentation

- `docs/LAYOUT_PREVIEW_V09.md`
- `docs/SEMANTIC_SNAPSHOT_V07.md`
- `docs/HUMAN_OWNERSHIP_CONFIRMATION_V07.md`
- `docs/CONTROLLED_PHYSICAL_EXECUTION_V07.md`
- `docs/RUNTIME_SMOKE_TEST_V07.md`\n- `docs/CANVAS_EVIDENCE_V083.md`
- `docs/POC_PLAN.md` — original feasibility milestone for historical context

## Status

- [x] PCB component / connectivity read
- [x] Circuit Graph
- [x] Structural feature extraction
- [x] Candidate grouping
- [x] Deterministic Ownership Relations
- [x] AI semantic inference + Validator
- [x] Semantic Snapshot / staleness control
- [x] Human owner confirmation
- [x] Constraint Policy
- [x] Immutable LayoutPlan + physical staleness fingerprint
- [x] Non-mutating PCB Ghost Preview
- [x] Accept / Reject gate before physical execution
- [x] Pad-aware controlled placement candidate
- [x] Baseline/post-move DRC transaction boundary
- [x] Coordinate read-back verification
- [x] Automatic rollback
- [x] Undo with concurrent-edit protection
- [ ] Production-grade footprint/courtyard collision
- [x] Simple board-boundary gate + parseable `NO_COMPONENTS` keepout gate
- [ ] Curved / multi-ring board and richer mechanical keepout model
- [ ] Return-path / via planning
- [ ] Routed-board re-optimization
- [ ] Multi-component placement optimization

## License

Apache-2.0.
