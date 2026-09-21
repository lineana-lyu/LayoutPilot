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

let decisions: HumanOwnershipDecision[] = [];

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

export function upsertHumanOwnershipDecision(
	decision: HumanOwnershipDecision,
): void {
	decisions = [
		...decisions.filter(item =>
			!(
				item.snapshotId === decision.snapshotId
				&& item.componentId === decision.componentId
			),
		),
		decision,
	];
}

export function getHumanOwnershipDecisions(
	snapshotId: string,
): HumanOwnershipDecision[] {
	return decisions.filter(item => item.snapshotId === snapshotId);
}

export function clearHumanOwnershipDecisions(
	snapshotId?: string,
): void {
	if (!snapshotId) {
		decisions = [];
		return;
	}

	decisions = decisions.filter(item => item.snapshotId !== snapshotId);
}

export function toExplicitOwnershipHints(
	snapshotId: string,
): ExplicitOwnershipHint[] {
	return getHumanOwnershipDecisions(snapshotId).map(decision => ({
		componentId: decision.componentId,
		ownerComponentId: decision.ownerComponentId,
		source: decision.source,
	}));
}
