# Real-world Benchmark A — STM32 Minimum System Board

## Source

Open-source JLCEDA Pro project:

**STM32最小系统板 — STM32F103C8T6 + Type-C + CH340**

Source page:
https://oshwhub.com/time_up_flowering_phase/stm32-minimum-system-board

The source project is a JLCEDA **专业版** project and can be cloned directly into the user's workspace.

## Why this benchmark

This board is a better Phase 1 fixture than the hand-built toy PCB because it naturally contains:

- STM32 MCU
- CH340 USB-UART IC
- Type-C connector
- power-related components
- resistors / capacitors
- shared GND / power rails
- local signal nets

This creates the exact structural problems LayoutPilot needs to solve:

1. multiple candidate core ICs;
2. passive components around each core;
3. connector/boundary components;
4. global rails that must not collapse unrelated modules;
5. ambiguous components that should not be force-assigned.

## Test workflow

1. Open the source project page.
2. Click **克隆工程**.
3. Open the cloned PCB in JLCEDA Pro.
4. Install the latest LayoutPilot artifact from the Phase 1 branch.
5. Run, in order:
   - 检查当前 PCB
   - 检查网络连接
   - 检查电路关系图
   - 检查结构特征
   - 检查候选功能块

## What we evaluate

We do **not** require a predefined perfect grouping.

Instead we inspect whether LayoutPilot:

- identifies STM32 and CH340 as plausible structural cores;
- avoids treating shared GND / power rails as strong grouping evidence;
- keeps Type-C / connector components as boundary candidates;
- groups local signal passives with evidence;
- surfaces ambiguous components instead of guessing;
- preserves the underlying Net / Pad evidence for every decision.

## Product principle

From this benchmark onward, LayoutPilot should be validated on cloned/open-source real projects rather than asking a beginner user to manually construct artificial Net relationships.
