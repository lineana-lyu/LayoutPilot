import type { ExplicitOwnershipHint } from './ownershipRelation';

export interface HumanOwnershipDecision {
	snapshotId: string;
	componentId: string;
	componentDesignator: string;
	ownerComponentId: string;
	ownerDesignator: string;
	createdAt: string;
	source: 'user-confirmed-owner-v1';
}

export function createHumanOwnershipDecision(
	input: Omit<HumanOwnershipDecision, 'createdAt' | 'source'>,
	createdAt = new Date().toISOString(),
): HumanOwnershipDecision {
	return Object.freeze({
		...input,
		createdAt,
		source: 'user-confirmed-owner-v1' as const,
	});
}

export function toExplicitOwnershipHints(
	decisions: HumanOwnershipDecision[],
): ExplicitOwnershipHint[] {
	return decisions.map(decision => ({
		componentId: decision.componentId,
		ownerComponentId: decision.ownerComponentId,
		source: decision.source,
	}));
}
