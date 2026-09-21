# Phase 0 — JLCEDA Extension API Feasibility PoC

## Why this phase exists

LayoutPilot should not start with an LLM or a placement algorithm.

The first product risk is more basic:

**Can a third-party JLCEDA Pro extension reliably read the current PCB and perform controlled, reversible component operations?**

This PoC exists to answer that question with evidence.

## Success criteria

The PoC passes only when all six capabilities are demonstrated on a real PCB project.

| ID | Capability | Acceptance criteria |
|---|---|---|
| P0-1 | Read components | Extension can enumerate all PCB components and show count + references |
| P0-2 | Read properties | Extension can inspect at least one selected component's reference, position, rotation and available properties |
| P0-3 | Read connectivity | Extension can obtain usable Net / Pin / Netlist information for later grouping |
| P0-4 | Move component | Extension can move one explicitly selected test component to a controlled new coordinate |
| P0-5 | Lock component | Extension can set and verify the component lock state |
| P0-6 | Verify result | Extension reads the component back and confirms position / lock state after the operation |

## Safety constraints

The PoC must not:
- bulk-move components;
- modify traces, vias or zones;
- run auto-routing;
- call an LLM;
- infer electrical correctness;
- silently mutate the board.

Every write action must be initiated through an explicit PoC command and target only one test component.

## Proposed PoC commands

The first extension UI/menu should expose only:

1. **Inspect PCB** — show component count and basic project information.
2. **Inspect Test Component** — inspect one selected / configured component.
3. **Move Test Component** — move that component by a small deterministic offset.
4. **Lock / Unlock Test Component** — toggle lock state.
5. **Verify Test Component** — read back and display current state.

## Go / No-Go decision

### GO

Proceed to Phase 1 if:
- all six acceptance criteria pass;
- component identity remains stable after modifications;
- operations are predictable enough for user-confirmed placement execution.

### CONDITIONAL GO

Proceed with reduced scope if:
- reading works reliably;
- writes require workarounds or have API limitations;
- preview / undo capabilities need an alternate UX.

### NO-GO

Reframe LayoutPilot as a layout-analysis / recommendation extension if stable component write operations cannot be achieved.

## Phase 1 after PoC

Only after this PoC passes do we build:

```
Components + Nets
      ↓
Circuit Graph
      ↓
Functional Block Candidates
      ↓
Constraint Extraction
      ↓
AI Semantic Understanding
```

This sequencing prevents us from spending time on AI logic before verifying the editor-control layer.
