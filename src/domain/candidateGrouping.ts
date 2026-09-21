import type { CircuitGraph } from './circuitGraph';
import type { StructuralFeature } from './componentFeatures';
import { buildNetGroupingProfiles } from './netInformativeness';

export type GroupEvidenceCode =
	| 'CORE_SELECTED'
	| 'PASSIVE_SINGLE_CORE_NEIGHBOR'
	| 'BOUNDARY_KEPT_SEPARATE'
	| 'ISOLATED_UNGROUPED'
	| 'ONLY_LOW_INFORMATION_NETS'
	| 'MULTIPLE_CORE_CANDIDATES';

export interface GroupEvidence {
	code: GroupEvidenceCode;
	component?: string;
	core?: string;
	cores?: string[];
}

export interface CandidateGroup {
	id: string;
	coreComponentId: string;
	coreDesignator: string;
	satelliteComponentIds: string[];
	satelliteDesignators: string[];
	evidence: GroupEvidence[];
}

export interface CandidateGroupingResult {
	groups: CandidateGroup[];
	ungroupedComponentIds: string[];
	ungroupedDesignators: string[];
	boundaryComponentIds: string[];
	boundaryDesignators: string[];
	ambiguousComponentIds: string[];
	ambiguousDesignators: string[];
	ambiguityEvidence: GroupEvidence[];
}

export function buildCandidateGroups(
	graph: CircuitGraph,
	features: StructuralFeature[],
): CandidateGroupingResult {
	const featureById = new Map(features.map(feature => [feature.id, feature]));
	const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
	const netProfiles = buildNetGroupingProfiles(graph);

	const coreFeatures = features.filter(feature => feature.coreLevel === 'high');
	const coreIds = new Set(coreFeatures.map(feature => feature.id));

	const groups: CandidateGroup[] = coreFeatures.map(core => ({
		id: `group:${core.id}`,
		coreComponentId: core.id,
		coreDesignator: core.designator,
		satelliteComponentIds: [],
		satelliteDesignators: [],
		evidence: [{ code: 'CORE_SELECTED', component: core.designator }],
	}));

	const groupByCoreId = new Map(groups.map(group => [group.coreComponentId, group]));
	const ungrouped = new Set<string>();
	const boundary = new Set<string>();
	const ambiguous = new Set<string>();
	const ambiguityEvidence: GroupEvidence[] = [];

	for (const node of graph.nodes) {
		const feature = featureById.get(node.id);
		if (!feature || coreIds.has(node.id)) {
			continue;
		}

		if (feature.isBoundaryCandidate) {
			boundary.add(node.id);
			continue;
		}

		if (node.isIsolated) {
			ungrouped.add(node.id);
			continue;
		}

		if (feature.isPassiveCandidate) {
			const informativeCoreIds = new Set<string>();
			const lowInformationCoreIds = new Set<string>();

			for (const net of graph.nets) {
				if (!net.componentIds.includes(node.id)) {
					continue;
				}

				const profile = netProfiles.get(net.name);
				if (!profile) {
					continue;
				}

				const coreIdsOnNet = net.componentIds.filter(
					id => id !== node.id && coreIds.has(id),
				);

				for (const coreId of coreIdsOnNet) {
					if (profile.groupingWeight >= 0.5) {
						informativeCoreIds.add(coreId);
					}
					else {
						lowInformationCoreIds.add(coreId);
					}
				}
			}

			if (informativeCoreIds.size === 1) {
				const coreId = Array.from(informativeCoreIds)[0];
				const group = groupByCoreId.get(coreId);
				if (group) {
					group.satelliteComponentIds.push(node.id);
					group.satelliteDesignators.push(node.designator);
					group.evidence.push({
						code: 'PASSIVE_SINGLE_CORE_NEIGHBOR',
						component: node.designator,
						core: group.coreDesignator,
					});
					continue;
				}
			}

			if (informativeCoreIds.size > 1) {
				ambiguous.add(node.id);
				ambiguityEvidence.push({
					code: 'MULTIPLE_CORE_CANDIDATES',
					component: node.designator,
					cores: Array.from(informativeCoreIds)
						.map(id => featureById.get(id)?.designator ?? id),
				});
				continue;
			}

			if (informativeCoreIds.size === 0 && lowInformationCoreIds.size > 0) {
				ambiguous.add(node.id);
				ambiguityEvidence.push({
					code: 'ONLY_LOW_INFORMATION_NETS',
					component: node.designator,
					cores: Array.from(lowInformationCoreIds)
						.map(id => featureById.get(id)?.designator ?? id),
				});
				continue;
			}
		}

		ungrouped.add(node.id);
	}

	const designatorOf = (id: string) =>
		nodeById.get(id)?.designator ?? featureById.get(id)?.designator ?? id;

	return {
		groups,
		ungroupedComponentIds: Array.from(ungrouped),
		ungroupedDesignators: Array.from(ungrouped).map(designatorOf),
		boundaryComponentIds: Array.from(boundary),
		boundaryDesignators: Array.from(boundary).map(designatorOf),
		ambiguousComponentIds: Array.from(ambiguous),
		ambiguousDesignators: Array.from(ambiguous).map(designatorOf),
		ambiguityEvidence,
	};
}
