# LayoutPilot

> AI-assisted PCB layout planning for JLCEDA / EasyEDA Pro.

LayoutPilot is an experimental PCB layout copilot focused on **human-AI collaboration**, not one-click autonomous placement.

The product thesis is simple:

> Engineers should not place every component manually, but an opaque AI should not be allowed to invent electrical ownership or move PCB components without evidence, review, verification, and rollback.

## Current stage — v0.9.23 Deterministic Review Navigation

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

## v0.9.23 Deterministic Review Navigation

Real-board review exposed a lifecycle problem rather than another zoom-number problem. Marker cleanup could reactivate an older PCB tab, the next click then trusted the live current tab, and a replaced preview iframe could still run its stale close callback and reopen the workbench while navigation was in progress.

v0.9.23 replaces that chain with explicit ownership boundaries:

- every review scene freezes its source PCB `documentTabId`, and that exact tab is reactivated/read back before validation and again before final navigation;
- preview cleanup is focus-neutral and removes markers by tab id without activating the tab;
- preview/navigation iframes use active-window ownership, so a stale close callback cannot clear the successor window's state or reopen the workbench;
- selection and indicator markers are presentation-only;
- the final camera has one writer: `zoomTo(centerX, centerY, explicitScaleRatio, tabId)`;
- the returned EasyEDA viewport is verified as a postcondition, so an off-target or effectively whole-board result fails visibly instead of being reported as successful;
- the camera policy is isolated in `src/domain/reviewCameraPolicy.ts` and covered by a pure regression test.

The architectural invariants and prohibited regression patterns are documented in `docs/REVIEW_NAVIGATION_CONTRACT.md`. No board-specific ids, timing sleeps, retry loops, test-mode production paths, or hidden split-screen assumptions are introduced.

## v0.9.22 Navigation Reset

Real-board testing showed that the navigation regressions were introduced by changes after the last known working implementation, not by missing editor-context checks.

The working v0.9.16 path used:
- live `getCurrentDocumentInfo()` after the workbench was hidden;
- direct `activateDocument(tabId)`;
- `zoomToRegion(...)`;
- `zoomTo(centerX, centerY, explicitScaleRatio, tabId)` with no omitted zoom arguments.

v0.9.19-v0.9.21 added viewport readback, implicit selection zoom, undefined optional zoom arguments, frozen-tab enforcement and split-screen metadata validation. These layers have now been removed from the navigation path.

v0.9.22 restores the proven live-document flow and keeps only a small geometry-derived zoom policy. Selection and markers remain visual aids; they do not control the camera. The planning-correctness and physical-fingerprint fixes from later versions are retained.

## v0.9.21 Editor Context Transaction

Real-board testing of v0.9.20 showed that explicit camera coordinates alone were not sufficient: EasyEDA could still throw an internal `minX undefined` error before rendering the requested local view. The remaining hidden dependency was the host editor context itself.

v0.9.21 introduces a separate editor-context transaction before any camera operation:

1. resolve the split screen that owns the frozen PCB tab;
2. verify that the tab still belongs to that split screen and is still a PCB document;
3. activate that split screen so it owns editor input focus;
4. activate the frozen PCB tab;
5. read the current document back and require exact tab/type equality;
6. only then hand the already-known CanvasRegion to the camera policy.

Camera, editor context, selection, and marker presentation are now four separate responsibilities. A stale or incomplete host context fails before any zoom API is called.

## v0.9.20 Explicit Camera Navigation

Real-board v0.9.19 testing exposed an EasyEDA host failure: implicit focus APIs could throw `Cannot destructure property 'minX' ... as it is undefined` while deriving their own internal BBox.

v0.9.20 removes implicit-BBox zoom from the review path.

1. Review selection is visual only; it no longer triggers `zoomToSelectedPrimitives()`.
2. TARGET marker rendering uses `zoom=false`; marker creation no longer owns camera state.
3. Camera control is isolated behind an `EditorCameraPort` with only three explicit operations: activate the frozen PCB tab, fit a known `CanvasRegion`, and center on known coordinates.
4. The final center operation returns EasyEDA's actual viewport, which is checked against the existing viewport postcondition.
5. There are no board-specific designators, fixture injection, or test-only production branches.

This follows the host API's documented strengths: `zoomToRegion()` for a caller-supplied rectangle and `zoomTo(x,y,...)` for caller-supplied center coordinates, rather than asking the host to infer a primitive/marker BBox.

## v0.9.19 Review Navigation Contract

v0.9.19 addresses a failure mode exposed by real-board testing: a review click could be blocked by a false physical-fingerprint mismatch before the editor ever reached the zoom command, and a successful `zoomToRegion()` boolean did not prove that the user actually received a local viewport.

