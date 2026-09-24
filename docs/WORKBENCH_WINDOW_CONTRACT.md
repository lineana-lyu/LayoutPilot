# Workbench Window Contract

This document freezes the product and lifecycle rules for LayoutPilot's EasyEDA
host windows.

## Product goal

The workbench must remain easy to recover without unnecessarily covering the PCB.
Window behavior is therefore designed around **board visibility** and
**recoverability**, not around decorative size presets.

## Host API boundary

EasyEDA currently exposes only four iframe lifecycle operations:

- open;
- show;
- hide;
- close.

The host API does not expose an arbitrary runtime resize operation for an already
open extension iframe. Width, height and initial X/Y are supplied only when the
iframe is opened.

LayoutPilot therefore must not present fixed "compact / standard / wide" presets
as if they were free resizing.

## Expanded workbench

- The default workbench opens as a right-side responsive window.
- Width is derived from the current EasyEDA viewport and capped so a meaningful
  PCB area remains visible on the left.
- The EasyEDA maximize button remains available for workflows that need the full
  workbench.
- Native EasyEDA minimize is disabled.

## Collapse behavior

LayoutPilot provides its own **收起工作台** control.

- The active workbench iframe is hidden, not destroyed, so transient review state
  can survive a short PCB inspection.
- A small, visually branded LayoutPilot return strip is opened in the top-right.
- The return strip has no native minimize/maximize controls.
- Restoring from the strip first attempts to reveal the exact hidden workbench.

This replaces EasyEDA's native collapsed rectangle, which can visually merge into
the editor chrome and has shown unstable placement after the host application is
minimized/restored.

## Menu recovery

The extension menu action **打开 LayoutPilot 工作台** is a recovery boundary.

It must never trust a stored iframe merely because `showIFrame()` returns true.
Current host builds can retain stale iframe identity after the whole application
has been minimized/restored.

The menu action therefore:

1. opens a fresh workbench using the current viewport;
2. persists the new instance id;
3. retires the previous instance only after the replacement is alive.

Workflow data remains in extension storage, so this recovery does not require
production test branches or board-specific state.

## Internal return path

Preview/evidence return actions use a different path:

1. attempt to show the exact hidden workbench;
2. preserve transient in-memory review state when the host iframe is still valid;
3. create a fresh frame only if the hidden instance is no longer recognized.

This distinction is intentional: menu open prioritizes recovery; internal return
prioritizes continuity.

## Navigation consistency

Owner evidence review and layout preview navigation use the same camera model:

- freeze/activate the intended PCB tab;
- build a bounded physical review context;
- derive one center + calibrated 18–36% scale;
- call one explicit `zoomTo(x, y, scale, tabId)`.

Evidence review must not reintroduce `zoomToRegion()`, because real-board
validation showed it can return success without moving the visible canvas.

## Prohibited patterns

Do not reintroduce:

- native workbench minimize;
- compact/standard/wide recreation presets;
- a stored iframe id as proof that the window is visible;
- menu recovery based only on `showIFrame()`;
- arbitrary sleeps or retry loops for host-window recovery;
- production-only test switches;
- separate camera implementations for layout review and Owner evidence review.
