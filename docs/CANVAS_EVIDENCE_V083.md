# v0.8.3 Canvas Evidence Review

## Purpose

Human ownership confirmation should not be a blind choice between labels such as `U11` and `U12`.

LayoutPilot therefore adds a read-only evidence-review layer between deterministic candidate generation and explicit human confirmation.

```
rail-domain candidates
        ↓
shared power-pad evidence
        ↓
current PCB geometry distance
        ↓
native PCB canvas locate / highlight
        ↓
engineer review
        ↓
explicit Owner confirmation
```

## Evidence shown

For each Host candidate, the workbench may show:

- component designator, resolved device name, manufacturer and footprint;
- compact deterministic net/pad topology;
- the closest pad pair that shares the relevant power rail;
- straight-line pad-centre distance in mil.

Example:

```
+3.3V · C12.2 ↔ U11.8 · 186.4 mil
```

## Authority boundary

Physical distance is **evidence, not an ownership rule**.

A closer device does not automatically become the Owner. Distance is affected by the current placement and can be misleading before placement has been optimized.

The displayed value is:

- Euclidean pad-centre distance;
- measured from current PCB geometry;
- not routed track length;
- not current-loop impedance;
- not an SI/PI metric;
- not a ranking score used by the Ownership Resolver.

Candidate cards may be ordered by this distance to reduce visual search cost, but confirmation remains an explicit human action.

## Native canvas review

The workbench uses official EasyEDA/JLCEDA editor APIs:

- `pcb_SelectControl.doSelectPrimitives()` to select the subject and Host;
- `dmt_EditorControl.zoomToSelectedPrimitives()` to fit the pair;
- `dmt_EditorControl.generateIndicatorMarkers()` to mark the relevant power pads and draw an evidence line.

When the user chooses **在 PCB 中定位**, the workbench yields the screen so the engineer can inspect the real PCB canvas.

The action is read-only with respect to PCB design data. It changes transient editor UI state only:

- current selection;
- viewport zoom;
- indicator markers.

It does not move components, change nets, edit copper, or alter the Semantic Snapshot.

## Interaction rule

Host cards deliberately separate:

- **在 PCB 中定位** — inspect evidence;
- **确认 Owner** — create a `user-confirmed-owner-v1` decision.

Viewing a candidate must never implicitly confirm it.

## Fail-closed behavior

Canvas review is blocked if the active document cannot be verified as a PCB document.

If pad geometry is unavailable, LayoutPilot may still show deterministic topology evidence, but it must not invent a physical distance.
