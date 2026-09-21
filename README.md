# LayoutPilot

> AI-assisted PCB layout planning for JLCEDA / EasyEDA Pro.

LayoutPilot is an experimental PCB layout copilot focused on **human-AI collaboration**, not one-click autonomous placement.

The core product hypothesis is:

> Engineers do not want to place every component manually, but they also cannot safely hand all placement decisions to an opaque auto-layout system.

LayoutPilot aims to:
- read real schematic / PCB structure from JLCEDA Extension APIs;
- compress many components into functional blocks;
- infer low-risk layout constraints automatically;
- ask only a small number of high-impact questions;
- generate a layout plan before execution;
- preserve user-approved regions and allow local re-optimization;
- verify the result with deterministic checks.

## Current stage

**Phase 0 — API Feasibility PoC**

Before adding LLMs or placement algorithms, we first verify that a JLCEDA extension can complete this loop:

```
Open PCB
  ↓
Read components
  ↓
Read component properties / connectivity
  ↓
Move one test component
  ↓
Lock it
  ↓
Read back and verify
```

If this loop is not stable, the product scope will be adjusted before deeper implementation.

## Planned architecture

```
JLCEDA Extension API
        ↓
Circuit Structure Layer
        ↓
Functional Block / Constraint Layer
        ↓
AI Decision Layer
        ↓
Human Confirmation
        ↓
Placement Execution
        ↓
Layout Verification
```

## Product status

- [x] Problem discovery
- [x] Official auto-layout / competitor research
- [x] Initial product positioning
- [ ] JLCEDA API feasibility PoC
- [ ] Functional block extraction
- [ ] Layout constraint schema
- [ ] Layout plan UI
- [ ] Placement engine integration
- [ ] Benchmark evaluation

## Documentation

See `docs/POC_PLAN.md` for the first technical milestone.

## License

Apache-2.0 is planned for the extension code unless changed later.
