import type { CircuitGraph } from './circuitGraph';
import type { StructuralFeature } from './componentFeatures';
import { getCoreAssociationCandidates } from './coreAssociation';
import { buildNetGroupingProfiles, type NetGroupingClass } from './netInformativeness';

export type OwnershipRelationType =
	| 'explicit-owner'
	| 'single-core'
	| 'bridge'
	| 'shared-signal'
	| 'rail-domain'
	| 'unknown';

export interface ExplicitOwnershipHint {
	componentId: string;
	ownerComponentId: string;
	source: string;
}

export interface OwnershipRelationEvidence {
	kind:
		| 'explicit-owner'
		| 'exclusive-signal'
		| 'shared-signal'
		| 'power-domain'
		| 'ground-ignored';
	netName?: string;
	hostDesignators?: string[];
	detail: string;
}

export interface OwnershipRelationResult {
	componentId: string;
	designator: string;
	relation: OwnershipRelationType;
	ownerDesignator?: string;
	hostDesignators: string[];
	sharedSignalNets: string[];
	railNets: string[];
	evidence: OwnershipRelationEvidence[];
	explanation: string;
}

interface NetHostContext {
	netName: string;
	classification: NetGroupingClass;
	hostIds: string[];
	hostDesignators: string[];
	componentCount: number;
}

function buildNetHostContexts(
	graph: CircuitGraph,
	features: StructuralFeature[],
	componentId: string,
): NetHostContext[] {
	const profiles = buildNetGroupingProfiles(graph);
	const coreCandidates = getCoreAssociationCandidates(features);
	const coreById = new Map(coreCandidates.map(feature => [feature.id, feature]));

	return graph.nets
		.filter(net => net.componentIds.includes(componentId))
		.map(net => {
			const profile = profiles.get(net.name);
			if (!profile) {
				throw new Error(`Missing net profile for ${net.name}`);
			}

			const hosts = net.componentIds
				.filter(id => id !== componentId)
				.map(id => coreById.get(id))
				.filter((item): item is StructuralFeature => Boolean(item));

			return {
				netName: net.name,
				classification: profile.classification,
				hostIds: hosts.map(item => item.id),
				hostDesignators: hosts.map(item => item.designator),
				componentCount: net.componentIds.length,
			};
		});
}

function validExplicitOwner(
	hints: ExplicitOwnershipHint[],
	componentId: string,
	coreIds: Set<string>,
): ExplicitOwnershipHint | undefined {
	return hints.find(
		hint =>
			hint.componentId === componentId
			&& coreIds.has(hint.ownerComponentId),
	);
}

