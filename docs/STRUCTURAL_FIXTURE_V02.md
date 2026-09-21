# LayoutPilot Structural Fixture v0.2

This fixture validates robust candidate grouping inside the real JLCEDA editor.

It is intentionally **not a production circuit**. The goal is to test structural reasoning under shared power / ground rails, multiple core ICs, a connector boundary, and an ambiguous passive.

## Components

Use easy-to-find PCB components. Exact manufacturer part numbers are not important.

| Designator | Suggested type | Role in fixture |
|---|---|---|
| U1 | existing STM32 / large IC | Core candidate A |
| U2 | any 8–16 pin IC (e.g. NE555 / op-amp / small MCU) | Core candidate B |
| R1 | resistor | Local passive for U1 |
| R2 | resistor | Local passive for U2 |
| C1 | capacitor | Ambiguous passive on shared rails |
| J1 | 2–4 pin connector | Boundary candidate |

Target total: **6 components**.

## Required networks

Use JLCEDA's “连接焊盘” tool to create these logical connections.

The exact physical pad numbers do not matter. Use different free pads on U1/U2 as needed.

### Local signal A

```
U1 ─── R1
```

Name may be auto-generated. It only needs to be a unique local net.

### Local signal B

```
U2 ─── R2
```

Again, any unique local net is fine.

### Shared GND rail

Connect one pad from each of:

```
U1
U2
R1
R2
C1
J1
```

to the same network and rename the network to:

`GND`

### Shared power rail

Connect one pad from:

```
U1
U2
C1
```

to the same network and rename it:

`3V3`

### Connector local signal

Connect another pad on J1 to a free pad on U1 using a unique local net.

This tests that J1 remains a boundary candidate even when it has a local connection.

## Expected structural behavior

LayoutPilot should **not** treat GND / 3V3 as strong evidence that every component belongs to one module.

Expected grouping:

```
候选功能块 1
核心器件：U1
外围器件：R1

候选功能块 2
核心器件：U2
外围器件：R2

存在歧义的器件：C1
边界器件候选：J1
```

C1 is intentionally ambiguous because its only useful relationships are shared power / ground rails.

## Acceptance criteria

- [ ] U1 is a core candidate
- [ ] U2 is a core candidate
- [ ] R1 groups under U1
- [ ] R2 groups under U2
- [ ] C1 is marked ambiguous, not force-assigned
- [ ] J1 remains a boundary candidate
- [ ] GND and 3V3 do not collapse all components into one group

## Why this fixture exists

A naive graph would see shared GND / power nets and conclude many unrelated components are neighbors.

LayoutPilot must preserve the complete electrical graph while using a separate **grouping-informativeness layer** so global rails do not dominate functional grouping.