1. **Stable physical identity.** Physical fingerprint v3 excludes EasyEDA's measured primitive BBox from plan identity. BBox remains a safety/review geometry input, but no longer participates in staleness hashing because it is derived presentation geometry. Component anchors, pad geometry, rotation, layer, lock state, routing evidence scope, board outline and component keepouts remain authoritative.
2. **Viewport postcondition.** Review navigation now reads the actual editor viewport after a requested focus and verifies that the requested target center is visible and that the viewport did not silently fall back to a whole-board view.
3. **Primitive/marker focus seed.** CURRENT/component navigation first uses EasyEDA's selected-primitive focus; TARGET navigation uses the indicator-marker zoom path. The bounded review region is then applied and verified. These are two independent native focus mechanisms rather than repeated magic zoom percentages.
4. **Fail visibly.** If EasyEDA reports a zoom success but the viewport readback is still not local, LayoutPilot reports the navigation contract failure instead of treating the operation as successful.

## v0.9.18 Planning Correctness & Owner-Cluster Planning

v0.9.18 moves the product focus from richer preview presentation to placement correctness.

1. **KEEP_CURRENT is a first-class candidate.** Current placement and proposed placements are evaluated by the same objective. A component is no longer moved merely because the planner can find a legal coordinate; a move must strictly improve the objective after relocation cost. Recommendations that make the loop proxy worse are filtered before LayoutPlan creation.

2. **Owner neighborhoods are solved jointly.** Confirmed decoupling constraints sharing the same Owner / power / ground context are grouped into one placement cluster. Each member contributes several legal alternatives plus KEEP_CURRENT, then a deterministic branch-and-bound assignment minimizes total cluster cost while enforcing pairwise clearance. If the joint search cannot complete within its explicit state budget, the cluster fails closed instead of falling back to designator-ordered greedy placement.

3. **Preview navigation is bound to the source PCB tab.** Review scenes freeze the exact EasyEDA PCB tab ID when they are collected. Clicking CURRENT, TARGET or a context component reactivates that exact tab before selection/markers/zoom, rather than rediscovering whichever document happens to be active after the workbench is hidden.

The architecture intentionally keeps candidate generation, hard legality checks, objective scoring and cluster assignment separate. Tests remain under `tests/`; production code contains no fixture injection, hard-coded designators or test-only branches.

## v0.9.17 Multi-Plan Layer Preview

v0.9.17 addresses three real-board review findings:

1. **Cross-layer Owner relationships can be previewed.** A decoupling capacitor and its manually confirmed Owner no longer have to be on the same component layer to produce a placement proposal. The planner keeps the capacitor on its own layer and uses the Owner pad XY as placement evidence. Cross-layer plans remain **execution-blocked** and reference-only: automatic movement still fails closed until a dedicated cross-layer electrical-path model exists.

2. **PCB navigation is moderately framed.** The over-aggressive explicit 700–800% zoom is removed. Review navigation now runs after the compact return bar opens and uses a larger contextual region. TARGET framing also includes the Owner when available, so the engineer sees the proposed placement relationship rather than an isolated pad at extreme magnification.

3. **One LayoutPlan can contain multiple confirmed changes.** The workbench no longer calls `generateCurrentLayoutPlan(1)`. Generation can retain up to eight legal confirmed placement items, planned sequentially against a virtual board so later proposals see earlier proposed positions. The inline review collects PCB primitives once, builds all review scenes from that snapshot, and exposes numbered item tabs for per-change Before/After inspection. “生成布局预览” always rebuilds from the current Owner decisions; stored/reference plans remain separately reviewable.

The execution MVP remains conservative: multi-item plans are reviewable as a set, while automatic Apply continues to accept only the existing single-item execution path.

## v0.9.16 Review Navigation UX

Real-board review exposed three usability problems in v0.9.15: the return window could cover the inspected area, the board mini-map could be misleading on complex outlines, and `zoomToRegion()` alone could still leave a small component visually too distant.

v0.9.16 tightens the review loop:

- hotspot navigation opens a compact, top-right return bar instead of the full centered plan-review window;
- the compact bar can be minimized and keeps only the current review target plus **返回工作台**;
- the final PCB zoom runs *after* the compact bar changes the editor viewport;
- explicit `zoomTo(x, y, scaleRatio)` is used with a bounded review scale after `zoomToRegion()`, so tiny passives get a meaningful close-up instead of a board-level fit;
- TARGET navigation shows only the selected component's green pad ghost, not the whole LayoutPlan;
- the misleading board mini-map is replaced by a deterministic CURRENT → TARGET position navigator with movement distance.

The change remains review-only. Planner, physical fingerprint, collision, keepout, routing safety, preflight and apply behavior are unchanged.

## v0.9.15 Interactive Review Navigator

v0.9.15 turns the focused comparison from a static illustration into a PCB review navigator.

The local renderer no longer draws permanent red / green spotlight circles. The changed footprint itself carries the color semantics:

- red footprint = CURRENT;
- green footprint = TARGET;
- neutral context = unchanged PCB.

A lightweight dashed focus box appears only on hover or keyboard focus.

Every rendered component is now a review hotspot. Clicking a real component:

```
Preview component
→ resolve its real PCB bounds
→ EasyEDA selection
→ zoomToRegion()
→ open the compact real-PCB review bar
```

Clicking the green TARGET uses the frozen LayoutPlan target bounds instead of selecting a nonexistent primitive, so the editor jumps directly to the proposed placement area.

