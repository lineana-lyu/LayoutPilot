import type { CandidateGroupingResult } from './candidateGrouping';
import type { CircuitGraph } from './circuitGraph';
import type { StructuralFeature } from './componentFeatures';
import { buildNetGroupingProfiles, type NetGroupingClass } from './netInformativeness';

export type CoreAssociationStatus =
	| 'resolved'
	| 'ambiguous'
	| 'insufficient-evidence';

export type CoreAssociationEvidenceKind =
	| 'direct-informative-net'
	| 'direct-low-fanout-power'
	| 'direct-high-fanout'
	| 'ignored-ground'
	| 'grouping-candidate';

export interface CoreAssociationEvidence {
	kind: CoreAssociationEvidenceKind;
	netName?: string;
	classification?: NetGroupingClass;
	fanout?: number;
	contribution: number;
	detail: string;
}

export interface CoreAssociationCandidate {
	componentId: string;
	designator: string;
	coreLevel: StructuralFeature['coreLevel'];
	coreScore: number;
	score: number;
	evidence: CoreAssociationEvidence[];
}

export interface CoreAssociationResult {
	componentId: string;
	designator: string;
	status: CoreAssociationStatus;
	resolvedCoreDesignator?: string;
	candidates: CoreAssociationCandidate[];
	topScore: number;
	margin?: number;
	explanation: string;
}

const MIN_RESOLVED_SCORE = 0.5;
const MIN_RESOLVED_MARGIN = 0.2;

export function getCoreAssociationCandidates(features: StructuralFeature[]): StructuralFeature[] {
	return features.filter(
		feature =>
			feature.isCoreEligible
			&& feature.coreLevel !== 'low',
	);
}

function associationBaseWeight(classification: NetGroupingClass): number {
	switch (classification) {
		case 'named-signal':
		case 'local':
			return 1;
		case 'global-power':
			return 0.55;
		case 'high-fanout':
			return 0.15;
		case 'global-ground':
		default:
			return 0;
	}
}

function evidenceKind(classification: NetGroupingClass, fanout: number):
CoreAssociationEvidenceKind {
	if (classification === 'global-ground') {
		return 'ignored-ground';
	}
	if (classification === 'global-power') {
		return fanout <= 3
			? 'direct-low-fanout-power'
			: 'direct-high-fanout';
	}
	if (classification === 'high-fanout') {
		return 'direct-high-fanout';
	}
	return 'direct-informative-net';
}

function scoreContribution(
	classification: NetGroupingClass,
	componentCountOnNet: number,
): number {
	if (classification === 'global-ground') {
		return 0;
	}

	const peerCount = Math.max(1, componentCountOnNet - 1);
	return associationBaseWeight(classification) / peerCount;
}

function groupingCandidatesFor(
	grouping: CandidateGroupingResult,
	designator: string,
): Set<string> {
	const evidence = grouping.ambiguityEvidence.find(
		item => item.component === designator,
	);

	return new Set(evidence?.cores ?? []);
}

export function resolveCoreAssociation(
	graph: CircuitGraph,
	features: StructuralFeature[],
	grouping: CandidateGroupingResult,
	componentId: string,
): CoreAssociationResult {
	const node = graph.nodes.find(item => item.id === componentId);
	if (!node) {
		throw new Error(`Unknown component id: ${componentId}`);
	}

	const featureById = new Map(features.map(feature => [feature.id, feature]));
	const coreCandidates = getCoreAssociationCandidates(features);
	const candidateById = new Map(
		coreCandidates.map(feature => [feature.id, feature]),
	);
	const profiles = buildNetGroupingProfiles(graph);
	const groupingCandidateDesignators = groupingCandidatesFor(
		grouping,
		node.designator,
	);

	const ranked = new Map<string, CoreAssociationCandidate>();

	const ensureCandidate = (core: StructuralFeature): CoreAssociationCandidate => {
		const existing = ranked.get(core.id);
		if (existing) {
			return existing;
		}

		const created: CoreAssociationCandidate = {
			componentId: core.id,
			designator: core.designator,
			coreLevel: core.coreLevel,
			coreScore: core.coreScore,
			score: 0,
			evidence: [],
		};
		ranked.set(core.id, created);
		return created;
	};

	for (const net of graph.nets) {
		if (!net.componentIds.includes(componentId)) {
			continue;
		}

		const profile = profiles.get(net.name);
		if (!profile) {
			continue;
		}

		const coresOnNet = net.componentIds
			.filter(id => id !== componentId)
			.map(id => candidateById.get(id))
			.filter((item): item is StructuralFeature => Boolean(item));

		if (profile.classification === 'global-ground') {
			for (const core of coresOnNet) {
				ensureCandidate(core).evidence.push({
					kind: 'ignored-ground',
					netName: net.name,
					classification: profile.classification,
					fanout: net.componentIds.length,
					contribution: 0,
					detail: '全局地网络仅记录，不参与 owner 选择。',
				});
			}
			continue;
		}

		for (const core of coresOnNet) {
			const contribution = scoreContribution(
				profile.classification,
				net.componentIds.length,
			);
			const candidate = ensureCandidate(core);
			candidate.score += contribution;
			candidate.evidence.push({
				kind: evidenceKind(
					profile.classification,
					net.componentIds.length,
				),
				netName: net.name,
				classification: profile.classification,
				fanout: net.componentIds.length,
				contribution,
				detail:
					`${net.name}（${profile.classification}，`
					+ `${net.componentIds.length} 个器件）贡献 `
					+ contribution.toFixed(3),
			});
		}
	}

	for (const candidate of ranked.values()) {
		if (groupingCandidateDesignators.has(candidate.designator)) {
			candidate.evidence.push({
				kind: 'grouping-candidate',
				contribution: 0,
				detail: '候选分组层也将其列为可能核心；仅作佐证，不重复计分。',
			});
		}
	}

	const candidates = Array.from(ranked.values())
		.sort(
			(a, b) =>
				b.score - a.score
				|| b.coreScore - a.coreScore
				|| a.designator.localeCompare(b.designator),
		);

	const top = candidates[0];
	const second = candidates[1];
	const topScore = top?.score ?? 0;
	const margin = top && second
		? top.score - second.score
		: top
			? top.score
			: undefined;

	if (!top || topScore < MIN_RESOLVED_SCORE) {
		return {
			componentId,
			designator: node.designator,
			status: 'insufficient-evidence',
			candidates,
			topScore,
			margin,
			explanation:
				'没有候选核心达到最小证据阈值；全局地不参与 owner 选择，高扇出网络只提供弱证据。',
		};
	}

	if (
		second
		&& second.score > 0
		&& (top.score - second.score) < MIN_RESOLVED_MARGIN
	) {
		return {
			componentId,
			designator: node.designator,
			status: 'ambiguous',
			candidates,
			topScore,
			margin,
			explanation:
				'前两名候选核心证据接近，保留歧义而不强行选择 owner。',
		};
	}

	return {
		componentId,
		designator: node.designator,
		status: 'resolved',
		resolvedCoreDesignator: top.designator,
		candidates,
		topScore,
		margin,
		explanation:
			'存在唯一且证据领先的候选核心；结果仅用于诊断，不会改写现有 Semantic Context。',
	};
}

export function resolveAmbiguousCoreAssociations(
	graph: CircuitGraph,
	features: StructuralFeature[],
	grouping: CandidateGroupingResult,
): CoreAssociationResult[] {
	return grouping.ambiguousComponentIds.map(componentId =>
		resolveCoreAssociation(graph, features, grouping, componentId),
	);
}
