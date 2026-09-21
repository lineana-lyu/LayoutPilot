import type { CircuitGraph, CircuitNet } from './circuitGraph';

export type NetGroupingClass =
	| 'global-ground'
	| 'global-power'
	| 'high-fanout'
	| 'local';

export interface NetGroupingProfile {
	netName: string;
	classification: NetGroupingClass;
	groupingWeight: number;
	reasons: string[];
}

const GROUND_PATTERNS = [
	/^GND$/i,
	/^AGND$/i,
	/^DGND$/i,
	/^PGND$/i,
	/^VSS[A-Z0-9_+-]*$/i,
];

const POWER_PATTERNS = [
	/^VCC[A-Z0-9_+-]*$/i,
	/^VDD[A-Z0-9_+-]*$/i,
	/^AVDD[A-Z0-9_+-]*$/i,
	/^DVDD[A-Z0-9_+-]*$/i,
	/^VBAT[A-Z0-9_+-]*$/i,
	/^VIN[A-Z0-9_+-]*$/i,
	/^VOUT[A-Z0-9_+-]*$/i,
	/^\+?[0-9]+(?:\.[0-9]+)?V[0-9A-Z_+-]*$/i,
	/^[0-9]+V[0-9A-Z_+-]*$/i,
];

function matchesAny(name: string, patterns: RegExp[]): boolean {
	return patterns.some(pattern => pattern.test(name));
}

export function classifyNetForGrouping(
	net: CircuitNet,
	totalComponents: number,
): NetGroupingProfile {
	const name = net.name.trim();

	if (matchesAny(name, GROUND_PATTERNS)) {
		return {
			netName: net.name,
			classification: 'global-ground',
			groupingWeight: 0,
			reasons: ['ground-like global rail'],
		};
	}

	if (matchesAny(name, POWER_PATTERNS)) {
		return {
			netName: net.name,
			classification: 'global-power',
			groupingWeight: 0.15,
			reasons: ['power-like rail'],
		};
	}

	const fanout = net.componentIds.length;
	const fanoutRatio = totalComponents > 0 ? fanout / totalComponents : 0;
	if (fanout >= 4 && fanoutRatio >= 0.3) {
		return {
			netName: net.name,
			classification: 'high-fanout',
			groupingWeight: 0.2,
			reasons: [`high fanout: ${fanout}/${totalComponents} components`],
		};
	}

	return {
		netName: net.name,
		classification: 'local',
		groupingWeight: 1,
		reasons: ['local/informative net'],
	};
}

export function buildNetGroupingProfiles(
	graph: CircuitGraph,
): Map<string, NetGroupingProfile> {
	return new Map(
		graph.nets.map(net => [
			net.name,
			classifyNetForGrouping(net, graph.nodes.length),
		]),
	);
}
