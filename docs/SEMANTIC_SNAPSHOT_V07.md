# v0.7 Semantic Snapshot

## Problem

Phase 3B separated deterministic ownership from AI semantic role inference, but two menu actions still executed independent model calls:

```
AI semantic analysis -> inference A

constraint preview -> inference B
```

That made the downstream layout explanation non-reproducible. A user could see one role in the analysis dialog and a different role in constraint preview.

## Decision

One explicit AI analysis creates one immutable, serializable **Semantic Snapshot**.

```
PCB semantic state
      ↓
board fingerprint
      ↓
AI semantic inference
      ↓
validator
      ↓
Semantic Snapshot
      ↓
constraint preview
```

Constraint preview is a pure consumer of the active snapshot. It must not call the model.

## Snapshot contents

Each snapshot stores:

- schema version;
- snapshot ID;
- board fingerprint;
- creation time;
- normalized semantic context per ambiguous component;
- AI inference;
- validator result;
- provider/model identity;
- failed / blocked / mock status.

Runtime-only values such as raw EDA objects are intentionally excluded.

## Fingerprint boundary

The semantic board fingerprint includes facts that can change semantic interpretation:

- component identity and reference;
- component name/value/part/footprint;
- net membership and pad endpoints;
- deterministic ownership relation;
- normalized connected-net context.

It intentionally excludes physical X/Y coordinates.

Reason: applying a placement move must not invalidate the statement "C14 is a decoupling capacitor". Electrical/semantic changes should invalidate the snapshot; physical movement alone should not.

## Staleness behavior

Before constraint preview, LayoutPilot rebuilds the current semantic fingerprint.

- same fingerprint -> reuse the active snapshot;
- different fingerprint -> stop and ask for a new semantic analysis;
- no snapshot -> stop and ask the user to analyze first.

The system never silently refreshes AI output while the user is asking to preview constraints.

## Scope choice

The snapshot store is session-memory only for v0.7.

This is intentional. The interview MVP needs consistency between analysis and preview, not cross-restart persistence. Persistence can later be added behind the same serializable snapshot contract without changing Constraint Policy.

## Acceptance criteria

1. Run AI analysis once: a snapshot ID and fingerprint are shown.
2. Run constraint preview: zero new model calls are made.
3. Re-run constraint preview without PCB semantic changes: the same snapshot is reused.
4. Change a net/component semantic input: the old snapshot is rejected as stale.
5. A snapshot can be JSON serialized.
6. Runtime-only EDA metadata cannot leak into the snapshot.
7. Existing Validator and deterministic ownership boundaries remain unchanged.


## Cross-menu workflow state

Semantic Snapshot continuity between EasyEDA menu actions uses `eda.sys_Storage`. Consumers still recompute the PCB semantic fingerprint before reuse.
