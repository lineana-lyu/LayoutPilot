# v0.7 Human Ownership Confirmation

## Why this exists

A semantic role and an ownership relation are different decisions.

Example:

```
C14 = decoupling capacitor      <- AI semantic role
C14 is on +3.3V / GND           <- PCB facts
C14 may serve U6 / U8 / U9      <- deterministic rail-domain relation
```

The system must not convert that into `owner=U6` by guessing.

## Decision model

Human confirmation is stored as a separate decision artifact:

```
Semantic Snapshot
  AI role = decoupling-capacitor
        +
Human Ownership Decision
  owner = U6
        ↓
ExplicitOwnershipHint
        ↓
Ownership Resolver
  relation = explicit-owner
        ↓
Constraint Policy
  near(C14, U6)
```

The AI snapshot is not rewritten.

## Eligibility in v0.7

The interview MVP only asks for owner confirmation when:

- the Semantic Snapshot entry passed Validator;
- AI role is `decoupling-capacitor`;
- deterministic relation is `rail-domain`;
- at least one deterministic Host candidate exists.

This is intentionally narrow. Bridge/shared-signal/unknown relations are not forced into a unique owner.

## User interaction

The extension uses the native EasyEDA/JLCEDA `showSelectDialog` API.

For each eligible component the user can:

- select one Host;
- leave it unconfirmed;
- replace a previous choice;
- clear a previous choice.

## Lifecycle

Human decisions are scoped to one Semantic Snapshot ID.

Creating a new Semantic Snapshot clears old in-memory decisions. This prevents decisions made against old semantic evidence from leaking into a new analysis session.

## Constraint behavior

Constraint Preview:

1. verifies the underlying PCB semantic fingerprint still matches the Snapshot;
2. converts current human decisions to `ExplicitOwnershipHint[]`;
3. rebuilds effective semantic contexts through the existing deterministic Ownership Resolver;
4. reuses the frozen AI inference;
5. runs the existing Constraint Policy.

No AI request is made during confirmation or constraint preview.

## Safety invariant

Without explicit confirmation:

```
rail-domain -> no unique owner -> no near(owner)
```

With explicit confirmation:

```
rail-domain + human owner decision
-> explicit-owner
-> policy may generate near(owner)
```

The user adds evidence; the policy threshold is not weakened.
