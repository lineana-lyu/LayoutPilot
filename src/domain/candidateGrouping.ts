import type { CircuitGraph } from './circuitGraph';
import type { StructuralFeature } from './componentFeatures';

export type GroupEvidenceCode =
	| 'CORE_SELECTED'
	| 'PASSIVE_SINGLE_CORE_NEIGHBOR'
	| 'BOUNDARY_KEPT_SEPARATE'
	| 'ISOLATED_UNGROUPED';

export interface GroupEvidence {
	code: GroupEvidenceCode;
	component?: string;
	core?: string;
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
}

export function buildCandidateGroups(
	graph: CircuitGraph,
	features: StructuralFeature[],
): CandidateGroupingResult {
	const featureById = new Map(features.map(feature => [feature.id, feature]));
	const nodeById = new Map(graph.nodes.map(node => [node.id, node]));

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
			const neighboringCoreIds = node.neighborComponentIds.filter(id => coreIds.has(id));
			if (neighboringCoreIds.length === 1) {
				const coreId = neighboringCoreIds[0];
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
	};
}
