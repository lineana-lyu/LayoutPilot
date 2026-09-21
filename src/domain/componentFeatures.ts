import type { CircuitGraph } from './circuitGraph';

export interface ComponentMetadata {
	id: string;
	designator: string;
	manufacturer?: string;
	supplier?: string;
	footprintName?: string;
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
	coreEvidence: string[];
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
		const evidence: string[] = [];

		if (referencePrefix === 'U') {
			score += 3;
			evidence.push('reference prefix U suggests an IC-class component');
		}

		if (node.padCount >= 16) {
			score += 2;
			evidence.push(`high pad count (${node.padCount})`);
		}
		else if (node.padCount >= 4) {
			score += 1;
			evidence.push(`multi-pad component (${node.padCount} pads)`);
		}

		if (degree >= 3) {
			score += 2;
			evidence.push(`connected to ${degree} neighboring components`);
		}
		else if (degree >= 1) {
			score += 1;
			evidence.push(`connected to ${degree} neighboring component(s)`);
		}

		if (connectedNetCount >= 3) {
			score += 2;
			evidence.push(`participates in ${connectedNetCount} named nets`);
		}
		else if (connectedNetCount >= 1) {
			score += 1;
			evidence.push(`participates in ${connectedNetCount} named net(s)`);
		}

		if (isPassiveCandidate) {
			score -= 3;
			evidence.push('passive-style reference prefix lowers core candidacy');
		}

		if (isBoundaryCandidate) {
			score -= 1;
			evidence.push('connector-style reference prefix is treated as a boundary candidate');
		}

		if (node.isIsolated) {
			score -= 2;
			evidence.push('currently isolated in the circuit graph');
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
