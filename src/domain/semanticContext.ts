import type { CandidateGroupingResult } from './candidateGrouping';
import type { CircuitGraph } from './circuitGraph';
import type { StructuralFeature } from './componentFeatures';
import { getCoreAssociationCandidates } from './coreAssociation';
import {
	resolveOwnershipRelation,
	type ExplicitOwnershipHint,
	type OwnershipRelationType,
} from './ownershipRelation';
import {
	buildNetGroupingProfiles,
	type NetElectricalRole,
	type NetGroupingClass,
	type NetNameOrigin,
} from './netInformativeness';

export interface SemanticComponentMetadata {
	id: string;
	designator: string;
	name?: string;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
	otherProperty?: unknown;
}

type SemanticPropertyValue = string | number | boolean;

function asPropertyRecord(value: unknown): Record<string, SemanticPropertyValue> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(value)
			.filter(([, item]) =>
				typeof item === 'string'
				|| typeof item === 'number'
				|| typeof item === 'boolean',
			),
	) as Record<string, SemanticPropertyValue>;
}

function getPropertyCaseInsensitive(
	properties: Record<string, SemanticPropertyValue>,
	key: string,
): SemanticPropertyValue | undefined {
	const exact = properties[key];
	if (exact !== undefined) {
		return exact;
	}

	const normalized = key.trim().toLowerCase();
	const matchedKey = Object.keys(properties)
		.find(candidate => candidate.trim().toLowerCase() === normalized);

	return matchedKey ? properties[matchedKey] : undefined;
}

export function resolveComponentDisplayName(
	rawName: string | undefined,
	otherProperty: unknown,
): string | undefined {
	if (!rawName) {
		return undefined;
	}

	const templateMatch = rawName.match(/^=\{(.+)\}$/);
	if (!templateMatch) {
		return rawName;
	}

	const properties = asPropertyRecord(otherProperty);
	const resolved = getPropertyCaseInsensitive(properties, templateMatch[1]);

	if (resolved === undefined || resolved === '') {
		return undefined;
	}

	return String(resolved);
}

export interface SemanticNetContext {
	netName: string;
	classification: NetGroupingClass;
	electricalRole: NetElectricalRole;
	nameOrigin: NetNameOrigin;
	fanout: number;
	groupingWeight: number;
	selfPads: string[];
	peerEndpoints: Array<{
		designator: string;
		padNumber: string;
	}>;
	coreDesignators: string[];
}

export interface SemanticOwnershipContext {
	relation: OwnershipRelationType;
	ownerDesignator?: string;
	hostDesignators: string[];
	sharedSignalNets: string[];
	railNets: string[];
	explanation: string;
}

export interface SemanticComponentContext {
	componentId: string;
	designator: string;
	name?: string;
	rawName?: string;
	value?: string;
	manufacturerPart?: string;
	referencePrefix: string;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
	otherProperty?: unknown;
	structuralRole: 'ambiguous';
	connectedNets: SemanticNetContext[];
	relatedCoreDesignators: string[];
	ownership: SemanticOwnershipContext;
	informativeSignalNets: string[];
	lowInformationNets: string[];
	missingEvidence: string[];
}

