# LayoutPilot

> AI-assisted PCB layout planning for JLCEDA / EasyEDA Pro.

LayoutPilot is an experimental PCB layout copilot focused on **human-AI collaboration**, not one-click autonomous placement.

The product thesis is simple:

> Engineers should not place every component manually, but an opaque AI should not be allowed to invent electrical ownership or move PCB components without evidence, review, verification, and rollback.

## Current stage — v0.8.3 Workbench Interview MVP

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
Pad-aware Physical Planner
  ↓
Safety gates + baseline DRC
  ↓
Explicit user confirmation
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

v0.7 only executes a very narrow placement case:

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
- already-routed components are not moved in v0.7;
- failed execution should restore the before-state;
- Undo must not overwrite a newer manual edit;
- Undo is a guarded inverse transaction: routed/locked/stale targets are not mechanically restored.

## Test isolation

Synthetic fixtures are restricted to `tests/`.

Production code under `src/` consumes real EasyEDA primitives and has no test-only flags, fixture injection, or special-case component branches.

CI runs domain tests, gateway syntax validation, extension compilation, and package generation.

## Documentation

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
