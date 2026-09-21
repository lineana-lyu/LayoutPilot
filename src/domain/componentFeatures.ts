import type { CircuitGraph } from './circuitGraph';

export interface ComponentMetadata {
	id: string;
	designator: string;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
}

export type StructuralEvidenceCode =
	| 'IC_PREFIX'
	| 'HIGH_PAD_COUNT'
	| 'MULTI_PAD'
	| 'HIGH_DEGREE'
	| 'LOW_DEGREE'
	| 'HIGH_NET_COUNT'
	| 'LOW_NET_COUNT'
	| 'PASSIVE_PREFIX'
	| 'BOUNDARY_PREFIX'
	| 'ISOLATED';

export interface StructuralEvidence {
	code: StructuralEvidenceCode;
	value?: number;
}

export interface StructuralFeature {
	id: string;
	designator: string;
	referencePrefix: string;
	padCount: number;
	degree: number;
	connectedNetCount: number;
	maxComponentsOnSharedNet: number;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
	isPassiveCandidate: boolean;
	isBoundaryCandidate: boolean;
	coreScore: number;
	coreLevel: 'low' | 'medium' | 'high';
	coreEvidence: StructuralEvidence[];
}

const PASSIVE_PREFIXES = new Set(['R', 'C', 'L', 'D', 'FB']);
const BOUNDARY_PREFIXES = new Set(['J', 'P', 'CN']);

export function getReferencePrefix(designator: string): string {
	const match = designator.toUpperCase().match(/^[A-Z]+/);
	return match?.[0] ?? '';
}

export function extractStructuralFeatures(
	graph: CircuitGraph,
	metadata: ComponentMetadata[],
): StructuralFeature[] {
	const metadataById = new Map(metadata.map(item => [item.id, item]));

	return graph.nodes.map(node => {
		const meta = metadataById.get(node.id);
		const referencePrefix = getReferencePrefix(node.designator);
		const degree = node.neighborComponentIds.length;
		const connectedNetCount = node.connectedNetCount;
		const isPassiveCandidate = PASSIVE_PREFIXES.has(referencePrefix);
		const isBoundaryCandidate = BOUNDARY_PREFIXES.has(referencePrefix);

		const sharedNetSizes = graph.nets
			.filter(net => net.componentIds.includes(node.id))
			.map(net => net.componentIds.length);
		const maxComponentsOnSharedNet = sharedNetSizes.length
			? Math.max(...sharedNetSizes)
			: 0;

		let score = 0;
		const evidence: StructuralEvidence[] = [];

		if (referencePrefix === 'U') {
			score += 3;
			evidence.push({ code: 'IC_PREFIX' });
		}

		if (node.padCount >= 16) {
			score += 2;
			evidence.push({ code: 'HIGH_PAD_COUNT', value: node.padCount });
		}
		else if (node.padCount >= 4) {
			score += 1;
			evidence.push({ code: 'MULTI_PAD', value: node.padCount });
		}

		if (degree >= 3) {
			score += 2;
			evidence.push({ code: 'HIGH_DEGREE', value: degree });
		}
		else if (degree >= 1) {
			score += 1;
			evidence.push({ code: 'LOW_DEGREE', value: degree });
		}

		if (connectedNetCount >= 3) {
			score += 2;
			evidence.push({ code: 'HIGH_NET_COUNT', value: connectedNetCount });
		}
		else if (connectedNetCount >= 1) {
			score += 1;
			evidence.push({ code: 'LOW_NET_COUNT', value: connectedNetCount });
		}

		if (isPassiveCandidate) {
			score -= 3;
			evidence.push({ code: 'PASSIVE_PREFIX' });
		}

		if (isBoundaryCandidate) {
			score -= 1;
			evidence.push({ code: 'BOUNDARY_PREFIX' });
		}

		if (node.isIsolated) {
			score -= 2;
			evidence.push({ code: 'ISOLATED' });
		}

		const coreScore = Math.max(0, Math.min(10, score));
		const coreLevel = coreScore >= 6 ? 'high' : coreScore >= 3 ? 'medium' : 'low';

		return {
			id: node.id,
			designator: node.designator,
			referencePrefix,
			padCount: node.padCount,
			degree,
			connectedNetCount,
			maxComponentsOnSharedNet,
			manufacturer: meta?.manufacturer,
			supplier: meta?.supplier,
			footprintName: meta?.footprintName,
			isPassiveCandidate,
			isBoundaryCandidate,
			coreScore,
			coreLevel,
			coreEvidence: evidence,
		};
	});
}