export function buildSemanticContexts(
	graph: CircuitGraph,
	features: StructuralFeature[],
	grouping: CandidateGroupingResult,
	metadata: SemanticComponentMetadata[],
	explicitOwnershipHints: ExplicitOwnershipHint[] = [],
): SemanticComponentContext[] {
	const featureById = new Map(features.map(feature => [feature.id, feature]));
	const metadataById = new Map(metadata.map(item => [item.id, item]));
	const coreIds = new Set(
		getCoreAssociationCandidates(features).map(feature => feature.id),
	);
	const designatorById = new Map(graph.nodes.map(node => [node.id, node.designator]));
	const netProfiles = buildNetGroupingProfiles(graph);

	return grouping.ambiguousComponentIds.map(componentId => {
		const feature = featureById.get(componentId);
		const meta = metadataById.get(componentId);

		if (!feature) {
			throw new Error(`Missing structural feature for ambiguous component ${componentId}`);
		}

		const properties = asPropertyRecord(meta?.otherProperty);
		const resolvedName = resolveComponentDisplayName(meta?.name, meta?.otherProperty);
		const valueProperty = getPropertyCaseInsensitive(properties, 'Value');
		const manufacturerPartProperty =
			getPropertyCaseInsensitive(properties, 'Manufacturer Part')
			?? getPropertyCaseInsensitive(properties, 'Manufacturer Part Number')
			?? getPropertyCaseInsensitive(properties, 'MPN');

		const ownershipResult = resolveOwnershipRelation(
			graph,
			features,
			componentId,
			explicitOwnershipHints,
		);

		const connectedNets: SemanticNetContext[] = graph.nets
			.filter(net => net.componentIds.includes(componentId))
			.map(net => {
				const profile = netProfiles.get(net.name);
				if (!profile) {
					throw new Error(`Missing net profile for ${net.name}`);
				}

				const selfPads = net.endpoints
					.filter(endpoint => endpoint.componentId === componentId)
					.map(endpoint => endpoint.padNumber);

				const peerEndpoints = net.endpoints
					.filter(endpoint => endpoint.componentId !== componentId)
					.map(endpoint => ({
						designator: endpoint.designator,
						padNumber: endpoint.padNumber,
					}));

				const coreDesignators = Array.from(new Set(
					net.componentIds
						.filter(id => id !== componentId && coreIds.has(id))
						.map(id => designatorById.get(id) ?? id),
				));

				return {
					netName: net.name,
					classification: profile.classification,
					electricalRole: profile.electricalRole,
					nameOrigin: profile.nameOrigin,
					fanout: profile.fanout,
					groupingWeight: profile.groupingWeight,
					selfPads,
					peerEndpoints,
					coreDesignators,
				};
			})
			.sort((a, b) =>
				b.groupingWeight - a.groupingWeight
				|| a.netName.localeCompare(b.netName),
			);

		const relatedCoreDesignators = Array.from(new Set(
			connectedNets.flatMap(net => net.coreDesignators),
		));

		const informativeSignalNets = connectedNets
			.filter(net =>
				net.electricalRole === 'signal'
				&& net.groupingWeight >= 0.5,
			)
			.map(net => net.netName);

		const lowInformationNets = connectedNets
			.filter(net =>
				net.electricalRole !== 'signal'
				|| net.groupingWeight < 0.5,
			)
			.map(net => net.netName);

		const missingEvidence: string[] = [];

		if (!resolvedName) {
			missingEvidence.push('component-name');
		}
		if (!meta?.footprintName) {
			missingEvidence.push('footprint');
		}
		if (!meta?.manufacturer) {
			missingEvidence.push('manufacturer');
		}
		if (!meta?.otherProperty) {
			missingEvidence.push('value-or-extra-properties');
		}
		if (informativeSignalNets.length === 0) {
			missingEvidence.push('informative-signal-net');
		}
		if (ownershipResult.relation === 'unknown') {
			missingEvidence.push('ownership-relation');
		}

		return {
			componentId,
			designator: feature.designator,
			name: resolvedName,
			rawName: meta?.name,
			value: valueProperty !== undefined ? String(valueProperty) : undefined,
			manufacturerPart: manufacturerPartProperty !== undefined
				? String(manufacturerPartProperty)
				: undefined,
			referencePrefix: feature.referencePrefix,
			manufacturer: meta?.manufacturer,
			supplier: meta?.supplier,
			footprintName: meta?.footprintName,
			otherProperty: meta?.otherProperty,
			structuralRole: 'ambiguous',
			connectedNets,
			relatedCoreDesignators,
			ownership: {
				relation: ownershipResult.relation,
				ownerDesignator: ownershipResult.ownerDesignator,
				hostDesignators: ownershipResult.hostDesignators,
				sharedSignalNets: ownershipResult.sharedSignalNets,
				railNets: ownershipResult.railNets,
				explanation: ownershipResult.explanation,
			},
			informativeSignalNets,
			lowInformationNets,
			missingEvidence,
		};
	});
}
