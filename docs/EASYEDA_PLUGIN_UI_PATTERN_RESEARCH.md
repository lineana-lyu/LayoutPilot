# EasyEDA Plugin UI Pattern Research

This note records the UI patterns reviewed before v0.9.27. It exists so future
changes can be evaluated against the host platform rather than reintroducing
window workarounds.

## 1. EasyEDA iframe windows are dialogs, not dockable plugin panels

Official API:

- `SYS_IFrame.openIFrame(html, width, height, id, props)`
- width / height / x / y are supplied when the window is created;
- the API explicitly opens a **Dialog window**;
- lifecycle APIs are open / show / hide / close.

Reference:
https://prodocs.easyeda.com/en/api/reference/pro-api.sys_iframe.openiframe.html

Implication for LayoutPilot:

A "free resize" or IDE-style dock cannot be honestly implemented by repeatedly
recreating extension iframes. Compact / standard / wide presets were therefore
removed rather than expanded.

## 2. EasyEDA panel control is not an extension-owned dock API

`SYS_PanelControl` exposes open/close/lock operations for EasyEDA's existing
left, right and bottom panels.

Reference:
https://prodocs.easyeda.com/en/api/reference/pro-api.sys_panelcontrol.html

There is no API here for mounting LayoutPilot's arbitrary HTML as a native panel.

Implication:

Do not fake a side dock by opening another iframe that merely looks docked.

## 3. Official Pad Fanout plugin: main iframe + mini iframe

Repository:
https://github.com/easyeda/eext-pad-fanout

The official plugin opens a main `index.html` iframe. On minimize it closes the
main dialog and opens `mini.html` as a small helper iframe, with MessageBus used
to restore the main window and synchronize state.

This is a valid EasyEDA pattern for a tool whose mini UI still contains useful
live controls. However, it does not fit LayoutPilot's PCB review mode:

- LayoutPilot's reviewer wants maximum board visibility;
- a mini return strip has no useful PCB-editing controls;
- keeping it only as a "way back" turns navigation into persistent chrome.

v0.9.26 briefly used the same conceptual pattern. Real-board testing rejected it.

## 4. Design Audit plugin: direct editor jump

Repository:
https://github.com/kong522/design-audit

Its issue rows select the target primitive and invoke an editor zoom directly.
The inspection action is attached to the result row rather than opening a second
review dialog.

Transferable principle:

**Use the PCB editor as the inspection surface.** UI should initiate the jump,
then get out of the way.

LayoutPilot keeps its calibrated coordinate camera rather than copying
`zoomToSelectedPrimitives()`, because real-board testing already established
the camera behavior needed for CURRENT / TARGET / Owner context.

## 5. Shortcut and toast are native lightweight return affordances

Official APIs:

- `SYS_ShortcutKey.registerShortcutKey(...)`
- `SYS_Message.showToastMessage(...)`

References:
https://prodocs.easyeda.com/en/api/reference/pro-api.sys_shortcutkey.registershortcutkey.html
https://prodocs.easyeda.com/en/api/reference/pro-api.sys_message.html

EasyEDA describes `SYS_Message` as non-intrusive user notification UI.

Transferable pattern:

- register one predictable return shortcut;
- keep a permanent top-menu return command as a visible fallback;
- use a short toast for transient target/evidence context;
- do not keep an auxiliary iframe alive just to provide a return button.

## v0.9.27 decision

LayoutPilot adopts **popup-free canvas inspection**:

1. decision originates in the workbench;
2. workbench hides;
3. PCB camera/selection/evidence markers show the requested context;
4. a short toast names the target and return shortcut;
5. `Alt+Shift+L` or the LayoutPilot top-menu return command cleans inspection
   state and restores the workbench;
6. Owner confirmation remains in the main workbench;
7. the LayoutPlan accept/reject iframe remains only for a genuine plan decision.

Rejected for this workflow:

- native iframe minimize;
- mini return-strip iframe;
- dedicated evidence-review iframe;
- navigation-only preview iframe;
- fake native docking through an iframe;
- more fixed workbench size presets.


## v0.9.28 real-board correction: sidecar, not hide/return

v0.9.27 attempted popup-free inspection by hiding the main workbench and using a
runtime-registered return shortcut. Real-board testing rejected both assumptions:

- the tested EasyEDA runtime kept the workbench visibly on screen even after
  `hideIFrame()` was called;
- the BETA `SYS_ShortcutKey.registerShortcutKey()` return shortcut did not
  trigger reliably.

The official API surface explains why this should not be a required production
path: iframe hide/show and shortcut registration are BETA, and there is still no
public move/resize/dock API for extension-owned HTML.

The revised transferable pattern is therefore:

1. keep exactly one extension iframe;
2. make it intentionally narrow (about 500–620 px) and right aligned;
3. adapt the internal UI to sidecar width instead of recreating window sizes;
4. let PCB navigation update the editor behind/beside the sidecar while decision
   controls remain visible;
5. expose one stable top-level `headerMenus` command to reopen/recover the
   workbench;
6. let users assign a native EasyEDA menu shortcut themselves if they want one,
   rather than registering a BETA runtime shortcut.

This keeps the interaction continuous and removes the entire hide → return
lifecycle from routine PCB inspection.


## 6. PCB canvas right-click is not an available extension surface

`SYS_RightClickMenu.changeMenu()` initially looked like a possible popup-free
return affordance. The current official contract rules it out for LayoutPilot:
the API only supports right-click customization for items in the bottom
component / symbol / footprint / reuse-module lists. It does **not** expose the
PCB canvas context menu, and it is BETA.

Therefore LayoutPilot must not build its PCB inspection lifecycle around a
canvas right-click command. The stable manifest-level `LayoutPilot 工作台`
header command remains the recovery entry point.

Reference:
https://prodocs.easyeda.com/cn/api/reference/pro-api.sys_rightclickmenu.changemenu.html

## v0.9.29 decision

The v0.9.28 sidecar model is retained and tightened around a PCB-visibility
budget. The sidecar targets roughly 26% of the host width, keeps a readable
430–520 px range where possible, and caps ordinary desktop/laptop occupancy near
34%.

Direct inspection does not hide the sidecar, register a runtime shortcut, create
a return iframe, or rely on an unsupported PCB canvas right-click menu.

The artifact build now includes a focused `verify:interaction` gate that rejects
reintroduction of the failed hide/show, runtime-shortcut, helper-popup and fixed
size-preset patterns before bundling.
