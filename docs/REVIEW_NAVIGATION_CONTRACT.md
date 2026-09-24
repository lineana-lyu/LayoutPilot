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

6. **Review intent is a physical PCB region, not a global zoom percentage**
   - The domain layer derives a bounded contextual region from the clicked
     component / CURRENT / TARGET geometry.
   - Tiny passives receive a practical minimum neighborhood; larger components
     scale their context with footprint size up to an explicit upper bound.
   - TARGET framing includes Owner context when it is available.

7. **One region-fit camera command is authoritative**
   - The final camera operation is
     `zoomToRegion(left, right, top, bottom, documentTabId)`.
   - All four coordinates and the tab id are explicit.
   - No second percentage-based `zoomTo()` call is allowed after the region
     has been resolved.

## Why percentage zoom is intentionally rejected

EasyEDA documents `zoomTo(..., scaleRatio, ...)` as an absolute percentage:
`500` means `500%`. Real-board validation on v0.9.23 confirmed that this is
the wrong abstraction for LayoutPilot review navigation: the target PCB area was
located correctly, but forcing a 300–500% scale massively over-zoomed small
passives.

The same validation also showed that the region returned by the beta `zoomTo()`
runtime cannot be treated as a trustworthy semantic postcondition in this path:
the API reported a roughly 3.5 mil viewport that excluded the requested center
while the editor had visibly navigated to the correct PCB neighborhood.

LayoutPilot therefore uses the region itself as the contract and lets
`zoomToRegion()` fit that region to the real editor viewport.

## Invariants

- A review click cannot change which PCB it refers to after the scene is built.
- Cleanup cannot change editor focus.
- A replaced iframe cannot clean up the current iframe's state.
- Camera state has one writer in the navigation transaction.
- Navigation never depends on an implicit selection/marker bounding box.
- Navigation never applies a second absolute percentage zoom after fitting a
  physical PCB review region.
- Review regions must contain finite coordinates and positive width/height.

## Patterns intentionally rejected

The following patterns must not be reintroduced into the production navigation
path:

- `zoomTo(undefined, undefined, undefined, tabId)` as a viewport getter;
- absolute percentage tuning such as 300/400/500/700/800% for component review;
- selection-driven `zoomToSelectedPrimitives()`;
- indicator markers with automatic zoom enabled;
- using the live current PCB as the click's identity after cleanup;
- activating a PCB inside marker cleanup;
- treating split-screen metadata as the authority for PCB identity;
- chaining `zoomToRegion()` and a second `zoomTo(...scaleRatio...)`;
- trusting beta `zoomTo()` return geometry as proof that the visible editor
  viewport is semantically correct;
- arbitrary sleeps, retries, board-specific component ids, or test-mode
  branches to hide lifecycle races.

## Regression coverage

`tests/reviewNavigationFraming.ts` covers the domain framing policy:

- tiny passive -> practical minimum review neighborhood;
- medium component -> footprint-relative context;
- large component -> bounded maximum context;
- TARGET/Owner context -> a larger minimum review neighborhood.

Real-board acceptance is still required because EasyEDA's region fitting is host
runtime behavior. The pure tests protect LayoutPilot's geometry policy and
prevent percentage-zoom regressions from being reintroduced.
