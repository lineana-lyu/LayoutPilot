import type { CircuitGraph, CircuitNet } from './circuitGraph';

export type NetGroupingClass =
	| 'global-ground'
	| 'global-power'
	| 'named-signal'
	| 'high-fanout'
	| 'local';

export type NetElectricalRole = 'ground' | 'power' | 'signal';
export type NetNameOrigin = 'global' | 'explicit' | 'generated';

export interface NetGroupingProfile {
	netName: string;
	classification: NetGroupingClass;
	electricalRole: NetElectricalRole;
	nameOrigin: NetNameOrigin;
	fanout: number;
	groupingWeight: number;
	reasons: string[];
}

const GROUND_PATTERNS = [
	/^GND$/i,
	/^AGND$/i,
	/^DGND$/i,
	/^PGND$/i,
	/^VSS[A-Z0-9_+.-]*$/i,
];

const POWER_BASE_PREFIXES = [
	'VCC',
	'VDD',
	'AVDD',
	'DVDD',
	'PVDD',
	'VBAT',
	'VIN',
	'VOUT',
	'VSYS',
	'VUSB',
	'VBUS',
];

const SIGNAL_SUFFIX_TOKENS = new Set([
	'SENSE',
	'SNS',
	'EN',
	'ENABLE',
	'PG',
	'PGOOD',
	'GOOD',
	'FB',
	'FEEDBACK',
	'MON',
	'MONITOR',
	'DET',
	'DETECT',
	'CTRL',
]);

function matchesAny(name: string, patterns: RegExp[]): boolean {
	return patterns.some(pattern => pattern.test(name));
}

function hasSignalLikeSuffix(name: string): boolean {
	const tokens = name
		.toUpperCase()
		.split(/[_+.-]+/)
		.filter(Boolean);

	return tokens.slice(1).some(token => SIGNAL_SUFFIX_TOKENS.has(token));
}

export function isPowerLikeNetName(name: string): boolean {
	const normalized = name.trim().toUpperCase();

	if (/^\+?[0-9]+(?:\.[0-9]+)?V[0-9A-Z_+.-]*$/.test(normalized)) {
		return true;
	}

	for (const prefix of POWER_BASE_PREFIXES) {
		if (normalized === prefix) {
			return true;
		}

		if (
			normalized.startsWith(prefix)
			&& /^[A-Z0-9_+.-]+$/.test(normalized.slice(prefix.length))
			&& !hasSignalLikeSuffix(normalized)
		) {
			return true;
		}
	}

	return false;
}

/**
 * EasyEDA-derived netlists commonly use designator-pin fallback names when the
 * schematic net has no explicit human label, e.g. U4_5, C9_1, Q2_3.
 *
 * Keep this concept separate from electrical role: a generated local net can
 * still be topologically informative, but its text must not be treated as
 * explicit semantic intent.
 */
export function isGeneratedNetName(name: string): boolean {
	const normalized = name.trim().toUpperCase();

	return (
		/^\$/i.test(normalized)
		|| /^N\$/i.test(normalized)
		|| /^NET[-_(]/i.test(normalized)
		|| /^NETC/i.test(normalized)
		|| /^[A-Z]+[0-9]+_(?:[0-9]+|[A-Z][0-9]+|EP|PAD[0-9]+)$/i.test(normalized)
	);
}

function isHumanReadableSignalName(name: string): boolean {
	return Boolean(name) && !isGeneratedNetName(name);
}

export function classifyNetForGrouping(
	net: CircuitNet,
	totalComponents: number,
): NetGroupingProfile {
	const name = net.name.trim();
	const fanout = net.componentIds.length;

	if (matchesAny(name, GROUND_PATTERNS)) {
		return {
			netName: net.name,
			classification: 'global-ground',
			electricalRole: 'ground',
			nameOrigin: 'global',
			fanout,
			groupingWeight: 0,
			reasons: ['ground-like global rail'],
		};
	}

	if (isPowerLikeNetName(name)) {
		return {
			netName: net.name,
			classification: 'global-power',
			electricalRole: 'power',
			nameOrigin: 'global',
			fanout,
			groupingWeight: 0.15,
			reasons: ['power-like rail'],
		};
	}

	const generated = isGeneratedNetName(name);
	const fanoutRatio = totalComponents > 0 ? fanout / totalComponents : 0;

	if (generated) {
		if (fanout >= 4 && fanoutRatio >= 0.3) {
			return {
				netName: net.name,
				classification: 'high-fanout',
				electricalRole: 'signal',
				nameOrigin: 'generated',
				fanout,
				groupingWeight: 0.2,
				reasons: [
					'generated designator-pin net name',
					`high fanout: ${fanout}/${totalComponents} components`,
				],
			};
		}

		return {
			netName: net.name,
			classification: 'local',
			electricalRole: 'signal',
			nameOrigin: 'generated',
			fanout,
			groupingWeight: 1,
			reasons: [
				'generated designator-pin net name',
				'local topology can be informative even without an explicit label',
			],
		};
	}

	if (isHumanReadableSignalName(name)) {
		return {
			netName: net.name,
			classification: 'named-signal',
			electricalRole: 'signal',
			nameOrigin: 'explicit',
			fanout,
			groupingWeight: 1,
			reasons: ['human-readable non-power signal net'],
		};
	}

	if (fanout >= 4 && fanoutRatio >= 0.3) {
		return {
			netName: net.name,
			classification: 'high-fanout',
			electricalRole: 'signal',
			nameOrigin: 'generated',
			fanout,
			groupingWeight: 0.2,
			reasons: [`high fanout: ${fanout}/${totalComponents} components`],
		};
	}

	return {
		netName: net.name,
		classification: 'local',
		electricalRole: 'signal',
		nameOrigin: 'generated',
		fanout,
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
