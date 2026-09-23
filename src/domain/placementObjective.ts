export const DEFAULT_RELOCATION_WEIGHT = 0.05;

export interface PlacementObjective {
	loopProxyMil: number;
	movementMil: number;
	relocationWeight: number;
	totalCost: number;
}

export function evaluatePlacementObjective(input: {
	loopProxyMil: number;
	movementMil: number;
	relocationWeight?: number;
}): PlacementObjective {
	const relocationWeight = input.relocationWeight ?? DEFAULT_RELOCATION_WEIGHT;
	if (
		!Number.isFinite(input.loopProxyMil)
		|| input.loopProxyMil < 0
		|| !Number.isFinite(input.movementMil)
		|| input.movementMil < 0
		|| !Number.isFinite(relocationWeight)
		|| relocationWeight < 0
	) {
		throw new Error('布局目标函数输入无效。');
	}

	return {
		loopProxyMil: input.loopProxyMil,
		movementMil: input.movementMil,
		relocationWeight,
		totalCost: input.loopProxyMil + input.movementMil * relocationWeight,
	};
}

export function placementImprovement(
	baseline: PlacementObjective,
	candidate: PlacementObjective,
): number {
	return baseline.totalCost - candidate.totalCost;
}

export function isStrictPlacementImprovement(
	baseline: PlacementObjective,
	candidate: PlacementObjective,
	epsilon = 1e-6,
): boolean {
	return placementImprovement(baseline, candidate) > epsilon;
}
