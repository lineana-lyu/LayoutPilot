import type { PhysicalBounds, PlacementPoint } from './physicalPlacement';

export type LayoutPlanStatus =
	| 'preview'
	| 'accepted'
	| 'rejected'
	| 'applied'
	| 'superseded';

export interface LayoutPlanItem {
	constraintId: string;
	subjectId: string;
	subjectDesignator: string;
	ownerId: string;
	ownerDesignator: string;
	powerNet: string;
	groundNet: string;
	ownerPowerPadNumber: string;
	subjectPowerPadNumber: string;
	ownerGroundPadNumber: string;
	subjectGroundPadNumber: string;
	from: PlacementPoint;
	to: PlacementPoint;
	fromBounds: PhysicalBounds;
	toBounds: PhysicalBounds;
	movementMil: number;
	estimatedLoopProxyMil: number;
	clearanceMil: number;
	executionBlockers: string[];
	rationale: string;
}

export interface LayoutPlan {
	schemaVersion: 1;
	id: string;
	snapshotId: string;
	semanticFingerprint: string;
	physicalFingerprint: string;
	createdAt: string;
	status: LayoutPlanStatus;
	items: LayoutPlanItem[];
}

function hashText(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function freezeDeep<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		freezeDeep(child);
	}
	return Object.freeze(value as object) as T;
}

export function createLayoutPlan(input: {
	snapshotId: string;
	semanticFingerprint: string;
	physicalFingerprint: string;
	items: LayoutPlanItem[];
	createdAt?: string;
}): LayoutPlan {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const stableItems = input.items.map(item => ({
		...item,
		from: { ...item.from },
		to: { ...item.to },
		fromBounds: { ...item.fromBounds },
		toBounds: { ...item.toBounds },
		executionBlockers: [...item.executionBlockers],
	}));

	const id = `layout-plan-${hashText(JSON.stringify({
		snapshotId: input.snapshotId,
		semanticFingerprint: input.semanticFingerprint,
		physicalFingerprint: input.physicalFingerprint,
		items: stableItems,
		createdAt,
	}))}`;

	return freezeDeep({
		schemaVersion: 1 as const,
		id,
		snapshotId: input.snapshotId,
		semanticFingerprint: input.semanticFingerprint,
		physicalFingerprint: input.physicalFingerprint,
		createdAt,
		status: 'preview' as const,
		items: stableItems,
	});
}

export function markLayoutPlanAccepted(
	plan: LayoutPlan,
): LayoutPlan {
	return freezeDeep({
		...plan,
		status: 'accepted' as const,
	});
}

export function markLayoutPlanRejected(
	plan: LayoutPlan,
): LayoutPlan {
	return freezeDeep({
		...plan,
		status: 'rejected' as const,
	});
}

export function markLayoutPlanApplied(
	plan: LayoutPlan,
): LayoutPlan {
	return freezeDeep({
		...plan,
		status: 'applied' as const,
	});
}

export function markLayoutPlanSuperseded(
	plan: LayoutPlan,
): LayoutPlan {
	return freezeDeep({
		...plan,
		status: 'superseded' as const,
	});
}

export function layoutPlanMatchesCurrentState(
	plan: LayoutPlan,
	input: {
		snapshotId: string;
		semanticFingerprint: string;
		physicalFingerprint: string;
	},
): boolean {
	return plan.snapshotId === input.snapshotId
		&& plan.semanticFingerprint === input.semanticFingerprint
		&& plan.physicalFingerprint === input.physicalFingerprint;
}