The top overview is no longer based on the beta EasyEDA screenshot cache. v0.9.16 further replaces the miniature board drawing with a deterministic CURRENT → TARGET position navigator, avoiding misleading board-outline reduction on complex designs.

This keeps the review scalable when future plans contain many changed components: color identifies change by default; focus decoration appears only for the component the reviewer is actually inspecting.

## v0.9.14 Local Detail Diff

Real-board validation showed that EasyEDA's beta canvas snapshot can silently return a stale whole-board frame after `zoomToRegion()`. This made the v0.9.13 local panes look almost identical even though their requested regions were different.

v0.9.14 removes native snapshots from the *local* comparison path.

The review is now hybrid:

```
whole-board orientation
  → EasyEDA native snapshot when available

CURRENT local detail
  → structured PCB renderer
  → real pads + traces + vias + designators
  → subject emphasized in red

PROPOSED local detail
  → same physical scale
  → old subject removed
  → translated real pad footprint inserted in green
```

The local renderer follows the same practical split used by EasyEDA's open-source Interactive HTML BOM and PcbDraw: render PCB structure from primitives, then highlight only the review subject. It intentionally does not attempt to reproduce every editor decoration, copper-pour visual effect, or post-route result.

This avoids relying on stale viewport screenshots for the one place where pixel-level focus matters most.

## v0.9.13 Focused Placement Compare

v0.9.13 changes the review information architecture rather than increasing marker intensity.

The native review now follows the mature visual-diff pattern used by PCB/CAD comparison tools:

```
Overview
  → locate the change on the whole board

CURRENT local view        PROPOSED local view
same physical scale       same physical scale
native PCB colors         native PCB colors
red current footprint     green target footprint ghost
```

The local pair no longer zooms out merely to keep CURRENT and TARGET in one frame. Both panes use the same physical width/height so spacing and density can be compared directly.

The PROPOSED side renders the subject's real pad geometry translated to the frozen LayoutPlan target. It remains a placement preview: existing routing is not rerouted and copper pours are not recomputed.

The design borrows the useful principles of KiCad-Diff (before/after synchronized comparison), kicadiff (red old / green new visual semantics), and PcbDraw (keep the board readable and highlight only the changed component) without adding those projects as runtime dependencies.

## v0.9.12 Native Marker Snapshot

v0.9.11 exposed a runtime incompatibility in EasyEDA's beta `zoomTo()` API when all coordinate arguments were omitted and the method was used as a viewport getter. On a real PCB this could throw an internal `minX undefined` error and force the workbench back to the v0.9.10 geometry renderer.

v0.9.12 removes that unsupported assumption entirely.

The native review path is now:

```
zoomToRegion(review area)
→ EasyEDA native indicator markers
   - CURRENT red
   - TARGET green
   - OWNER neutral
→ getCurrentRenderedAreaImage()
→ remove indicator markers
→ show the exact native marked frame in the workbench
```

No PCB-world-to-image reprojection is required. Marker alignment is therefore owned by EasyEDA's native canvas coordinate system.

The review still falls back to the geometry renderer if native capture itself fails.

## Native PCB Review Overlay

v0.9.11 promotes EasyEDA's native PCB rendering to the visual source of truth for established / partially laid out boards.

The workbench review path is now:

```
Frozen LayoutPlan
→ capture native EasyEDA review region
→ restore user's original PCB viewport
→ grayscale native snapshot
→ red CURRENT / green TARGET overlay
→ optional real-canvas verification
```

The native capture is non-destructive: LayoutPilot does not recolor PCB primitives and does not mutate the board. If the native rendered-area capture API is unavailable or fails, the workbench automatically falls back to the v0.9.10 geometry renderer.

The geometry renderer therefore remains useful as a fallback and as the basis for future greenfield / unplaced-board proposal views.


The next review architecture is frozen in `docs/NATIVE_PCB_REVIEW_OVERLAY.md`.

The key decision is to stop expanding the lightweight SVG renderer into a second PCB editor. For established / partially laid out boards, EasyEDA's native rendered canvas becomes the visual source of truth and LayoutPilot adds a non-destructive red/green placement diff. The current SVG scene remains as a fallback and as the basis for greenfield Proposal Canvas.

P0 will not recolor native PCB primitives. Native canvas state remains untouched; preview state is disposable.

## Review geometry alignment

v0.9.10 separates **safety geometry** from **review geometry**.

The placement engine continues to use EasyEDA measured primitive BBoxes for conservative collision / board / keepout checks. The workbench preview no longer renders those BBoxes as if they were the visible component body, because a primitive BBox may include attached text or other graphics and shift the apparent visual centre.

For review rendering, LayoutPilot now builds a lightweight footprint envelope from the component's real pad coordinates and pad sizes, anchored at the component's actual X/Y position. Components without usable pads fall back to a bounded BBox recentered on the component anchor.

This follows a common PCB-tool separation between conservative placement geometry and presentation geometry: review visuals may be simplified, but they must preserve real placement anchors and must never weaken execution safety.

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
