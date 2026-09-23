# Native PCB Review Overlay — Product & Technical Design

Status: P0 IMPLEMENTED IN v0.9.11
Target: v0.9.11
Scope: placement review only
Non-goal: second PCB editor / full rerouter / SI/PI simulator

## 1. Product decision

LayoutPilot must support two fundamentally different review contexts:

1. **Existing / partial PCB layout**
   - Reuse EasyEDA's native rendering as the visual source of truth.
   - Show the proposed placement as a non-destructive review layer.
2. **Greenfield / effectively unplaced board**
   - Use the existing geometry-based Proposal Canvas because there is no meaningful native placement to diff against.

The review experience must not mutate the PCB until the user explicitly enters the physical execution path.

## 2. Important API constraint

The current public EasyEDA extension API exposes:

- `DMT_EditorControl.getCurrentRenderedAreaImage()`
- `DMT_EditorControl.generateIndicatorMarkers()`
- `DMT_EditorControl.removeIndicatorMarkers()`
- `DMT_EditorControl.zoomToRegion()`
- `SYS_IFrame.openIFrame(..., { grayscaleMask })`

However, the public API does **not** expose a stable canvas-DOM overlay hook or a supported API for temporarily recoloring every native PCB primitive and restoring it afterwards.

Therefore LayoutPilot must not implement the preview by changing native primitive colors.

A transparent HTML iframe placed above the editor also cannot be assumed to be click-through merely because its internal document uses `pointer-events:none`; the host iframe window itself is owned by EasyEDA. The product must not rely on unsupported DOM injection.

## 3. Chosen architecture: hybrid native review

### 3.1 Primary review — Native Snapshot Diff

For an existing / partial board:

```
Frozen LayoutPlan
    ↓
determine review region
    ↓
remember current viewport
    ↓
zoomToRegion(review region)
    ↓
getCurrentRenderedAreaImage()
    ↓
restore previous viewport
    ↓
Workbench Review Surface
    ├── native EasyEDA snapshot
    ├── grayscale / low-saturation presentation filter
    ├── CURRENT overlay (red)
    ├── TARGET overlay (green)
    ├── movement arrow
    └── Owner / explanation labels
```

The background image is rendered by EasyEDA itself, so existing copper, silkscreen, vias, pads, tracks and layer visibility match the native canvas.

The image is a **review snapshot**, not a rewritten PCB.

### 3.2 Secondary verification — Native Canvas Markers

The action “在真实 PCB 中核对” opens the actual EasyEDA PCB document and uses native indicator markers:

- red outline: CURRENT
- green outline: TARGET
- movement vector
- optional Owner outline

No grayscale mutation is applied to the native PCB.

This preserves the original canvas interaction model and avoids changing design state.

### 3.3 Greenfield / unplaced fallback — Proposal Canvas

When there is no meaningful existing placement to compare:

```
BoardRegion
+ fixed / locked anchors
+ LayoutPlan proposals
→ Proposal Canvas
```

Rendering semantics:

- fixed / locked items: gray
- new suggested placements: green
- unresolved / not yet planned: blue-gray
- conflicts / blockers: red
- keepouts: muted hatch / outline

This is a blueprint, not a post-route simulation.

## 4. Why not recolor the native PCB directly

Rejected approach:

```
save all native primitive styles
→ recolor board gray
→ recolor changed objects red / green
→ allow review
→ restore every primitive
```

Reasons:

- no stable public API for whole-board temporary recoloring;
- large mutation surface;
- rollback complexity;
- plugin crash could leave visual/design state inconsistent;
- layer-specific color restoration is expensive to verify;
- would violate Preview ≠ Apply.

## 5. Visual semantics

### Existing / partial board — Snapshot Diff

- unchanged PCB context: native snapshot rendered in grayscale / reduced saturation;
- CURRENT subject: red outline + translucent red fill;
- TARGET subject: green outline + translucent green fill;
- movement path: red → green dashed arrow;
- Owner: neutral white / gray label, optional thin outline;
- target layer: explicitly shown in the label;
- current and target remain on the same side for v1.0.

Example:

```
CURRENT · C19 · Top   ─ ─ ─→   TARGET · C19 · Top
       red                         green

                      OWNER · U9
```

### Layer behavior

The snapshot represents the EasyEDA layer visibility state at capture time.

LayoutPilot stores:

- PCB document/tab id;
- review region;
- subject side;
- visible-layer context when available from supported API.

v1.0 rule:

> LayoutPilot does not automatically flip a component from Top to Bottom.

A future cross-side recommendation must be a separate explicit human-confirmed action.

## 6. Interaction model

### Review entry

```
Generate LayoutPlan
→ Freeze plan + fingerprint
→ Detect review context
   ├── established / partial → Native Snapshot Diff
   └── greenfield            → Proposal Canvas
```

### Snapshot Diff controls

