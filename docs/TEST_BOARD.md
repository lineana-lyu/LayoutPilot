# LayoutPilot Test Board v0.1

This fixture is intentionally simple. It exists only to verify JLCEDA Extension API behavior before testing AI layout logic.

## Goal

Create a tiny PCB with a known set of components so LayoutPilot can verify:

1. component enumeration;
2. component properties;
3. position / rotation;
4. lock / unlock;
5. deterministic movement;
6. read-back verification.

No schematic is required for Phase 0.

## Board setup

Create a new JLCEDA / EasyEDA Pro project named:

`LayoutPilot-TestBoard`

Use the automatically created PCB document.

Draw a simple rectangular board outline, approximately:

`50 mm × 30 mm`

## Place these components

The exact manufacturer part is not important for Phase 0. Use common library footprints/components that are easy to find.

| Reference role | Suggested type | Purpose |
|---|---|---|
| U1 | MCU / IC | Main test component |
| J1 | USB / connector | Edge-style component |
| R1 | resistor | Small passive |
| R2 | resistor | Small passive |
| C1 | capacitor | Small passive |
| C2 | capacitor | Small passive |
| LED1 / D1 | LED | Visual component |
| SW1 | button | User-interface component |

Target total: **8 components**.

Do not route any traces yet.

## Suggested rough placement

```
┌──────────────────────────────────┐
│ J1                               │
│                                  │
│          C1   U1   C2            │
│          R1        R2            │
│                                  │
│     LED1                 SW1      │
└──────────────────────────────────┘
```

The placement does not need to be electrically meaningful yet.

## Phase 0 test sequence

### Test A — Inspect PCB

Run:

`LayoutPilot → Inspect PCB`

Expected result:

- component count should be 8;
- the popup should list some references;
- developer console should contain structured component data.

### Test B — Inspect one component

Next implementation will use `U1` as the stable test target.

### Test C — Controlled write

Only after read tests pass:

- move U1 by a small deterministic offset;
- read its new coordinates;
- lock U1;
- verify lock state;
- unlock / restore it.

## Safety rule

Never use a production PCB for Phase 0 write tests.

This fixture is disposable and should be the only board used until the API write loop is proven.
