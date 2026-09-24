# PCB Review Navigation Contract

This document defines the production navigation path used when a reviewer clicks a
component, CURRENT position, or TARGET position in LayoutPilot's layout review.

The goal is not to make camera movement "usually work". The goal is to make the
navigation transaction deterministic and reviewable when EasyEDA has multiple PCB
tabs and multiple extension iframes.

## Source-of-truth chain

1. **Review scene owns the PCB identity**
   - `collectLayoutReviewScenes()` freezes `documentTabId` when the review
     scene is collected.
   - A later click must use that frozen tab. The live current tab is not an
     authority because cleanup, another iframe, or the user can change focus.

2. **Activate before validation**
   - The frozen PCB tab is activated and read back.
   - Both `documentType === PCB` and exact `tabId` equality are required.
   - Physical/semantic freshness validation then runs against that same board.

3. **Cleanup is focus-neutral**
   - Removing LayoutPilot markers addresses the stored `documentTabId`
     directly.
   - Cleanup must never activate another PCB as a side effect.

4. **Preview iframe uses active-window ownership**
   - Every preview/navigation iframe gets a unique id.
   - Only the iframe whose id still matches the stored active id may clear
     preview state or reopen the workbench.
   - A stale close callback from a replaced iframe is therefore inert.

5. **Selection and indicators are presentation only**
   - Primitive selection and CURRENT/TARGET markers help the user see what is
     being reviewed.
   - They never determine camera geometry and never request automatic zoom.

6. **Review intent is a physical PCB context**
   - The domain layer derives a bounded contextual region from the clicked
     component / CURRENT / TARGET geometry.
   - Tiny passives receive a practical minimum neighborhood; larger components
     scale their context with footprint size up to an explicit upper bound.
   - TARGET framing includes Owner context when it is available.

7. **One explicit coordinate camera command is authoritative**
   - The final camera operation is `zoomTo(x, y, scaleRatio, documentTabId)`.
   - `x/y` are the center of the bounded physical review context.
   - `scaleRatio` is derived from that context and clamped to a moderate
     18–36% range. It is never a 300–800% close-up.
   - No `zoomToRegion()` call runs in the final path.

## Why this camera path is intentionally narrow

Real-board validation separated two EasyEDA beta-runtime behaviors:

- v0.9.23 proved `zoomTo(x, y, scaleRatio, tabId)` reliably moved to the
  requested PCB center, but our 300–500% policy was far too tight;
- v0.9.24 proved `zoomToRegion(...)` can return `true` while the visible PCB
  viewport does not move at all.

External EasyEDA tooling reports the same practical split: working arbitrary
point framing uses `zoomTo()` with roughly tens of percent (about 15–40%), while
`zoomToRegion()` may behave as a no-op in current gateway/runtime combinations.
LayoutPilot therefore keeps the known-good coordinate navigation path and scales
it from the already bounded physical review context.

The beta `zoomTo()` return geometry is still not interpreted as a semantic
postcondition because v0.9.23 returned geometry inconsistent with what was
visibly rendered.

## Invariants

- A review click cannot change which PCB it refers to after the scene is built.
- Cleanup cannot change editor focus.
- A replaced iframe cannot clean up the current iframe's state.
- Camera state has one writer in the navigation transaction.
- Navigation never depends on an implicit selection/marker bounding box.
- Navigation uses one explicit `zoomTo()` command whose scale is bounded to the
  calibrated review range.
- Review regions must contain finite coordinates and positive width/height.

## Patterns intentionally rejected

The following patterns must not be reintroduced into the production navigation
path:

- `zoomTo(undefined, undefined, undefined, tabId)` as a viewport getter;
- unbounded percentage tuning such as 300/400/500/700/800% for component review;
- selection-driven `zoomToSelectedPrimitives()`;
- indicator markers with automatic zoom enabled;
- using the live current PCB as the click's identity after cleanup;
- activating a PCB inside marker cleanup;
- treating split-screen metadata as the authority for PCB identity;
- using `zoomToRegion()` as the final camera writer when real-board validation
  shows it can return success without moving the visible PCB;
- chaining multiple camera APIs for one review click;
- trusting beta `zoomTo()` return geometry as proof that the visible editor
  viewport is semantically correct;
- arbitrary sleeps, retries, board-specific component ids, or test-mode
  branches to hide lifecycle races.

## Regression coverage

`tests/reviewNavigationFraming.ts` covers the domain framing and camera policy:

- tiny passive -> practical minimum review neighborhood;
- medium component -> footprint-relative context;
- large component -> bounded maximum context;
- TARGET/Owner context -> a larger minimum review neighborhood;
- context span -> calibrated 18–36% coordinate zoom;
- invalid camera geometry -> fail closed.

Real-board acceptance is still required because EasyEDA's region fitting is host
runtime behavior. The pure tests protect LayoutPilot's geometry policy and
prevent percentage-zoom regressions from being reintroduced.
