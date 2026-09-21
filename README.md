# LayoutPilot

> AI-assisted PCB layout planning for JLCEDA / EasyEDA Pro.

LayoutPilot is an experimental PCB layout copilot focused on **human-AI collaboration**, not one-click autonomous placement.

The product thesis is simple:

> Engineers should not place every component manually, but an opaque AI should not be allowed to invent electrical ownership or move PCB components without evidence, review, verification, and rollback.

## Current stage — v0.7 Interview MVP

The current implementation closes a conservative end-to-end loop:

```
Read real PCB
  ↓
Circuit Graph / Structural Features
  ↓
Deterministic Ownership Relations
  ↓
AI Semantic Inference
  ↓
Immutable Semantic Snapshot
  ↓
Human confirmation for unresolved owner
  ↓
Constraint Policy
  ↓
Pad-aware Physical Planner
  ↓
Safety gates + baseline DRC
  ↓
Explicit user confirmation
  ↓
Move one unrouted component
  ↓
Read-back verification + post-move DRC
  ↓
Commit or automatic rollback
  ↓
Undo with concurrent-edit protection
```

## AI authority boundary

AI is currently allowed to infer semantic roles such as a decoupling capacitor.

AI is **not** allowed to assign electrical ownership.

Ownership comes from deterministic PCB topology or an explicit human decision:

```
PCB facts → Ownership Resolver
AI context → Semantic role
Human decision → ExplicitOwnershipHint
```

Downstream Constraint Policy combines those evidence sources without changing their provenance.

## Why Semantic Snapshot exists

Constraint Preview and physical execution must consume the exact AI result the engineer reviewed.

One AI analysis therefore produces a serializable, immutable Semantic Snapshot with:

- board semantic fingerprint;
- normalized component context;
- inference result;
- validator result;
- provider/model identity;
- creation time.

If relevant PCB semantics change, the snapshot becomes stale. Physical X/Y movement alone does not invalidate semantic identity.

## Controlled physical execution

v0.7 only executes a very narrow placement case:

- role is `decoupling-capacitor`;
- constraint is `near(owner)`;
- confidence is medium/high;
- owner has been explicitly confirmed by the user;
- component is unlocked;
- subject and owner are on the same component layer;
- subject has no existing routed primitives;
- pad geometry is available;
- an approximate collision-free candidate exists;
- the PCB passes DRC before execution.

The target is anchored to the owner's **shared power pad**, not the IC body centre.

After moving one component, LayoutPilot reads coordinates back and runs DRC again. A post-move DRC failure triggers automatic rollback.

This is a controlled Placement PoC, **not** a production-grade autorouter or global placement optimizer.

## Architecture

```
EasyEDA Extension API
        ↓
Circuit Structure Layer
        ↓
Deterministic Ownership Layer
        ↓
Semantic Context
        ↓
AI Gateway + Validator
        ↓
Semantic Snapshot
        ↓
Human Decision Layer
        ↓
Constraint Evaluation
        ↓
Physical Context / Planner
        ↓
Placement Command
        ↓
Read-back + DRC + Undo
```

## Engineering principles

- deterministic electrical facts have priority over probabilistic AI output;
- missing evidence fails closed;
- preview and execution share the same Constraint Evaluation;
- no hard-coded component designators or board-specific exceptions;
- no test mode or synthetic fixture path in production;
- already-routed components are not moved in v0.7;
- failed execution should restore the before-state;
- Undo must not overwrite a newer manual edit.

## Test isolation

Synthetic fixtures are restricted to `tests/`.

Production code under `src/` consumes real EasyEDA primitives and has no test-only flags, fixture injection, or special-case component branches.

CI runs domain tests, gateway syntax validation, extension compilation, and package generation.

## Documentation

- `docs/SEMANTIC_SNAPSHOT_V07.md`
- `docs/HUMAN_OWNERSHIP_CONFIRMATION_V07.md`
- `docs/CONTROLLED_PHYSICAL_EXECUTION_V07.md`
- `docs/POC_PLAN.md` — original feasibility milestone for historical context

## Status

- [x] PCB component / connectivity read
- [x] Circuit Graph
- [x] Structural feature extraction
- [x] Candidate grouping
- [x] Deterministic Ownership Relations
- [x] AI semantic inference + Validator
- [x] Semantic Snapshot / staleness control
- [x] Human owner confirmation
- [x] Constraint Policy
- [x] Pad-aware controlled placement candidate
- [x] Baseline/post-move DRC transaction boundary
- [x] Coordinate read-back verification
- [x] Automatic rollback
- [x] Undo with concurrent-edit protection
- [ ] Production-grade footprint/courtyard collision
- [ ] Board-edge / mechanical keepout model
- [ ] Return-path / via planning
- [ ] Routed-board re-optimization
- [ ] Multi-component placement optimization

## License

Apache-2.0.