export function resolveOwnershipRelation(
	graph: CircuitGraph,
	features: StructuralFeature[],
	componentId: string,
	explicitOwnershipHints: ExplicitOwnershipHint[] = [],
): OwnershipRelationResult {
	const node = graph.nodes.find(item => item.id === componentId);
	if (!node) {
		throw new Error(`Unknown component id: ${componentId}`);
	}

	const coreCandidates = getCoreAssociationCandidates(features);
	const coreById = new Map(coreCandidates.map(feature => [feature.id, feature]));
	const coreIds = new Set(coreCandidates.map(feature => feature.id));
	const explicit = validExplicitOwner(
		explicitOwnershipHints,
		componentId,
		coreIds,
	);

	if (explicit) {
		const owner = coreById.get(explicit.ownerComponentId);
		if (!owner) {
			throw new Error('Explicit owner vanished from candidate pool.');
		}

		return {
			componentId,
			designator: node.designator,
			relation: 'explicit-owner',
			ownerDesignator: owner.designator,
			hostDesignators: [owner.designator],
			sharedSignalNets: [],
			railNets: [],
			evidence: [
				{
					kind: 'explicit-owner',
					hostDesignators: [owner.designator],
					detail: `显式归属来源：${explicit.source}`,
				},
			],
			explanation:
				'工程或用户提供了显式归属，优先级高于自动拓扑推断。',
		};
	}

	const netContexts = buildNetHostContexts(
		graph,
		features,
		componentId,
	);

	const informative = netContexts.filter(
		net =>
			net.classification !== 'global-ground'
			&& net.classification !== 'global-power'
			&& net.hostDesignators.length > 0,
	);
	const power = netContexts.filter(
		net =>
			net.classification === 'global-power',
	);
	const ground = netContexts.filter(
		net =>
			net.classification === 'global-ground',
	);

	const sharedSignalNets = informative.filter(
		net => new Set(net.hostDesignators).size >= 2,
	);
	const exclusiveSignalNets = informative.filter(
		net => new Set(net.hostDesignators).size === 1,
	);

	const evidence: OwnershipRelationEvidence[] = [];

	for (const net of ground) {
		evidence.push({
			kind: 'ground-ignored',
			netName: net.netName,
			hostDesignators: net.hostDesignators,
			detail: '全局地网络不用于判断器件归属。',
		});
	}

	for (const net of power) {
		evidence.push({
			kind: 'power-domain',
			netName: net.netName,
			hostDesignators: net.hostDesignators,
			detail:
				`电源网络 ${net.netName} 记录为 rail-domain 证据，不单独决定唯一 owner。`,
		});
	}

	for (const net of sharedSignalNets) {
		evidence.push({
			kind: 'shared-signal',
			netName: net.netName,
			hostDesignators: net.hostDesignators,
			detail:
				`同一信号网络连接多个核心：${net.hostDesignators.join('、')}。`,
		});
	}

	for (const net of exclusiveSignalNets) {
		evidence.push({
			kind: 'exclusive-signal',
			netName: net.netName,
			hostDesignators: net.hostDesignators,
			detail:
				`信号网络 ${net.netName} 只连接候选核心 ${net.hostDesignators[0]}。`,
		});
	}

	if (sharedSignalNets.length > 0) {
		const hosts = Array.from(new Set(
			sharedSignalNets.flatMap(net => net.hostDesignators),
		)).sort();

		return {
			componentId,
			designator: node.designator,
			relation: 'shared-signal',
			hostDesignators: hosts,
			sharedSignalNets: sharedSignalNets.map(net => net.netName),
			railNets: power.map(net => net.netName),
			evidence,
			explanation:
				'至少一个非电源信号网同时连接多个候选核心，因此按共享信号关系处理，不分配唯一 owner。',
		};
	}

	const exclusiveHosts = Array.from(new Set(
		exclusiveSignalNets.flatMap(net => net.hostDesignators),
	)).sort();

	if (exclusiveHosts.length >= 2) {
		return {
			componentId,
			designator: node.designator,
			relation: 'bridge',
			hostDesignators: exclusiveHosts,
			sharedSignalNets: [],
			railNets: power.map(net => net.netName),
			evidence,
			explanation:
				'不同信号网络分别指向不同核心，器件更像跨核心桥接关系，不应强行归属单一核心。',
		};
	}

	if (exclusiveHosts.length === 1) {
		return {
			componentId,
			designator: node.designator,
			relation: 'single-core',
			ownerDesignator: exclusiveHosts[0],
			hostDesignators: exclusiveHosts,
			sharedSignalNets: [],
			railNets: power.map(net => net.netName),
			evidence,
			explanation:
				'所有可区分的非电源信号证据都指向同一个核心，可作为单核心归属候选。',
		};
	}

	if (power.length > 0) {
		const railHosts = Array.from(new Set(
			power.flatMap(net => net.hostDesignators),
		)).sort();

		return {
			componentId,
			designator: node.designator,
			relation: 'rail-domain',
			hostDesignators: railHosts,
			sharedSignalNets: [],
			railNets: power.map(net => net.netName),
			evidence,
			explanation:
				'当前只能确认器件处于某个电源域，无法仅凭电源/地网络确定唯一核心归属。',
		};
	}

	return {
		componentId,
		designator: node.designator,
		relation: 'unknown',
		hostDesignators: [],
		sharedSignalNets: [],
		railNets: [],
		evidence,
		explanation:
			'没有显式归属，也没有足够的非电源信号或电源域证据判断关系类型。',
	};
}

export function resolveOwnershipRelations(
	graph: CircuitGraph,
	features: StructuralFeature[],
	componentIds: string[],
	explicitOwnershipHints: ExplicitOwnershipHint[] = [],
): OwnershipRelationResult[] {
	return componentIds.map(componentId =>
		resolveOwnershipRelation(
			graph,
			features,
			componentId,
			explicitOwnershipHints,
		),
	);
}
