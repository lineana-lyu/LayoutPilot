# Workbench Window Contract

This document freezes the product and lifecycle rules for LayoutPilot's EasyEDA
host window.

## Host limitation

EasyEDA exposes extension HTML through `SYS_IFrame.openIFrame()`. The public
contract opens a **Dialog window** with creation-time width, height, X and Y.
There is no public API for arbitrary runtime resize or movement of an already
open extension iframe.

`SYS_PanelControl` only controls EasyEDA's built-in left/right/bottom panels;
it cannot host LayoutPilot's arbitrary extension HTML.

Therefore LayoutPilot must not pretend that it owns a native dock, free-resize
panel, or movable IDE sidebar.

## Real-board findings

Two host behaviors are now treated as unreliable for the primary workflow:

- `hideIFrame()` can report success while the visible workbench remains on
  screen in the tested EasyEDA runtime;
- runtime shortcut registration through `SYS_ShortcutKey` is BETA and the
  tested Alt+Shift+L return shortcut did not fire reliably.

Neither API is used as a required navigation dependency from v0.9.28 onward.

## Sidecar workbench

The workbench is intentionally designed as a narrow right-side **sidecar** with an explicit PCB-visibility budget:

- target width: about 26% of the EasyEDA viewport;
- readable width band: roughly 430–520 px where the viewport permits;
- ordinary desktop/laptop hosts cap the sidecar near 34% of viewport width;
- right aligned at creation time;
- tall enough for continuous decision work;
- no compact/standard/wide recreation presets;
- no native minimize requirement;
- no plugin-managed mini dock or return bar.

The width policy is derived from viewport ratios plus a minimum readable inspector width. It is not tuned to one board or screenshot resolution.

The workbench's internal layout collapses to a vertical master/detail view at
sidecar widths: the task queue occupies a bounded top section and the active
decision area uses the remaining height.

## PCB inspection

CURRENT / TARGET / component navigation and Owner evidence checking keep the
sidecar workbench visible.

The sequence is:

1. validate/freeze the intended PCB tab;
2. clear the previous LayoutPilot review markers/session;
3. execute the calibrated PCB camera command;
4. render selection / ghost / evidence markers;
5. keep the decision controls visible in the sidecar.

This removes the hide → inspect → return window roundtrip entirely.

Owner confirmation remains in the same workbench. Confirming an Owner retires
the active evidence inspection markers/session.

## Reopen / recovery

The extension exposes a one-click top-level **LayoutPilot 工作台** command.

That command is recovery-oriented: it creates a fresh workbench using the
current viewport before retiring a previous stale instance.

Users may optionally assign a native EasyEDA menu shortcut to that command from
EasyEDA's own shortcut settings / menu shortcut editor. LayoutPilot does not
register a runtime shortcut itself.

## Plan decision surface

The LayoutPlan accept/reject iframe is retained only for the actual plan decision
flow. It is separate from direct PCB navigation.

## Build-time interaction audit gate

The production bundle step runs `npm run verify:interaction` before esbuild. The verifier encodes the window architecture itself: routine inspection code may not reintroduce `hideIFrame()`, runtime shortcut return paths, compact/standard/wide controls, helper dock/evidence iframes, or navigation-only LayoutPreview state. `showIFrame()` remains allowed only for returning from the retained LayoutPlan decision surface. It also asserts that the shared PCB navigation entry points remain present.

This focused gate is intentionally scoped to the interaction architecture. The repository still contains legacy diagnostic code that predates a whole-project strict TypeScript gate; fixing unrelated diagnostic typing is not required to change the workbench lifecycle.

## Prohibited patterns

Do not reintroduce:

- reliance on `hideIFrame()` / `showIFrame()` for routine PCB inspection;
- runtime-registered return shortcuts as a required control path;
- compact/standard/wide window presets;
- helper return-strip / dock iframes;
- a dedicated Owner evidence iframe;
- a navigation-only LayoutPreview iframe;
- fake native docking through an iframe;
- arbitrary sleeps or retry loops for window recovery;
- production-only test switches.
