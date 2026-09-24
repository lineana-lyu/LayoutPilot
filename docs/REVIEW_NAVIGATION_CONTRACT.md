# PCB Review Navigation Contract

This document defines the production navigation path used when a reviewer clicks a
component, CURRENT position, or TARGET position in LayoutPilot's layout review.

The goal is not to make camera movement "usually work". The goal is to make the
navigation transaction deterministic, observable, and safe when EasyEDA has
multiple PCB tabs and multiple extension iframes.

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

6. **One explicit camera command is authoritative**
   - The final camera operation is
     `zoomTo(centerX, centerY, scaleRatio, documentTabId)`.
   - X, Y, scale and tab id are all explicit. No parameter is omitted.
   - The focus region is converted to a bounded continuous scale policy before
     the call.

7. **Returned viewport is a postcondition**
   - `zoomTo()` returns the viewport EasyEDA actually applied.
   - LayoutPilot verifies that the requested center is visible and that the
     returned viewport is not materially wider than the requested local review
     region.
   - A host call that returns an off-target or whole-board-like viewport is a
     visible navigation failure, not a silent success.

## Invariants

- A review click cannot change which PCB it refers to after the scene is built.
- Cleanup cannot change editor focus.
- A replaced iframe cannot clean up the current iframe's state.
- Camera state has one writer in the navigation transaction.
- Navigation never depends on an implicit selection/marker bounding box.
- Camera parameters are finite and the focus region has positive area.
- Failure messages identify the camera postcondition that failed.

## Patterns intentionally rejected

The following patterns must not be reintroduced into the production navigation
path:

- `zoomTo(undefined, undefined, undefined, tabId)` as a viewport getter;
- omitted/undefined zoom parameters;
- selection-driven `zoomToSelectedPrimitives()`;
- indicator markers with automatic zoom enabled;
- using the live current PCB as the click's identity after cleanup;
- activating a PCB inside marker cleanup;
- treating split-screen metadata as the authority for PCB identity;
- chaining multiple camera APIs when only the final camera state matters;
- arbitrary sleeps, retries, board-specific component ids, or test-mode
  branches to hide lifecycle races.

## Regression coverage

`tests/reviewCameraPolicy.ts` covers:

- bounded close-up / normal / large-region scale calculation;
- invalid and zero-span regions;
- a valid returned viewport;
- an off-target viewport;
- a viewport that is too wide for a component-level review.

Real-board acceptance still matters because EasyEDA's editor camera API is host
runtime behavior. The pure tests protect LayoutPilot's contract and prevent the
previous architecture regressions from being reintroduced.
