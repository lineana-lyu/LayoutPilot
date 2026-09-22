# v0.7 EasyEDA Runtime Smoke Test

This checklist validates the real EasyEDA Pro runtime path. It is intentionally separate from automated tests.

Do **not** run the first write test on an important design. Duplicate a small PCB project and use the copy.

## Test board requirements

Use a disposable PCB with:

- one clear IC owner candidate;
- one unrouted 0402/0603-style decoupling capacitor on the owner's power rail and GND;
- a simple closed board outline made from straight segments or one simple non-curved polyline;
- a clean DRC baseline;
- enough free space around the owner power pin;
- components whose runtime BBoxes can be read successfully;
- no intentional overlap around the test area.

For the first positive-path run, avoid curved board edges and complex keepout geometry. Those cases are expected to fail closed in v0.7.

## Pre-flight

1. Install the package built from `feat/v0.7-interview-mvp`.
2. Open the disposable PCB.
3. Run EasyEDA DRC manually and confirm it passes.
4. Record the test capacitor's X/Y position.
5. Confirm the test capacitor is not locked and has no routed track/fill contact.
6. Start the configured local AI Gateway.

## Positive path

### 1. Analyze

Run:

`LayoutPilot → 分析当前 PCB（AI 语义）`

Expected:

- a Semantic Snapshot ID is shown;
- a PCB fingerprint is shown;
- the target capacitor is classified as `decoupling-capacitor` or otherwise explains why it cannot be used;
- no PCB primitive moves.

### 2. Confirm unresolved owner

Run:

`LayoutPilot → 确认待决 Owner（人工）`

Expected for a rail-domain decoupling capacitor:

- candidate host ICs are shown;
- selecting the intended IC stores a human decision;
- AI is not called again;
- PCB geometry is unchanged.

### 3. Preview constraints

Run:

`LayoutPilot → 查看布局建议`

Expected:

- the same Semantic Snapshot ID is reused;
- no new AI request is made;
- the target capacitor receives `near(owner)` only after explicit owner confirmation;
- the proposal is `preview-eligible` only for medium/high confidence.

### 4. Apply controlled placement

Run:

`LayoutPilot → 应用受控布局建议`

Before accepting the confirmation dialog, verify it displays:

- subject component;
- confirmed owner;
- owner power pad and power net;
- owner GND reference;
- loop geometry proxy;
- before/after coordinates;
- approximate clearance;
- that physical collision checks use EasyEDA measured component BBoxes.

Accept the move.

Expected:

- exactly one component moves;
- component rotation is unchanged;
- coordinate read-back reports PASS;
- post-move DRC reports PASS;
- a Placement Command ID is shown.

Inspect the board visually. The capacitor should be adjacent to the relevant owner power pad, not merely near the IC body centre.

### 5. Undo

Run:

`LayoutPilot → 撤销上次受控布局`

Expected:

- the capacitor returns to the exact recorded before-position;
- coordinate read-back reports PASS;
- DRC runs again.

## Negative gates

Each case below should block execution rather than "try anyway".

### Locked subject

Lock the capacitor and attempt Apply.

Expected: blocked before mutation.

### Routed subject

Route at least one test-capacitor pad and attempt Apply.

Expected: blocked because v0.7 does not reposition routed components.

### Dirty DRC baseline

Introduce a known DRC violation before Apply.

Expected: blocked before mutation because there is no clean baseline.

### Unsupported board outline

Use a duplicate board with a curved or ambiguous/multi-ring outline.

Expected: board-boundary gate rejects automatic execution.

### Component keepout

Create a `NO_COMPONENTS` region covering all valid nearby positions.

Expected: planner reports no legal candidate or blocks on unsupported keepout geometry.

### Routed-after-apply Undo

1. Apply a successful LayoutPilot move on the disposable board.
2. Add a real track or copper connection to the moved capacitor without moving the capacitor.
3. Run Undo.

Expected:

- Undo is blocked before mutation;
- the routed capacitor does not move;
- the old Placement Command is marked `superseded` because the engineer has materially continued the design.

### Dirty Undo baseline

After a successful LayoutPilot move, introduce an unrelated DRC violation and run Undo.

Expected: Undo is blocked before mutation because a clean inverse-transaction baseline cannot be established.

### Concurrent manual edit before Undo

1. Apply a successful LayoutPilot move.
2. Manually move the same capacitor elsewhere.
3. Run Undo.

Expected: LayoutPilot refuses to overwrite the newer engineer edit.

## Failure recovery check

A post-move DRC failure must produce one of two explicit states:

1. **Rollback verified** — the original X/Y is restored and no successful command is kept.
2. **Rollback not verified** — LayoutPilot states that the PCB requires immediate manual inspection.

There must be no silent "unknown final state".

## Release gate

Do not merge this branch to `main` or tag the interview build until the positive path and the critical negative gates above have been observed in the real EasyEDA client.

Record runtime version, test PCB name/copy, and pass/fail notes when executing the smoke test.
