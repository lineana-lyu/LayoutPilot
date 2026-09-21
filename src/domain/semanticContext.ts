import type { CandidateGroupingResult } from './candidateGrouping';
import type { CircuitGraph } from './circuitGraph';
import type { StructuralFeature } from './componentFeatures';
import { buildNetGroupingProfiles, type NetGroupingClass } from './netInformativeness';

export interface SemanticComponentMetadata {
	id: string;
	designator: string;
	name?: string;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
	otherProperty?: unknown;
}

export interface SemanticNetContext {
	netName: string;
	classification: NetGroupingClass;
	groupingWeight: number;
	selfPads: string[];
	peerEndpoints: Array<{
		designator: string;
		padNumber: string;
	}>;
	coreDesignators: string[];
}

export interface SemanticComponentContext {
	componentId: string;
	designator: string;
	name?: string;
	referencePrefix: string;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
	otherProperty?: unknown;
	structuralRole: 'ambiguous';
	connectedNets: SemanticNetContext[];
	relatedCoreDesignators: string[];
	informativeSignalNets: string[];
	lowInformationNets: string[];
	missingEvidence: string[];
}

export function buildSemanticContexts(
	graph: CircuitGraph,
	features: StructuralFeature[],
	grouping: CandidateGroupingResult,
	metadata: SemanticComponentMetadata[],
): SemanticComponentContext[] {
	const featureById = new Map(features.map(feature => [feature.id, feature]));
	const metadataById = new Map(metadata.map(item => [item.id, item]));
	const coreIds = new Set(grouping.groups.map(group => group.coreComponentId));
	const designatorById = new Map(graph.nodes.map(node => [node.id, node.designator]));
	const netProfiles = buildNetGroupingProfiles(graph);

	return grouping.ambiguousComponentIds.map(componentId => {
		const feature = featureById.get(componentId);
		const meta = metadataById.get(componentId);

		if (!feature) {
			throw new Error(`Missing structural feature for ambiguous component ${componentId}`);
		}

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
					groupingWeight: profile.groupingWeight,
					selfPads,
					peerEndpoints,
					coreDesignators,
				};
			})
			.sort((a, b) => b.groupingWeight - a.groupingWeight || a.netName.localeCompare(b.netName));

		const relatedCoreDesignators = Array.from(new Set(
			connectedNets.flatMap(net => net.coreDesignators),
		));

		const informativeSignalNets = connectedNets
			.filter(net => net.groupingWeight >= 0.5)
			.map(net => net.netName);

		const lowInformationNets = connectedNets
			.filter(net => net.groupingWeight < 0.5)
			.map(net => net.netName);

		const missingEvidence: string[] = [];

		if (!meta?.name) {
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
		if (relatedCoreDesignators.length === 0) {
			missingEvidence.push('direct-core-relation');
		}

		return {
			componentId,
			designator: feature.designator,
			name: meta?.name,
			referencePrefix: feature.referencePrefix,
			manufacturer: meta?.manufacturer,
			supplier: meta?.supplier,
			footprintName: meta?.footprintName,
			otherProperty: meta?.otherProperty,
			structuralRole: 'ambiguous',
			connectedNets,
			relatedCoreDesignators,
			informativeSignalNets,
			lowInformationNets,
			missingEvidence,
		};
	});
}