- 原始
- 建议
- 差异
- 在真实 PCB 中核对
- 返回工作台

#### 原始

Native snapshot with CURRENT highlighted red.

#### 建议

Same native snapshot, CURRENT de-emphasized, TARGET highlighted green.

Important:
The background routing remains the **current PCB routing**. It must not be represented as post-move routing.

#### 差异

CURRENT red + TARGET green + movement arrow.

### Exit

```
close review
→ revoke object URL / release Blob
→ clear transient markers
→ discard preview session
→ PCB remains unchanged
```

## 7. State machine

```
IDLE
  │ generate
  ▼
PLAN_READY
  │ open review
  ▼
CAPTURING_NATIVE_VIEW
  ├── success → REVIEW_ACTIVE
  └── unsupported / failure → PROPOSAL_FALLBACK

REVIEW_ACTIVE
  ├── switch original/proposed/diff → REVIEW_ACTIVE
  ├── verify on real PCB → NATIVE_VERIFY
  ├── accept → PLAN_ACCEPTED
  ├── reject → PLAN_REJECTED
  └── PCB fingerprint changes → STALE

NATIVE_VERIFY
  ├── return → REVIEW_ACTIVE
  └── PCB fingerprint changes → STALE

PLAN_ACCEPTED
  ├── executable → PRE_FLIGHT
  └── reference-only → ARCHIVED_REFERENCE
```

## 8. Freshness and interaction safety

A review snapshot is tied to:

- LayoutPlan id;
- semantic snapshot id;
- physical fingerprint;
- captured review region.

If the PCB is materially edited while the review is active:

```
current fingerprint != plan fingerprint
→ mark preview stale
→ disable Accept / Apply
→ ask user to regenerate
```

The review should not attempt to continuously repaint after arbitrary PCB edits in v1.0.

## 9. Context detection

Deterministic classification only; no LLM decision.

Inputs may include:

- percentage of components inside BoardRegion;
- number of routed primitives;
- number of locked / fixed components;
- obvious off-board staging concentration.

Initial policy:

- **Established**: most components placed + meaningful routing exists.
- **Partial**: meaningful anchors exist, but many components remain unresolved.
- **Greenfield**: little/no meaningful placement, little/no routing.

The threshold values must be calibrated on real boards before being promoted from heuristic to product contract.

## 10. P0 / P1 / P2 implementation

### P0 — high-value, low-risk

1. Capture review region with `getCurrentRenderedAreaImage()`.
2. Restore the user's previous viewport immediately after capture.
3. Show image in workbench using a grayscale CSS filter.
4. Overlay red CURRENT / green TARGET using the same review-region transform.
5. Add Original / Proposed / Diff controls.
6. Keep “在真实 PCB 中核对” using native indicator markers.
7. If native capture is unsupported, fall back to the existing v0.9.10 SVG review.
8. No native primitive mutation.

### P1 — after real-board validation

1. Multi-item LayoutPlan diff.
2. Component labels with collision-aware placement.
3. Layer / side badge.
4. Snapshot cache keyed by physical fingerprint + review region.
5. Partial-board classification.
6. Explicit stale-review banner after PCB edits.

### P2 — only if user value justifies it

1. Greenfield multi-stage proposal canvas.
2. Layer visibility controls in the proposal view.
3. Cross-side recommendation as a separately confirmed action.
4. Exportable review image / report.
5. Multiple alternative LayoutPlans.

## 11. What replaces v0.9.10

Do not delete the current renderer.

Reposition it:

- current v0.9.10 SVG renderer → **fallback / greenfield renderer**
- new native snapshot renderer → **default for existing / partial boards**
- native EasyEDA marker view → **second-stage real-canvas verification**

This minimizes regression risk.

## 12. Explicit non-goals

The review does not claim to show:

- post-move rerouted tracks;
- recomputed copper pours;
- autorouting results;
- EMI / SI / PI validation;
- manufacturing-ready final board state.

The product language must say “布局位置预览 / Placement Review”, not “最终 PCB 仿真”.

## 13. Acceptance criteria for P0

A real-board P0 passes only when all are true:

1. the native snapshot matches the visible EasyEDA region;
2. CURRENT overlay aligns with the real current component;
3. TARGET overlay aligns with the frozen LayoutPlan coordinate;
4. zooming/capture does not leave the user viewport changed after capture;
5. closing review leaves zero PCB mutations;
6. stale PCB edits invalidate review acceptance;
7. capture failure falls back cleanly to v0.9.10 renderer;
8. the same test passes on at least:
   - one established routed board;
   - one partial board;
   - one board with Bottom-side components.

## 14. Interview value

This architecture demonstrates a deliberate AI product boundary:

> reuse the domain editor as the rendering source of truth, keep AI preview non-destructive, make change review explicit, and fall back gracefully when native preview capabilities are unavailable.

The value is not “we can draw a PCB”; it is “we know when not to rebuild an existing expert tool.”
