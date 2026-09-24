# Workbench Window Contract

This document freezes the product and lifecycle rules for LayoutPilot's EasyEDA
host windows and PCB inspection mode.

## Product goal

The workbench must be easy to recover without forcing a permanent helper popup
onto the PCB. Window behavior is designed around **board visibility**,
**recoverability**, and **one obvious way back**.

## Host API boundary

EasyEDA extension UI has two relevant boundaries:

- `SYS_IFrame.openIFrame()` always opens a dialog-style iframe window. Width,
  height, X and Y are creation-time properties; there is no arbitrary runtime
  resize API for an already-open extension iframe.
- `SYS_PanelControl` controls EasyEDA's built-in left/right/bottom panels. It
  does not provide an extension-owned dock surface.

LayoutPilot therefore must not simulate a native dock or free-resize system by
creating extra helper dialogs.

## Expanded workbench

- The default workbench opens as a responsive right-side window.
- Width is derived from the current EasyEDA viewport and capped so a meaningful
  PCB area remains visible on the left.
- The EasyEDA maximize button remains available.
- Native EasyEDA minimize is disabled.
- Compact / standard / wide recreation presets remain removed.

## Hide behavior

The workbench provides **隐藏工作台**.

- Hiding uses `SYS_IFrame.hideIFrame()`; it does not create another iframe.
- No collapsed rectangle, return strip, mini dock, or evidence popup is kept on
  top of the PCB.
- The normal return shortcut is **Alt+Shift+L**.
- The top extension menu also exposes **返回 LayoutPilot 工作台（退出核对）**.
- A short EasyEDA toast may explain the current inspection target and return
  shortcut, then disappears automatically.

## Menu recovery

The extension menu action **重新打开 LayoutPilot 工作台** remains a recovery
boundary for stale host-window state.

It creates a fresh workbench using the current host viewport, records the new
instance first, and only then retires the previous instance.

This is intentionally separate from **返回工作台**, which prefers the exact
hidden workbench so transient in-memory review state can survive inspection.

## Popup-free canvas inspection

CURRENT / TARGET / component navigation and Owner evidence checking use the PCB
canvas itself as the review surface.

The sequence is:

1. capture/freeze the intended PCB tab and relevant review state;
2. hide the workbench;
3. execute the calibrated PCB camera command;
4. render selection / ghost / evidence markers;
5. show a short non-blocking EasyEDA toast;
6. return through Alt+Shift+L or the top menu;
7. clean review markers/session and restore the hidden workbench.

Owner confirmation stays in the workbench. The PCB inspection mode is read-only;
it does not need a Confirm button floating over the board.

## Plan decision surface

The existing LayoutPlan accept/reject iframe is intentionally retained only for
the actual plan decision flow. It is not used as a return bar for direct PCB
navigation.

This keeps decision UI separate from navigation UI.

## Navigation consistency

Owner evidence review and layout review navigation use the same camera model:

- freeze/activate the intended PCB tab;
- build a bounded physical review context;
- derive one center + calibrated 18–36% scale;
- call one explicit `zoomTo(x, y, scale, tabId)`.

Evidence review must not reintroduce `zoomToRegion()`, because real-board
validation showed it can report success without moving the visible canvas.

## Prohibited patterns

Do not reintroduce:

- native workbench minimize;
- compact/standard/wide recreation presets;
- helper return-strip / dock iframes;
- a dedicated Owner evidence iframe;
- a navigation-only LayoutPreview iframe;
- a stored iframe id as proof that the window is visible;
- arbitrary sleeps or retry loops for host-window recovery;
- production-only test switches;
- separate camera implementations for layout review and Owner evidence review.
